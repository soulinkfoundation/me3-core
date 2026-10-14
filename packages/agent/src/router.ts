import { record } from "./fast-path";
import type { AgentMessage, AgentModel, AgentUsage } from "./types";

// Routes a fresh turn to a fast tool-free model only when a decision model is
// confident no owner records, actions or web search are needed. Anything else,
// including a slow, failed or malformed decision, stays on the main model.
export type AgentRouteDecision = {
  route: "fast" | "main";
  reason: "conversation" | "needs_tools" | "follows_record_work" | "timeout" | "error" | "malformed" | "attachments";
  router: string;
  needsTools?: number;
  followsRecordWork?: number;
  durationMs: number;
  usage?: AgentUsage;
};
export type AgentRouterInput = { messageText: string; recentMessages: readonly AgentMessage[]; signal: AbortSignal };
export type AgentRouterAnswer = { needsTools: number; followsRecordWork?: number; usage?: AgentUsage };
export interface AgentRouter {
  id: string;
  fastModel: AgentModel;
  /** Routing never waits longer than this before falling back to the main model. */
  timeoutMs?: number;
  /** Highest acceptable probability that the turn needs tools. */
  maxNeedsTools?: number;
  ask(input: AgentRouterInput): Promise<AgentRouterAnswer>;
}

export const DEFAULT_ROUTER_TIMEOUT_MS = 1_200;
export const DEFAULT_MAX_NEEDS_TOOLS = .15;

export const ROUTER_QUESTIONS = {
  needs_tools: { type: "noul", instructions: "Does answering `latest_request` require ME3 to look up or change the owner's own records (calendar, bookings, reminders, tasks, projects, journal, quotes, contacts, email, website or social posts), generate an image, search the web for current information, or take any action? General conversation, brainstorming, advice, explanations, and drafting or rewriting text the owner supplied do not." },
  follows_record_work: { type: "noul", instructions: "Does `latest_request` continue earlier work on the owner's records or actions in `recent_messages`, for example choosing an option, confirming, correcting or asking about a listed item? Unrelated new questions do not." },
} as const;

export function routerState(input: Pick<AgentRouterInput, "messageText" | "recentMessages">) {
  const recent = input.recentMessages.filter(message => message.role === "user" || message.role === "assistant").filter(message => message.content);
  if (recent.at(-1)?.role === "user" && recent.at(-1)?.content === input.messageText) recent.pop();
  return { latest_request: input.messageText, recent_messages: recent.slice(-4).map(({ role, content }) => ({ role, text: content.slice(0, 600) })) };
}

/** Reads Clef `noul` answers; anything missing or out of range is malformed. */
export function parseRouterAnswers(value: unknown): Pick<AgentRouterAnswer, "needsTools" | "followsRecordWork"> | null {
  const answers = record(record(value)?.answers);
  const read = (id: string) => {
    const answer = record(answers?.[id]);
    return answer?.type === "noul" && typeof answer.noul === "number" && answer.noul >= 0 && answer.noul <= 1 ? answer.noul : null;
  };
  const needsTools = read("needs_tools"), followsRecordWork = read("follows_record_work");
  return needsTools === null || followsRecordWork === null ? null : { needsTools, followsRecordWork };
}

export async function decideRoute(router: AgentRouter, input: AgentRouterInput & { hasImages: boolean }): Promise<AgentRouteDecision> {
  const started = performance.now();
  const base = { router: router.id };
  if (input.hasImages) return { ...base, route: "main", reason: "attachments", durationMs: 0 };
  const controller = new AbortController();
  const stop = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", stop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), router.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS); });
    const answer = await Promise.race([router.ask({ ...input, signal: controller.signal }), timeout]);
    const durationMs = performance.now() - started;
    if (answer === "timeout") { controller.abort("Router timed out"); return { ...base, route: "main", reason: "timeout", durationMs }; }
    const details = { needsTools: answer.needsTools, followsRecordWork: answer.followsRecordWork, durationMs, ...(answer.usage ? { usage: answer.usage } : {}) };
    const limit = router.maxNeedsTools ?? DEFAULT_MAX_NEEDS_TOOLS;
    if (answer.needsTools > limit) return { ...base, ...details, route: "main", reason: "needs_tools" };
    if ((answer.followsRecordWork ?? 0) > limit) return { ...base, ...details, route: "main", reason: "follows_record_work" };
    return { ...base, ...details, route: "fast", reason: "conversation" };
  } catch (error) {
    input.signal.throwIfAborted();
    const malformed = error instanceof Error && error.message === "Malformed router response";
    return { ...base, route: "main", reason: malformed ? "malformed" : "error", durationMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", stop);
  }
}
