import { describe, expect, it } from "vitest";
import { createGoalSaveQueue, goalPayload } from "./goalSaves";
import type { HomeGoal } from "./homeSummary";

// Goals save as you change them, one request at a time. Failure modes: an edit made while a save is in
// flight is lost; several waiting edits send stale lists; an older answer replaces newer edits; an untitled
// goal or stale task links reach the install; a failed save leaves the queue stuck.
const goal = (id: string, title: string, progress = 0): HomeGoal => ({ id, title, status: "active", progress });

function fakeInstall() {
  const sent: HomeGoal[][] = [];
  const gates: Array<() => void> = [];
  let failNext = false;
  return {
    sent,
    release: () => gates.shift()?.(),
    failOnce: () => { failNext = true; },
    send: (goals: HomeGoal[]) => {
      sent.push(goals);
      return new Promise<HomeGoal[]>((resolve, reject) => gates.push(() => {
        if (failNext) { failNext = false; reject(new Error("Offline")); } else resolve(goals);
      }));
    },
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("goal saves", () => {
  it("sends edits made during a save afterwards, with only the latest list", async () => {
    const install = fakeInstall();
    const save = createGoalSaveQueue(install.send);
    const first = save([goal("a", "Run", 10)]);
    await tick();
    await expect(save([goal("a", "Run", 20)])).resolves.toBeNull();
    await expect(save([goal("a", "Run", 30)])).resolves.toBeNull();
    install.release();
    await tick();
    install.release();
    const result = await first;
    expect(install.sent.map(list => list[0].progress)).toEqual([10, 30]);
    expect(result?.[0].progress).toBe(30);
  });

  it("never sends untitled goals or task links, and trims titles", () => {
    expect(goalPayload([
      { ...goal("a", "  Run a marathon \n"), taskIds: ["t1"], projectIds: ["p1"], areaId: "health" },
      goal("b", "   "),
    ])).toEqual([{ id: "a", title: "Run a marathon", status: "active", areaId: "health", progress: 0, projectIds: ["p1"] }]);
  });

  it("lets the next save through after one fails", async () => {
    const install = fakeInstall();
    install.failOnce();
    const save = createGoalSaveQueue(install.send);
    const failing = save([goal("a", "Run")]);
    await tick();
    install.release();
    await expect(failing).rejects.toThrow("Offline");
    const retry = save([goal("a", "Run", 50)]);
    await tick();
    install.release();
    expect((await retry)?.[0].progress).toBe(50);
  });
});
