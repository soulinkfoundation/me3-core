import { decideAgentApproval } from "../../../../packages/agent/src/store";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import type { Env } from "../types";
import { updateAgentChatPresence } from "../agent-notifications";
import { PAYMENT_PROPOSE_TOOL, PaymentError, paymentApprovalAuth, recordPaymentDecision } from "../agent-payments";

/** How the owner proved they are present: a web session's sign-in time, or a native device unlock. */
export type ApprovalAuthEvidence={sessionIssuedAt:number|null;deviceAuthentication?:unknown};

type ApprovalRow={id:string;thread_id:string;turn_id:string;tool_name:string;card_json:string;status:string;created_at:string;decided_at:string|null};
const approvalSelect="SELECT id,thread_id,turn_id,tool_name,card_json,status,created_at,decided_at FROM me3_agent_approvals";

function approvalCard(row:ApprovalRow) {
  const card=JSON.parse(row.card_json) as Record<string,unknown>;
  return {...card,id:row.id,pluginId:"me3.core",actionId:row.tool_name,title:card.title||row.tool_name,summary:card.summary||"Review this action",riskLevel:"high",status:row.status==="declined"?"rejected":row.status,requestedAt:row.created_at,resolvedAt:row.decided_at,threadId:row.thread_id,turnId:row.turn_id,payload:card};
}
export async function listNewAgentApprovals(env:Env,ownerId:string,status?:string) {
  const requested=status==="rejected"?"declined":status;
  if(requested&&!['pending','approved','declined'].includes(requested))return [];
  const rows=await env.DB.prepare(`${approvalSelect} WHERE owner_id=?${requested?" AND status=?":""} ORDER BY created_at DESC,id DESC LIMIT 100`)
    .bind(...(requested?[ownerId,requested]:[ownerId])).all<ApprovalRow>();
  return (rows.results||[]).map(approvalCard);
}
export async function decideNewAgentApproval(c:AppContext,ownerId:string,id:string,decision:"approved"|"declined",evidence?:ApprovalAuthEvidence):Promise<Response> {
  const row=await c.env.DB.prepare(`${approvalSelect} WHERE id=? AND owner_id=?`).bind(id,ownerId).first<ApprovalRow>();
  if(!row)return c.json({ok:false,error:"Approval not found"},404);
  if(row.tool_name===PAYMENT_PROPOSE_TOOL) {
    // Payments need a fresh sign-in, bound to the proposal before the agent can resume.
    try {
      const auth=decision==="approved"?paymentApprovalAuth({channel:evidence?.sessionIssuedAt!=null?"web":"mobile",sessionIssuedAt:evidence?.sessionIssuedAt,deviceAuthentication:evidence?.deviceAuthentication}):undefined;
      await recordPaymentDecision(c.env,ownerId,row,decision,auth);
    } catch(error) {
      if(!(error instanceof PaymentError))throw error;
      return c.json({ok:false,error:error.message,code:error.status===403?"fresh_authentication_required":"payment_conflict"},error.status as 403|409);
    }
  }
  const namespace=c.env.ME3_AGENT;
  if(!namespace)return c.json({ok:false,error:"Agent runtime is unavailable"},503);
  if(!await decideAgentApproval(c.env.DB,ownerId,id,decision))return c.json({ok:false,error:"Approval already has a different decision"},409);
  // Persist the decision first. A retried request resumes the identical saved turn.
  const response=await namespace.get(namespace.idFromName(ownerId)).fetch("https://me3-agent/turn/resume",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ownerId,turnId:row.turn_id})});
  const turn=await response.json().catch(()=>({ok:false,error:"Agent resume response unavailable"})) as Record<string,unknown>;
  return c.json({...turn,approval:approvalCard({...row,status:decision,decided_at:new Date().toISOString()})},response.ok?200:502);
}
export function registerNewAgentRoutes(app:AppHono,deps:OwnerRouteDeps) {
  const evidence=async(c:AppContext,body:{deviceAuthentication?:unknown}|null):Promise<ApprovalAuthEvidence>=>({sessionIssuedAt:await deps.ownerSessionIssuedAt?.(c)??null,deviceAuthentication:body?.deviceAuthentication});
  app.put("/api/assistant/threads/:threadId/presence", async c => {
    const ownerId = await deps.requireOwner(c); if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json().catch(() => null) as { clientId?: unknown; watching?: unknown } | null;
    const threadId = c.req.param("threadId");
    if (!threadId || threadId.length > 500 || typeof body?.clientId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(body.clientId) || typeof body.watching !== "boolean") return c.json({ error: "Invalid Chat presence" }, 400);
    if (!await updateAgentChatPresence(c.env, ownerId, threadId, body.clientId, body.watching)) return c.json({ error: "Conversation not found" }, 404);
    return c.json({ ok: true });
  });
  app.post("/api/assistant/chat/turn/abort",async c=>{
    const ownerId=await deps.requireOwner(c);if(!ownerId)return deps.unauthorized(c);
    const body=await c.req.json().catch(()=>null) as {requestId?:unknown}|null;
    if(typeof body?.requestId!=="string"||!body.requestId||body.requestId.length>500)return c.json({ok:false,error:"requestId is required"},400);
    const namespace=c.env.ME3_AGENT;if(!namespace)return c.json({ok:false,error:"Agent runtime is unavailable"},503);
    return namespace.get(namespace.idFromName(ownerId)).fetch("https://me3-agent/turn/cancel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ownerId,requestId:body.requestId})});
  });
  app.get("/api/assistant/approvals",async c=>{
    const ownerId=await deps.requireOwner(c);if(!ownerId)return deps.unauthorized(c);
    return c.json({approvals:await listNewAgentApprovals(c.env,ownerId,c.req.query("status"))});
  });
  app.post("/api/assistant/approvals/:id",async c=>{
    const ownerId=await deps.requireOwner(c);if(!ownerId)return deps.unauthorized(c);
    const body=await c.req.json().catch(()=>null) as {decision?:unknown;deviceAuthentication?:unknown}|null;
    if(body?.decision!=="approved"&&body?.decision!=="declined")return c.json({ok:false,error:"decision must be approved or declined"},400);
    return decideNewAgentApproval(c,ownerId,c.req.param("id"),body.decision,await evidence(c,body));
  });
  app.post("/api/assistant/turns/:turnId/cancel",async c=>{
    const ownerId=await deps.requireOwner(c);if(!ownerId)return deps.unauthorized(c);
    const namespace=c.env.ME3_AGENT;if(!namespace)return c.json({ok:false,error:"Agent runtime is unavailable"},503);
    return namespace.get(namespace.idFromName(ownerId)).fetch("https://me3-agent/turn/cancel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ownerId,turnId:c.req.param("turnId")})});
  });
}
