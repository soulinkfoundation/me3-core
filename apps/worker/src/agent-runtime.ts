import { AGENT_CONTEXT_LIMITS, appendAgentStreamEvent, buildAgentSystemPrompt, createCloudflareModel, createD1TurnStore, runAgentTurn, type AgentMessage, type AgentTurnResult } from "../../../packages/agent/src";
import { createDomainTools, type AgentDomainServices } from "../../../packages/agent/src/tools";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { getAiSettings } from "./ai-providers";
import { getAiGatewayRuntimeConfig } from "./ai-gateway";
import { getManagedAiBillingSettings } from "./managed-ai-billing";
import { createStableAgentSchedulingServices } from "./agent-domain-scheduling";
import { createAgentMailboxServices } from "./agent-mailbox-services";
import { createPeopleSearchToolServices } from "./network-directory";
import { createWebResearchToolServices } from "./web-research";
import { listCorePluginRecords } from "./plugins";
import { beginManagedRuntimeWriteLease, isManagedRuntime, releaseManagedRuntimeWriteLease } from "./managed-runtime-lifecycle";
import type { Env, OwnerProfile } from "./types";

export type NewAgentDispatchInput = {
  userId:string;threadId:string;turnId:string;requestId:string;messageText:string;
  selectedModel?:{providerId:string;model:string}|null;
  attachmentTextContext?:string|null;
  attachments?:Array<{kind?:string|null;storageKey?:string|null;mimeType?:string|null}>;
  connectionId?:string;sourceEventId?:string;mode?:string;
};

export function isNewAgentDispatchInput(value:unknown):value is NewAgentDispatchInput {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const input=value as Record<string,unknown>;
  return (input.threadId===undefined||(typeof input.threadId==="string"&&Boolean(input.threadId.trim())&&input.threadId.length<=500))&&["userId","turnId","requestId","messageText"].every(key=>typeof input[key]==="string"&&Boolean((input[key] as string).trim())&&(input[key] as string).length<=(key==="messageText"?100_000:500));
}

export async function executeNewAgentTurn(env:Env,input:NewAgentDispatchInput,signal:AbortSignal,onEvent?:(event:string,data:Record<string,unknown>,seq:number)=>void):Promise<Record<string,unknown>> {
  const lease=await beginManagedRuntimeWriteLease(env,"POST","assistant_agent");
  if(isManagedRuntime(env)&&!lease)throw new Error("Managed runtime is not accepting agent writes");
  try {
    const owner=await env.DB.prepare("SELECT * FROM owner_profile WHERE id=?").bind(input.userId).first<OwnerProfile>();
    if(!owner)throw new Error("Agent owner not found");
    const thread=await env.DB.prepare("SELECT id FROM assistant_threads WHERE id=? AND owner_id=? AND status='active'").bind(input.threadId,input.userId).first();
    if(!thread)throw new Error("Agent conversation is not available for this owner");
    const timezone=owner.timezone||"UTC";
    const plugins=await listCorePluginRecords(env);
    const enabledPluginIds=new Set(plugins.filter(plugin=>plugin.enabled&&plugin.status==="installed").map(plugin=>plugin.id));
    const settings=await getAiSettings(env,input.userId);
    const managed=env.ME3_DEPLOYMENT_MODE==="managed"?await getManagedAiBillingSettings(env):null;
    if(managed&&!managed.eligible)throw new Error(managed.ineligibleReason||"Managed AI is unavailable");
    const route=settings.defaults.chat;
    const modelName=input.selectedModel?providerModel(input.selectedModel.providerId,input.selectedModel.model):managed?.defaultModel||providerModel(route.providerId,route.model);
    if(managed&&!managed.models.some(model=>model.id===modelName))throw new Error("Selected model is not permitted by this installation's managed policy");
    const gateway=await getAiGatewayRuntimeConfig(env,input.userId);
    if(!env.AI)throw new Error("Cloudflare AI binding is not configured");
    const metadata={me3_runtime:"agent",me3_turn_id:input.turnId,me3_request_id:input.requestId,me3_thread_id:input.threadId};
    let usageIndex=0;
    const modelFor=(selected:string)=>createCloudflareModel({ai:env.AI as never,model:selected,gatewayId:gateway.gatewayId||env.CLOUDFLARE_AI_GATEWAY_ID||"default",metadata,recordUsage:async usage=>{
      await env.DB.prepare(`INSERT OR IGNORE INTO ai_usage_events(id,user_id,kind,provider,model,tokens_in,tokens_out,estimated_cost_usd,metadata_json)
        VALUES(?,?,'text',?,?,?,?,?,?)`).bind(`${input.turnId}:model:${crypto.randomUUID()}:${usageIndex++}`,input.userId,selected.split("/")[0],selected,usage.inputTokens,usage.outputTokens,usage.estimatedCostUsd??0,JSON.stringify({...metadata,cachedInputTokens:usage.cachedInputTokens,cacheWriteInputTokens:usage.cacheWriteInputTokens??0,costKnown:usage.estimatedCostUsd!==null})).run();
    }});
    const model=modelFor(modelName);
    const backupName=env.ME3_AI_CHAT_BACKUP_MODEL;
    const backup=backupName&&(!managed||managed.models.some(model=>model.id===backupName))?modelFor(backupName):undefined;
    const store=createD1TurnStore(env.DB,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId});
    let messages:AgentMessage[]=[];
    if(!await store.load()) {
      const snapshot=await loadOwnerSnapshotContext({db:env.DB,ownerId:input.userId,owner:{id:owner.id,name:owner.name,username:owner.username,timezone,assistantName:owner.assistant_name||"ME3"},meJsonUrl:null});
      const recent=await env.DB.prepare("SELECT role,content FROM assistant_messages WHERE owner_id=? AND thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 80").bind(input.userId,input.threadId).all<{role:"user"|"assistant"|"system";content:string}>();
      messages=[{role:"system",content:buildAgentSystemPrompt({ownerName:owner.name||"the owner",timezone,ownerSnapshot:snapshot.prompt})},...(recent.results||[]).reverse().filter(message=>message.role!=="system")];
      const content=[input.messageText,input.attachmentTextContext].filter(Boolean).join("\n\n");
      const images=await loadImageAttachments(env,input);
      messages.push({role:"user",content,...(images.length?{images}:{})});
      await env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)").bind(`${input.turnId}:user`,input.userId,input.threadId,input.messageText,JSON.stringify({requestId:input.requestId,runtime:"agent"})).run();
    }
    const services=await newAgentServices(env,input.userId);
    const tools=createDomainTools().filter(tool=>isToolAvailable(tool.name,services));
    const result=await runAgentTurn({model,backupModel:backup,tools,messages,store,contextWindow:AGENT_CONTEXT_LIMITS,context:{db:env.DB,ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId,ownerTimezone:timezone,messageText:input.messageText,enabledPluginIds,services:services as unknown as Record<string,unknown>},signal,onEvent:async event=>{
      const seq=await appendAgentStreamEvent(env.DB,input.userId,input.turnId,event.event,event.data);
      onEvent?.(event.event,event.data,seq);
    }});
    return persistNewAgentResult(env,input,result,onEvent);
  } finally {await releaseManagedRuntimeWriteLease(env,lease);}
}

