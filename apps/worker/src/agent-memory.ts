import type { AgentDb, AgentModel, AgentTool } from "../../../packages/agent/src/types";

// Automatic memory: after each finished turn a fast model reads the owner's own words
// and decides whether anything is worth keeping. It only ever sees what the owner typed
// and the reply, never emails, pages or tool output, so outside text cannot plant memories.
// It may change only memories it wrote itself; owner-written ones are never overwritten.
const MAX_OPS_PER_TURN = 3;
const MAX_BODY_CHARS = 240;
const MAX_EXISTING_FOR_MODEL = 150;
const MAX_RETIRED_FOR_MODEL = 100;
const KINDS = ["owner_note", "project_context", "preference", "relationship_note", "correction", "learning"] as const;
type MemoryKind = (typeof KINDS)[number];

type MemoryOp =
  | { op: "add"; kind: MemoryKind; body: string; importance: number; sensitive: boolean; expiresAt: string | null }
  | { op: "update"; id: string; body: string; importance: number | null; expiresAt: string | null }
  | { op: "archive"; id: string };

type ExistingMemory = { id: string; memory_kind: string; body: string; source_kind: string; review_status: string; importance: number; expires_at: string | null };

const memoryTool: AgentTool = {
  name: "core_memory_ops",
  description: "Record what is worth remembering about the owner from this turn. Return an empty list when nothing is.",
  parameters: {
    type: "object",
    properties: {
      ops: {
        type: "array",
        maxItems: MAX_OPS_PER_TURN,
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["add", "update", "archive"] },
            id: { type: "string", description: "Existing memory id, for update and archive." },
            kind: { type: "string", enum: [...KINDS] },
            body: { type: "string", description: "One self-contained sentence about the owner, at most 240 characters." },
            importance: { type: "integer", minimum: 1, maximum: 5 },
            sensitive: { type: "boolean" },
            expiresAt: { type: "string", description: "ISO date-time after which the fact no longer holds, for time-bound facts." },
          },
          required: ["op"],
          additionalProperties: false,
        },
      },
    },
    required: ["ops"],
    additionalProperties: false,
  },
  effect: "read",
  approval: "none",
  async execute() { throw Error("Memory ops never execute as a tool."); },
};

const SYSTEM_PROMPT = [
  "You maintain the long-term memory of a personal assistant for its owner.",
  "Read the owner's latest message (the assistant's reply is context only) and decide whether it reveals something durable worth remembering in future conversations:",
  "stable preferences about how the owner wants things done, people in their life and how they relate, ongoing commitments and projects, important dates, corrections to what the assistant assumed.",
  "Do not save: small talk, one-off requests, things only true for this conversation, anything the assistant said rather than the owner, anything already in the owner snapshot (mission, goals, Wheel of Life, profile, projects), or secrets such as passwords, codes and card or account numbers.",
  "Prefer changing an existing memory over adding a near-duplicate: use update when a memory is outdated or can be made more precise, and archive when it no longer holds. Only memories with source \"agent\" can be updated or archived.",
  "Write each memory as one plain sentence starting with \"Owner\", for example \"Owner's daughter Mia started school in October 2026.\" Include absolute dates, not relative ones.",
  "importance: 5 = core identity or close people, 4 = strong preference or major commitment, 3 = useful context, 1-2 = minor detail.",
  "Set sensitive to true for health, finances, legal matters, relationship conflict or anything the owner may not want kept without being asked.",
  "Set expiresAt only for facts that will stop being true, such as travel or a temporary situation. Never let a lasting fact expire because it arrived with a dated event: from \"my daughter Mia starts school on Monday\" keep \"Owner's daughter is Mia; she started school in October 2026.\" with no expiresAt.",
  "doNotRepeat lists what the owner declined or asked you to forget: never add a memory about the same subject again, however it is worded, unless the owner explicitly asks you to remember it.",
  "Most turns contain nothing worth keeping; return an empty list then. Call core_memory_ops exactly once with no prose.",
].join(" ");

/** Sensitive memories saved this turn, waiting for the owner's yes; most important first. */
export type RememberOutcome = { held: Array<{ id: string; body: string; importance: number }> };

