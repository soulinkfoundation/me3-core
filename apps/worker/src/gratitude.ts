import { addDaysToDateString, getUtcMsForLocalTime } from "./calendar";
import { dispatchCalendarPushCandidate } from "./calendar-push-notifications";
import { getTodayQuote, ownerLocalClock } from "./quotes";
import { JournalInputError } from "./journal";
import { isRecord, parseJsonRecord } from "./workspace-input";
import type { Env, DbUserReminder } from "./types";

export function gratitudeLines(value: unknown): string[] {
  return Array.from({ length: 3 }, (_, i) => Array.isArray(value) && typeof value[i] === "string" ? value[i] : "");
}
const hasLine = (value: unknown) => gratitudeLines(value).some(line => line.trim());
const reminderId = (userId: string) => `card:gratitude:${userId}`;
function atNine(date: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(getUtcMsForLocalTime({ year, month, day, hour: 21, minute: 0 }, timezone)).toISOString();
}

export async function getGratitudeSettings(env: Env, userId: string) {
  const [setting, reminder] = await Promise.all([
    env.DB.prepare("SELECT quote_in_briefing, in_today FROM gratitude_settings WHERE user_id = ?").bind(userId).first<{ quote_in_briefing: number; in_today: number }>(),
    env.DB.prepare("SELECT status FROM user_reminders WHERE user_id = ? AND context_type = 'card' AND context_id = 'gratitude'").bind(userId).first<{ status: string }>(),
  ]);
  // inToday: Gratitude shows as a section of the Home Today card. Off by default.
  return { quoteInBriefing: setting?.quote_in_briefing !== 0, eveningReminder: !!reminder && ["pending", "failed"].includes(reminder.status), inToday: setting?.in_today === 1 };
}

export async function getGratitudeState(env: Env, userId: string, now = new Date()) {
  const clock = await ownerLocalClock(env, userId, now);
  const [rows, quote, settings] = await Promise.all([
    env.DB.prepare("SELECT entry_date, metadata_json FROM journal_entries WHERE user_id = ? AND entry_date >= ? AND entry_date <= ? AND archived_at IS NULL").bind(userId, addDaysToDateString(clock.date, -6), clock.date).all<{ entry_date: string; metadata_json: string }>(),
    getTodayQuote(env, userId, now),
    getGratitudeSettings(env, userId),
  ]);
  const metadata = new Map((rows.results || []).map(row => [row.entry_date, parseJsonRecord(row.metadata_json)]));
  const today = metadata.get(clock.date);
  return { ...clock, quote, gratitude: gratitudeLines(today?.gratitude), goodThings: gratitudeLines(today?.goodThings), settings,
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDaysToDateString(clock.date, i - 6); const day = metadata.get(date);
      return { date, written: hasLine(day?.gratitude) || hasLine(day?.goodThings) };
    }),
  };
}

export async function updateGratitudeLines(env: Env, userId: string, input: unknown, now = new Date()) {
  if (!isRecord(input)) throw new JournalInputError("Lines are required");
  const { date } = await ownerLocalClock(env, userId, now);
  if (input.date !== date) throw new JournalInputError("The day changed. Refresh before saving.", 409);
  const keys = (["gratitude", "goodThings"] as const).filter(key => input[key] !== undefined);
  if (!keys.length) throw new JournalInputError("Lines are required");
  const jsonArgs: string[] = [];
  for (const key of keys) {
    const value = input[key];
    if (!Array.isArray(value) || value.length > 3 || value.some(line => typeof line !== "string" || line.length > 1000)) throw new JournalInputError("Write up to three lines of 1000 characters each");
    jsonArgs.push(JSON.stringify(gratitudeLines(value).map(line => line.trim())));
  }
  // json_set changes just these lists atomically; the owner's writing is untouched.
  // A page the owner deleted (archived) starts over, so its old writing stays deleted.
  const paths = keys.map(key => `, '$.${key}', json(?)`).join("");
  const deleted = "journal_entries.archived_at IS NOT NULL";
  await env.DB.prepare(`INSERT INTO journal_entries(id, user_id, entry_date, body, body_format, metadata_json, updated_at, revision)
    VALUES (?, ?, ?, '', 'html', json_set('{}'${paths}), ?, 1)
    ON CONFLICT(user_id, entry_date) DO UPDATE SET
      title = CASE WHEN ${deleted} THEN NULL ELSE journal_entries.title END,
      body = CASE WHEN ${deleted} THEN '' ELSE journal_entries.body END,
      body_format = CASE WHEN ${deleted} THEN 'html' ELSE journal_entries.body_format END,
      metadata_json = json_set(CASE WHEN ${deleted} THEN '{}' ELSE journal_entries.metadata_json END${paths}),
      archived_at = NULL, updated_at = excluded.updated_at, revision = journal_entries.revision + 1`).bind(crypto.randomUUID(), userId, date, ...jsonArgs, now.toISOString(), ...jsonArgs).run();
  return { ok: true };
}

