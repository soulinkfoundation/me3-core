import { canonicalJson, toolIdempotencyKey, validateArguments } from "./schema";
import type { AgentDb, AgentStatement, AgentTargetPresentationCard, AgentTargetSelection, AgentTool, AgentToolCall, AgentToolContext } from "./types";

const LIFETIME_MS = 24 * 60 * 60 * 1000;
type Field = { label: string; value: string };
type Candidate = { id: string; option: number; label: string; fields: Field[]; snapshot: Record<string, unknown> };
type Envelope = { actionLabel: string; idParameter: string; ownerTimezone: string | null; changes: Field[]; candidates: Candidate[] };
export type AgentTargetPresentation = Envelope & {
  id: string; ownerId: string; threadId: string; domain: string; selectionId: string; ordinal: number;
  toolName: string; arguments: Record<string, unknown>; createdTurnId: string; createdAt: string; expiresAt: string;
  chosenRecordId: string | null; choiceTurnId: string | null; choiceRequestId: string | null;
  status: AgentTargetPresentationCard["status"]; argumentsJson: string; candidatesJson: string;
};
type Row = {
  id: string; owner_id: string; thread_id: string; domain: string; selection_id: string; ordinal: number;
  tool_name: string; arguments_json: string; candidates_json: string; created_turn_id: string; created_at: string;
  expires_at: string; chosen_record_id: string | null; choice_turn_id: string | null; choice_request_id: string | null;
  status: "pending" | "selected"; available: number;
};