export async function rememberFromTurn(
  db: AgentDb,
  model: AgentModel,
  input: { ownerId: string; turnId: string; ownerMessage: string; replyText: string; ownerSnapshot?: string; now?: Date },
  signal: AbortSignal,
): Promise<RememberOutcome> {
  const held: RememberOutcome["held"] = [];
  const ownerMessage = input.ownerMessage.trim();
  if (!ownerMessage) return { held };
  const now = input.now || new Date();
  const existing = (await db.prepare(
    `SELECT id, memory_kind, body, source_kind, review_status, importance, expires_at
     FROM mission_private_memory
     WHERE user_id = ? AND review_status IN ('active', 'needs_review')
     ORDER BY importance DESC, updated_at DESC
     LIMIT ?`,
  ).bind(input.ownerId, MAX_EXISTING_FOR_MODEL).all<ExistingMemory>()).results || [];
  const retired = (await db.prepare(
    `SELECT body FROM mission_private_memory
     WHERE user_id = ? AND review_status = 'archived' AND forgotten_at IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).bind(input.ownerId, MAX_RETIRED_FOR_MODEL).all<{ body: string }>()).results || [];

  const response = await model.step({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({
        now: now.toISOString(),
        ownerMessage: ownerMessage.slice(0, 4_000),
        assistantReply: input.replyText.slice(0, 2_000),
        existingMemories: existing.map(row => ({ id: row.id, kind: row.memory_kind, body: row.body, source: row.source_kind, importance: row.importance, expiresAt: row.expires_at })),
        doNotRepeat: retired.map(row => row.body),
        ...(input.ownerSnapshot ? { ownerSnapshot: input.ownerSnapshot.slice(0, 6_000) } : {}),
      }) },
    ],
    tools: [memoryTool],
    toolChoice: memoryTool.name,
    signal,
    onDelta: async () => {},
  });
  const call = response.toolCalls.find(item => item.name === memoryTool.name);
  const ops = readMemoryOps(call?.arguments.ops, now);
  if (!ops.length) return { held };

  const ownedByAgent = new Map(existing.filter(row => row.source_kind === "agent").map(row => [row.id, row]));
  const known = new Set([...existing, ...retired].map(row => normalizeBody(row.body)));
  const stamp = now.toISOString();
  let applied = 0;
  for (const op of ops) {
    if (applied === MAX_OPS_PER_TURN) break;
    applied++;
    if (op.op === "add") {
      const key = normalizeBody(op.body);
      if (known.has(key)) { applied--; continue; }
      known.add(key);
      const id = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO mission_private_memory
           (id, user_id, memory_kind, body, confidence, source_kind, source_ref, review_status, importance, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'agent', ?, ?, ?, ?, ?, ?)`,
      ).bind(id, input.ownerId, op.kind, op.body, input.turnId, op.sensitive ? "needs_review" : "active", op.importance, op.expiresAt, stamp, stamp).run();
      if (op.sensitive) held.push({ id, body: op.body, importance: op.importance });
    } else if (op.op === "update") {
      const current = ownedByAgent.get(op.id);
      if (!current) { applied--; continue; }
      await db.prepare(
        `UPDATE mission_private_memory
         SET body = ?, importance = ?, expires_at = ?, source_ref = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND source_kind = 'agent'`,
      ).bind(op.body, op.importance ?? current.importance, op.expiresAt ?? current.expires_at, input.turnId, stamp, op.id, input.ownerId).run();
    } else {
      if (!ownedByAgent.has(op.id)) { applied--; continue; }
      await db.prepare(
        `UPDATE mission_private_memory SET review_status = 'archived', updated_at = ?
         WHERE id = ? AND user_id = ? AND source_kind = 'agent'`,
      ).bind(stamp, op.id, input.ownerId).run();
    }
  }
  return { held: held.sort((a, b) => b.importance - a.importance) };
}

