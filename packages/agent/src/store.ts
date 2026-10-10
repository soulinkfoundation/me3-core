import type { AgentCheckpoint, AgentDb, AgentToolCall, AgentToolResult, AgentTurnStore } from "./types";

export const AGENT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS me3_agent_request_aliases (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    input_json TEXT NOT NULL, PRIMARY KEY(owner_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS me3_agent_cancellations (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(owner_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS me3_agent_turns (
    turn_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    request_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    input_json TEXT, checkpoint_json TEXT, response_json TEXT, trace_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS me3_agent_stream_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    event TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS me3_agent_stream_turn ON me3_agent_stream_events(owner_id, turn_id, seq)`,
  `CREATE TABLE IF NOT EXISTS me3_agent_tool_receipts (
    owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, turn_id TEXT NOT NULL,
    tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, status TEXT NOT NULL,
    result_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(owner_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS me3_agent_approvals (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL,
    card_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at TEXT,
    UNIQUE(owner_id, turn_id, idempotency_key)
  )`,
] as const;

export type D1TurnIdentity = { ownerId:string;threadId:string;turnId:string;requestId:string };
export class AgentInputConflictError extends Error {}

export function createD1TurnStore(db:AgentDb,identity:D1TurnIdentity):AgentTurnStore {
  const {ownerId,threadId,turnId,requestId}=identity;
  return {
    cancellationRequested:()=>isAgentCancellationRequested(db,ownerId,requestId),
    async load() {
      const row=await db.prepare("SELECT checkpoint_json FROM me3_agent_turns WHERE owner_id = ? AND turn_id = ? AND request_id = ?").bind(ownerId,turnId,requestId).first<{checkpoint_json:string|null}>();
      return row?.checkpoint_json?JSON.parse(row.checkpoint_json) as AgentCheckpoint:null;
    },
    async save(checkpoint) {
      await db.prepare(`INSERT INTO me3_agent_turns(turn_id,owner_id,thread_id,request_id,status,checkpoint_json,trace_json)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,request_id) DO UPDATE SET
        status=excluded.status,checkpoint_json=excluded.checkpoint_json,trace_json=excluded.trace_json,updated_at=CURRENT_TIMESTAMP
        WHERE me3_agent_turns.turn_id=excluded.turn_id AND me3_agent_turns.thread_id=excluded.thread_id`)
        .bind(turnId,ownerId,threadId,requestId,checkpoint.status,JSON.stringify(checkpoint),JSON.stringify(checkpoint.trace)).run();
    },
    async getReceipt(key) {
      const row=await db.prepare("SELECT result_json FROM me3_agent_tool_receipts WHERE owner_id=? AND idempotency_key=? AND status IN ('finished','waiting')").bind(ownerId,key).first<{result_json:string|null}>();
      return row?.result_json?JSON.parse(row.result_json) as AgentToolResult:null;
    },
    async claimReceipt(key,call) {
      const inserted=await db.prepare(`INSERT OR IGNORE INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status)
        VALUES(?,?,?,?,?,'running')`).bind(ownerId,key,turnId,call.name,JSON.stringify(call.arguments)).run();
      if(inserted.meta?.changes)return true;
      const resumed=await db.prepare("UPDATE me3_agent_tool_receipts SET status='running',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND idempotency_key=? AND turn_id=? AND status='waiting'").bind(ownerId,key,turnId).run();
      return Boolean(resumed.meta?.changes);
    },
    async finishReceipt(key,value) {
      await db.prepare("UPDATE me3_agent_tool_receipts SET status=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND idempotency_key=? AND turn_id=?")
        .bind(value.status==="needs_approval"?"waiting":"finished",JSON.stringify(value),ownerId,key,turnId).run();
    },
    async requestApproval(key,call,card) {
      await db.prepare(`INSERT OR IGNORE INTO me3_agent_approvals(id,owner_id,thread_id,turn_id,idempotency_key,tool_name,arguments_json,card_json)
        SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?)`).bind(crypto.randomUUID(),ownerId,threadId,turnId,key,call.name,JSON.stringify(call.arguments),JSON.stringify(card),ownerId,requestId).run();
      const row=await db.prepare("SELECT id FROM me3_agent_approvals WHERE owner_id=? AND turn_id=? AND idempotency_key=? AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?)").bind(ownerId,turnId,key,ownerId,requestId).first<{id:string}>();
      if(!row)throw new Error("Approval could not be persisted");return row.id;
    },
    async approvalDecision(id) {
      const row=await db.prepare("SELECT status FROM me3_agent_approvals WHERE id=? AND owner_id=? AND turn_id=?").bind(id,ownerId,turnId).first<{status:"pending"|"approved"|"declined"}>();
      if(!row)throw new Error("Approval is unavailable for this turn");return row.status;
    },
    async approvalData(id) {
      const row=await db.prepare("SELECT card_json FROM me3_agent_approvals WHERE id=? AND owner_id=? AND turn_id=? AND status='approved'").bind(id,ownerId,turnId).first<{card_json:string}>();
      return row?JSON.parse(row.card_json):undefined;
    },
  };
}

export async function requestAgentCancellation(db:AgentDb,ownerId:string,requestId:string):Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO me3_agent_cancellations(owner_id,request_id) VALUES(?,?)").bind(ownerId,requestId).run();
}
export async function isAgentCancellationRequested(db:AgentDb,ownerId:string,requestId:string):Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?").bind(ownerId,requestId).first());
}

export async function decideAgentApproval(db:AgentDb,ownerId:string,id:string,decision:"approved"|"declined"):Promise<boolean> {
  const result=await db.prepare("UPDATE me3_agent_approvals SET status=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=? AND status='pending'").bind(decision,id,ownerId).run();
  if(result.meta?.changes)return true;
  const row=await db.prepare("SELECT status FROM me3_agent_approvals WHERE id=? AND owner_id=?").bind(id,ownerId).first<{status:string}>();
  return row?.status===decision;
}

export async function persistAgentInput(db:AgentDb,identity:D1TurnIdentity,input:unknown):Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO me3_agent_turns(turn_id,owner_id,thread_id,request_id,input_json) VALUES(?,?,?,?,?)`)
    .bind(identity.turnId,identity.ownerId,identity.threadId,identity.requestId,JSON.stringify(input)).run();
  const row=await db.prepare("SELECT turn_id,thread_id,input_json FROM me3_agent_turns WHERE owner_id=? AND request_id=?").bind(identity.ownerId,identity.requestId).first<{turn_id:string;thread_id:string;input_json:string|null}>();
  if(row?.turn_id!==identity.turnId || row.thread_id!==identity.threadId || row.input_json===null || canonicalJson(JSON.parse(row.input_json))!==canonicalJson(input))throw new AgentInputConflictError("Request input conflicts with a saved turn");
}

export async function persistAgentRequestAlias(db:AgentDb,ownerId:string,requestId:string,turnId:string,input:unknown):Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO me3_agent_request_aliases(owner_id,request_id,turn_id,input_json) VALUES(?,?,?,?)").bind(ownerId,requestId,turnId,JSON.stringify(input)).run();
  await validateAgentRequestAlias(db,ownerId,requestId,turnId,input);
}

export async function persistAgentApprovalReply(db:AgentDb,ownerId:string,requestId:string,turnId:string,input:unknown,approvalId:string,decision:"approved"|"declined"):Promise<boolean> {
  if(!db.batch)throw new Error("Approval replies require atomic D1 batches");
  const serialized=JSON.stringify(input);
  // D1 batches are transactional: a crash cannot leave an alias whose decision
  // was never recorded. Retries never apply an old reply to a later approval.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO me3_agent_request_aliases(owner_id,request_id,turn_id,input_json)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM me3_agent_approvals WHERE owner_id=? AND turn_id=? AND id=? AND status IN ('pending',?))`)
      .bind(ownerId,requestId,turnId,serialized,ownerId,turnId,approvalId,decision),
    db.prepare(`UPDATE me3_agent_approvals SET status=?,decided_at=CURRENT_TIMESTAMP
      WHERE owner_id=? AND turn_id=? AND id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=? AND turn_id=? AND input_json=?)
      AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND
        (request_id=? OR request_id=(SELECT request_id FROM me3_agent_turns WHERE owner_id=? AND turn_id=?)))`)
      .bind(decision,ownerId,turnId,approvalId,ownerId,requestId,turnId,serialized,ownerId,requestId,ownerId,turnId),
  ]);
  await validateAgentRequestAlias(db,ownerId,requestId,turnId,input);
  const row=await db.prepare("SELECT status FROM me3_agent_approvals WHERE owner_id=? AND turn_id=? AND id=?").bind(ownerId,turnId,approvalId).first<{status:string}>();
  return row?.status===decision;
}

async function validateAgentRequestAlias(db:AgentDb,ownerId:string,requestId:string,turnId:string,input:unknown):Promise<void> {
  const row=await db.prepare("SELECT turn_id,input_json FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=?").bind(ownerId,requestId).first<{turn_id:string;input_json:string}>();
  if(!row||row.turn_id!==turnId||canonicalJson(JSON.parse(row.input_json))!==canonicalJson(input))throw new AgentInputConflictError("Approval reply conflicts with its saved input");
}

function canonicalJson(value:unknown):string {return JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}

export async function appendAgentStreamEvent(db:AgentDb,ownerId:string,turnId:string,event:string,data:Record<string,unknown>):Promise<number> {
  // RETURNING obtains this event's sequence without racing another turn.
  const row=await db.prepare("INSERT INTO me3_agent_stream_events(owner_id,turn_id,event,data_json) VALUES(?,?,?,?) RETURNING seq").bind(ownerId,turnId,event,JSON.stringify(data)).first<{seq:number}>();
  if(!row)throw new Error("Stream event could not be persisted");return row.seq;
}
