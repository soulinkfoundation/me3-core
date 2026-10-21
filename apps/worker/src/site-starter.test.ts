import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftStarterSite, getOwnerProfileSite, publishStarterSite, renderDraftPreviewHtml, setDraftTheme, starterSearchQuery } from "./site-starter";
import { getSiteFileText } from "./sites";
import type { Env } from "./types";

vi.mock("./network-directory", () => ({
  syncPublishedProfileToSoulinkDirectory: vi.fn(async () => {}),
  removePublishedProfileFromSoulinkDirectory: vi.fn(async () => {}),
}));

// Failure modes, written before the service: drafting publishes by accident (published_at or
// public/index.html change); the existing photo is dropped; a custom Mission is overwritten, or
// the fill-in-the-blanks template counts as a Mission; a second draft duplicates the clarity call
// or the About page; a non-link is kept; the chosen look is not saved or not previewed; the live
// site lacks the bio, the bookable call or the signup, or shows the draft-only testimonials block.
const fixtures: DatabaseSync[] = [];
afterEach(() => { fixtures.splice(0).forEach((raw) => raw.close()); vi.clearAllMocks(); });

function fixture(options: { mission?: string | null; avatar?: boolean } = {}) {
  const raw = new DatabaseSync(":memory:");
  fixtures.push(raw);
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, dir), "utf8"));
  raw.prepare("INSERT INTO owner_profile(id, name, username, timezone) VALUES('owner', 'Sam Rivera', 'samrivera', 'Europe/London')").run();
  raw.prepare("INSERT INTO sites(id, user_id, username, site_type, site_role) VALUES('site-1', 'owner', 'samrivera', 'profile', 'profile')").run();
  if (options.avatar !== false) {
    const seed = JSON.stringify({ version: "0.1", name: "Sam Rivera", handle: "samrivera", avatar: "files/avatar.png", visibility: "public" });
    raw.prepare("INSERT INTO site_files(site_id, path, content, content_type, size) VALUES('site-1', 'src/me.json', ?, 'application/json', ?)").run(Buffer.from(seed), seed.length);
  }
  if (options.mission) raw.prepare("INSERT INTO mission_dashboard_settings(user_id, settings_json, mission_statement) VALUES('owner', '{}', ?)").run(options.mission);
  const db = { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args.map((value) => value instanceof ArrayBuffer ? Buffer.from(value) : value); return statement; },
      async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
    };
    return statement;
  }, async batch() { throw new Error("batch unused"); } };
  return { raw, env: { DB: db, CORE_WEB_ORIGIN: "http://localhost:4000" } as unknown as Env };
}

const answer = {
  headline: "Career coach · Leeds and online",
  bio: "I help people in their 30s and 40s who've outgrown their jobs work out what's next.",
  location: "Leeds, UK",
  links: ["samrivera.co.uk", "https://instagram.com/samrivera.coach", "not a link"],
  about: "I spent twelve years in marketing before retraining as a coach.",
  services: ["6-week programme: six weekly video calls to plan and make your move", "Free 30-minute clarity call"],
  missionWho: "people who've outgrown their job", missionChange: "work out what's next", missionHow: "1:1 coaching over video",
};

describe("the search someone would type to find the owner", () => {
  it("keeps the headline's first clause and the town", () => {
    expect(starterSearchQuery("Career coach · Leeds and online", "Leeds, UK", [])).toBe("Career coach in Leeds");
    expect(starterSearchQuery("Career coach helping growth-focused professionals in their 30s", "Leeds, UK", [])).toBe("Career coach in Leeds");
    expect(starterSearchQuery("", "", [{ title: "Wedding cakes" }])).toBe("Wedding cakes");
    expect(starterSearchQuery("", "Cork, Ireland", [])).toBe("Cork");
  });
});

