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
