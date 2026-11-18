import { describe, expect, it } from "vitest";
import { readChatTour, tourPlaceForPath, tourStartIndex, type ChatTour } from "./chatTour";

// Failure modes: an older Core without the tour leaves Show me around doing nothing; a broken step draws an empty card;
// the tour restarts from the top after a reload instead of the owner's step; a page that isn't Accounts or Social ticks a step.
const step = (id: string) => ({ id, emoji: "🏠", title: id, body: "Hi", task: null, copy: null, done: false });

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
