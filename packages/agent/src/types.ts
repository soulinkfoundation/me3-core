export type JsonSchema = Record<string, unknown>;
export type AgentEffect = "read" | "write" | "external" | "destructive";
export type AgentToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type AgentTargetSelection = { presentationId: string; candidateId: string };
export type AgentTargetMetadata = { domain: string; idParameter: string; actionLabel: string; unsupportedArguments?: readonly string[]; ownerTimezoneParameter?: string };
export type AgentTargetPresentationCard = {
  id: string; actionLabel: string; changes: Array<{ label: string; value: string }>;
  candidates: Array<{ id: string; option: number; label: string; fields: Array<{ label: string; value: string }> }>;
  expiresAt: string; status: "pending" | "selected" | "unavailable";
};
export type AgentImage = { url: string; mimeType?: string };
export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
  images?: AgentImage[];
};
export type AgentUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteInputTokens?: number; estimatedCostUsd: number | null };
export type AgentModelResponse = { text: string; toolCalls: AgentToolCall[]; usage?: AgentUsage; billingUsageId?: string };
export interface AgentModel {
  id: string;
  /** `toolChoice` forces exactly that tool, so the reply is one call and no prose. */
  step(input: { messages: readonly AgentMessage[]; tools: readonly AgentTool[]; signal: AbortSignal; onDelta(text: string): Promise<void>; toolChoice?: string }): Promise<AgentModelResponse>;
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
  targetSelection?: AgentTargetSelection;
  toolCall?: AgentToolCall;
  declaredTarget?: AgentTargetMetadata;
  effectReceiptClaimed?: boolean;
  loadIntentOwnerInputs?(references:AgentTargetIntentInputReferences,signal:AbortSignal):Promise<AgentTargetIntentOwnerInput[]>;
  intentOwnerInputs?:AgentTargetIntentOwnerInput[];
  intentToolContracts?:AgentTargetIntentOperation[];
  intentReadToolContracts?:AgentTargetIntentReadContract[];
  verifyTargetIntent?(evidence:AgentTargetIntentEvidence,signal:AbortSignal):Promise<AgentTargetIntentVerdictResult>;
  verifyOwnerCreateIntent?: import("./owner-create-intent").OwnerCreateVerifier;
  verifyCreateIntent?: import("./create-intent").CreateIntentVerifier;
  onTargetIntentReceipt?(receipt:AgentTargetIntentReceipt):void|Promise<void>;

