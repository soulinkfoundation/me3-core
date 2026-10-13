import { addDaysToDateString, getUtcMsForLocalTime, normalizeTimeZone } from "./calendar";
import { loadCalendarPushItems } from "./calendar-push-notifications";
import { notifyDailyBriefingReady, type DailyBriefingPushSummary } from "./push-notifications";
import type { Env } from "./types";
import { getBriefingQuote } from "./quotes";

export const MORNING_CALENDAR_PUSH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS morning_calendar_push_dispatches (
    user_id TEXT NOT NULL REFERENCES owner_profile(id) ON DELETE CASCADE,
    date_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date_key)
  )`,
] as const;

export function normalizeDailyBriefingTime(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

export async function dispatchDueMorningCalendarPushes(env: Env, now = new Date()) {
  const owners = await env.DB.prepare(
    "SELECT id, timezone, daily_briefing_time FROM owner_profile ORDER BY created_at ASC",
  ).all<{ id: string; timezone: string | null; daily_briefing_time: string | null }>();
  let sent = 0;
  let failed = 0;
  for (const owner of owners.results || []) {
    const timezone = normalizeTimeZone(owner.timezone) || "UTC";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
    const dateKey = `${part("year")}-${part("month")}-${part("day")}`;
    if (`${part("hour")}:${part("minute")}` < (normalizeDailyBriefingTime(owner.daily_briefing_time) || "07:30")) continue;

    const claim = await env.DB.prepare(
      `INSERT INTO morning_calendar_push_dispatches (user_id, date_key, status, claimed_at)
       VALUES (?, ?, 'pending', ?)
       ON CONFLICT(user_id, date_key) DO UPDATE SET status = 'pending', claimed_at = excluded.claimed_at
       WHERE morning_calendar_push_dispatches.status = 'failed'
          OR (morning_calendar_push_dispatches.status = 'pending' AND morning_calendar_push_dispatches.claimed_at < ?)`,
    ).bind(owner.id, dateKey, now.getTime(), now.getTime() - 5 * 60_000).run();
    if (!claim.meta?.changes) continue;

    let delivered = false;
    try {
      const midnight = (date: string) => {
        const [year, month, day] = date.split("-").map(Number);
        return new Date(getUtcMsForLocalTime({ year, month, day, hour: 0, minute: 0 }, timezone)).toISOString();
      };
      const items = await loadCalendarPushItems(env, owner.id, midnight(dateKey), midnight(addDaysToDateString(dateKey, 1)));
      const birthdays = items.events.filter(event => event.kind === "birthday");
      const quote = await getBriefingQuote(env, owner.id, now);
      const summary: DailyBriefingPushSummary = {
        ...(quote ? { quote: { text: quote.text, author: quote.author } } : {}),
        birthdayNames: birthdays.map(event => event.title.replace(/['’]s birthday$/i, "").trim()),
        counts: {
          birthdays: birthdays.length,
          events: items.events.length - birthdays.length + items.importedEvents.length,
          bookings: items.bookings.length,
          reminders: items.reminders.length,
        },
      };
      const result = await notifyDailyBriefingReady(env, `daily:${dateKey}`, summary);
      delivered = result.ok === true && (typeof result.retryable === "number"
        ? result.retryable === 0
        : Number(result.sent || 0) + Number(result.alreadySent || 0) >= Number(result.matched || 0));
    } catch {
      console.warn("Morning calendar push was deferred", { dateKey });
    }
    await env.DB.prepare(
      "UPDATE morning_calendar_push_dispatches SET status = ? WHERE user_id = ? AND date_key = ? AND claimed_at = ?",
    ).bind(delivered ? "sent" : "failed", owner.id, dateKey, now.getTime()).run();
    if (delivered) sent++; else failed++;
  }
  return { checkedAt: now.toISOString(), sent, failed };
}
