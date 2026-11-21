import { describe, expect, it } from "vitest";
import { agentMaxSteps, agentPlanNote } from "./agent-plan-limits";
import { buildAgentSystemPrompt } from "../../../packages/agent/src/prompt";

// Failure modes: a weak model loops through all 30 steps on one message (seen: 26 steps), so one message
// costs many; a bad setting disables the limit or stops every turn at once; an owner on a restricted plan is
// offered work the agent has no tools for; an ordinary installation's prompt or limit changes.
describe("plan limits for the agent", () => {
  it("uses the installation's default unless a valid lower cap is set", () => {
    expect(agentMaxSteps({})).toBeUndefined();
    expect(agentMaxSteps({ ME3_AGENT_MAX_STEPS: "8" })).toBe(8);
    for (const value of ["", "0", "-3", "abc", "2.5", "1", "31", "500"]) expect(agentMaxSteps({ ME3_AGENT_MAX_STEPS: value }), value).toBeUndefined();
    expect(agentMaxSteps({ ME3_AGENT_MAX_STEPS: "2" })).toBe(2);
    expect(agentMaxSteps({ ME3_AGENT_MAX_STEPS: "30" })).toBe(30);
  });

  it("adds the plan note to the system prompt before the owner's data, and nothing when unset", () => {
    expect(agentPlanNote({})).toBeUndefined();
    expect(agentPlanNote({ ME3_AGENT_PLAN_NOTE: "   " })).toBeUndefined();
    const base = buildAgentSystemPrompt({ ownerName: "Ada", timezone: "Europe/Dublin", ownerSnapshot: "tasks: none", now: new Date(0) });
    expect(buildAgentSystemPrompt({ ownerName: "Ada", timezone: "Europe/Dublin", ownerSnapshot: "tasks: none", now: new Date(0), planNote: undefined })).toBe(base);
    const noted = buildAgentSystemPrompt({ ownerName: "Ada", timezone: "Europe/Dublin", ownerSnapshot: "tasks: none", now: new Date(0), planNote: agentPlanNote({ ME3_AGENT_PLAN_NOTE: " Free plan: no email. " }) });
    expect(noted).toContain("Free plan: no email.");
    expect(noted.indexOf("Free plan: no email.")).toBeLessThan(noted.indexOf("Owner snapshot"));
  });
});
