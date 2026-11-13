// Owners who set up Soup keep going as News (me3-6ptk.7), without redoing setup. Their topics are
// already the two lanes News uses; this adds the News settings beside them: the time of their
// morning headlines becomes the paper's time, the other servings are dropped, and open scheduled
// servings are closed so no Soup card lingers. Someone who asked for soup "only when I ask" never
// had a schedule, so News stays off for them and shows its intro when they add it.
import { normalizeDailyBriefingTime } from "./morning-calendar-push";
import { defaultNewsPrefs } from "./news-settings";
import { cityFromTimezone, geocodeCity, type NewsPlace } from "./news-weather";
import { parseSoupTaste, snapNewsTime, type NewsPrefs, type SoupTaste } from "./soup-taste";
import { parseJsonRecord } from "./workspace-input";
import type { Env } from "./types";

/** The News settings a Soup setup turns into, or null when there is nothing to carry over. Pure. */
export function newsPrefsFromSoup(taste: SoupTaste, context: { briefingTime: string | null; removedFromHome: boolean; place?: NewsPlace | null; now: Date }): NewsPrefs | null {
  if (taste.news || !taste.servings.length) return null;
  if (!taste.workTopics.length && !taste.interests.length) return null;
  const headlines = taste.servings.find(serving => serving.kind === "headlines");
  const prefs = defaultNewsPrefs(snapNewsTime(headlines?.time) || context.briefingTime);
  prefs.setUpAt = context.now.toISOString();
  // A Soup card the owner took off Home stays off: News is carried over but paused.
  prefs.paused = context.removedFromHome;
  if (context.place) { prefs.city = context.place.city; prefs.country = context.place.country; prefs.lat = context.place.lat; prefs.lon = context.place.lon; }
  return prefs;
}

type Row = { user_id: string; taste_json: string; timezone: string | null; daily_briefing_time: string | null; layout_json: string | null };

/** Runs with the paper cron. Each owner is moved once; afterwards their row carries News settings and is skipped. */
export async function moveSoupSetupsToNews(env: Env, now = new Date(), geocode: (name: string) => Promise<NewsPlace | null> = geocodeCity): Promise<number> {
  const rows = await env.DB.prepare(`SELECT t.user_id, t.taste_json, o.timezone, o.daily_briefing_time, h.layout_json
    FROM soup_taste t JOIN owner_profile o ON o.id = t.user_id LEFT JOIN home_layout h ON h.user_id = t.user_id
    WHERE t.set_up_at IS NOT NULL`).all<Row>();
  let moved = 0;
  for (const row of rows.results || []) {
    const taste = parseSoupTaste(parseJsonRecord(row.taste_json));
    if (taste.news || !taste.servings.length) continue;
    const hidden = parseJsonRecord(row.layout_json || "{}").hidden;
    const guess = cityFromTimezone(row.timezone);
    const prefs = newsPrefsFromSoup(taste, {
      briefingTime: normalizeDailyBriefingTime(row.daily_briefing_time), now,
      removedFromHome: Array.isArray(hidden) && hidden.includes("soup"),
      place: guess ? await geocode(guess).catch(() => null) : null,
    });
    if (!prefs) continue;
    const stamp = now.toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE soup_taste SET taste_json = ?, updated_at = ? WHERE user_id = ?").bind(JSON.stringify({ ...taste, servings: [], news: prefs }), stamp, row.user_id),
      // Scheduled servings end here; a pick the owner asked for in chat keeps its own short life.
      env.DB.prepare("UPDATE soup_servings SET status = 'expired', updated_at = ? WHERE user_id = ? AND status IN ('open', 'pending') AND serving_id NOT LIKE 'ask-%'").bind(stamp, row.user_id),
    ]);
    moved++;
  }
  return moved;
}
