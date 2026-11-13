import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveSoupSetupsToNews } from "./news-migrate";
import { actOnNewsPaper, getNewsToday } from "./news-paper";
import { NEWS_PUSH_TITLE, dispatchDueNewsNotifications } from "./news-push";
import { defaultNewsPrefs } from "./news-settings";
import { notifyCalendarItemDue } from "./push-notifications";
import { emptySoupTaste } from "./soup-taste";
import { gratitudeFixture } from "./test-utils/gratitude-fixture";

vi.mock("./push-notifications", () => ({ notifyCalendarItemDue: vi.fn(async () => ({ ok: true, matched: 1, sent: 1 })) }));
vi.mock("./plugins", () => ({ isCorePluginEnabled: vi.fn(async () => true) }));

// Failure modes, against a real schema: two notifications for one paper, a notification for a
// paper the owner already read or while News is paused, a Soup owner who has to set up again or
// is moved twice, and a "hide until tomorrow" that outlives the day.
const fixtures: ReturnType<typeof gratitudeFixture>[] = [];
function fixture() {
  const f = gratitudeFixture();
  for (const name of ["0098_soup", "0104_news_papers", "0071_home_layout"]) f.raw.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  fixtures.push(f);
  return f;
}
afterEach(() => { fixtures.splice(0).forEach(f => f.raw.close()); vi.clearAllMocks(); });

const paperJson = JSON.stringify({ time: "06:45", frontOnly: false, counts: { pages: 2, stories: 1, videos: 0, minutes: 1, considered: 5 }, pages: { front: { lead: { id: "news:a", headline: "A", summary: "", url: "https://example.com/a", source: "RTÉ", medium: "read" }, briefs: [] }, work: null, media: null, topics: null, near: null } });
function seedPaper(f: ReturnType<typeof fixture>, prefs = {}) {
  const news = { ...defaultNewsPrefs("06:45"), setUpAt: "2026-11-12T20:00:00.000Z", ...prefs };
  f.raw.prepare("INSERT INTO soup_taste(user_id, taste_json, set_up_at) VALUES('owner', ?, '2026-11-12T20:00:00.000Z')").run(JSON.stringify({ ...emptySoupTaste(), interests: ["poetry"], news }));
  f.raw.prepare("INSERT INTO news_papers(id, user_id, date_key, status, paper_json, deliver_at, ready_at) VALUES('paper-1', 'owner', '2026-11-13', 'ready', ?, '2026-11-13T06:45:00.000Z', '2026-11-13T06:16:00.000Z')").run(paperJson);
}
const at = (time: string) => new Date(`2026-11-13T${time}:00.000Z`);

describe("your news is ready, against the schema", () => {
  it("sends exactly one notification a day, at the owner's time, as a card the apps can open", async () => {
    const f = fixture(); seedPaper(f);
    expect(await dispatchDueNewsNotifications(f.env, at("06:30"))).toMatchObject({ sent: 0 });
    expect(await dispatchDueNewsNotifications(f.env, at("06:45"))).toMatchObject({ sent: 1 });
    expect(await dispatchDueNewsNotifications(f.env, at("06:46"))).toMatchObject({ sent: 0 });
    expect(await dispatchDueNewsNotifications(f.env, at("07:00"))).toMatchObject({ sent: 0 });
    expect(notifyCalendarItemDue).toHaveBeenCalledTimes(1);
    expect(notifyCalendarItemDue).toHaveBeenCalledWith(f.env, expect.objectContaining({ title: NEWS_PUSH_TITLE, contextType: "card", contextId: "news", occurrenceId: "2026-11-13", category: "reminders" }));
  });

  it("stays quiet when notifications are off, News is paused, or the paper was already read", async () => {
    for (const prefs of [{ notify: false }, { paused: true }]) {
      const f = fixture(); seedPaper(f, prefs);
      expect(await dispatchDueNewsNotifications(f.env, at("06:45"))).toMatchObject({ sent: 0 });
    }
    const f = fixture(); seedPaper(f);
    await actOnNewsPaper(f.env, "owner", "paper-1", { action: "read" }, at("06:20"));
    expect(await dispatchDueNewsNotifications(f.env, at("06:45"))).toMatchObject({ sent: 0 });
    expect(notifyCalendarItemDue).not.toHaveBeenCalled();
  });
});

