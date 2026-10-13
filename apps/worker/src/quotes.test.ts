import { afterEach, describe, expect, it, vi } from "vitest";
import { getTodayQuote, listMyQuotes, saveOwnerQuote, setQuoteSaved } from "./quotes";
import { gratitudeFixture } from "./test-utils/gratitude-fixture";
import seed from "./data/quotes-core-seed.json";

// Failure modes: seed drift, ignoring the lowest scored area, repeating rotations,
// unstable daily picks, concurrent reads, saved quotes never appearing, owner leakage.
const fixtures: ReturnType<typeof gratitudeFixture>[] = [];
function fixture() { const f = gratitudeFixture(); fixtures.push(f); return f; }
afterEach(() => { fixtures.splice(0).forEach(f => f.raw.close()); vi.restoreAllMocks(); });
const now = new Date("2026-10-13T08:00:00Z");

describe("quotes with real SQLite", () => {
  it("seeds exactly the supplied 31 quotes and quietly favours the lowest area", async () => {
    const f = fixture();
    expect(f.raw.prepare("SELECT COUNT(*) AS count FROM quotes WHERE origin='core'").get()).toMatchObject({ count: 31 });
    f.raw.prepare("INSERT INTO mission_wheel_snapshots(id,user_id,segments_json,notes_json) VALUES('wheel','owner',?,'{}')").run(JSON.stringify([{ id: "work", value: 8 }, { id: "joy", value: 2 }, { id: "health", value: null }]));
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    const quote = await getTodayQuote(f.env, "owner", now);
    expect(quote?.areas).toContain("joy");
    expect(quote).not.toHaveProperty("reason");
    expect(await getTodayQuote(f.env, "owner", now)).toEqual(quote);
  });

  it("keeps concurrent daily reads stable and rotates the whole pool before repeating", async () => {
    const f = fixture();
    const quotes = await Promise.all([getTodayQuote(f.env, "owner", now), getTodayQuote(f.env, "owner", now)]);
    expect(quotes[0]?.id).toBe(quotes[1]?.id);
    const seen = new Set([quotes[0]!.id]);
    for (let i = 1; i < 31; i++) seen.add((await getTodayQuote(f.env, "owner", now, true))!.id);
    expect(seen.size).toBe(31);
    const last = await getTodayQuote(f.env, "owner", now);
    const rotated = await getTodayQuote(f.env, "owner", now, true);
    expect(rotated!.id).not.toBe(last!.id);
    expect((await getTodayQuote(f.env, "owner", new Date("2026-10-14T08:00:00Z")))!.id).not.toBe(rotated!.id);
  });

  it("saves and unsaves a Core quote and mixes in an owner's saved quote", async () => {
    const f = fixture();
    await setQuoteSaved(f.env, "owner", "q216", true);
    expect((await listMyQuotes(f.env, "owner")).quotes.map(q => q.id)).toEqual(["q216"]);
    await setQuoteSaved(f.env, "owner", "q216", false);
    expect((await listMyQuotes(f.env, "owner")).quotes).toEqual([]);
    const input = { text: "A small thing, in my own words.", author: "Owner" };
    const saved = await saveOwnerQuote(f.env, "owner", input, "agent");
    expect((await saveOwnerQuote(f.env, "owner", input, "agent")).id).toBe(saved.id);
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect((await getTodayQuote(f.env, "owner", now))!.id).toBe(saved.id);
    expect((await listMyQuotes(f.env, "another-owner")).quotes).toEqual([]);
    await expect(setQuoteSaved(f.env, "another-owner", saved.id, false)).rejects.toThrow("not found");
  });

  it("rejects malformed quote content, areas and source URLs", async () => {
    const f = fixture();
    for (const input of [{ text: "" }, { text: "Hello", areas: ["hard-day"] }, { text: "Hello", sourceUrl: "javascript:alert(1)" }]) {
      await expect(saveOwnerQuote(f.env, "owner", input, "owner")).rejects.toThrow();
    }
  });

  it("uses scored settings before the first snapshot and reuses an existing Core quote", async () => {
    const f = fixture();
    f.raw.prepare("INSERT INTO mission_wheel_settings(user_id,segments_json) VALUES('owner',?)").run(JSON.stringify([{ id: "work", value: 8 }, { id: "joy", value: 2 }]));
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    expect((await getTodayQuote(f.env, "owner", now))?.areas).toContain("joy");
    const original = seed.find(quote => quote.id === "q216")!;
    expect((await saveOwnerQuote(f.env, "owner", original, "agent")).id).toBe(original.id);
    expect(f.raw.prepare("SELECT COUNT(*) count FROM quotes").get()).toMatchObject({ count: 31 });
    await expect(setQuoteSaved(f.env, "owner", original.id, true)).resolves.toMatchObject({ id: original.id });
  });

  it("keeps a Core quote pristine and saves it independently for two owners", async () => {
    const f = fixture();
    f.raw.prepare("INSERT INTO owner_profile(id,username,timezone) VALUES('another-owner','other-synthetic','Europe/Dublin')").run();
    const before = f.raw.prepare("SELECT * FROM quotes WHERE id='q216'").get();
    await setQuoteSaved(f.env, "owner", "q216", true);
    await setQuoteSaved(f.env, "another-owner", "q216", true);
    expect((await listMyQuotes(f.env, "owner")).quotes.map(q => q.id)).toEqual(["q216"]);
    expect((await listMyQuotes(f.env, "another-owner")).quotes.map(q => q.id)).toEqual(["q216"]);
    expect(f.raw.prepare("SELECT * FROM quotes WHERE id='q216'").get()).toEqual(before);
  });

  it("unsaves only the requesting owner's Core bookmark and keeps daily selection scoped", async () => {
    const f = fixture();
    f.raw.prepare("INSERT INTO owner_profile(id,username,timezone) VALUES('another-owner','other-synthetic','Europe/Dublin')").run();
    await setQuoteSaved(f.env, "owner", "q216", true);
    await setQuoteSaved(f.env, "another-owner", "q216", true);
    await setQuoteSaved(f.env, "another-owner", "q216", false);
    expect((await listMyQuotes(f.env, "owner")).quotes.map(q => q.id)).toEqual(["q216"]);
    expect((await listMyQuotes(f.env, "another-owner")).quotes).toEqual([]);
    f.raw.prepare("INSERT INTO daily_quotes(user_id,date_key,quote_id,seen_json) VALUES('owner','2026-10-13','q216','[\"q216\"]')").run();
    f.raw.prepare("INSERT INTO daily_quotes(user_id,date_key,quote_id,seen_json) VALUES('another-owner','2026-10-13','q216','[\"q216\"]')").run();
    expect(await getTodayQuote(f.env, "owner", now)).toMatchObject({ id: "q216", savedAt: expect.any(String) });
    expect(await getTodayQuote(f.env, "another-owner", now)).toMatchObject({ id: "q216", savedAt: null });
  });

  it("refuses explicit conflicting metadata instead of silently returning a seeded quote", async () => {
    const f = fixture();
    const original = seed.find(quote => quote.id === "q216")!;
    const before = f.raw.prepare("SELECT * FROM quotes WHERE id='q216'").get();
    await expect(saveOwnerQuote(f.env, "owner", { ...original, source: "A different supplied source", sourceUrl: "https://example.invalid/different-source" }, "owner")).rejects.toThrow("different metadata");
    expect(f.raw.prepare("SELECT * FROM quotes WHERE id='q216'").get()).toEqual(before);
    expect((await listMyQuotes(f.env, "owner")).quotes).toEqual([]);
  });

  it("rejects conflicting owner metadata and preserves metadata when omitted on a repeat save", async () => {
    const f = fixture();
    const original = { text: "An owner quotation", author: "Owner", source: "Original source", sourceUrl: "https://example.invalid/original", areas: ["work"] };
    const saved = await saveOwnerQuote(f.env, "owner", original, "owner");
    const before = f.raw.prepare("SELECT * FROM quotes WHERE id=?").get(saved.id);
    await expect(saveOwnerQuote(f.env, "owner", { ...original, areas: ["joy"] }, "owner")).rejects.toThrow("different metadata");
    expect(f.raw.prepare("SELECT * FROM quotes WHERE id=?").get(saved.id)).toEqual(before);
    expect(await saveOwnerQuote(f.env, "owner", { text: original.text, author: original.author }, "owner")).toMatchObject({ id: saved.id, source: original.source, sourceUrl: original.sourceUrl, areas: original.areas });
  });

  it.each([
    { source: "Concurrent source", source_url: "https://example.invalid/original", areas: '["work"]' },
    { source: "Original source", source_url: "https://example.invalid/concurrent", areas: '["work"]' },
    { source: "Original source", source_url: "https://example.invalid/original", areas: '["joy"]' },
  ])("rejects a conflicting same-owner insert raced between lookup and save: %j", async metadata => {
    const f = fixture();
    const input = { text: "A concurrently inserted quotation", author: "Owner", source: "Original source", sourceUrl: "https://example.invalid/original", areas: ["work"] };
    f.raw.prepare("INSERT INTO owner_profile(id,username,timezone) VALUES('another-owner','other-synthetic','Europe/Dublin')").run();
    f.raw.prepare("INSERT INTO quotes(id,user_id,text,author,source,areas,origin) VALUES('other-quote','another-owner',?,?,'Other owner source','[]','owner')").run(input.text, input.author);
    const otherBefore = f.raw.prepare("SELECT * FROM quotes WHERE id='other-quote'").get();
    const coreBefore = f.raw.prepare("SELECT * FROM quotes WHERE origin='core' ORDER BY id").all();
    let racedBefore: unknown;
    const batch = f.env.DB.batch.bind(f.env.DB);
    vi.spyOn(f.env.DB, "batch").mockImplementationOnce(async statements => {
      f.raw.prepare("INSERT INTO quotes(id,user_id,text,author,source,source_url,areas,origin,archived_at) VALUES('raced-quote','owner',?,?,?,?,?,'owner','2026-10-12T08:00:00Z')")
        .run(input.text, input.author, metadata.source, metadata.source_url, metadata.areas);
      racedBefore = f.raw.prepare("SELECT * FROM quotes WHERE id='raced-quote'").get();
      return batch(statements);
    });
    const outcome = await saveOwnerQuote(f.env, "owner", input, "owner").catch(error => error);
    expect(f.raw.prepare("SELECT * FROM quotes WHERE id='raced-quote'").get()).toEqual(racedBefore);
    expect(f.raw.prepare("SELECT * FROM quote_bookmarks WHERE quote_id='raced-quote'").all()).toEqual([]);
    expect(f.raw.prepare("SELECT * FROM quotes WHERE id='other-quote'").get()).toEqual(otherBefore);
    expect(f.raw.prepare("SELECT * FROM quotes WHERE origin='core' ORDER BY id").all()).toEqual(coreBefore);
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.message).toContain("different metadata");
  });

  it.each([true, false])("reuses a matching raced insert and retains omitted metadata (explicit=%s)", async explicit => {
    const f = fixture();
    const input = { text: "A matching concurrent quotation", author: "Owner", source: "Original source", sourceUrl: "https://example.invalid/original", areas: ["work"] };
    const batch = f.env.DB.batch.bind(f.env.DB);
    vi.spyOn(f.env.DB, "batch").mockImplementationOnce(async statements => {
      f.raw.prepare("INSERT INTO quotes(id,user_id,text,author,source,source_url,areas,origin,archived_at) VALUES('raced-quote','owner',?,?,?,?,?,'owner','2026-10-12T08:00:00Z')")
        .run(input.text, input.author, input.source, input.sourceUrl, JSON.stringify(input.areas));
      return batch(statements);
    });
    expect(await saveOwnerQuote(f.env, "owner", explicit ? input : { text: input.text, author: input.author }, "owner"))
      .toMatchObject({ id: "raced-quote", source: input.source, sourceUrl: input.sourceUrl, areas: input.areas, savedAt: expect.any(String) });
    expect(f.raw.prepare("SELECT archived_at FROM quotes WHERE id='raced-quote'").get()).toEqual({ archived_at: null });
    expect((await listMyQuotes(f.env, "owner")).quotes).toHaveLength(1);
  });
});
