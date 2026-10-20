import type { AgentMessage } from "./types";

// Tools return instants in UTC. Converting them to the owner's wall time is
// error-prone for smaller models, so every absolute instant in a tool result
// also travels as owner-local text in a sibling `<key>Local` field. Only the
// model's copy changes: saved tool messages must stay byte-equal to receipts.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const MAX_DEPTH = 8;

export function withOwnerLocalTimes<T>(value: T, timezone: string): T {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });
  } catch {
    return value;
  }
  const local = (text: string) => {
    if (!INSTANT.test(text)) return null;
    const date = new Date(text);
    return Number.isFinite(date.getTime()) ? format.format(date) : null;
  };
  const visit = (node: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH || !node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(item => visit(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      out[key] = visit(item, depth + 1);
      const text = typeof item === "string" && !key.endsWith("Local") ? local(item) : null;
      if (text && !(`${key}Local` in node)) out[`${key}Local`] = text;
    }
    return out;
  };
  return visit(value, 0) as T;
}

export function withOwnerLocalToolTimes(messages: readonly AgentMessage[], timezone: string): AgentMessage[] {
  return messages.map(message => {
    if (message.role !== "tool") return message;
    let parsed: unknown;
    try { parsed = JSON.parse(message.content); } catch { return message; }
    return { ...message, content: JSON.stringify(withOwnerLocalTimes(parsed, timezone)) };
  });
}