export async function updateGratitudeSettings(env: Env, userId: string, input: unknown, now = new Date()) {
  if (!isRecord(input) || Object.keys(input).some(key => !["quoteInBriefing", "eveningReminder", "inToday"].includes(key) || typeof input[key] !== "boolean")) throw new JournalInputError("Reminder settings are invalid");
  if (typeof input.quoteInBriefing === "boolean") {
    await env.DB.prepare("INSERT INTO gratitude_settings(user_id, quote_in_briefing) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET quote_in_briefing = excluded.quote_in_briefing").bind(userId, Number(input.quoteInBriefing)).run();
  }
  if (typeof input.inToday === "boolean") {
    await env.DB.prepare("INSERT INTO gratitude_settings(user_id, in_today) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET in_today = excluded.in_today").bind(userId, Number(input.inToday)).run();
  }
  if (typeof input.eveningReminder === "boolean") {
    if (input.eveningReminder) {
      const clock = await ownerLocalClock(env, userId, now);
      let due = atNine(clock.date, clock.timezone);
      if (due <= now.toISOString()) due = atNine(addDaysToDateString(clock.date, 1), clock.timezone);
      await env.DB.prepare(`INSERT INTO user_reminders(id, user_id, title, remind_at, timezone, recurrence_rule, context_type, context_id, context_label, created_via)
        VALUES (?, ?, 'Three good things', ?, ?, 'FREQ=DAILY', 'card', 'gratitude', 'Gratitude', 'owner')
        ON CONFLICT(user_id, context_id) WHERE context_type = 'card' DO UPDATE SET
          remind_at = excluded.remind_at, timezone = excluded.timezone, status = 'pending', cancelled_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP`).bind(reminderId(userId), userId, due, clock.timezone).run();
    } else {
      await env.DB.prepare("UPDATE user_reminders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND context_type = 'card' AND context_id = 'gratitude'").bind(userId).run();
    }
  }
  return { settings: await getGratitudeSettings(env, userId) };
}

export async function dispatchDueGratitudeReminders(env: Env, now = new Date()) {
  const rows = await env.DB.prepare("SELECT * FROM user_reminders WHERE context_type = 'card' AND context_id = 'gratitude' AND status IN ('pending', 'failed') AND remind_at <= ?").bind(now.toISOString()).all<DbUserReminder>();
  for (const reminder of rows.results || []) {
    const clock = await ownerLocalClock(env, reminder.user_id, now);
    const dueDate = (await ownerLocalClock(env, reminder.user_id, new Date(reminder.remind_at))).date;
    const day = await env.DB.prepare("SELECT metadata_json FROM journal_entries WHERE user_id = ? AND entry_date = ? AND archived_at IS NULL").bind(reminder.user_id, clock.date).first<{ metadata_json: string }>();
    let advance = dueDate !== clock.date || hasLine(parseJsonRecord(day?.metadata_json || null).goodThings);
    if (!advance) {
      const result = await dispatchCalendarPushCandidate(env, {
        userId: reminder.user_id, category: "reminders", itemId: reminder.id, title: "Three good things",
        occurrenceId: reminder.remind_at, alertOffsetMinutes: 0, alertAt: reminder.remind_at,
        contextType: "card", contextId: "gratitude",
      });
      advance = result.outcome === "sent" || result.outcome === "skipped";
      if (result.outcome === "already_dispatched") {
        const dispatch = await env.DB.prepare("SELECT status FROM calendar_push_dispatches WHERE user_id = ? AND category = 'reminders' AND item_id = ? AND occurrence_id = ? AND alert_offset_minutes = 0").bind(reminder.user_id, reminder.id, reminder.remind_at).first<{ status: string }>();
        advance = dispatch?.status === "sent" || dispatch?.status === "skipped";
      }
    }
    if (advance) {
      const nextDate = atNine(clock.date, clock.timezone) > now.toISOString() ? clock.date : addDaysToDateString(clock.date, 1);
      await env.DB.prepare("UPDATE user_reminders SET remind_at = ?, timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND remind_at = ? AND status IN ('pending', 'failed')").bind(atNine(nextDate, clock.timezone), clock.timezone, reminder.id, reminder.remind_at).run();
    }
  }
}
