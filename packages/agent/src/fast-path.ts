import { canonicalJson, validateArguments } from "./schema";
import type { AgentMessage, AgentTool, AgentToolCall, AgentUsage } from "./types";

export type AgentFastPathDecision = (
  | { kind: "execute"; call: Pick<AgentToolCall, "name" | "arguments">; confidence: number; probabilities: Record<string, number>; gates: Record<string, number> }
  | { kind: "fallthrough"; reason: string; probabilities?: Record<string, number>; gates?: Record<string, number>; confidence?: number }
) & { toolChoice?: string };
export type AgentDeciderInput = { messageText: string; recentMessages: readonly AgentMessage[]; tools: readonly AgentTool[]; ownerTimezone: string; now: Date; signal: AbortSignal };
export type AgentFastPathResult = AgentFastPathDecision & { usage?: AgentUsage; durationMs: number };
export interface AgentDecider { id: string; decide(input: AgentDeciderInput): Promise<AgentFastPathResult> }
export type AgentFastPathTool = { mode: "tool_only" } | { mode: "arguments"; candidates: "reminders" | "tasks" | "calendar" };
export type FastPathThresholds = { toolProbability: number; argumentProbability: number; historyProbability: number };
// Phase-1 Clef calibration: score shadow predictions, never authorize execution.
export const FAST_PATH_THRESHOLDS: FastPathThresholds = { toolProbability: .56, argumentProbability: .84, historyProbability: .09 };
export type AgentFastPathTrace = { decider: string; status: "complete" | "error" | "timeout" | "skipped"; decision?: AgentFastPathDecision; durationMs: number; usage?: AgentUsage;
  comparison?: { llmFirstCalls: string[]; toolMatch: boolean; argsMatch: boolean | null } };
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, unknown> };
type Question = ChoiceQuestion | { type: "noul"; instructions: string };
type Candidate = { description: string; arguments: Record<string, unknown> };
export type FastPathRequest = { state: Record<string, unknown>; questions: Record<string, Question> & { tool: ChoiceQuestion }; candidates: Record<string, Record<string, Candidate>>; tools: readonly AgentTool[] };

export function eligibleFastPathTools(tools: readonly AgentTool[]): AgentTool[] {
  return tools.filter(tool => tool.fastPath && (tool.fastPath.mode === "tool_only" || tool.effect === "read"));
}

export function buildFastPathRequest(input: AgentDeciderInput): FastPathRequest {
  const tools = eligibleFastPathTools(input.tools);
  const recent = input.recentMessages.filter(message => message.role !== "system" && message.role !== "tool");
  if (recent.at(-1)?.role === "user" && recent.at(-1)?.content === input.messageText) recent.pop();
  const candidates: FastPathRequest["candidates"] = {};
  const questions: FastPathRequest["questions"] = {
    tool: { type: "choice", instructions: "Which single action does `latest_request` ask ME3 to do? Ordinary list questions count. Choose none for several actions, moving/cancelling existing items, explanations or composed prose, negated actions, or anything depending on earlier messages. Choose none for bookings or free-slot availability: listing calendar events does not fulfil those requests. For create actions judge intent only; missing or invalid dates belong to later validation. Recent messages are context, not new requests.",
      criteria: { ...Object.fromEntries(tools.map(tool => [tool.name, tool.description])), none: "Outside these actions, several actions, prose, a negated action or a history-dependent follow-up." } },
  };
  if (recent.length) questions.refers_to_history = { type: "noul", instructions: "Does `latest_request` require `recent_messages` to identify the requested action, target or arguments? Independent requests do not. Pronouns such as that one or the second usually do." };
  for (const tool of tools) {
    if (tool.fastPath?.mode !== "arguments") continue;
    const options = listCandidates(tool.fastPath.candidates, input);
    candidates[tool.name] = Object.fromEntries(Object.entries(options).filter(([, candidate]) => !validateArguments(tool.parameters, candidate.arguments)));
    questions[`args_${tool.name}`] = { type: "choice", instructions: `If the action is ${tool.name}, which candidate represents the requested arguments? Dates are inclusive owner-local dates. An unfiltered list uses the all candidate when available. Match every explicit constraint. Choose none_of_these for an unsupported filter, an unspecified calendar range, an open-ended range, or a range absent from the candidates.`,
      criteria: { ...Object.fromEntries(Object.entries(candidates[tool.name]).map(([id, candidate]) => [id, candidate])), none_of_these: "No candidate exactly covers all requested arguments, or this tool cannot apply a requested filter." } };
  }
  return { state: { latest_request: input.messageText, recent_messages: recent.slice(-3).map(({ role, content }) => ({ role, text: content })), owner_timezone: input.ownerTimezone, now_iso: input.now.toISOString() }, questions, candidates, tools };
}

