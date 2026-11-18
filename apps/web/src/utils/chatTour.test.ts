import { describe, expect, it } from "vitest";
import { currentTourTarget, onTourScreen, placeTourCard, tourScreenRoute, readChatTour, tourPlaceForPath, tourStartIndex, type ChatTour } from "./chatTour";

// Failure modes: an older Core without the tour leaves Show me around doing nothing; a broken step draws an empty card;
// the tour restarts from the top after a reload instead of the owner's step; a page that isn't Accounts or Social ticks a step.
const step = (id: string) => ({ id, emoji: "🏠", title: id, body: "Hi", screen: null, intro: null, targets: [], task: null, copy: null, done: false });

describe("readChatTour", () => {
  it("keeps only steps it can draw", () => {
    const tour = readChatTour({ steps: [step("a"), { ...step("b"), title: "" }] } as Partial<ChatTour>);
    expect(tour?.steps.map(item => item.id)).toEqual(["a"]);
    expect(tour?.progress).toEqual({ status: "new", stepId: null });
  });

  it("is null when Core sends no steps, so the app can ask ME3 instead", () => {
    expect(readChatTour({})).toBeNull();
    expect(readChatTour(null)).toBeNull();
  });
});

describe("tourStartIndex", () => {
  const steps = [step("home"), step("email"), step("website")];
  it("picks up at the saved step while active, else starts at the top", () => {
    expect(tourStartIndex({ steps, progress: { status: "active", stepId: "email" } })).toBe(1);
    expect(tourStartIndex({ steps, progress: { status: "active", stepId: "gone" } })).toBe(0);
    expect(tourStartIndex({ steps, progress: { status: "skipped", stepId: "email" } })).toBe(0);
  });
});

describe("tourPlaceForPath", () => {
  it("knows Accounts and Social only", () => {
    expect(tourPlaceForPath("/accounts")).toBe("accounts");
    expect(tourPlaceForPath("/social/compose")).toBe("social");
    expect(tourPlaceForPath("/accountsx")).toBeNull();
    expect(tourPlaceForPath("/assistant")).toBeNull();
  });
});

// Failure modes (pointing tour): the card points at a target the owner can't see yet, or at the first one after
// they've moved on; it covers the button it points at, or the open menu; it runs off screen on a phone.
describe("currentTourTarget", () => {
  const targets = [{ id: "home_tab", hint: "Tap Home." }, { id: "add_to_home", hint: "Tap Add to Home." }];
  it("points at the furthest target the owner can see, then Back when none are there", () => {
    expect(currentTourTarget(targets, id => id === "home_tab")?.id).toBe("home_tab");
    expect(currentTourTarget(targets, id => id === "home_tab" || id === "add_to_home")?.id).toBe("add_to_home");
    expect(currentTourTarget(targets, id => id === "back_home")?.id).toBe("back_home");
    expect(currentTourTarget(targets, () => false)).toBeNull();
    expect(currentTourTarget([], id => id === "back_home")).toBeNull();
  });
});

describe("placeTourCard", () => {
  const card = { width: 340, height: 180 };
  const desktop = { width: 1200, height: 800 };
  const overlaps = (a: { top: number; left: number; right: number; bottom: number }, b: { top: number; left: number; right: number; bottom: number }) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const box = (placement: { top: number; left: number }) => ({ top: placement.top, left: placement.left, right: placement.left + card.width, bottom: placement.top + card.height });

  it("sits under a top tab with the arrow on it, never covering it", () => {
    const tab = { top: 10, left: 560, right: 640, bottom: 50 };
    const placed = placeTourCard(tab, card, desktop)!;
    expect(placed.side).toBe("below");
    expect(placed.left + placed.arrow).toBe(600);
    expect(overlaps(box(placed), tab)).toBe(false);
  });

  it("goes above a button near the bottom, and stays on a phone screen", () => {
    const placed = placeTourCard({ top: 700, left: 20, right: 120, bottom: 744 }, card, { width: 375, height: 812 })!;
    expect(placed.side).toBe("above");
    expect(placed.left).toBeGreaterThanOrEqual(12);
    expect(placed.left + card.width).toBeLessThanOrEqual(375 - 12);
  });

  it("sits beside an open menu rather than over it, or docks when there's no room", () => {
    const menu = { top: 60, left: 846, right: 1186, bottom: 600 };
    const placed = placeTourCard({ top: 300, left: 856, right: 1176, bottom: 344 }, card, desktop, menu)!;
    expect(placed.side).toBe("left");
    expect(overlaps(box(placed), menu)).toBe(false);
    expect(placeTourCard({ top: 300, left: 20, right: 355, bottom: 344 }, card, { width: 375, height: 812 }, { top: 60, left: 14, right: 361, bottom: 780 })).toBeNull();
  });
});

// Failure mode: the card explains a screen the owner isn't on, or Next sends them somewhere else.
describe("onTourScreen", () => {
  it("tells Home from Chat by view, and knows Accounts and Social", () => {
    expect(onTourScreen("home", "/assistant", "home")).toBe(true);
    expect(onTourScreen("home", "/assistant", "chat")).toBe(false);
    expect(onTourScreen("chat", "/assistant", "chat")).toBe(true);
    expect(onTourScreen("social", "/social", undefined)).toBe(true);
    expect(onTourScreen("social", "/accounts", undefined)).toBe(false);
    expect(tourScreenRoute("social")).toEqual({ path: "/social" });
    expect(tourScreenRoute("chat")).toEqual({ path: "/assistant", query: { view: "chat" } });
  });
});
