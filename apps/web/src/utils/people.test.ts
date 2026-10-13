import { describe, expect, it } from "vitest";
import type { Contact } from "../stores/contacts";
import { formatSinceShort, indexLetter, rankHomePeople } from "./people";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

function person(id: string, extra: Partial<Contact> = {}): Contact {
  return {
    id, userId: "owner", name: id, email: null, phone: null, source: "manual", sourceRef: null,
    relationship: "contact", closeness: "close", status: "active", notes: null, lastInteractionAt: null,
    socialHandles: {}, metadata: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    bookingCount: 0, lastBookingAt: null, isClose: true, closeSince: daysAgo(100), isClient: false,
    lastInTouchAt: null, reminderAt: null, ...extra,
  };
}

const rank = (contacts: Contact[]) => {
  const card = rankHomePeople(contacts, (contact) => contact.reminderAt, NOW);
  return card.state === "people" ? card.people.map((contact) => contact.id) : card.state;
};

describe("Home People ranking", () => {
  it("1. only includes Close people, and hides the card without any", () => {
    expect(rank([person("friend", { isClose: false, closeness: null, lastInTouchAt: daysAgo(90) })])).toBe("hidden");
    expect(rank([
      person("friend", { isClose: false, closeness: null, lastInTouchAt: daysAgo(90) }),
      person("mam", { lastInTouchAt: daysAgo(20) }),
    ])).toEqual(["mam"]);
  });

  it("2. puts people whose reminder date has arrived first", () => {
    expect(rank([
      person("long-gap", { lastInTouchAt: daysAgo(90) }),
      person("reminded", { lastInTouchAt: daysAgo(10), reminderAt: daysAgo(1) }),
      person("future-reminder", { lastInTouchAt: daysAgo(30), reminderAt: new Date(NOW + DAY).toISOString() }),
    ])).toEqual(["reminded", "long-gap", "future-reminder"]);
  });

  it("2. keeps a due reminder even when they were in touch recently", () => {
    expect(rank([person("recent", { lastInTouchAt: daysAgo(2), reminderAt: daysAgo(0.5) })])).toEqual(["recent"]);
  });

  it("3. orders by longest since last in touch, up to three", () => {
    expect(rank([
      person("a", { lastInTouchAt: daysAgo(10) }),
      person("b", { lastInTouchAt: daysAgo(40) }),
      person("c", { lastInTouchAt: daysAgo(20) }),
      person("d", { lastInTouchAt: daysAgo(30) }),
    ])).toEqual(["b", "d", "c"]);
  });

  it("4. skips people in touch in the last week, and says all caught up when that is everyone", () => {
    expect(rank([
      person("this-week", { lastInTouchAt: daysAgo(3) }),
      person("last-month", { lastInTouchAt: daysAgo(30) }),
    ])).toEqual(["last-month"]);
    expect(rank([person("x", { lastInTouchAt: daysAgo(1) }), person("y", { lastInTouchAt: daysAgo(6) })])).toBe("caught-up");
  });

  it("5. ranks never-in-touch as the longest gap", () => {
    expect(rank([
      person("old", { lastInTouchAt: daysAgo(400) }),
      person("new-star", { lastInTouchAt: null }),
    ])).toEqual(["new-star", "old"]);
  });

  it("6. breaks ties by who was starred first", () => {
    expect(rank([
      person("starred-later", { closeSince: daysAgo(5) }),
      person("starred-first", { closeSince: daysAgo(50) }),
    ])).toEqual(["starred-first", "starred-later"]);
  });

  it("ignores archived people", () => {
    expect(rank([person("gone", { status: "archived", lastInTouchAt: daysAgo(90) })])).toBe("hidden");
  });
});

describe("People formatting", () => {
  it("shows time since last in touch in short form", () => {
    expect(formatSinceShort(null, NOW)).toBeNull();
    expect(formatSinceShort(daysAgo(0.2), NOW)).toBe("Today");
    expect(formatSinceShort(daysAgo(6), NOW)).toBe("6d ago");
    expect(formatSinceShort(daysAgo(42), NOW)).toBe("6w ago");
    expect(formatSinceShort(daysAgo(130), NOW)).toBe("4mo ago");
    expect(formatSinceShort(daysAgo(400), NOW)).toBe("1y ago");
  });

  it("files accented names under their plain letter", () => {
    expect(indexLetter("Órla")).toBe("O");
    expect(indexLetter("Bríd")).toBe("B");
    expect(indexLetter("+353 87")).toBe("#");
  });
});
