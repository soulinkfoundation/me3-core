import { describe, expect, it } from "vitest";
import { readGoalSuggestions, writeGoalSuggestions } from "./agent-goal-suggestions";
import type { AgentModel } from "../../../packages/agent/src/types";

// Failure modes: generic or duplicate goals, two for one area, unknown areas,
// over-long text, a goal the owner already has, or prose instead of the tool call.
describe("starter goal suggestions", () => {
  it("keeps three distinct, bounded goals in known areas the owner doesn't have", () => {
    expect(readGoalSuggestions([
      { areaId: "health", title: "Walk by the Lee three lunchtimes a week.", help: "ME3 can nudge you at 12:30." },
      { areaId: "health", title: "Swim on Saturdays", help: "ME3 can remind you." },
      { areaId: "career", title: "Ship it", help: "ME3 can help." },
      { areaId: "work", title: "Book two clarity calls", help: "ME3 can add a task." },
      { areaId: "joy", title: "x".repeat(61), help: "ME3 can remind you." },
      { areaId: "home", title: "Clear the desk", help: "ME3 can remind you on Saturdays." },
      { areaId: "finances", title: "Price my coaching", help: "ME3 can add a task." },
    ], ["book two clarity calls"])).toEqual([
      { areaId: "health", title: "Walk by the Lee three lunchtimes a week", help: "ME3 can nudge you at 12:30." },
      { areaId: "home", title: "Clear the desk", help: "ME3 can remind you on Saturdays." },
      { areaId: "finances", title: "Price my coaching", help: "ME3 can add a task." },
    ]);
    expect(readGoalSuggestions("nope")).toEqual([]);
  });

  it("forces the tool call and sends the wheel and snapshot", async () => {
    let seen: Parameters<AgentModel["step"]>[0] | undefined;
    const model = { id: "fast", async step(step) {
      seen = step;
      return { text: "", toolCalls: [{ id: "1", name: "core_goal_suggestions", arguments: { goals: [{ areaId: "spirituality", title: "Sit for ten minutes before calls", help: "ME3 can remind you each morning." }] } }] };
    } } as AgentModel;
    const goals = await writeGoalSuggestions(model, { ownerSnapshot: "Coach in Ireland", wheel: [{ areaId: "spirituality", score: 3 }], existingGoals: [] }, new AbortController().signal);
    expect(goals).toEqual([{ areaId: "spirituality", title: "Sit for ten minutes before calls", help: "ME3 can remind you each morning." }]);
    expect(seen?.toolChoice).toBe("core_goal_suggestions");
    expect(String(seen?.messages[1].content)).toContain("Coach in Ireland");
  });
});