function listCandidates(kind: "reminders" | "tasks" | "calendar", input: AgentDeciderInput): Record<string, Candidate> {
  const text = input.messageText;
  if (kind === "calendar") {
    const today = localDate(input.now, input.ownerTimezone);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const monday = addDays(today, -((weekday + 6) % 7));
    const ranges: Record<string, [string, string]> = { today: [today, today], tomorrow: [addDays(today, 1), addDays(today, 1)], day_after_tomorrow: [addDays(today, 2), addDays(today, 2)], this_week: [monday, addDays(monday, 6)], next_7_days: [today, addDays(today, 6)] };
    const number = /\bnext\s+(\d{1,2}|one|two|three|four|five|six|seven|ten|fourteen|thirty)\s+days?\b/i.exec(text)?.[1]?.toLowerCase();
    const count = number ? Number(number) || ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30 } as Record<string, number>)[number] : 0;
    if (count >= 1 && count <= 31) ranges[`next_${count}_days`] = [today, addDays(today, count - 1)];
    const explicit = explicitDates(text, today);
    explicit.forEach((date, index) => { ranges[`explicit_${index}`] = [date, date]; });
    if (explicit.length === 2 && explicit[1] >= explicit[0] && Date.parse(explicit[1]) - Date.parse(explicit[0]) <= 30 * 86_400_000) ranges.explicit_range = [explicit[0], explicit[1]];
    const candidates: Record<string, Candidate> = Object.fromEntries(Object.entries(ranges).map(([id, [dateFrom, dateTo]]) => [id, { description: `${id.replace(/_/g, " ")}: ${dateFrom} through ${dateTo}, inclusive (${input.ownerTimezone})`, arguments: { dateFrom, dateTo } }]));
    const limit = /\b(?:first|next|limit(?:\s+to)?)\s+(\d{1,2})\b(?!\s+(?:days?|weeks?|months?|years?)\b)/i.exec(text)?.[1];
    if (limit && +limit >= 1 && +limit <= 50) for (const [id, candidate] of Object.entries(candidates)) candidates[`${id}_limit`] = { description: `${candidate.description}, maximum ${limit} events`, arguments: { ...candidate.arguments, limit: +limit } };
    return candidates;
  }
  const quoted = [...text.matchAll(/["“]([^"”\n]{1,100})["”]/g)].map(match => match[1]);
  const candidates: Record<string, Candidate> = { all: { description: "All records, without a query, project, status or date filter", arguments: {} } };
  if (kind === "reminders") {
    const query = /\b(?:reminders?|alerts?)\s+(?:called|named|about|for)\s+(.+?)[.!?]?$/i.exec(text)?.[1];
    [...new Set([...quoted, ...(query ? [query] : [])])].slice(0, 8).forEach((query, i) => { candidates[`query_${i}`] = { description: `Title contains exactly ${JSON.stringify(query)}`, arguments: { query } }; });
    return candidates;
  }
  const projects = [...quoted];
  for (const pattern of [/\b(?:tasks|work items)\s+(?:in|for)\s+(.+?)[.!?]?$/i, /\bmy\s+(.+?)\s+tasks\b/i, /\bfor\s+(?:the\s+)?(.+?)\s+project\b/i]) {
    const match = pattern.exec(text); if (match) projects.push(match[1]);
  }
  [...new Set(projects.map(value => value.replace(/^(?:the\s+)?project\s+/i, "").trim()).filter(Boolean))].slice(0, 8).forEach((projectName, i) => { candidates[`project_${i}`] = { description: `Exact project name ${JSON.stringify(projectName)}, every status`, arguments: { projectName } }; });
  for (const [id, candidate] of Object.entries(candidates)) for (const status of ["backlog", "in_progress", "done"]) {
    candidates[`${id}_${status}`] = { description: `${candidate.description}; only ${status} tasks`, arguments: { ...candidate.arguments, status } };
  }
  return candidates;
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
function explicitDates(text: string, today: string): string[] {
  const dates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match => match[0]);
  const months = "january february march april may june july august september october november december".split(" ");
  for (const match of text.matchAll(/\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)(?:,?\s+(\d{4}))?\b/g)) {
    const month = months.findIndex(value => value === (match[2] ?? match[3]).toLowerCase());
    if (month !== -1) dates.push(`${match[5] ?? today.slice(0, 4)}-${String(month + 1).padStart(2, "0")}-${(match[1] ?? match[4]).padStart(2, "0")}`);
  }
  return [...new Set(dates.filter(date => { const ms = Date.parse(`${date}T12:00:00Z`); return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date; }))].slice(0, 8);
}

