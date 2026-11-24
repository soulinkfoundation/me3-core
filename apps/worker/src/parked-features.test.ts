import { describe, expect, it } from "vitest";
import { isToolAvailable, parkedFeaturesOn } from "./agent-runtime";
import { createDomainTools } from "../../../packages/agent/src/tools/index";
import { buildAgentSystemPrompt } from "../../../packages/agent/src/prompt";

// me3-5u97.6: custom Home cards are parked for the first release. A new owner's agent must not see
// their tools (so it cannot offer them); social posts hide with their plugin. Agent purchases were
// parked with them and are offered again (me3-2gdu.17).
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

  it("tells the agent never to offer campaigns, social posts or cards, and leaves purchases open", () => {
    const prompt = buildAgentSystemPrompt({ ownerName: "Ada", timezone: "UTC" });
    expect(prompt).toMatch(/never offer or suggest them/);
    expect(prompt).not.toMatch(/make purchases/);
    expect(prompt).toMatch(/custom Home cards/);
  });

  // me3-c5h8: once cards are offered, the prompt must not still forbid them, or the agent answers in text.
  it("lets the agent build cards when they are offered", () => {
    const prompt = buildAgentSystemPrompt({ ownerName: "Ada", timezone: "UTC", cardsOffered: true });
    expect(prompt).toMatch(/never offer or suggest them/);
    expect(prompt).not.toMatch(/custom Home cards/);
  });
});
