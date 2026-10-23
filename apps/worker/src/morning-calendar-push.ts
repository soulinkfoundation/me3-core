import { addDaysToDateString, getUtcMsForLocalTime, normalizeTimeZone } from "./calendar";
import { loadCalendarPushItems } from "./calendar-push-notifications";
import { recordOwnerActivity } from "./mission-activity";
import { composeMorningMessage } from "./morning-message";
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
    "SELECT id, name, timezone, daily_briefing_time FROM owner_profile ORDER BY created_at ASC",
  ).all<{ id: string; name: string | null; timezone: string | null; daily_briefing_time: string | null }>();
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
    // A missed cron catches up, but only while it is still morning: a phone set up in
    // the evening should not be told "Good morning".
    const localTime = `${part("hour")}:${part("minute")}`;
    const briefingTime = normalizeDailyBriefingTime(owner.daily_briefing_time) || "07:30";
    if (localTime < briefingTime || localTime >= briefingDeadline(briefingTime)) continue;

    const claim = await env.DB.prepare(
      `INSERT INTO morning_calendar_push_dispatches (user_id, date_key, status, claimed_at)
       VALUES (?, ?, 'pending', ?)
       ON CONFLICT(user_id, date_key) DO UPDATE SET status = 'pending', claimed_at = excluded.claimed_at
       WHERE morning_calendar_push_dispatches.status = 'failed'
          OR (morning_calendar_push_dispatches.status = 'pending' AND morning_calendar_push_dispatches.claimed_at < ?)`,
    ).bind(owner.id, dateKey, now.getTime(), now.getTime() - 5 * 60_000).run();
    if (!claim.meta?.changes) continue;

    let delivered = false;
    let reachedDevice = false;
    let summary: DailyBriefingPushSummary | null = null;
    try {
      const midnight = (date: string) => {
        const [year, month, day] = date.split("-").map(Number);
        return new Date(getUtcMsForLocalTime({ year, month, day, hour: 0, minute: 0 }, timezone)).toISOString();
      };
      const items = await loadCalendarPushItems(env, owner.id, midnight(dateKey), midnight(addDaysToDateString(dateKey, 1)));
      const birthdays = items.events.filter(event => event.kind === "birthday");
      const quote = await getBriefingQuote(env, owner.id, now);
      const birthdayNames = birthdays.map(event => event.title.replace(/['’]s birthday$/i, "").trim());
      const startsAt = (event: { all_day: number; starts_at: string }) => (event.all_day === 1 ? null : event.starts_at);
      summary = {
        ...(quote ? { quote: { text: quote.text, author: quote.author } } : {}),
        alert: composeMorningMessage({
          ownerName: owner.name,
          timezone,
          birthdayNames,
          schedule: [
            ...items.events.filter(event => event.kind !== "birthday").map(event => ({ title: event.title, startsAt: startsAt(event), timezone: event.timezone })),
            ...items.importedEvents.map(event => ({ title: event.title, startsAt: startsAt(event), timezone: event.timezone })),
            ...items.bookings.map(booking => ({ title: `Booking with ${booking.guest_name}`, startsAt: booking.starts_at })),
          ],
          reminders: items.reminders.map(reminder => ({ title: reminder.title, startsAt: reminder.remind_at, timezone: reminder.timezone })),
        }),
        birthdayNames,
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
      reachedDevice = Number(result.sent || 0) + Number(result.alreadySent || 0) > 0;
    } catch {
      console.warn("Morning calendar push was deferred", { dateKey });
    }
    await env.DB.prepare(
      "UPDATE morning_calendar_push_dispatches SET status = ? WHERE user_id = ? AND date_key = ? AND claimed_at = ?",
    ).bind(delivered ? "sent" : "failed", owner.id, dateKey, now.getTime()).run();
    if (delivered) sent++; else failed++;
    // With no registered device the briefing reached no one, so it is not work done.
    if (delivered && reachedDevice && summary) await recordOwnerActivity(env, owner.id, {
      pluginId: "me3.mission-control",
      activityType: "daily_briefing.sent",
      title: "Sent your morning briefing",
      summary: describeBriefingDay(summary),
      status: "succeeded",
      relatedId: `daily-briefing:${dateKey}`,
    });
  }
  return { checkedAt: now.toISOString(), sent, failed };
}

/** Noon, or three hours after a late briefing time, whichever is later. */
function briefingDeadline(briefingTime: string) {
  const [hour, minute] = briefingTime.split(":").map(Number);
  const end = Math.min(Math.max(12 * 60, hour * 60 + minute + 180), 24 * 60);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function describeBriefingDay(summary: DailyBriefingPushSummary) {
  const counts = summary.counts;
  const parts = ([
    [counts.events, "event"], [counts.bookings, "booking"], [counts.reminders, "reminder"], [counts.birthdays, "birthday"],
  ] as const).filter(([count]) => count > 0).map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`);
  if (parts.length === 0) return "Nothing on your calendar today.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${list} today.`;
}
