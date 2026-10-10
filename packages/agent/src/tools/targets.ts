import type { AgentToolContext, AgentToolResult } from "../types";

const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;
type Target = { id: string };
type Candidate = { option: number; id: string; label?: string };

export async function rememberTargets<T extends Target>(context: AgentToolContext, domain: string, records: readonly T[], label?: (record: T) => string | null | undefined) {
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
  // Empty and single-record reads must also invalidate older numbered choices.
  await context.db.prepare(`INSERT INTO me3_agent_selections
    (id, owner_id, thread_id, domain, candidates_json, read_turn_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(selectionId, context.ownerId, context.threadId, domain, JSON.stringify(records.map((record, index) => ({ option: index + 1, id: record.id, label: (label?.(record) || record.id).normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ") }))), context.turnId, readAt).run();
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
  if (selectedOption !== null) {
    let selection = await context.db.prepare(`SELECT domain, candidates_json, created_at, read_turn_id FROM me3_agent_selections
      WHERE owner_id = ? AND thread_id = ? AND read_turn_id != ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .bind(context.ownerId, context.threadId, context.turnId).first<{ domain: string; candidates_json: string; created_at: string; read_turn_id: string }>();
    if (selection) {
      const groups = await context.db.prepare(`SELECT domain, candidates_json, read_turn_id, created_at FROM me3_agent_selections
        WHERE owner_id = ? AND thread_id = ? AND (read_turn_id = ? OR created_at = ?) AND read_turn_id != ?`)
        .bind(context.ownerId, context.threadId, selection.read_turn_id, selection.created_at, context.turnId).all<{ domain: string; candidates_json: string; read_turn_id: string; created_at: string }>();
      // SQLite row order is not portable, so equal timestamps cannot order different turns.
      if (new Set(groups.results?.map(group => group.read_turn_id)).size > 1) throw new Error("The recorded selection is ambiguous across turns. Show the candidates again.");
      const nonempty = (groups.results || []).filter(group => (JSON.parse(group.candidates_json) as Candidate[]).length > 0);
      const choices = new Set(nonempty.map(group => JSON.stringify([group.domain, (JSON.parse(group.candidates_json) as Candidate[]).map(({ option, id }) => ({ option, id }))])));
      if (choices.size > 1) throw new Error("Multiple candidate sets were returned. Ask the owner to identify the exact record before changing it.");
      // An empty read in this same turn supplies no option; an entirely empty newer turn still invalidates older choices.
      if (nonempty.length) selection = nonempty[0];
    }
    const candidates = selection ? JSON.parse(selection.candidates_json) as Candidate[] : [];
    if (!selection || selection.domain !== domain || Date.now() - Date.parse(selection.created_at) > MAX_RECEIPT_AGE_MS || candidates.find(candidate => candidate.option === selectedOption)?.id !== id) {
      throw new Error("The requested stable ID does not match the owner's recorded selection. Show the candidates again.");
    }
  } else {
    const groups = await context.db.prepare(`SELECT candidates_json FROM me3_agent_selections
      WHERE owner_id = ? AND thread_id = ? AND domain = ? AND created_at >= ?`)
      .bind(context.ownerId, context.threadId, domain, new Date(Date.now() - MAX_RECEIPT_AGE_MS).toISOString()).all<{ candidates_json: string }>();
    const ambiguousIds = new Set<string>();
    for (const group of groups.results || []) {
      const candidates = JSON.parse(group.candidates_json) as Candidate[];
      const target = candidates.find(candidate => candidate.id === id);
      if (!target) continue;
      // Immutable menu evidence survives narrower model reads. Older receipts lack labels, so fail closed.
      const peers = candidates.filter(candidate => target.label === undefined || candidate.label === undefined || candidate.label === target.label);
      if (new Set(peers.map(candidate => candidate.id)).size > 1) peers.forEach(candidate => ambiguousIds.add(candidate.id));
    }
    const ownerIds = [...ambiguousIds].filter(candidateId => ownerSuppliedId(context.messageText, candidateId));
    if (ambiguousIds.size > 1 && (ownerIds.length !== 1 || ownerIds[0] !== id)) {
      throw new Error(`Multiple ${domain} records have the same label or an ambiguous earlier read. Show the candidates and ask the owner to choose one numbered option or exact stable ID before changing it.`);
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

function ownerSuppliedId(message: string, id: string): boolean {
  return message.split(/\s+/u).some(token => token.replace(/^["'`([{]+|["'`)\]},.!?;]+$/gu, "") === id);
}