function readMemoryOps(value: unknown, now: Date): MemoryOp[] {
  if (!Array.isArray(value)) return [];
  const ops: MemoryOp[] = [];
  for (const item of value.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (raw.op === "archive") {
      if (id) ops.push({ op: "archive", id });
      continue;
    }
    const body = readBody(raw.body);
    if (!body) continue;
    const expiresAt = readExpiry(raw.expiresAt, now);
    if (raw.op === "update") {
      if (id) ops.push({ op: "update", id, body, importance: raw.importance === undefined ? null : readImportance(raw.importance), expiresAt });
    } else if (raw.op === "add" && KINDS.includes(raw.kind as MemoryKind)) {
      ops.push({ op: "add", kind: raw.kind as MemoryKind, body, importance: readImportance(raw.importance), sensitive: raw.sensitive === true, expiresAt });
    }
  }
  return ops;
}

function readBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\s+/g, " ").trim();
  // Long digit runs are codes, card or account numbers: never kept.
  const digits = body.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "").replace(/[\s-]/g, "");
  if (!body || body.length > MAX_BODY_CHARS || /\d{6,}/.test(digits)) return null;
  return body;
}

function readImportance(value: unknown): number {
  const number = typeof value === "number" ? Math.round(value) : 3;
  return Math.min(Math.max(Number.isFinite(number) ? number : 3, 1), 5);
}

function readExpiry(value: unknown, now: Date): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > now.getTime() ? new Date(time).toISOString() : null;
}

function normalizeBody(body: string): string {
  return body.toLowerCase().replace(/\s+/g, " ").replace(/[.!\s]+$/, "").trim();
}

// Memories are written for the agent as "Owner's daughter is Mia." The owner reads them as
// "Your daughter is Mia." Anything this can't rewrite with confidence keeps its original words.
const OWNER_VERBS: Record<string, string> = { is: "are", was: "were", has: "have", does: "do", goes: "go", "isn't": "aren't", "wasn't": "weren't", "hasn't": "haven't", "doesn't": "don't" };
const OWNER_ADVERBS = "(?:(?:always|usually|often|never|rarely|seldom|sometimes|generally|typically|normally|regularly|frequently|also|still|currently|now|only|mostly|really|no longer)\\s+)*";
const OWNER_SUBJECT = new RegExp(`^(\\s+${OWNER_ADVERBS})([a-z]+(?:['’][a-z]+)?)\\b`);

export function ownerFacingMemory(body: string): string {
  if (!/\b(?:Owner|The owner)\b/.test(body)) return body;
  const parts = body.split(/([.;:!?]\s+)/);
  for (let index = 0; index < parts.length; index += 2) {
    const clause = rewriteOwnerClause(parts[index], index === 0 || /[.!?]/.test(parts[index - 1]));
    if (clause === null) return body;
    parts[index] = clause;
  }
  return parts.join("");
}

function rewriteOwnerClause(clause: string, capital: boolean): string | null {
  const lead = /^(?:Owner|The owner)(['’]s\b)?/.exec(clause);
  let rest = clause;
  let subject = false;
  if (lead) {
    rest = clause.slice(lead[0].length);
    if (lead[1]) rest = (capital ? "Your" : "your") + rest;
    else {
      const verb = OWNER_SUBJECT.exec(rest);
      const conjugated = verb && ownerVerb(verb[2]);
      if (!verb || !conjugated) return null;
      rest = (capital ? "You" : "you") + verb[1] + conjugated + rest.slice(verb[0].length);
      subject = true;
    }
  }
  rest = rest.replace(/\bOwner['’]s\b/g, "your");
  if (/\b(?:Owner|The owner)\b/.test(rest)) return null;
  return subject ? rest.replace(/\bthemsel(?:ves|f)\b/g, "yourself") : rest;
}

function ownerVerb(word: string): string | null {
  const apostrophe = word.includes("’") ? "’" : "'";
  const irregular = OWNER_VERBS[word.replace("’", "'")];
  if (irregular) return irregular.replace("'", apostrophe);
  if (!word.endsWith("s")) return word;
  if (/(?:ss|us|is)$/.test(word)) return null;
  if (/(?:ss|sh|ch|x|z|o)es$/.test(word)) return word.slice(0, -2);
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  return word.slice(0, -1);
}
