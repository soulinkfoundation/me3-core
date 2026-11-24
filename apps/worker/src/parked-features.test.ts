import { describe, expect, it } from "vitest";
import { isToolAvailable } from "./agent-runtime";
import { createDomainTools } from "../../../packages/agent/src/tools/index";
import { buildAgentSystemPrompt } from "../../../packages/agent/src/prompt";

// me3-c5h8: custom Home cards were parked for the first release (me3-5u97.6) and are now offered on every
// install. Free installs limit which data a card may show (home-card-data.test.ts). Social posts and email
// campaigns stay out of the agent's offers.
describe("features the agent may offer", () => {
  it("offers card tools when their services are there and hides them when not", () => {
    const names = createDomainTools().map((tool) => tool.name);
    const cards = names.filter((name) => name.startsWith("core_cards_"));
    expect(cards.length).toBeGreaterThan(0);
    for (const name of cards) expect(isToolAvailable(name, {})).toBe(false);
    expect(isToolAvailable("core_sites_starter_draft", {})).toBe(true);
  });

  it("never forbids cards, and still never offers campaigns or social posts", () => {
    const prompt = buildAgentSystemPrompt({ ownerName: "Ada", timezone: "UTC" });
    expect(prompt).toMatch(/cannot yet send email campaigns or publish social posts: never offer or suggest them/);
    expect(prompt).not.toMatch(/custom Home cards/);
    expect(prompt).not.toMatch(/make purchases/);
  });
});
