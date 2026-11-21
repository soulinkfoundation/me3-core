import { describe, expect, it } from "vitest";
import { peopleRows } from "./firstSite";

const person = (overrides: Record<string, unknown>) => ({
  profileId: "p1",
  name: "Niamh Byrne Hair",
  publicUrl: "https://niamh.me3.app",
  ...overrides,
});
const offer = (title: string, amount?: string, currency = "EUR", durationMinutes: number | null = 45) => ({
  type: "service",
  id: `service:${title}`,
  title,
  durationMinutes,
  price: amount ? { amount, currency } : null,
});

describe("peopleRows card lines", () => {
  it("shows the town, not the full location label", () => {
    const [row] = peopleRows({ results: [person({ location: { label: "Galway, Ireland", locality: "Galway" } })] });
    expect(row.place).toBe("Galway");
  });

  it("falls back to the location label when there is no town", () => {
    const [row] = peopleRows({ results: [person({ location: { label: "Ireland", locality: null } })] });
    expect(row.place).toBe("Ireland");
  });

  it("shows the lowest price as a starting price when there are several", () => {
    const [row] = peopleRows({ results: [person({ offerings: [offer("Colour", "85"), offer("Cut & finish", "55.00"), offer("Blow dry", "60")] })] });
    expect(row.offer).toBe("from €55");
  });

  it("shows a single price without 'from' and keeps cents that matter", () => {
    const [row] = peopleRows({ results: [person({ offerings: [offer("Cut", "42.50")] })] });
    expect(row.offer).toBe("€42.50");
  });

  it("leads with the free call, then the starting price", () => {
    const [row] = peopleRows({ results: [person({ offerings: [offer("Intro call", undefined, "EUR", 20), offer("Coaching", "90"), offer("Package", "300")] })] });
    expect(row.offer).toBe("Free 20-min call · from €90");
  });

  it("ignores prices in another currency than the first price", () => {
    const [row] = peopleRows({ results: [person({ offerings: [offer("Cut", "55"), offer("Cut (UK)", "20", "GBP")] })] });
    expect(row.offer).toBe("€55");
  });

  it("falls back to the first offer's title when nothing has a price or free call", () => {
    const [row] = peopleRows({ results: [person({ offerings: [offer("Ask about weddings", undefined, "EUR", null)] })] });
    expect(row.offer).toBe("Ask about weddings");
  });

  it("leaves the offer line empty when there are no offerings", () => {
    const [row] = peopleRows({ results: [person({})] });
    expect(row.offer).toBe("");
  });

  it("does not break on an unknown currency code", () => {
    const [row] = peopleRows({ results: [person({ offerings: [offer("Cut", "55", "XX")] })] });
    expect(row.offer).toBe("55 XX");
  });
});

describe("peopleRows next free time", () => {
  // Failure modes: a time shown when the search had no day; the wrong weekday (timezone drift on a bare date);
  // "Today"/"Tomorrow" not used for the next two days; the price lost when a time is shown; a free call with no
  // price showing nothing after the time.
  const now = new Date(2026, 10, 25, 9, 0); // Wed 25 Nov 2026, local time
  const free = (localDate: string, localTime = "13:00") => ({ startsAt: `${localDate}T${localTime}:00.000Z`, localDate, localTime, timezone: "Europe/Dublin", offeringId: "service:cut", offeringTitle: "Cut" });

  it("shows the weekday and time before the starting price", () => {
    const [row] = peopleRows({ results: [person({ nextFree: free("2026-11-28"), offerings: [offer("Cut", "55"), offer("Colour", "85")] })] }, now);
    expect(row.freeAt).toBe("Free Sat 13:00");
    expect(row.offer).toBe("from €55");
  });

  it("says today and tomorrow for the next two days, and a date a week or more away", () => {
    expect(peopleRows({ results: [person({ nextFree: free("2026-11-25", "16:30") })] }, now)[0].freeAt).toBe("Free today 16:30");
    expect(peopleRows({ results: [person({ nextFree: free("2026-11-26", "09:00") })] }, now)[0].freeAt).toBe("Free tomorrow 09:00");
    expect(peopleRows({ results: [person({ nextFree: free("2026-12-02") })] }, now)[0].freeAt).toBe("Free 2 Dec 13:00");
  });

  it("describes a free call by its length after the time, not 'Free' twice", () => {
    const [row] = peopleRows({ results: [person({ nextFree: free("2026-11-28"), offerings: [offer("Intro call", undefined, "EUR", 20)] })] }, now);
    expect(row.freeAt).toBe("Free Sat 13:00");
    expect(row.offer).toBe("20-min call");
  });

  it("shows no time without nextFree, or with a broken one", () => {
    expect(peopleRows({ results: [person({})] }, now)[0].freeAt).toBe("");
    expect(peopleRows({ results: [person({ nextFree: { localDate: "Saturday", localTime: "13:00" } })] }, now)[0].freeAt).toBe("");
  });
});
