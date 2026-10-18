import type { AgentMessage, AgentTool } from "./types";

/**
 * Rarely used tool groups stay out of model calls until the model loads them,
 * which keeps every ordinary turn ~3k tokens lighter. Execution still sees the
 * full tool list, so a deferred tool called by name keeps working.
 */
export const TOOL_LOADER_NAME = "core_tools_load";
export const DEFERRED_TOOL_GROUPS: Record<string, { prefix: string; summary: string }> = {
  sites: { prefix: "core_sites_", summary: "create, update or list landing pages on the owner's websites, and read site blog posts" },
  payments: { prefix: "core_payments_", summary: "propose a purchase for the owner to approve and pay on their own device (including from other ME3 sites found with core_people_search, checked live with the seller), record receipts, and list payments" },
  computer: { prefix: "core_computer_", summary: "start, check or cancel a background browser job in which ME3 reads public websites to find or check information such as prices, availability or opening hours" },
  social: { prefix: "core_social_", summary: "save social post drafts and post suggestions from a journal entry or task, search the social library, and plan or schedule posts. Use it whenever the owner asks for a social post or draft" },
};

export function toolGroupFor(name: string): string | undefined {
  return Object.entries(DEFERRED_TOOL_GROUPS).find(([, group]) => name.startsWith(group.prefix))?.[0];
}

/** Adds the loader when any deferred group is available to this turn. */
export function withToolLoader(tools: AgentTool[]): AgentTool[] {
  const groups = [...new Set(tools.map(tool => tool.group).filter((group): group is string => !!group))];
  if (!groups.length) return tools;
  const loader: AgentTool = {
    name: TOOL_LOADER_NAME, effect: "read", approval: "none",
    description: `Load more tools for this turn, then call them. Groups: ${groups.map(group => `${group} = ${DEFERRED_TOOL_GROUPS[group]?.summary ?? group}`).join("; ")}.`,
    parameters: { type: "object", properties: { groups: { type: "array", minItems: 1, items: { type: "string", enum: groups } } }, required: ["groups"], additionalProperties: false },
    async execute(args) {
      const requested = new Set(Array.isArray(args.groups) ? args.groups : []);
      return { status: "ok", data: { loaded: [...requested], tools: tools.filter(tool => tool.group && requested.has(tool.group)).map(tool => tool.name) } };
    },
  };
  return [...tools, loader];
}

/** Tools the model sees: always-on tools plus every group loaded earlier in the turn. */
export function visibleTools(tools: readonly AgentTool[], messages: readonly AgentMessage[]): AgentTool[] {
  const loaded = new Set<string>();
  for (const message of messages) for (const call of message.toolCalls ?? []) {
    if (call.name === TOOL_LOADER_NAME && Array.isArray(call.arguments.groups)) for (const group of call.arguments.groups) loaded.add(String(group));
  }
  return tools.filter(tool => !tool.group || loaded.has(tool.group));
}