async function persistNewAgentResult(env:Env,input:NewAgentDispatchInput,result:AgentTurnResult,onEvent?: (event:string,data:Record<string,unknown>,seq:number)=>void) {
  const payload={ok:result.status==="complete"||result.status==="needs_approval",auditId:input.turnId,turnId:input.turnId,threadId:input.threadId,specialist:"core.agent",replyText:result.replyText,model:result.trace.model,source:"workers-ai-gateway",mode:input.mode||"default",status:result.status,approvalId:result.approvalId||null,trace:result.trace,streamMetrics:{timeToFirstTokenMs:result.trace.timeToFirstTokenMs,totalDurationMs:result.trace.totalDurationMs,modelRequestCount:result.modelRequestCount,toolCallCount:result.toolCalls.length},...(result.status==="failed"?{error:result.replyText}:{})};
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'assistant',?,?)").bind(`${input.turnId}:assistant:${result.status}:${result.approvalId||"final"}`,input.userId,input.threadId,result.replyText,JSON.stringify(payload)),
    env.DB.prepare("UPDATE me3_agent_turns SET response_json=?,trace_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND turn_id=?").bind(JSON.stringify(payload),JSON.stringify(result.trace),input.userId,input.turnId),
    env.DB.prepare("UPDATE assistant_threads SET updated_at=CURRENT_TIMESTAMP,last_message_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.threadId,input.userId),
    env.DB.prepare(`INSERT INTO agent_turn_results(user_id,request_id,turn_id,response_json) VALUES(?,?,?,?) ON CONFLICT(user_id,request_id) DO UPDATE SET response_json=excluded.response_json,updated_at=CURRENT_TIMESTAMP`).bind(input.userId,input.requestId,input.turnId,JSON.stringify(payload)),
  ]);
  const event=result.status==="failed"?"error":"done";
  const seq=await appendAgentStreamEvent(env.DB,input.userId,input.turnId,event,payload);
  onEvent?.(event,payload,seq);
  return payload;
}

async function newAgentServices(env:Env,ownerId:string):Promise<AgentDomainServices> {
  return {
    scheduling:createStableAgentSchedulingServices(env,ownerId),
    mailbox:createAgentMailboxServices(env,ownerId),
    people:createPeopleSearchToolServices(env,ownerId) as unknown as AgentDomainServices["people"],
    web:createWebResearchToolServices(env,ownerId),landingPageEnv:env as never,
  };
}
function isToolAvailable(name:string,services:AgentDomainServices):boolean {
  if(name.startsWith("core_mailbox_"))return Boolean(services.mailbox);
  if(name==="core_scheduling_request_read")return Boolean(services.scheduling?.getRequest);
  if(name==="core_scheduling_request")return Boolean(services.scheduling?.request);
  if(name==="core_scheduling_request_profile")return Boolean(services.scheduling?.requestNetwork);
  if(name==="core_scheduling_approve")return Boolean(services.scheduling?.approve);
  if(name==="core_scheduling_decline")return Boolean(services.scheduling?.decline);
  return true;
}
function providerModel(provider:string,model:string):string {return provider==="workers-ai"||model.startsWith(`${provider}/`)?model:`${provider}/${model}`;}
async function loadImageAttachments(env:Env,input:NewAgentDispatchInput) {
  const images:Array<{url:string}>=[];
  for(const attachment of (input.attachments||[]).filter(item=>item.kind==="image").slice(0,4)) {
    if(!attachment.storageKey||!env.SITE_ASSETS)throw new Error("Image attachment storage is unavailable");
    const asset=await env.DB.prepare("SELECT id FROM assistant_message_assets WHERE owner_id=? AND thread_id=? AND storage_key=? AND status='ready'").bind(input.userId,input.threadId,attachment.storageKey).first();
    if(!asset)throw new Error("Image is unavailable for this conversation");
    const object=await env.SITE_ASSETS.get(attachment.storageKey);if(!object)throw new Error("Image attachment not found");
    if(object.size>10*1024*1024)throw new Error("Image exceeds attachment limit");
    const bytes=new Uint8Array(await object.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
    images.push({url:`data:${attachment.mimeType||"image/png"};base64,${btoa(binary)}`});
  }
  return images;
}
