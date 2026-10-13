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
});
