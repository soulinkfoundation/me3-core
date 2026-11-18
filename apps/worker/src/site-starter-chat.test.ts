import { describe, expect, it } from "vitest";
import { createDomainTools } from "../../../packages/agent/src/tools/index";
import { visibleTools, withToolLoader } from "../../../packages/agent/src/tool-groups";

// me3-5u97.12: on a fresh install, "I teach yoga in Galway. Build me a simple website where people can book
// a free 30-minute intro class." got "I can't build websites", then a three-question interview. The first-site
// draft must be callable on turn one with no loader step, and say so to the model.
describe("first-site draft reachable from a plain chat request", () => {
  const tools = createDomainTools();
  const draft = tools.find((tool) => tool.name === "core_sites_starter_draft")!;

  it("is visible on every turn without loading a tool group", () => {
    expect(draft.group).toBeUndefined();
    expect(visibleTools(withToolLoader(tools), []).map((tool) => tool.name)).toContain("core_sites_starter_draft");
  });

  it("tells the model to draft straight away from one sentence and never to refuse", () => {
    expect(draft.description).toMatch(/build, make or set up a website/);
    expect(draft.description).toMatch(/I teach yoga in Galway/);
    expect(draft.description).toMatch(/do not interview them first/);
    expect(draft.description).toMatch(/Never say you cannot build websites/);
  });
});

// The domain offer must be reachable from "can I get my own .com?" in one step, and never claim a purchase.
describe("domain offer reachable from chat", () => {
  const tool = createDomainTools().find((entry) => entry.name === "core_sites_domain_options")!;

  it("is visible on every turn and never registers or sends the owner elsewhere", () => {
    expect(tool.group).toBeUndefined();
    expect(tool.approval).not.toBe("required");
    expect(tool.description).toMatch(/Never say you bought or registered a domain/);
    expect(tool.description).toMatch(/never send them to another registrar/);
  });
});