export function parseFastPathResponse(value: unknown, request: FastPathRequest, thresholds: FastPathThresholds = FAST_PATH_THRESHOLDS): AgentFastPathDecision {
  const response = record(value), answers = record(response?.answers);
  if (!answers || ![thresholds.toolProbability, thresholds.argumentProbability, thresholds.historyProbability].every(probability)) return { kind: "fallthrough", reason: "malformed_response" };
  for (const id of ["tool", ...(request.questions.refers_to_history ? ["refers_to_history"] : [])]) {
    const question = request.questions[id];
    const answer = record(answers[id]);
    if (!answer || answer.type !== question.type || (question.type === "noul" ? !probability(answer.noul) : !validChoice(answer, question.criteria))) return { kind: "fallthrough", reason: "malformed_response" };
  }
  const toolAnswer = record(answers.tool)!;
  const name = toolAnswer.choice as string, probabilities = toolAnswer.probabilities as Record<string, number>;
  const gates: Record<string, number> = request.questions.refers_to_history ? { refers_to_history: record(answers.refers_to_history)!.noul as number } : {};
  const common = { probabilities, gates, confidence: toolAnswer.confidence as number, toolChoice: name };
  const fallthrough = (reason: string): AgentFastPathDecision => ({ kind: "fallthrough", reason, ...common });
  if (name === "none") return fallthrough("none");
  if (probabilities[name] < thresholds.toolProbability) return fallthrough("tool_threshold");
  if (gates.refers_to_history !== undefined && gates.refers_to_history > thresholds.historyProbability) return fallthrough("refers_to_history");
  const tool = request.tools.find(tool => tool.name === name);
  if (!tool) return fallthrough("unavailable_tool");
  if (tool.fastPath?.mode === "tool_only") return fallthrough("tool_only");
  const answer = record(answers[`args_${name}`]);
  const question = request.questions[`args_${name}`];
  if (!answer || answer.type !== "choice" || question?.type !== "choice" || !validChoice(answer, question.criteria)) return fallthrough("malformed_response");
  if (answer.choice === "none_of_these") return fallthrough("arguments_uncovered");
  if ((answer.probabilities as Record<string, number>)[answer.choice as string] < thresholds.argumentProbability) return fallthrough("argument_threshold");
  const args = request.candidates[name]?.[answer.choice as string]?.arguments;
  if (!args || validateArguments(tool.parameters, args)) return fallthrough("invalid_arguments");
  return { kind: "execute", call: { name, arguments: { ...args } }, ...common };
}

function validChoice(answer: Record<string, unknown>, criteria: Record<string, unknown>): boolean {
  const probabilities = record(answer.probabilities);
  if (!probabilities || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice) || !probability(answer.confidence)) return false;
  const keys = Object.keys(criteria), values = Object.values(probabilities);
  return keys.length === values.length && keys.every(key => Object.hasOwn(probabilities, key) && probability(probabilities[key]))
    && Math.abs((values as number[]).reduce((sum, value) => sum + value, 0) - 1) < .001
    && values.every(value => (value as number) <= (probabilities[answer.choice as string] as number));
}
export function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function probability(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }

export function startFastPathShadow(config: { mode: "off" | "shadow"; decider: AgentDecider } | undefined, input: AgentDeciderInput) {
  if (config?.mode !== "shadow") return undefined;
  const started = performance.now(), controller = new AbortController();
  let settled: AgentFastPathTrace | undefined;
  const abort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  const close = () => { clearTimeout(timer); input.signal.removeEventListener("abort", abort); controller.abort(); };
  const trace = (status: AgentFastPathTrace["status"], reason: string): AgentFastPathTrace => ({ decider: config.decider.id, status, durationMs: performance.now() - started, decision: { kind: "fallthrough", reason } });
  const timer = setTimeout(() => { settled ??= trace("timeout", "timeout"); close(); }, 2000);
  if (input.recentMessages.some(message => message.images?.length)) { settled = trace("skipped", "attachments"); close(); }
  else void Promise.resolve().then(async () => {
    try {
      const raw = await config.decider.decide({ ...input, recentMessages: structuredClone(input.recentMessages), signal: controller.signal });
      const result = JSON.parse(JSON.stringify(raw)) as typeof raw;
      if (!record(result) || !Number.isFinite(result.durationMs) || result.durationMs < 0 || !["execute", "fallthrough"].includes(result.kind)
        || (result.kind === "execute" ? !record(result.call?.arguments) || typeof result.call?.name !== "string" || !probability(result.confidence) : typeof result.reason !== "string")) throw new Error("Invalid decision");
      const { durationMs, usage, ...decision } = result;
      settled ??= { decider: config.decider.id, status: "complete", decision, durationMs, ...(usage ? { usage } : {}) };
    } catch { settled ??= trace("error", "decider_error"); }
  });
  return { close, snapshot(calls: readonly AgentToolCall[]): AgentFastPathTrace {
    const snapshot = settled ?? trace("timeout", "timeout"); close();
    const decision = snapshot.decision;
    if (snapshot.status !== "complete" || !decision) return snapshot;
    const chosen = decision.kind === "execute" ? decision.call.name : decision.toolChoice;
    const toolMatch = calls.length === 1 && calls[0].name === chosen;
    return { ...snapshot, comparison: { llmFirstCalls: calls.map(call => call.name), toolMatch,
      argsMatch: decision.kind === "execute" ? toolMatch && canonicalJson(decision.call.arguments) === canonicalJson(calls[0].arguments) : null } };
  } };
}
