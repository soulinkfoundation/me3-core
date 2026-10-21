import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookFreeCall, planFreeCall } from "./agent-free-call";
import type { Env } from "./types";

// Failure modes, written before the service: a paid offering is booked as free; a plain-http site is
// booked on a deployed install; a slot the owner cannot make (too soon, before the time they asked)
// is chosen; a retry books twice; a taken slot reads as booked; the booking never reaches the owner's
// calendar.
const fixtures: DatabaseSync[] = [];
afterEach(() => { fixtures.splice(0).forEach((raw) => raw.close()); vi.unstubAllGlobals(); vi.useRealTimers(); });

const NOW = Date.parse("2026-10-21T09:00:00Z");
const PERSON = {
  profileId: "local:http://127.0.0.1:8788", name: "Kieran (stand-in)", handle: "kieran", publicUrl: "http://127.0.0.1:8788/", profileUrl: "http://127.0.0.1:8788/me.json",
  offerings: [
    { type: "service", id: "service:paid-session", title: "Paid session", durationMinutes: 60, price: { amount: "80", currency: "EUR" }, kind: "booking" },
    { type: "service", id: "service:intro-call", title: "Free 20-minute call", durationMinutes: 20, price: null, kind: "booking" },
  ],
};

function fixture(options: { environment?: string; email?: string | null } = {}) {
  const raw = new DatabaseSync(":memory:");
  fixtures.push(raw);
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, dir), "utf8"));
  raw.prepare("INSERT INTO owner_profile(id, name, email, username, timezone) VALUES('owner', 'Sam Rivera', ?, 'samrivera', 'Europe/London')").run(options.email === undefined ? "sam@example.test" : options.email);
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
  return { raw, env: { DB: db, ENVIRONMENT: options.environment ?? "local" } as unknown as Env };
}

function slotsByDate(slots: Record<string, string[]>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    const date = new URL(url).searchParams.get("date") || "";
    const starts = slots[date] || [];
    return Response.json({ ok: true, date, timezone: "Europe/Dublin", slots: starts.map((start) => ({ slotStart: start, slotEnd: new Date(Date.parse(start) + 20 * 60_000).toISOString() })) });
  }));
  return calls;
}

describe("booking a free call on another ME3 site", () => {
  it("plans the first free offering at the earliest time that fits, never a paid one", async () => {
    vi.useFakeTimers({ now: NOW });
    const calls = slotsByDate({ "2026-10-21": ["2026-10-21T09:30:00.000Z", "2026-10-21T13:00:00.000Z"], "2026-10-22": ["2026-10-22T08:00:00.000Z"] });
    const plan = await planFreeCall(fixture().env, "owner", { profile: PERSON });
    expect(plan).toMatchObject({
      with: "Kieran (stand-in)", handle: "kieran", publicUrl: "http://127.0.0.1:8788/", bookingUrl: "http://127.0.0.1:8788/api/book/kieran",
      offering: { id: "service:intro-call", offerId: "intro-call", title: "Free 20-minute call", durationMinutes: 20 },
      slot: { start: "2026-10-21T13:00:00.000Z", end: "2026-10-21T13:20:00.000Z", timezone: "Europe/London", label: "Wed 21 Oct, 14:00" },
      notes: null,
    });
    expect(calls).toEqual(["http://127.0.0.1:8788/api/book/kieran/slots?date=2026-10-21&offerId=intro-call"]);

    const later = await planFreeCall(fixture().env, "owner", { profile: PERSON, date: "2026-10-22", time: "09:00" });
    expect(later.slot).toMatchObject({ start: "2026-10-22T08:00:00.000Z", label: "Thu 22 Oct, 09:00" });
    await expect(planFreeCall(fixture().env, "owner", { profile: PERSON, date: "2026-10-22", time: "10:00" })).rejects.toThrow("no free time from 10:00 on 2026-10-22");
    // A paid or mistyped offering id falls back to the free call; the owner approves the exact offer anyway.
    await expect(planFreeCall(fixture().env, "owner", { profile: PERSON, offeringId: "service:paid-session" })).resolves.toMatchObject({ offering: { id: "service:intro-call" } });
    await expect(planFreeCall(fixture().env, "owner", { profile: { ...PERSON, offerings: [PERSON.offerings[0]] } })).rejects.toThrow("has no free call to book");
  });

  it("books plain-http sites only on a local install", async () => {
    vi.useFakeTimers({ now: NOW });
    slotsByDate({ "2026-10-21": ["2026-10-21T13:00:00.000Z"] });
    await expect(planFreeCall(fixture({ environment: "production" }).env, "owner", { profile: PERSON })).rejects.toThrow("no public ME3 site link");
    const secure = { ...PERSON, publicUrl: "https://kieran.me3.app/", profileUrl: "https://kieran.me3.app/me.json" };
    await expect(planFreeCall(fixture({ environment: "production" }).env, "owner", { profile: secure })).resolves.toMatchObject({ bookingUrl: "https://kieran.me3.app/api/book/kieran" });
  });

  it("books the approved time once, with the owner's name and email, and puts it in their calendar", async () => {
    const plan = {
      with: "Kieran (stand-in)", handle: "kieran", publicUrl: "http://127.0.0.1:8788/", bookingUrl: "http://127.0.0.1:8788/api/book/kieran",
      offering: { id: "service:intro-call", offerId: "intro-call", title: "Free 20-minute call", durationMinutes: 20 },
      slot: { start: "2026-10-22T08:00:00.000Z", end: "2026-10-22T08:20:00.000Z", timezone: "Europe/London", label: "Thu 22 Oct, 09:00" },
      notes: "Keen to talk about my site.",
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true, booking: { id: "booking-7" } }));
    vi.stubGlobal("fetch", fetchMock);
    const f = fixture();
    const booked = await bookFreeCall(f.env, "owner", plan, "turn-1");
    expect(booked).toMatchObject({ status: "booked", bookingId: "booking-7", calendarEventId: "free-call-turn-1", with: "Kieran (stand-in)" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8788/api/book/kieran/confirm");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      offerId: "intro-call", slotStart: "2026-10-22T08:00:00.000Z", slotEnd: "2026-10-22T08:20:00.000Z",
      guestName: "Sam Rivera", guestEmail: "sam@example.test", notes: "Keen to talk about my site. Booked through ME3.",
    });
    expect(f.raw.prepare("SELECT title, starts_at, ends_at, timezone FROM user_calendar_events WHERE user_id='owner'").all()).toEqual([
      { title: "Free 20-minute call with Kieran (stand-in)", starts_at: "2026-10-22T08:00:00.000Z", ends_at: "2026-10-22T08:20:00.000Z", timezone: "Europe/London" },
    ]);

    // A retried resume returns the same booking without calling the site again.
    await expect(bookFreeCall(f.env, "owner", plan, "turn-1")).resolves.toMatchObject({ status: "booked", calendarEventId: "free-call-turn-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "That slot is no longer available" }, { status: 409 })));
    await expect(bookFreeCall(fixture().env, "owner", plan, "turn-2")).rejects.toThrow("That time was just taken");
    await expect(bookFreeCall(fixture({ email: null }).env, "owner", plan, "turn-3")).rejects.toThrow("Add your name and email");
  });
});
