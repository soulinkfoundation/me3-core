import { describe, expect, it } from "vitest";
import { isToolAvailable, parkedFeaturesOn } from "./agent-runtime";
import { createDomainTools } from "../../../packages/agent/src/tools/index";
import { buildAgentSystemPrompt } from "../../../packages/agent/src/prompt";

// me3-5u97.6: custom Home cards and agent purchases are parked for the first release. A new owner's
// agent must not see their tools (so it cannot offer them); social posts hide with their plugin.
describe("parked features stay out of a new owner's agent", () => {
  it("is off unless ME3_PARKED_FEATURES is on", () => {
    expect(parkedFeaturesOn({})).toBe(false);
    expect(parkedFeaturesOn({ ME3_PARKED_FEATURES: "off" })).toBe(false);
    expect(parkedFeaturesOn({ ME3_PARKED_FEATURES: " On " })).toBe(true);
  });

  it("hides card and payment tools when their services are not offered", () => {
    const names = createDomainTools().map((tool) => tool.name);
    const cards = names.filter((name) => name.startsWith("core_cards_"));
    const payments = names.filter((name) => name.startsWith("core_payments_"));
    expect(cards.length).toBeGreaterThan(0);
    expect(payments.length).toBeGreaterThan(0);
    for (const name of [...cards, ...payments]) expect(isToolAvailable(name, {})).toBe(false);
    expect(isToolAvailable("core_sites_starter_draft", {})).toBe(true);
  });

  it("tells the agent never to offer campaigns, social posts, cards or purchases", () => {
    expect(buildAgentSystemPrompt({ ownerName: "Ada", timezone: "UTC" })).toMatch(/never offer or suggest them/);
  });
});