describe("the paper on Home, against the schema", () => {
  it("is read, rated, hidden and brought back, and yesterday's hide does not carry into today", async () => {
    const f = fixture(); seedPaper(f);
    expect((await getNewsToday(f.env, "owner", at("07:00"))).paper).toMatchObject({ id: "paper-1", readAt: null, hiddenAt: null, time: "06:45" });
    expect(await actOnNewsPaper(f.env, "owner", "paper-1", { action: "rate", rating: "sleepy" }, at("07:05"))).toMatchObject({ rating: "sleepy" });
    expect(JSON.parse((f.raw.prepare("SELECT taste_json FROM soup_taste").get() as { taste_json: string }).taste_json).news.lastRating).toBe("sleepy");
    await actOnNewsPaper(f.env, "owner", "paper-1", { action: "read" }, at("07:06"));
    expect((await actOnNewsPaper(f.env, "owner", "paper-1", { action: "hide" }, at("07:07"))).hiddenAt).toBeTruthy();
    expect((await actOnNewsPaper(f.env, "owner", "paper-1", { action: "unhide" }, at("07:08"))).hiddenAt).toBeNull();
    await actOnNewsPaper(f.env, "owner", "paper-1", { action: "hide" }, at("07:09"));
    await expect(actOnNewsPaper(f.env, "owner", "paper-1", { action: "shred" }, at("07:10"))).rejects.toThrow(/read, hide, unhide or rate/);
    // The next day has no paper yet, and when it arrives it is a new row that was never hidden.
    const tomorrow = await getNewsToday(f.env, "owner", new Date("2026-11-14T08:00:00.000Z"));
    expect(tomorrow).toMatchObject({ setUp: true, paper: null, time: "07:45" });
  });
});

describe("moving Soup setups to News, against the schema", () => {
  const geocode = async () => ({ city: "Dublin", country: "IE", lat: 53.35, lon: -6.26 });
  it("moves an owner once, keeps their topics, takes the headlines time and closes scheduled servings", async () => {
    const f = fixture();
    const taste = { ...emptySoupTaste(), workTopics: [{ topic: "agent payments", projectId: null, source: "owner" }], interests: ["poetry"], servings: [{ id: "morning", name: "Morning headlines", time: "07:30", days: [], kind: "headlines" }, { id: "evening", name: "Evening", time: "20:00", days: [], kind: "pick" }] };
    f.raw.prepare("INSERT INTO soup_taste(user_id, taste_json, set_up_at) VALUES('owner', ?, '2026-11-04T09:00:00.000Z')").run(JSON.stringify(taste));
    const serving = f.raw.prepare("INSERT INTO soup_servings(id, user_id, date_key, serving_id, kind, title, status, due_at, expires_at) VALUES(?, 'owner', '2026-11-13', ?, 'pick', 't', 'open', '2026-11-13T07:30:00.000Z', '2026-11-13T23:00:00.000Z')");
    serving.run("s1", "morning"); serving.run("s2", "ask-1234");
    expect(await moveSoupSetupsToNews(f.env, at("05:00"), geocode)).toBe(1);
    expect(await moveSoupSetupsToNews(f.env, at("05:15"), geocode)).toBe(0);
    const saved = JSON.parse((f.raw.prepare("SELECT taste_json FROM soup_taste").get() as { taste_json: string }).taste_json);
    expect(saved).toMatchObject({ interests: ["poetry"], servings: [], news: { time: "07:30", city: "Dublin", country: "IE", paused: false, notify: true } });
    expect(saved.workTopics[0].topic).toBe("agent payments");
    expect(f.raw.prepare("SELECT id, status FROM soup_servings ORDER BY id").all()).toEqual([{ id: "s1", status: "expired" }, { id: "s2", status: "open" }]);
    expect(await getNewsToday(f.env, "owner", at("06:00"))).toMatchObject({ setUp: true, paused: false, time: "07:30" });
  });

  it("carries a removed Soup card over as paused, and leaves an only-when-I-ask owner on the intro", async () => {
    const f = fixture();
    f.raw.prepare("INSERT INTO soup_taste(user_id, taste_json, set_up_at) VALUES('owner', ?, '2026-11-04T09:00:00.000Z')").run(JSON.stringify({ ...emptySoupTaste(), interests: ["poetry"], servings: [{ id: "morning", name: "Morning headlines", time: "07:30", days: [], kind: "headlines" }] }));
    f.raw.prepare("INSERT INTO home_layout(user_id, layout_json) VALUES('owner', ?)").run(JSON.stringify({ order: [], hidden: ["soup"], pinned: [], earned: ["soup"] }));
    expect(await moveSoupSetupsToNews(f.env, at("05:00"), geocode)).toBe(1);
    expect(await getNewsToday(f.env, "owner", at("06:00"))).toMatchObject({ setUp: true, paused: true });

    const g = fixture();
    g.raw.prepare("INSERT INTO soup_taste(user_id, taste_json, set_up_at) VALUES('owner', ?, '2026-11-04T09:00:00.000Z')").run(JSON.stringify({ ...emptySoupTaste(), interests: ["poetry"], servings: [] }));
    expect(await moveSoupSetupsToNews(g.env, at("05:00"), geocode)).toBe(0);
    expect(await getNewsToday(g.env, "owner", at("06:00"))).toMatchObject({ setUp: false, paper: null });
  });
});
