import type { AgentToolContext, AgentToolResult } from "../types";

const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;
type Target = { id: string };

export async function rememberTargets(context: AgentToolContext, domain: string, records: readonly Target[]) {
  const readAt = new Date().toISOString();
  for (const record of records) {
    await context.db.prepare(`INSERT INTO me3_agent_targets
      (owner_id, thread_id, domain, record_id, snapshot_json, read_turn_id, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, thread_id, domain, record_id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json, read_turn_id = excluded.read_turn_id, read_at = excluded.read_at`)
      .bind(context.ownerId, context.threadId, domain, record.id, JSON.stringify(record), context.turnId, readAt).run();
  }
  const selectionId = crypto.randomUUID();
  if (records.length > 1) {
    await context.db.prepare(`INSERT INTO me3_agent_selections
      (id, owner_id, thread_id, domain, candidates_json, read_turn_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(selectionId, context.ownerId, context.threadId, domain, JSON.stringify(records.map((record, index) => ({ option: index + 1, id: record.id }))), context.turnId, readAt).run();
  }
  return { selectionId, candidates: records.map((record, index) => ({ option: index + 1, ...record })) };
}

export async function requireTarget<T>(context: AgentToolContext, domain: string, id: string): Promise<T> {
  const approvedTarget = context.approved ? context.approvalData?.target : undefined;
  if (context.approved) {
    if (!approvedTarget || typeof approvedTarget !== "object" || context.approvalData?.targetDomain !== domain) throw new Error("Approval does not contain the reviewed snapshot for this target domain.");
    if ((approvedTarget as { id?: string }).id !== id) throw new Error("Approval does not match this stable target ID.");
    return approvedTarget as T;
  }
  const row = await context.db.prepare(`SELECT snapshot_json, read_at FROM me3_agent_targets
    WHERE owner_id = ? AND thread_id = ? AND domain = ? AND record_id = ?`)
    .bind(context.ownerId, context.threadId, domain, id).first<{ snapshot_json: string; read_at: string }>();
  if (!row || Date.now() - Date.parse(row.read_at) > MAX_RECEIPT_AGE_MS) {
    throw new Error(`Read this ${domain} record before changing it; use its returned stable ID.`);
  }
  // An exact numbered reply is a generic target binding, independent of domain phrasing.
  const selectedOption = ownerSelectionOption(context.messageText);
  if (selectedOption) {
    const selection = await context.db.prepare(`SELECT candidates_json, created_at, read_turn_id FROM me3_agent_selections
      WHERE owner_id = ? AND thread_id = ? AND domain = ? AND read_turn_id != ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .bind(context.ownerId, context.threadId, domain, context.turnId).first<{ candidates_json: string; created_at: string; read_turn_id: string }>();
    if (selection) {
      const groups = await context.db.prepare(`SELECT candidates_json FROM me3_agent_selections
        WHERE owner_id = ? AND thread_id = ? AND domain = ? AND read_turn_id = ?`)
        .bind(context.ownerId, context.threadId, domain, selection.read_turn_id).all<{ candidates_json: string }>();
      if (new Set(groups.results?.map(group => group.candidates_json)).size > 1) throw new Error("Multiple candidate sets were returned. Ask the owner to identify the exact record before changing it.");
    }
    const candidates = selection ? JSON.parse(selection.candidates_json) as Array<{ option: number; id: string }> : [];
    if (!selection || Date.now() - Date.parse(selection.created_at) > MAX_RECEIPT_AGE_MS || candidates.find(candidate => candidate.option === Number(selectedOption))?.id !== id) {
      throw new Error("The requested stable ID does not match the owner's recorded selection. Show the candidates again.");
    }
  }
  return JSON.parse(row.snapshot_json) as T;
}

export function assertUnchanged(expected: unknown, current: unknown, label: string) {
  if (stableSnapshot(expected) !== stableSnapshot(current)) throw new Error(`${label} changed since it was read. Read it again before changing it.`);
}

export function approval(context: AgentToolContext, title: string, summary: string, details: Record<string, unknown> = {}): AgentToolResult | null {
  return context.approved ? null : { status: "needs_approval", approval: { title, summary, ...details } };
}

function stableSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
    : entry);
}

function ownerSelectionOption(message: string): number | null {
  const normalized = message.trim().toLocaleLowerCase().replace(/[.!]$/, "").trim();
  const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const match = /^(?:the )?(?:(?:option|choice) )?(\d{1,3}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?: (?:one|option|choice))?(?:,? please)?$/.exec(normalized);
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : ordinals.indexOf(match[1]) + 1;
}
