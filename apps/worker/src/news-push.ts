// "Your news is ready" (me3-6ptk.4): one notification a day, at the owner's time, once the paper
// is built. It rides the card push path Gratitude uses (a title, a card context the apps open),
// so there is no new Cloud push type; calendar_push_dispatches keeps it to exactly one per owner
// and day. A paper that was late is announced when it is ready. Nothing is sent while News is
// paused, the owner switched notifications off, or the paper has already been read.
import { dispatchCalendarPushCandidate } from "./calendar-push-notifications";
import { isCorePluginEnabled } from "./plugins";
import { SOUP_PLUGIN_ID, parseSoupTaste, type NewsPrefs } from "./soup-taste";
import { parseJsonRecord } from "./workspace-input";
import type { Env } from "./types";

export const NEWS_PUSH_TITLE = "🗞️ Your news is ready";
/** Every paper is announced under the same item; the day is the occurrence. */
export const NEWS_PUSH_ITEM_ID = "news-paper";
/** A paper more than this late is no longer morning news worth a notification. */
const NEWS_PUSH_WINDOW_MS = 4 * 3_600_000;

export type NewsPushPaper = { status: string; deliver_at: string; read_at: string | null; hidden_at: string | null };

/** Whether this paper should be announced now. Pure, so the rules are testable without a database. */
export function newsPushDue(prefs: Pick<NewsPrefs, "notify" | "paused" | "setUpAt"> | null, paper: NewsPushPaper, now: Date): boolean {
  if (!prefs?.setUpAt || prefs.paused || !prefs.notify) return false;
  if (paper.status !== "ready" || paper.read_at || paper.hidden_at) return false;
  const due = Date.parse(paper.deliver_at);
  return Number.isFinite(due) && now.getTime() >= due && now.getTime() < due + NEWS_PUSH_WINDOW_MS;
}

type DueRow = NewsPushPaper & { id: string; user_id: string; date_key: string; taste_json: string };

/** Runs every minute: announce each ready paper whose time has come and that has not been announced. */
export async function dispatchDueNewsNotifications(env: Env, now = new Date()) {
  if (!await isCorePluginEnabled(env, SOUP_PLUGIN_ID)) return { skipped: "plugin disabled" };
  const since = new Date(now.getTime() - NEWS_PUSH_WINDOW_MS).toISOString();
  const rows = await env.DB.prepare(`SELECT p.id, p.user_id, p.date_key, p.status, p.deliver_at, p.read_at, p.hidden_at, t.taste_json
    FROM news_papers p JOIN soup_taste t ON t.user_id = p.user_id
    WHERE p.status = 'ready' AND p.deliver_at <= ? AND p.deliver_at > ?
      AND NOT EXISTS (SELECT 1 FROM calendar_push_dispatches d WHERE d.user_id = p.user_id AND d.category = 'reminders'
        AND d.item_id = ? AND d.occurrence_id = p.date_key AND d.alert_offset_minutes = 0 AND d.status = 'sent')`)
    .bind(now.toISOString(), since, NEWS_PUSH_ITEM_ID).all<DueRow>();
  let sent = 0;
  for (const row of rows.results || []) {
    if (!newsPushDue(parseSoupTaste(parseJsonRecord(row.taste_json)).news, row, now)) continue;
    const result = await dispatchCalendarPushCandidate(env, {
      userId: row.user_id, category: "reminders", itemId: NEWS_PUSH_ITEM_ID, occurrenceId: row.date_key,
      alertOffsetMinutes: 0, alertAt: row.deliver_at, title: NEWS_PUSH_TITLE, contextType: "card", contextId: "news",
    }, now);
    if (result.outcome === "sent") sent++;
  }
  return { checkedAt: now.toISOString(), sent };
}
