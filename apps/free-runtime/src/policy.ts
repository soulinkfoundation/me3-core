/**
 * What the free plan includes. Everything here is an allowlist: a Core route or agent tool added later
 * stays off for free users until it is listed.
 */
export type FreePolicyOptions = { news: boolean };

const FREE_API_PREFIXES = [
  "/api/mobile", "/api/auth/me", "/api/auth/logout", "/api/assistant", "/api/agent/approvals",
  "/api/mission-control", "/api/tasks", "/api/journal", "/api/calendar", "/api/home", "/api/account",
  "/api/quotes", "/api/gratitude", "/api/push", "/api/config", "/api/navigation-features",
];
const NEWS_API_PREFIXES = ["/api/news", "/api/soup"];
// Inside an allowed area but not free: uploads need storage, and these agent channels belong to paid installs.
const BLOCKED_API_PREFIXES = ["/api/assistant/attachments", "/api/calendar/sources"];

const FREE_TOOL_PREFIXES = [
  "core_calendar_", "core_conversations_", "core_docs_", "core_journal_", "core_memory_", "core_mission_",
  "core_owner_", "core_quotes_", "core_reminders_", "core_targets_", "core_tools_",
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function freeApiAccess(method: string, path: string, options: FreePolicyOptions, body?: unknown): "allow" | "upgrade" {
  const pathname = path.split("?")[0];
  if (pathname === "/api/batch") {
    const requests = (body as { requests?: unknown } | null | undefined)?.requests;
    if (method !== "POST" || !Array.isArray(requests)) return "upgrade";
    return requests.every((entry) => typeof entry === "string" && entry !== "/api/batch" && freeApiAccess("GET", entry, options) === "allow") ? "allow" : "upgrade";
  }
  if (BLOCKED_API_PREFIXES.some((prefix) => under(pathname, prefix))) return "upgrade";
  const allowed = options.news ? [...FREE_API_PREFIXES, ...NEWS_API_PREFIXES] : FREE_API_PREFIXES;
  return allowed.some((prefix) => under(pathname, prefix)) ? "allow" : "upgrade";
}

export function freeToolAllowlist(options: FreePolicyOptions): string {
  return (options.news ? [...FREE_TOOL_PREFIXES, "core_news_"] : FREE_TOOL_PREFIXES).join(",");
}

/** Free chat runs on the model the runtime chooses; a client cannot pick a costlier model or mode. */
export function sanitizeChatTurnBody(body: Record<string, unknown>): Record<string, unknown> {
  const { model: _model, mode: _mode, ...rest } = body;
  return rest;
}

export const isChatTurnPath = (path: string) => /^\/api\/assistant\/chat\/turn(\/stream)?$/.test(path) || path === "/api/agent/sandbox";
