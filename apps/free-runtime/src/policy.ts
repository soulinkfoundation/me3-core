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

const FREE_EMPTY_LISTS = ["/api/sites", "/api/contacts"];

const FREE_TOOL_PREFIXES = [
  "core_calendar_", "core_conversations_", "core_docs_", "core_journal_", "core_memory_", "core_mission_",
  "core_owner_", "core_quotes_", "core_reminders_", "core_targets_", "core_tools_",
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function freeApiAccess(method: string, path: string, options: FreePolicyOptions, body?: unknown): "allow" | "upgrade" {
  const pathname = path.split("?")[0];
  // The apps build their menu from the plugin list; a free user may read it (filtered) but not switch plugins.
  if (pathname === "/api/plugins") return method === "GET" ? "allow" : "upgrade";
  // Home reads these two lists on every refresh. A free ME3 has no sites or contacts, so they are empty;
  // only the bare list is readable, nothing under it and no writes.
  if (FREE_EMPTY_LISTS.includes(pathname)) return method === "GET" ? "allow" : "upgrade";
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

/** What the apps may show a free user; mailbox and sites belong to paid installations. */
export const FREE_MOBILE_CAPABILITIES = ["mobile.v1", "assistant", "mission-control", "calendar", "journal", "account"];

/**
 * Core describes an install by its origin, but a free user's ME3 lives under /u/{userId} on a shared
 * origin and offers fewer features. Corrects the install details in /api/mobile responses so the apps
 * call the right base URL and hide what the free plan does not include.
 */
export function rewriteMobileInstall<T>(body: T, place: { base: string; publicURL: string }): T {
  if (!body || typeof body !== "object") return body;
  const result = { ...(body as Record<string, unknown>) };
  const install = result.install;
  if (install && typeof install === "object") {
    result.install = { ...(install as Record<string, unknown>), apiBaseURL: `${place.base}/api`, publicURL: place.publicURL, capabilities: FREE_MOBILE_CAPABILITIES };
    if (Array.isArray(result.scope)) result.scope = FREE_MOBILE_CAPABILITIES;
  }
  if (typeof result.installId === "string" && result.capabilities && typeof result.capabilities === "object" && !Array.isArray(result.capabilities)) {
    result.publicURL = place.publicURL;
    result.capabilities = { ...(result.capabilities as Record<string, unknown>), mailbox: false, sites: false };
  }
  return result as T;
}

const FREE_PLUGIN_IDS = ["me3.agent-chat", "me3.calendar", "me3.journal", "me3.mission-control"];

/** GET /api/plugins for a free user: only the plugins the free plan includes. */
export function freePluginList<T extends { plugins?: { id: string }[] }>(body: T, options: FreePolicyOptions): T {
  if (!body || !Array.isArray(body.plugins)) return body;
  const allowed = new Set(options.news ? [...FREE_PLUGIN_IDS, "me3.soup"] : FREE_PLUGIN_IDS);
  return { ...body, plugins: body.plugins.filter((plugin) => allowed.has(plugin.id)) };
}

type TourBody = { steps?: { id: string; body?: string }[]; progress?: { status: string; stepId: string | null } };

/** The first-run tour for a free user: Home only. Inbox, Accounts, Social and the website builder are paid. */
export function freeTour<T extends TourBody>(body: T): T {
  if (!body || !Array.isArray(body.steps)) return body;
  const steps = body.steps
    .filter((step) => step.id === "home")
    .map((step) => ({ ...step, body: step.body?.replace(/\s*Inbox is a good one to start with\./, "") }));
  const stepId = steps.some((step) => step.id === body.progress?.stepId) ? body.progress!.stepId : null;
  return { ...body, steps, progress: body.progress ? { ...body.progress, stepId } : body.progress };
}

export const isTourPath = (path: string) => path === "/api/assistant/tour" || path === "/api/assistant/tour/progress";
