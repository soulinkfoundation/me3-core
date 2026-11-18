import { describe, expect, it } from "vitest";
import { loadChatTour } from "./chatTour";

// Failure modes: an older Core without the tour leaves Show me around doing nothing; a broken step draws an empty card.
describe("loadChatTour", () => {
  it("keeps only steps it can draw", async () => {
    const tour = await loadChatTour(async <T>() => ({ steps: [{ id: "a", emoji: "🌐", title: "Your website", body: "Hi", where: "Website", tryIt: null }, { id: "b", title: "", body: "" }] }) as T);
    expect(tour?.steps.map(step => step.id)).toEqual(["a"]);
    expect(tour?.done.title).toBe("That's the tour");
  });

  it("is null when Core sends no steps, so the app can ask ME3 instead", async () => {
    expect(await loadChatTour(async <T>() => ({}) as T)).toBeNull();
  });
});
