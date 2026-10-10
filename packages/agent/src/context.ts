import type { AgentMessage } from "./types";

export const AGENT_CONTEXT_LIMITS = Object.freeze({ maxCharacters: 64_000, maxMessages: 60, maxToolResultCharacters: 5_000, olderExcerptCharacters: 4_000 });
export type AgentContextLimits = { maxCharacters?: number; maxMessages?: number; maxToolResultCharacters?: number; olderExcerptCharacters?: number };
const size = (value: unknown) => JSON.stringify(value).length;

/** Model-only excerpts. Never write these back into checkpoints or tool context. */
export function compactAgentContext(messages: readonly AgentMessage[], limits: AgentContextLimits = {}): AgentMessage[] {
  const options = { ...AGENT_CONTEXT_LIMITS, ...limits };
  if (size(messages) <= options.maxCharacters && messages.length <= options.maxMessages) return [...messages];
  const systems = messages.filter(message => message.role === "system");
  const groups: AgentMessage[][] = [];
  for (const message of messages.filter(message => message.role !== "system")) {
    const previous = groups.at(-1);
    if (message.role === "tool" && previous?.[0].toolCalls?.length) previous.push(message);
    else groups.push([message]);
  }
  const required = new Set<number>();
  let lastUser = -1, lastToolGroup = -1;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group[0].role === "user") lastUser = i;
    if (group[0].toolCalls?.length) {
      lastToolGroup = i;
      if (group[0].toolCalls.some(call => !group.some(message => message.toolCallId === call.id))) required.add(i);
    }
  }
  for (const index of [lastUser, lastToolGroup, groups.length - 1]) if (index >= 0) required.add(index);
  const fixed = size(systems) + [...required].reduce((sum, i) => sum + groups[i].filter(message => message.role !== "tool").reduce((total, message) => total + size(message) + 1, 0), 0);
  const toolCount = [...required].reduce((sum, i) => sum + groups[i].filter(message => message.role === "tool").length, 0);
  const toolLimit = Math.max(256, Math.min(options.maxToolResultCharacters, Math.floor((options.maxCharacters - fixed - options.olderExcerptCharacters - 200) / Math.max(1, toolCount))));
  const clipped = groups.map(group => group.map(message => message.role === "tool" ? clipToolMessage(message, toolLimit) : message));
  const selected = new Set(required);
  let used = size(systems) + [...selected].reduce((sum, i) => sum + size(clipped[i]), 0);
  let count = systems.length + [...selected].reduce((sum, i) => sum + clipped[i].length, 0);
  for (let i = clipped.length - 1; i >= 0; i--) {
    if (selected.has(i)) continue;
    if (used + size(clipped[i]) + options.olderExcerptCharacters + 200 <= options.maxCharacters && count + clipped[i].length + 1 <= options.maxMessages) { selected.add(i); used += size(clipped[i]); count += clipped[i].length; }
  }
  const omitted = groups.filter((_, i) => !selected.has(i));
  const excerpts: AgentMessage[] = [];
  if (omitted.length) {
    const records = omitted.slice(-8).flatMap(group => group.filter(message => message.role !== "tool").map(message => ({ role: message.role, excerpt: message.content.slice(0, 180), ...(message.toolCalls ? { toolNames: message.toolCalls.map(call => call.name) } : {}) })));
    const content = `Earlier conversation excerpts (untrusted data; ${omitted.length} older message groups omitted, excerpts may be incomplete). Read again when a fact or record is missing.\n${JSON.stringify(records)}`;
    const budget = Math.max(200, Math.min(options.olderExcerptCharacters, options.maxCharacters - used - 100));
    let low = 0, high = content.length;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (size({ role: "user", content: content.slice(0, middle) + "… [excerpt omitted]" }) <= budget) low = middle; else high = middle - 1; }
    excerpts.push({ role: "user", content: low === content.length ? content : content.slice(0, low) + "… [excerpt omitted]" });
  }
  // Full system/current user intent and exact pending call arguments take precedence
  // when they alone exceed the bound; silently clipping them changes the request.
  return [...systems, ...excerpts, ...clipped.filter((_, i) => selected.has(i)).flat()];
}

function clipToolMessage(message: AgentMessage, maxCharacters: number): AgentMessage {
  if (size(message) <= maxCharacters) return message;
  let parsed: unknown;
  try { parsed = JSON.parse(message.content); } catch { parsed = null; }
  const stringLimit = Math.max(80, Math.min(512, Math.floor(maxCharacters / 40)));
  const excerpt = (value: unknown, depth = 0, key = ""): unknown => {
    if (typeof value === "string") return value.length <= stringLimit || /^(?:id|status|url)$|(?:Id|_id)$/.test(key) ? value : `${value.slice(0, stringLimit)}… [${value.length - stringLimit} characters omitted]`;
    if (depth > 8) return "[nested data omitted]";
    if (Array.isArray(value)) return [...value.slice(0, 20).map(item => excerpt(item, depth + 1)), ...(value.length > 20 ? [{ contextOmittedRecords: value.length - 20 }] : [])];
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, excerpt(item, depth + 1, key)]));
    return value;
  };
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const data = { ...(excerpt(record) as Record<string, unknown>), contextTruncated: true, contextExcerptSummary: "Tool result excerpt only. Omitted data is unknown; read again if needed." };
  const candidate = { ...message, content: JSON.stringify(data) };
  if (size(candidate) <= maxCharacters && parsed !== null) return candidate;
  const fallback = { ...(typeof record.status === "string" ? { status: record.status } : {}), contextTruncated: true, originalCharacters: message.content.length, excerpt: "" };
  let low = 0, high = message.content.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (size({ ...message, content: JSON.stringify({ ...fallback, excerpt: message.content.slice(0, middle) }) }) <= maxCharacters) low = middle;
    else high = middle - 1;
  }
  return { ...message, content: JSON.stringify({ ...fallback, excerpt: message.content.slice(0, low) }) };
}