  signal: AbortSignal;
}
export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  effect: AgentEffect;
  approval: "none" | "required";
  pluginId?: string | null;
  target?: AgentTargetMetadata;
  endsTurn?: boolean;
  /** New-record tools: an independent model confirms the owner asked for the record before it runs. */
  createCheck?: boolean;
  /** Deferred group; the model sees the tool only after loading the group (see tool-groups.ts). */
  group?: string;
  prepareApproval?(args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult>;
  idempotencyArguments?(args: Record<string, unknown>): Record<string, unknown>;
  execute(args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult>;
}
export type AgentEvent = { event: "status" | "tool" | "delta" | "step" | "approval_required"; data: Record<string, unknown> };
export type AgentTrace = {
  model: string;
  /** Deferred tool groups visible from the first step, without a loader call. */
  toolGroups?: string[];
  modelSteps?: Array<{ step: number; model: string; status: "complete" | "error"; durationMs: number; usage?: AgentUsage; billingUsageId?: string; toolCalls: Array<Pick<AgentToolCall, "name" | "arguments">> }>;
  targetIntentRequests?:Array<{receiptId:string;modelId:string;usageId?:string;uncertain:boolean}>;
  steps: number;
  toolCalls: Array<{ name: string; effect: AgentEffect; status: string; durationMs: number }>;
  startedAt: string;
  totalDurationMs: number;
  timeToFirstTokenMs: number | null;
  usage: AgentUsage;
};
export type AgentCheckpoint = { messages: AgentMessage[]; steps: number; trace: AgentTrace; pendingCalls?: AgentToolCall[]; nextCallIndex?: number; approvalId?: string; targetPresentation?: AgentTargetPresentationCard; status: "running" | "needs_approval" | "complete" | "cancelled" | "failed" };
export interface AgentTurnStore {
  cancellationRequested?(): Promise<boolean>;
  load(): Promise<AgentCheckpoint | null>;
  save(checkpoint: AgentCheckpoint): Promise<void>;
  getReceipt(key: string): Promise<AgentToolResult | null>;
  claimReceipt(key: string, call: AgentToolCall): Promise<boolean>;
  finishReceipt(key: string, result: AgentToolResult, options?: { notAdmitted?: boolean }): Promise<void>;
  requestApproval(key: string, call: AgentToolCall, card: NonNullable<AgentToolResult["approval"]>): Promise<string>;
  approvalDecision(id: string): Promise<"pending" | "approved" | "declined">;
  approvalData?(id: string): Promise<Record<string, unknown> | undefined>;
}
export type AgentTurnInput = {
  model: AgentModel;
  backupModel?: AgentModel;
  tools: readonly AgentTool[];
  /** Deferred tool groups shown from the first step, e.g. groups this conversation loaded on earlier turns. */
  preloadedToolGroups?: readonly string[];
  messages: AgentMessage[];
  context: Omit<AgentToolContext, "toolCallId" | "idempotencyKey" | "effectReceiptClaimed" | "signal" | "messages">;
  store: AgentTurnStore;
  signal?: AbortSignal;
  maxSteps?: number;
  timeBudgetMs?: number;
  contextWindow?: import("./context").AgentContextLimits;
  onEvent?(event: AgentEvent): void | Promise<void>;
};
export type AgentTurnResult = { replyText: string; source: string; toolCalls: AgentTrace["toolCalls"]; usage: AgentUsage; modelRequestCount: number; trace: AgentTrace; status: AgentCheckpoint["status"]; approvalId?: string; targetPresentation?: AgentTargetPresentationCard };

export type AgentTargetIntentOwnerInput = { turnId: string; requestId: string; messageText: string };
export type AgentTargetIntentInputReferences = { readTurnIds: string[]; presentationTurnId?: string };
export type AgentTargetIntentOperation = Pick<AgentTool,"name"|"description"|"parameters"|"effect"|"approval"> & {target:{domain:string;idParameter:string}};
export type AgentTargetIntentCandidate = { id:string; selectionId:string; readTurnId:string; snapshot:Record<string,unknown> & {id:string} };
export type AgentTargetIntentSourceRead = { selectionId:string; domain:string; readTurnId:string };
export type AgentTargetIntentPresentation = { id:string; ordinal:number; createdTurnId:string; selectionId:string; domain:string; action:{name:string;arguments:Record<string,unknown>}; candidates:Array<{id:string;option:number;snapshot:Record<string,unknown>&{id:string}}> };
export type AgentTargetIntentReadContract = Pick<AgentTool,"name"|"parameters">;
export type AgentTargetIntentReferenceEvidence = { reads:Array<{turnId:string;requestId:string;seq:number;callId:string;name:string;arguments:Record<string,unknown>;result:{status:"ok";data:unknown}}>; displays:Array<{turnId:string;requestId:string;seq:number;replyText:string}> };
export type AgentTargetIntentEvidence = { version:1; ownerId:string; threadId:string; turnId:string; requestId:string; ownerTimezone:string; ownerInputs:AgentTargetIntentOwnerInput[]; targets:Array<{domain:string;candidates:AgentTargetIntentCandidate[]}>; operations:AgentTargetIntentOperation[]; sourceReads?:AgentTargetIntentSourceRead[]; referenceEvidence?:AgentTargetIntentReferenceEvidence; presentation?:AgentTargetIntentPresentation };
export type AgentTargetIntentAction = {selectedCandidateId:string;authorizedCall:{name:string;arguments:Record<string,unknown>}};
export type AgentTargetIntentVerdict = ({decision:"allow"} & (AgentTargetIntentAction | {actions:AgentTargetIntentAction[]})) | {decision:"deny"|"clarify";reason:string};
export type AgentTargetIntentAuthorizedAction = AgentTargetIntentAction & {domain:string;actionKey:string};
export type AgentTargetIntentInference = {modelId:string;usageId?:string;usage?:AgentUsage};
export type AgentTargetIntentVerdictResult = AgentTargetIntentVerdict & {inference?:AgentTargetIntentInference};
export type AgentTargetIntentReceipt = {receiptId:string;verdict?:AgentTargetIntentVerdict;inference?:AgentTargetIntentInference;authorizedActionKey?:string;authorizedActions?:AgentTargetIntentAuthorizedAction[];uncertain?:boolean;cacheHit:boolean};

export type AgentTargetIntentContext = AgentToolContext;