describe("the chat-drafted first site", () => {
  it("writes the source without publishing and keeps the photo", async () => {
    const f = fixture();
    const draft = await draftStarterSite(f.env, "owner", answer);
    expect(draft).toMatchObject({ username: "samrivera", theme: "warm", newsletter: true, previewPath: "/api/sites/samrivera/draft-preview-html", searchQuery: "Career coach in Leeds", hasPhoto: true });
    expect(draft.services).toEqual([{ title: "Free 30-minute clarity call", bookable: true }, { title: "6-week programme", bookable: false }]);
    const site = (await getOwnerProfileSite(f.env, "owner"))!;
    expect(site.published_at).toBeNull();
    expect(await getSiteFileText(f.env, "site-1", "public/index.html")).toBeNull();
    const profile = JSON.parse((await getSiteFileText(f.env, "site-1", "src/me.json"))!);
    expect(profile.avatar).toBe("files/avatar.png");
    expect(profile.bio).toContain(answer.bio);
    expect(profile.links).toEqual({ website: "https://samrivera.co.uk", instagram: "https://instagram.com/samrivera.coach" });
    expect(profile.intents.book.offers.map((offer: { id: string }) => offer.id)).toEqual(["clarity-call"]);
    expect(profile.intents.book.availability.timezone).toBe("Europe/London");
    expect(profile.intents.subscribe.enabled).toBe(true);
    expect(profile.services).toEqual([{ id: "offer-6-week-programme", title: "6-week programme", description: "six weekly video calls to plan and make your move" }]);
    expect(await getSiteFileText(f.env, "site-1", "src/about.md")).toContain("## Ways to work together");
    // A second draft replaces, never duplicates.
    await draftStarterSite(f.env, "owner", { ...answer, theme: "paper" });
    const again = JSON.parse((await getSiteFileText(f.env, "site-1", "src/me.json"))!);
    expect(again.intents.book.offers).toHaveLength(1);
    expect(again.pages.filter((page: { slug: string }) => page.slug === "about")).toHaveLength(1);
    expect(again.extensions["me3.app/site"].theme).toBe("paper");
  });

  it("fills an unset or template Mission and leaves a written one alone", async () => {
    const template = fixture({ mission: "I help [who] [the change you want for them] by [how you help]." });
    await draftStarterSite(template.env, "owner", answer);
    expect(template.raw.prepare("SELECT mission_statement FROM mission_dashboard_settings WHERE user_id='owner'").get()).toEqual({ mission_statement: "I help people who've outgrown their job work out what's next by 1:1 coaching over video." });
    const written = fixture({ mission: "I help founders ship, because shipping matters." });
    await draftStarterSite(written.env, "owner", answer);
    expect(written.raw.prepare("SELECT mission_statement FROM mission_dashboard_settings WHERE user_id='owner'").get()).toEqual({ mission_statement: "I help founders ship, because shipping matters." });
  });

  it("saves the chosen look, previews a look without saving it, and publishes through the real pipeline", async () => {
    const f = fixture();
    await draftStarterSite(f.env, "owner", answer);
    const site = (await getOwnerProfileSite(f.env, "owner"))!;
    expect(await setDraftTheme(f.env, site, "meadow")).toBe("meadow");
    expect(JSON.parse((await getSiteFileText(f.env, "site-1", "src/me.json"))!).extensions["me3.app/site"].theme).toBe("meadow");
    const preview = (await renderDraftPreviewHtml(f.env, site, "paper"))!;
    expect(preview).toContain('data-vibe="paper"');
    expect(preview).toContain("Only you see this");
    expect(JSON.parse((await getSiteFileText(f.env, "site-1", "src/me.json"))!).extensions["me3.app/site"].theme).toBe("meadow");

    const published = await publishStarterSite(f.env, "owner");
    expect(published.publishedAt).toBeTruthy();
    expect(published.searchQuery).toBe("Career coach in Leeds");
    expect((await getOwnerProfileSite(f.env, "owner"))!.published_at).toBeTruthy();
    const html = (await getSiteFileText(f.env, "site-1", "public/index.html"))!;
    expect(html).toContain('data-vibe="meadow"');
    expect(html).toContain("outgrown their jobs");
    expect(html).toContain("Free 30-minute clarity call");
    expect(html).toContain("data-newsletter-form");
    expect(html).not.toContain("Only you see this");
    const meJson = JSON.parse((await getSiteFileText(f.env, "site-1", "public/me.json"))!);
    expect(meJson.services).toEqual([
      expect.objectContaining({ id: "service:clarity-call", durationMinutes: 30, availability: "calendar", status: "active" }),
      expect.objectContaining({ id: "service:offer-6-week-programme", title: "6-week programme", availability: "manual" }),
    ]);
    expect(meJson.services.some((service: { price?: unknown }) => service.price)).toBe(false);
  });
});