export const AGENT_PRESENTATION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS me3_agent_presentations (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, domain TEXT NOT NULL,
    selection_id TEXT NOT NULL, ordinal INTEGER NOT NULL, tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL, candidates_json TEXT NOT NULL, created_turn_id TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, chosen_record_id TEXT,
    choice_turn_id TEXT, choice_request_id TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','selected')),
    UNIQUE(owner_id,thread_id,ordinal)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_presentations_scope ON me3_agent_presentations(owner_id,thread_id,ordinal DESC)`,
] as const;

export function targetPresentationCard(presentation: AgentTargetPresentation): AgentTargetPresentationCard {
  return { id: presentation.id, actionLabel: presentation.actionLabel, changes: presentation.changes,
    candidates: presentation.candidates.map(({ id, option, label, fields }) => ({ id, option, label, fields })),
    expiresAt: presentation.expiresAt, status: presentation.status };
}

export async function prepareTargetPresentation(context: AgentToolContext, input: { selectionId: string; toolName: string; arguments: Record<string, unknown> }, tools: readonly AgentTool[]): Promise<AgentTargetPresentation> {
  const tool = eligibleTool(tools, input.toolName, context);
  const target = tool.target!;
  if (!input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments) || target.idParameter in input.arguments) throw new Error("Supply pending changes without a target ID.");
  if (hasTechnicalIdentity(input.arguments) || target.unsupportedArguments?.some(key => key in input.arguments)) throw new Error("This destination or proposed change needs an authoritative display and frozen scope before it can be presented.");
  const selection = await context.db.prepare(`SELECT domain,candidates_json,created_at FROM me3_agent_selections
    WHERE id=? AND owner_id=? AND thread_id=?`).bind(input.selectionId, context.ownerId, context.threadId)
    .first<{ domain: string; candidates_json: string; created_at: string }>();
  if (!selection || selection.domain !== target.domain || !fresh(selection.created_at)) throw new Error("Read the matching records again before presenting a choice.");
  const records = JSON.parse(selection.candidates_json) as Array<{ id: string; option: number; displayLabel?: string; snapshot?: Record<string, unknown> }>;
  if (!Array.isArray(records) || !records.length || records.length > 50 || new Set(records.map(record => record.id)).size !== records.length) throw new Error("This selection cannot be presented.");
  const candidates = records.map((record, index): Candidate => {
    if (record.option !== index + 1 || !record.snapshot || record.snapshot.id !== record.id || typeof record.displayLabel !== "string") throw new Error("This historical selection lacks immutable snapshots. Read the records again.");
    const invalid = validateArguments(tool.parameters, { ...input.arguments, [target.idParameter]: record.id });
    if (invalid) throw new Error(invalid);
    return { id: record.id, option: record.option, label: record.displayLabel, fields: displayFields(record.snapshot), snapshot: record.snapshot };
  });
  const argumentsJson = canonicalJson(input.arguments);
  const ownerTimezone = target.ownerTimezoneParameter && input.arguments[target.ownerTimezoneParameter] === undefined ? context.ownerTimezone : null;
  const changes = displayFields(input.arguments, true);
  if (ownerTimezone) changes.push({ label: `${fieldLabel(target.ownerTimezoneParameter!)} (default)`, value: ownerTimezone });
  const envelope: Envelope = { actionLabel: target.actionLabel, idParameter: target.idParameter, ownerTimezone, changes, candidates };
  const candidatesJson = canonicalJson(envelope);
  const id = await toolIdempotencyKey(context.ownerId, context.turnId, "core_targets_present", { selectionId: input.selectionId, toolName: tool.name, arguments: input.arguments });
  const createdAt = new Date().toISOString();
  context.signal.throwIfAborted();
  await context.db.prepare(`INSERT OR IGNORE INTO me3_agent_presentations
    (id,owner_id,thread_id,domain,selection_id,ordinal,tool_name,arguments_json,candidates_json,created_turn_id,created_at,expires_at)
    SELECT ?,?,?,?,?,COALESCE(MAX(ordinal),0)+1,?,?,?,?,?,? FROM me3_agent_presentations
    WHERE owner_id=? AND thread_id=? HAVING EXISTS(SELECT 1 FROM me3_agent_turns WHERE owner_id=? AND thread_id=? AND turn_id=? AND request_id=? AND status NOT IN ('cancelled','failed'))
      AND EXISTS(SELECT 1 FROM assistant_threads WHERE id=? AND owner_id=? AND status='active' AND deleted_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?)`)
    .bind(id, context.ownerId, context.threadId, target.domain, input.selectionId, tool.name, argumentsJson, candidatesJson, context.turnId, createdAt,
      new Date(Date.now() + LIFETIME_MS).toISOString(), context.ownerId, context.threadId, context.ownerId, context.threadId, context.turnId, context.requestId,
      context.threadId, context.ownerId, context.ownerId, context.requestId).run();
  const presentation = await loadTargetPresentation(context.db, { ownerId: context.ownerId, threadId: context.threadId, presentationId: id });
  if (!presentation || presentation.status === "unavailable" || presentation.toolName !== tool.name || presentation.argumentsJson !== argumentsJson || presentation.candidatesJson !== candidatesJson) throw new Error("The presentation is no longer available.");
  return presentation;
}

export async function loadTargetPresentation(db: AgentDb, input: { ownerId: string; threadId: string; presentationId: string }): Promise<AgentTargetPresentation | null> {
  const row = await db.prepare(`SELECT p.*, CASE WHEN p.ordinal=(SELECT MAX(ordinal) FROM me3_agent_presentations WHERE owner_id=p.owner_id AND thread_id=p.thread_id)
      AND p.expires_at>? AND EXISTS(SELECT 1 FROM assistant_threads WHERE id=p.thread_id AND owner_id=p.owner_id AND status='active' AND deleted_at IS NULL)
      AND EXISTS(SELECT 1 FROM me3_agent_turns t WHERE t.turn_id=p.created_turn_id AND t.owner_id=p.owner_id AND t.thread_id=p.thread_id AND t.status NOT IN ('cancelled','failed')
        AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations c WHERE c.owner_id=t.owner_id AND c.request_id=t.request_id))
      AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations c WHERE c.owner_id=p.owner_id AND c.request_id=p.choice_request_id)
      AND NOT EXISTS(SELECT 1 FROM me3_agent_turns t WHERE t.owner_id=p.owner_id AND t.turn_id=p.choice_turn_id AND t.status IN ('cancelled','failed'))
      AND NOT EXISTS(SELECT 1 FROM me3_agent_request_aliases a WHERE a.owner_id=p.owner_id AND a.request_id=p.choice_request_id)
      THEN 1 ELSE 0 END available FROM me3_agent_presentations p WHERE p.id=? AND p.owner_id=? AND p.thread_id=?`)
    .bind(new Date().toISOString(), input.presentationId, input.ownerId, input.threadId).first<Row>();
  if (!row) return null;
  const envelope = JSON.parse(row.candidates_json) as Envelope;
  if (!envelope.idParameter || !Array.isArray(envelope.candidates)) throw new Error("The presentation snapshot is invalid.");
  return { ...envelope, id: row.id, ownerId: row.owner_id, threadId: row.thread_id, domain: row.domain, selectionId: row.selection_id,
    ordinal: row.ordinal, toolName: row.tool_name, arguments: JSON.parse(row.arguments_json), createdTurnId: row.created_turn_id,
    createdAt: row.created_at, expiresAt: row.expires_at, chosenRecordId: row.chosen_record_id, choiceTurnId: row.choice_turn_id,
    choiceRequestId: row.choice_request_id, status: row.available ? row.status : "unavailable", argumentsJson: row.arguments_json, candidatesJson: row.candidates_json };
}

export async function validateTargetSelection(context: AgentToolContext, selection: AgentTargetSelection, tools: readonly AgentTool[]): Promise<{ presentation: AgentTargetPresentation; call: AgentToolCall }> {
  if (!selection || typeof selection.presentationId !== "string" || typeof selection.candidateId !== "string") throw new Error("Invalid target selection.");
  const presentation = await loadTargetPresentation(context.db, { ownerId: context.ownerId, threadId: context.threadId, presentationId: selection.presentationId });
  if (!presentation || presentation.status === "unavailable") throw new Error("The target presentation is expired, superseded, cancelled or unavailable.");
  const tool = eligibleTool(tools, presentation.toolName, context);
  if (tool.target!.domain !== presentation.domain || tool.target!.idParameter !== presentation.idParameter) throw new Error("The presented action is no longer supported.");
  if (!presentation.candidates.some(candidate => candidate.id === selection.candidateId)) throw new Error("The selected candidate does not belong to this presentation.");
  if (presentation.status === "selected" && (presentation.chosenRecordId !== selection.candidateId || presentation.choiceTurnId !== context.turnId || presentation.choiceRequestId !== context.requestId)) throw new Error("This presentation is already bound to another choice.");
  const call = presentationCall(presentation, selection.candidateId);
  const invalid = validateArguments(tool.parameters, call.arguments);
  if (invalid) throw new Error(invalid);
  return { presentation, call };
}

type ChoiceIdentity = { ownerId: string; threadId: string; turnId: string; requestId: string; candidateId: string };
/** Shared conditional predicate for atomic canonical input admission and choice claim. Alias must be p. */
export function targetSelectionEligibility(presentation: AgentTargetPresentation, input: ChoiceIdentity): { sql: string; values: unknown[] } {
  return { sql: `p.id=? AND p.owner_id=? AND p.thread_id=? AND p.tool_name=? AND p.arguments_json=? AND p.candidates_json=?
    AND p.ordinal=(SELECT MAX(ordinal) FROM me3_agent_presentations WHERE owner_id=p.owner_id AND thread_id=p.thread_id)
    AND p.expires_at>? AND EXISTS(SELECT 1 FROM assistant_threads WHERE id=p.thread_id AND owner_id=p.owner_id AND status='active' AND deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM json_each(p.candidates_json,'$.candidates') WHERE json_extract(value,'$.id')=?)
    AND (p.status='pending' OR (p.status='selected' AND p.chosen_record_id=? AND p.choice_turn_id=? AND p.choice_request_id=?))
    AND EXISTS(SELECT 1 FROM me3_agent_turns t WHERE t.owner_id=p.owner_id AND t.thread_id=p.thread_id AND t.turn_id=p.created_turn_id AND t.status NOT IN ('cancelled','failed')
      AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations c WHERE c.owner_id=t.owner_id AND c.request_id=t.request_id))
    AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?)
    AND NOT EXISTS(SELECT 1 FROM me3_agent_turns WHERE owner_id=? AND turn_id=? AND status IN ('cancelled','failed'))
    AND NOT EXISTS(SELECT 1 FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=?)`,
    values: [presentation.id, input.ownerId, input.threadId, presentation.toolName, presentation.argumentsJson, presentation.candidatesJson,
      new Date().toISOString(), input.candidateId, input.candidateId, input.turnId, input.requestId, input.ownerId, input.requestId, input.ownerId, input.turnId, input.ownerId, input.requestId] };
}

export function targetSelectionClaimStatement(db: AgentDb, presentation: AgentTargetPresentation, input: ChoiceIdentity & { inputJson: string }): AgentStatement {
  if (!input.inputJson || !input.turnId || !input.requestId) throw new Error("Canonical choice input is required.");
  const predicate = targetSelectionEligibility(presentation, input);
  return db.prepare(`UPDATE me3_agent_presentations AS p SET status='selected',chosen_record_id=?,choice_turn_id=?,choice_request_id=?
    WHERE ${predicate.sql} AND EXISTS(SELECT 1 FROM me3_agent_turns WHERE owner_id=? AND thread_id=? AND turn_id=? AND request_id=? AND input_json=?)`)
    .bind(input.candidateId, input.turnId, input.requestId, ...predicate.values, input.ownerId, input.threadId, input.turnId, input.requestId, input.inputJson);
}

/** Mutation authority comes from the persisted authenticated choice, never from model arguments or a reread. */
export async function selectedTargetSnapshot<T>(context: AgentToolContext, domain: string, id: string): Promise<T> {
  const selection = context.targetSelection!;
  const p = await loadTargetPresentation(context.db, { ownerId: context.ownerId, threadId: context.threadId, presentationId: selection.presentationId });
  if (!p || p.status !== "selected" || p.domain !== domain || p.chosenRecordId !== id || selection.candidateId !== id
    || p.choiceTurnId !== context.turnId || p.choiceRequestId !== context.requestId || (p.ownerTimezone !== null && p.ownerTimezone !== context.ownerTimezone)) throw new Error("The target lacks a matching authenticated choice.");
  if (!context.toolCall || canonicalJson({ name: context.toolCall.name, arguments: context.toolCall.arguments }) !== canonicalJson({ name: p.toolName, arguments: presentationCall(p, id).arguments })) throw new Error("The action or changes do not match the reviewed choice.");
  const candidate = p.candidates.find(candidate => candidate.id === id);
  if (!candidate || candidate.snapshot.id !== id) throw new Error("The immutable selected snapshot is missing.");
  return candidate.snapshot as T;
}

function presentationCall(presentation: AgentTargetPresentation, candidateId: string): AgentToolCall {
  return { id: `target-choice:${presentation.id}`, name: presentation.toolName, arguments: { ...presentation.arguments, [presentation.idParameter]: candidateId } };
}
function eligibleTool(tools: readonly AgentTool[], name: string, context: AgentToolContext): AgentTool {
  const tool = tools.find(tool => tool.name === name);
  if (!tool?.target || tool.effect === "read" || tool.name === "core_targets_present" || (tool.pluginId && !context.enabledPluginIds.has(tool.pluginId))) throw new Error("This action cannot use a target presentation.");
  return tool;
}
function fresh(timestamp: string): boolean { const age = Date.now() - Date.parse(timestamp); return Number.isFinite(age) && age >= -60_000 && age < LIFETIME_MS; }
function displayFields(record: Record<string, unknown>, changes = false): Field[] {
  return Object.entries(record).filter(([key, value]) => !["createdAt", "updatedAt", ...(changes ? [] : ["title", "name", "subject"])].includes(key)
      && !technicalKey(key) && value !== null && value !== undefined)
    .map(([key, value]) => ({ label: fieldLabel(key), value: typeof value === "string" ? value : canonicalJson(sanitizeDisplay(value)) }));
}
function fieldLabel(key: string): string { return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, char => char.toUpperCase()); }
function technicalKey(key: string): boolean {
  return ["revision", "messageIdHeader", "inReplyTo", "referencesHeader", "threadKey", "storageKey"].includes(key)
    || key === "id" || key.endsWith("Id") || /_id$/i.test(key);
}
function hasTechnicalIdentity(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTechnicalIdentity);
  return Boolean(value && typeof value === "object" && Object.entries(value).some(([key, child]) => technicalKey(key) || hasTechnicalIdentity(child)));
}
function sanitizeDisplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDisplay);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !technicalKey(key)).map(([key, child]) => [key, sanitizeDisplay(child)]));
  return value;
}
