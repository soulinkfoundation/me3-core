export type JsonSchema = Record<string, unknown>;
export type AgentEffect = "read" | "write" | "external" | "destructive";
export type AgentToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type AgentImage = { url: string; mimeType?: string };
export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
  images?: AgentImage[];
};
export type AgentUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteInputTokens?: number; estimatedCostUsd: number | null };
export type AgentModelResponse = { text: string; toolCalls: AgentToolCall[]; usage?: AgentUsage };
export interface AgentModel {
  id: string;
  step(input: { messages: readonly AgentMessage[]; tools: readonly AgentTool[]; signal: AbortSignal; onDelta(text: string): Promise<void> }): Promise<AgentModelResponse>;
}
export interface AgentStatement {
  bind(...values: unknown[]): AgentStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface AgentDb {
  prepare(sql: string): AgentStatement;
  batch?(statements: AgentStatement[]): Promise<unknown[]>;
}
export type AgentToolResult = {
  status: "ok" | "error" | "needs_approval" | "needs_selection";
  data?: unknown;
  error?: string;
  approval?: { id?: string; title: string; summary: string; [key: string]: unknown };
  [key: string]: unknown;
};
export interface AgentToolContext {
  db: AgentDb;
  ownerId: string;
  threadId: string;
  turnId: string;
  requestId: string;
  toolCallId: string;
  idempotencyKey: string;
  ownerTimezone: string;
  messageText: string;
  messages: readonly AgentMessage[];
  enabledPluginIds: ReadonlySet<string>;
  services?: Record<string, unknown>;
  approved?: boolean;
  approvalData?: Record<string, unknown>;
  signal: AbortSignal;
}
export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  effect: AgentEffect;
  approval: "none" | "required";
  pluginId?: string | null;
  prepareApproval?(args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult>;
  idempotencyArguments?(args: Record<string, unknown>): Record<string, unknown>;
  execute(args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult>;
}
export type AgentEvent = { event: "status" | "tool" | "delta" | "step" | "approval_required"; data: Record<string, unknown> };
export type AgentTrace = {
  model: string;
  steps: number;
  toolCalls: Array<{ name: string; effect: AgentEffect; status: string; durationMs: number }>;
  startedAt: string;
  totalDurationMs: number;
  timeToFirstTokenMs: number | null;
  usage: AgentUsage;
};
export type AgentCheckpoint = { messages: AgentMessage[]; steps: number; trace: AgentTrace; pendingCalls?: AgentToolCall[]; nextCallIndex?: number; approvalId?: string; status: "running" | "needs_approval" | "complete" | "cancelled" | "failed" };
export interface AgentTurnStore {
  cancellationRequested?(): Promise<boolean>;
  load(): Promise<AgentCheckpoint | null>;
  save(checkpoint: AgentCheckpoint): Promise<void>;
  getReceipt(key: string): Promise<AgentToolResult | null>;
  claimReceipt(key: string, call: AgentToolCall): Promise<boolean>;
  finishReceipt(key: string, result: AgentToolResult): Promise<void>;
  requestApproval(key: string, call: AgentToolCall, card: NonNullable<AgentToolResult["approval"]>): Promise<string>;
  approvalDecision(id: string): Promise<"pending" | "approved" | "declined">;
  approvalData?(id: string): Promise<Record<string, unknown> | undefined>;
}
export type AgentTurnInput = {
  model: AgentModel;
  backupModel?: AgentModel;
  tools: readonly AgentTool[];
  messages: AgentMessage[];
  context: Omit<AgentToolContext, "toolCallId" | "idempotencyKey" | "signal" | "messages">;
  store: AgentTurnStore;
  signal?: AbortSignal;
  maxSteps?: number;
  timeBudgetMs?: number;
  contextWindow?: import("./context").AgentContextLimits;
  onEvent?(event: AgentEvent): void | Promise<void>;
};
export type AgentTurnResult = { replyText: string; source: string; toolCalls: AgentTrace["toolCalls"]; usage: AgentUsage; modelRequestCount: number; trace: AgentTrace; status: AgentCheckpoint["status"]; approvalId?: string };
