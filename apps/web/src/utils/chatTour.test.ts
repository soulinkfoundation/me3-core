import { describe, expect, it } from "vitest";
import { coverTourCard, currentTourScreen, currentTourTarget, onTourScreen, placeTourCard, tourArrival, tourCardWaits, tourLeftLast, tourMovesOn, tourScreenRoute, tourScreenToOpen, tourStepDone, tourStepIsHere, readChatTour, tourPlaceForPath, tourStartIndex, type ChatTour } from "./chatTour";

// Failure modes: an older Core without the tour leaves Show me around doing nothing; a broken step draws an empty card;
// the tour restarts from the top after a reload instead of the owner's step; a page that isn't Accounts or Social ticks a step.
const step = (id: string) => ({ id, emoji: "🏠", title: id, body: "Hi", screen: null, intro: null, targets: [], task: null, done: false });

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

// Failure mode: Back from Accounts to Home leaves Accounts open; Next to a pointing step on the same screen jumps somewhere.
describe("tourScreenToOpen", () => {
  const home = { ...step("home"), screen: "home" as const, targets: [{ id: "home_tab", hint: "Tap Home." }] };
  const social = { ...step("social"), screen: "social" as const };
  it("opens a leading step's screen, and leaves Accounts or Social for a step on another screen", () => {
    expect(tourScreenToOpen(social, "home")).toBe("social");
    expect(tourScreenToOpen(social, "social")).toBeNull();
    expect(tourScreenToOpen(home, "accounts")).toBe("home");
    expect(tourScreenToOpen(home, "social")).toBe("home");
    // Failure mode (owner device test, 26 Nov 2026): Next from Home's card on Chat left the owner on Chat.
    expect(tourScreenToOpen(home, "chat")).toBe("home");
    expect(tourScreenToOpen(step("x"), "accounts")).toBeNull();
  });

  // Failure mode (owner device test, 26 Nov 2026): a step Core already counts done showed Done over Chat.
  it("counts a pointing step done only on its own screen, and Accounts or Social on landing", () => {
    const done = { ...home, done: true };
    expect(tourStepDone(done, "chat")).toBe(false);
    expect(tourStepDone(done, "home")).toBe(true);
    expect(tourStepDone(home, "home")).toBe(false);
    expect(tourStepDone(social, "social")).toBe(true);
    expect(tourStepDone({ ...step("website"), screen: "chat" as const, done: true }, "home")).toBe(true);
  });

  it("steps aside on Calendar during the calendar step", () => {
    expect(tourStepIsHere(step("calendar"), "/calendar")).toBe(true);
    expect(tourStepIsHere(step("calendar"), "/assistant")).toBe(false);
    expect(tourStepIsHere(step("email"), "/calendar")).toBe(false);
  });

  it("reads the screen from the route", () => {
    expect(currentTourScreen("/assistant", "chat")).toBe("chat");
    expect(currentTourScreen("/assistant", undefined)).toBe("home");
    expect(currentTourScreen("/accounts", undefined)).toBe("accounts");
    expect(currentTourScreen("/email", undefined)).toBeNull();
  });
});

// Failure mode: the card shows over the screen being left before Accounts or Social has opened, or waits forever.
describe("tourArrival", () => {
  it("waits until the screen is up and a moment after, and gives up after 3 s", () => {
    let state = tourArrival({ screen: "accounts", asked: 0, arrived: null }, "home", 100);
    expect(state.waiting).toBe(true);
    state = tourArrival(state.trip, "accounts", 500);
    expect(state).toEqual({ trip: { screen: "accounts", asked: 0, arrived: 500 }, waiting: true });
    expect(tourArrival(state.trip, "accounts", 900).waiting).toBe(true);
    expect(tourArrival(state.trip, "accounts", 1000)).toEqual({ trip: null, waiting: false });
    expect(tourArrival({ screen: "social", asked: 0, arrived: null }, "home", 3000)).toEqual({ trip: null, waiting: false });
    expect(tourArrival(null, "home", 0)).toEqual({ trip: null, waiting: false });
  });
});

// Failure mode: the card sits over Add to Home while the owner is choosing a card, or vanishes when it points into the dialog.
describe("tourCardWaits", () => {
  const home = { ...step("home"), screen: "home" as const };
  it("hides while a dialog covers the step's screen, unless it points inside the dialog", () => {
    expect(tourCardWaits(home, "home", { open: true, holdsTarget: false })).toBe(true);
    expect(tourCardWaits(home, "home", { open: true, holdsTarget: true })).toBe(false);
    expect(tourCardWaits(home, "home", { open: false, holdsTarget: false })).toBe(false);
    expect(tourCardWaits(home, "chat", { open: true, holdsTarget: false })).toBe(false);
  });
});

// Failure mode: the owner adds a card and has to find Next; or a step that was already done skips itself.
describe("tourMovesOn", () => {
  it("moves on once the step is done and the owner is back on Home with nothing open", () => {
    let state = tourMovesOn(null, { stepId: "home", done: false, hasTargets: true, settled: true });
    expect(state.advance).toBe(false);
    // Added a card inside Add to Home: done, but the dialog is still open.
    state = tourMovesOn(state.memory, { stepId: "home", done: true, hasTargets: true, settled: false });
    expect(state.advance).toBe(false);
    state = tourMovesOn(state.memory, { stepId: "home", done: true, hasTargets: true, settled: true });
    expect(state.advance).toBe(true);
  });

  it("leaves a step that was done on arrival, and steps with nothing to point at", () => {
    const done = tourMovesOn(null, { stepId: "email", done: true, hasTargets: true, settled: true });
    expect(tourMovesOn(done.memory, { stepId: "email", done: true, hasTargets: true, settled: true }).advance).toBe(false);
    const accounts = tourMovesOn(null, { stepId: "accounts", done: false, hasTargets: false, settled: true });
    expect(tourMovesOn(accounts.memory, { stepId: "accounts", done: true, hasTargets: false, settled: true }).advance).toBe(false);
  });
});

// Failure mode: the owner walks away from the last card and the tour follows them around the app.
describe("tourLeftLast", () => {
  it("ends once the owner has been on the last card's screen and left it", () => {
    let state = tourLeftLast(false, { isLast: true, screen: "chat", current: "home" });
    expect(state).toEqual({ reached: false, end: false });
    state = tourLeftLast(state.reached, { isLast: true, screen: "chat", current: "chat" });
    expect(state).toEqual({ reached: true, end: false });
    expect(tourLeftLast(true, { isLast: true, screen: "chat", current: "home" }).end).toBe(true);
    expect(tourLeftLast(true, { isLast: false, screen: "chat", current: "home" })).toEqual({ reached: false, end: false });
  });
});

// Failure mode: with nothing to point at the card sits half across the dog, or under Chat's composer.
describe("coverTourCard", () => {
  it("centres the card on the placeholder, clear of the bottom", () => {
    const placed = coverTourCard({ top: 200, left: 400, right: 800, bottom: 400 }, { width: 340, height: 180 }, { width: 1200, height: 800 }, 96);
    expect(placed).toEqual({ top: 210, left: 430, side: "over", arrow: 0 });
    expect(coverTourCard({ top: 600, left: 0, right: 375, bottom: 800 }, { width: 340, height: 180 }, { width: 375, height: 812 }, 96).top).toBe(812 - 96 - 180);
  });
});
