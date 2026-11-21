import { LEAN_TOOL_GROUPS } from "../../../packages/agent/src/tool-groups";
import type { AgentTool } from "../../../packages/agent/src/types";
import type { Env } from "./types";

/**
 * An installation normally offers every tool its services support. A runtime that hosts a restricted
 * plan sets ME3_AGENT_TOOL_ALLOWLIST to the tool-name prefixes that plan includes; anything else is
 * hidden from the model and cannot be executed.
 */
export function toolAllowedByEnv(env: Pick<Env, "ME3_AGENT_TOOL_ALLOWLIST">, name: string): boolean {
  const prefixes = env.ME3_AGENT_TOOL_ALLOWLIST?.split(",").map((prefix) => prefix.trim()).filter(Boolean);
  if (!prefixes?.length) return true;
  return prefixes.some((prefix) => name.startsWith(prefix));
}

const leanOn = (env: Pick<Env, "ME3_AGENT_LEAN_TOOLS">) => env.ME3_AGENT_LEAN_TOOLS?.trim().toLowerCase() === "on";

/**
 * Lean mode keeps the tool list the model reads on every request short: tools in LEAN_TOOL_GROUPS wait
 * behind the loader like the other deferred groups. A tool that already has a group stays in it.
 */
export function withLeanToolGroups(env: Pick<Env, "ME3_AGENT_LEAN_TOOLS">, tools: AgentTool[]): AgentTool[] {
  if (!leanOn(env)) return tools;
  return tools.map((tool) => {
    if (tool.group) return tool;
    const group = Object.entries(LEAN_TOOL_GROUPS).find(([, lean]) => lean.prefixes.some((prefix) => tool.name.startsWith(prefix)))?.[0];
    return group ? { ...tool, group } : tool;
  });
}

/** Lean groups the owner's message plainly needs, so they load without costing a model step. */
export function leanToolGroupsFor(env: Pick<Env, "ME3_AGENT_LEAN_TOOLS">, messageText: string): string[] {
  if (!leanOn(env)) return [];
  return Object.entries(LEAN_TOOL_GROUPS).filter(([, lean]) => lean.hint.test(messageText)).map(([group]) => group);
}
