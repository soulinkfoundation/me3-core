import { describe, expect, it } from "vitest";
import { createDomainTools } from "../../../packages/agent/src/tools";
import { visibleTools, withToolLoader, TOOL_LOADER_NAME } from "../../../packages/agent/src/tool-groups";
import { leanToolGroupsFor, withLeanToolGroups, toolAllowedByEnv } from "./agent-tool-allowlist";

// Failure modes: lean mode hides writing or search tools but the model has no way to load them (or no idea
// when to); a message that plainly needs them pays an extra model step; an installation without lean mode
// sees any change; lean mode moves a tool that already belongs to a group.
const FREE = "core_calendar_,core_conversations_,core_docs_,core_journal_,core_memory_,core_mission_,core_owner_,core_quotes_,core_reminders_,core_targets_,core_tools_";
const free = () => createDomainTools().filter((tool) => toolAllowedByEnv({ ME3_AGENT_TOOL_ALLOWLIST: FREE }, tool.name));
const names = (tools: { name: string }[]) => tools.map((tool) => tool.name);
const size = (tools: { name: string; description: string; parameters: unknown }[]) => JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters }))).length;

describe("lean tool groups", () => {
  it("changes nothing unless switched on", () => {
    const before = free().map((tool) => [tool.name, tool.group]);
    expect(withLeanToolGroups({}, free()).map((tool) => [tool.name, tool.group])).toEqual(before);
    expect(leanToolGroupsFor({}, "what did I write in my journal?")).toEqual([]);
  });

  it("keeps everyday tools in view and defers writing and search behind the loader", () => {
    const tools = withLeanToolGroups({ ME3_AGENT_LEAN_TOOLS: "on" }, free());
    const shown = names(visibleTools(withToolLoader(tools), []));
    for (const name of ["core_mission_task_create", "core_mission_task_list", "core_reminders_create", "core_calendar_events_list", "core_calendar_event_create", TOOL_LOADER_NAME]) expect(shown, name).toContain(name);
    for (const name of ["core_journal_save", "core_journal_read", "core_quotes_save", "core_conversations_search", "core_owner_content_search", "core_docs_read"]) expect(shown, name).not.toContain(name);
    const loader = withToolLoader(tools).find((tool) => tool.name === TOOL_LOADER_NAME)!;
    expect(loader.description).toMatch(/writing = .*journal/i);
    expect(loader.description).toMatch(/search = .*conversations/i);
    // The point of the exercise: a clearly smaller tool list on an ordinary turn.
    expect(size(visibleTools(withToolLoader(tools), []))).toBeLessThan(size(visibleTools(withToolLoader(free()), [])) * 0.75);
  });

  it("shows a deferred group once it is loaded or the message asks for it", () => {
    const tools = withLeanToolGroups({ ME3_AGENT_LEAN_TOOLS: "on" }, free());
    expect(names(visibleTools(withToolLoader(tools, ["writing"]), [], ["writing"]))).toContain("core_journal_save");
    expect(leanToolGroupsFor({ ME3_AGENT_LEAN_TOOLS: "on" }, "Add to my journal: slept well")).toEqual(["writing"]);
    expect(leanToolGroupsFor({ ME3_AGENT_LEAN_TOOLS: "on" }, "save this quote")).toEqual(["writing"]);
    expect(leanToolGroupsFor({ ME3_AGENT_LEAN_TOOLS: "on" }, "what did we talk about last week?")).toEqual(["search"]);
    expect(leanToolGroupsFor({ ME3_AGENT_LEAN_TOOLS: "on" }, "remind me to call Sam tomorrow")).toEqual([]);
  });

  it("leaves tools that already have a group where they are", () => {
    const tools = withLeanToolGroups({ ME3_AGENT_LEAN_TOOLS: "on" }, createDomainTools());
    expect(tools.find((tool) => tool.name === "core_memory_search")?.group).toBe("memory");
    expect(tools.find((tool) => tool.name === "core_accounts_summary")?.group).toBe("accounts");
  });
});
