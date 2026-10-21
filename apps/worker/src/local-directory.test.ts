import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { profileToResult, searchLocalDirectory } from "./local-directory";
import type { Env } from "./types";

// Failure modes, written before the service: the owner finds themselves in an ordinary search; a
// deployed install reads local origins; an incidental word ("call") matches everyone; the stand-in
// cannot be found by name; a private me.json is listed; the owner's own booking link points at the
// web app, which does not serve the public site locally.
const fixtures: DatabaseSync[] = [];
afterEach(() => { fixtures.splice(0).forEach((raw) => raw.close()); vi.unstubAllGlobals(); });

const OWN_ME_JSON = {
  version: "0.3", kind: "person", visibility: "public", name: "Sam Rivera", handle: "samrivera", url: "http://localhost:4000/",
  bio: "**Career coach · Leeds and online**\n\nI help people in their 30s and 40s work out what's next.", location: "Leeds, UK",
  services: [{ id: "service:clarity-call", title: "Free 30-minute clarity call", durationMinutes: 30, availability: "calendar", status: "active" }],
};
const STANDIN_ME_JSON = {
  version: "0.3", kind: "person", visibility: "public", name: "Kieran (stand-in)", handle: "kieran", url: "http://127.0.0.1:8788/",
  bio: "Builds ME3. Book a free 20-minute call to talk about your site or your assistant.", location: "Dublin, Ireland",
  services: [{ id: "service:intro-call", title: "Free 20-minute call", durationMinutes: 20, availability: "calendar", status: "active" }],
};

function fixture(options: { environment?: string; origins?: string; published?: boolean } = {}) {
  const raw = new DatabaseSync(":memory:");
  fixtures.push(raw);
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, dir), "utf8"));
  raw.prepare("INSERT INTO owner_profile(id, name, username, timezone) VALUES('owner', 'Sam Rivera', 'samrivera', 'Europe/London')").run();
  raw.prepare("INSERT INTO sites(id, user_id, username, site_type, site_role, published_at) VALUES('site-1', 'owner', 'samrivera', 'profile', 'profile', ?)")
    .run(options.published === false ? null : "2026-10-21 09:00:00");
  const meJson = JSON.stringify(OWN_ME_JSON);
  raw.prepare("INSERT INTO site_files(site_id, path, content, content_type, size) VALUES('site-1', 'public/me.json', ?, 'application/json', ?)").run(Buffer.from(meJson), meJson.length);
  const db = { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
    };
    return statement;
  } };
  return { DB: db, ENVIRONMENT: options.environment ?? "local", CORE_WEB_ORIGIN: "http://localhost:4000", CORE_API_ORIGIN: "http://localhost:8787", ME3_LOCAL_DIRECTORY_ORIGINS: options.origins ?? "http://127.0.0.1:8788" } as unknown as Env;
}

function stubStandin() {
  const fetchMock = vi.fn(async (url: string) => url === "http://127.0.0.1:8788/me.json" ? Response.json(STANDIN_ME_JSON) : new Response("", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("the local directory", () => {
  it("finds the stand-in by name and by what they offer, never by one incidental word", async () => {
    stubStandin();
    const byName = await searchLocalDirectory(fixture(), "owner", { query: "Kieran" });
    expect(byName.map((result) => result.name)).toEqual(["Kieran (stand-in)"]);
    expect(byName[0]).toMatchObject({ profileId: "local:http://127.0.0.1:8788", publicUrl: "http://127.0.0.1:8788/", handle: "kieran", location: { label: "Dublin, Ireland" } });
    expect(byName[0].offerings).toEqual([expect.objectContaining({ id: "service:intro-call", title: "Free 20-minute call", durationMinutes: 20, price: null, kind: "booking" })]);
    expect(byName[0].self).toBeUndefined();

    const byOffer = await searchLocalDirectory(fixture(), "owner", { query: "someone to talk about my assistant in Dublin" });
    expect(byOffer.map((result) => result.name)).toEqual(["Kieran (stand-in)"]);
    expect(byOffer[0].reasons).toEqual(["Based in Dublin, Ireland"]);

    const byCall = await searchLocalDirectory(fixture(), "owner", { query: "20-minute call Kieran" });
    expect(byCall[0].reasons).toEqual(["Offers Free 20-minute call"]);

    expect(await searchLocalDirectory(fixture(), "owner", { query: "gardening call" })).toEqual([]);
  });

  it("shows the owner their own listing only when asked, with the worker as its booking origin", async () => {
    stubStandin();
    const hidden = await searchLocalDirectory(fixture(), "owner", { query: "career coach in Leeds" });
    expect(hidden).toEqual([]);

    const shown = await searchLocalDirectory(fixture(), "owner", { query: "career coach in Leeds", includeMe: true });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ self: true, name: "Sam Rivera", publicUrl: "http://localhost:8787/", profileUrl: "http://localhost:8787/me.json", bio: "Career coach · Leeds and online I help people in their 30s and 40s work out what's next." });
    expect(shown[0].reasons).toEqual(["Based in Leeds, UK"]);
    expect(shown[0].offerings[0]).toMatchObject({ id: "service:clarity-call", price: null });

    expect(await searchLocalDirectory(fixture({ published: false }), "owner", { query: "career coach in Leeds", includeMe: true })).toEqual([]);
  });

  it("stays off outside a local install and skips private or unreachable profiles", async () => {
    const fetchMock = stubStandin();
    expect(await searchLocalDirectory(fixture({ environment: "production" }), "owner", { query: "Kieran", includeMe: true })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...STANDIN_ME_JSON, visibility: "private" })));
    expect(await searchLocalDirectory(fixture(), "owner", { query: "Kieran" })).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("connect ECONNREFUSED"); }));
    expect(await searchLocalDirectory(fixture(), "owner", { query: "Kieran" })).toEqual([]);
  });

  it("maps a me.json into a people result that the booking tool can use", () => {
    const result = profileToResult({ ...STANDIN_ME_JSON, avatar: "files/avatar.png", products: [{ id: "product:guide", title: "Guide", price: { amount: "12", currency: "EUR" } }] }, "https://kieran.me3.app", false);
    expect(result).toMatchObject({ name: "Kieran (stand-in)", avatarUrl: "https://kieran.me3.app/files/avatar.png", profileUrl: "https://kieran.me3.app/me.json", publicUrl: "https://kieran.me3.app/" });
    expect(result.offerings.map((offering) => [offering.type, offering.id, offering.price])).toEqual([["service", "service:intro-call", null], ["product", "product:guide", { amount: "12", currency: "EUR" }]]);
  });
});
