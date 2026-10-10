import { AGENT_CONTEXT_LIMITS, appendAgentStreamEvent, buildAgentSystemPrompt, createCloudflareModel, createD1TurnStore, runAgentTurn, type AgentMessage, type AgentModel, type AgentTurnResult } from "../../../packages/agent/src";
import { createDomainTools, type AgentDomainServices } from "../../../packages/agent/src/tools";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { modelSupportsImageInput, modelCapabilitiesFor } from "../../../packages/agent-chat/src/model-capabilities";
import { getAiSettings } from "./ai-providers";
import { getAiGatewayRuntimeConfig } from "./ai-gateway";
import { getManagedAiBillingSettings, syncManagedAiUsage, MANAGED_AI_FALLBACK_MODEL, type ManagedAiBillingSettings } from "./managed-ai-billing";
import { createStableAgentSchedulingServices } from "./agent-domain-scheduling";
import { createAgentMailboxServices } from "./agent-mailbox-services";
import { prepareAgentImageInputs, resolveAgentImageInputs, loadAgentAttachmentManifest, type AgentAttachmentInput } from "./agent-image-input";
import { createAgentImageGenerationServices, loadAgentGeneratedImageAction } from "./agent-image-generation";
import { revalidateAgentImagePayload } from "./agent-image-projection";
import { createPeopleSearchToolServices } from "./network-directory";
import { createWebResearchToolServices } from "./web-research";
import { listCorePluginRecords } from "./plugins";
import { beginManagedRuntimeWriteLease, isManagedRuntime, releaseManagedRuntimeWriteLease } from "./managed-runtime-lifecycle";
import type { Env, OwnerProfile } from "./types";

export type NewAgentDispatchInput = {
  userId:string;threadId:string;turnId:string;requestId:string;messageText:string;
  selectedModel?:{providerId:string;model:string}|null;
  attachmentTextContext?:string|null;
  attachments?:AgentAttachmentInput[];
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
    const managed=isManagedRuntime(env)?await getManagedAiBillingSettings(env):null;
    if(managed&&!managed.eligible)throw new Error(managed.ineligibleReason||"Managed AI is unavailable");
    const route=settings.defaults.chat;
    const modelName=input.selectedModel?providerModel(input.selectedModel.providerId,input.selectedModel.model):managed?.defaultModel||providerModel(route.providerId,route.model);
    if(managed){await assertManagedCostsReconciled(env,input.userId,true);resolveManagedModel(managed,modelName);}
    const gateway=await getAiGatewayRuntimeConfig(env,input.userId);
    if(!env.AI)throw new Error("Cloudflare AI binding is not configured");
    const metadata={me3_runtime:"agent",me3_turn_id:input.turnId,me3_request_id:input.requestId,me3_thread_id:input.threadId};
    const imageScope={ownerId:input.userId,threadId:input.threadId};
    let usageIndex=0;
    const cloudflareModel=(selected:string,reportCount=0):AgentModel=>({id:selected,async step(step){
      step.signal.throwIfAborted();
      if(step.messages.some(message=>message.images?.length)&&!bindingModelSupportsImageInput(selected))throw new Error("This model cannot read images. Choose an image-input model for this turn.");
      const messages=await resolveAgentImageInputs(env,imageScope,step.messages,step.signal);
      step.signal.throwIfAborted();
      const usageId=`${input.turnId}:model:${crypto.randomUUID()}:${usageIndex++}`;
      const receiptMetadata={...metadata,billingManaged:Boolean(managed),modelAuthor:selected.replace(/^@cf\//,"").split("/")[0]};
      const billingFeeRate=managed&&!selected.startsWith("@cf/")?0.05:0;
      // An interrupted or unpriced paid request must remain visibly unreconciled.
      const admitted=await env.DB.prepare(`INSERT INTO ai_usage_events(id,user_id,kind,provider,model,tokens_in,tokens_out,estimated_cost_usd,metadata_json)
        SELECT ?,?,'text','workers-ai',?,0,0,0,? WHERE ?=0 OR (NOT EXISTS(
          SELECT 1 FROM ai_usage_events WHERE user_id=? AND created_at >= datetime('now','start of month')
          AND json_extract(metadata_json,'$.me3_runtime')='agent'
          AND json_extract(metadata_json,'$.billingManaged')=1
          AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NULL
        ) AND ?=(SELECT COUNT(*) FROM ai_usage_events WHERE user_id=?
          AND created_at >= datetime('now','start of month')
          AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL
        ))`).bind(usageId,input.userId,selected,JSON.stringify({...receiptMetadata,billingFeeRate,baseCostUsd:null,costKnown:false,usageReported:false}),managed?1:0,input.userId,reportCount,input.userId).run();
      if(managed&&!admitted.meta.changes){
        await assertManagedCostsReconciled(env,input.userId,true);
        throw new Error("Managed AI budget policy changed before model admission; retry this turn");
      }
      return createCloudflareModel({ai:env.AI as never,model:selected,gatewayId:gateway.gatewayId||env.CLOUDFLARE_AI_GATEWAY_ID||"default",metadata,recordUsage:async usage=>{
        const tokensKnown=[usage.inputTokens,usage.outputTokens,usage.cachedInputTokens,usage.cacheWriteInputTokens??0].every(value=>typeof value==="number"&&Number.isFinite(value)&&value>=0);
        const baseCostUsd=usage.estimatedCostUsd;
        const billedCostUsd=baseCostUsd===null?null:baseCostUsd*(1+billingFeeRate);
        const costKnown=tokensKnown&&billedCostUsd!==null&&Number.isFinite(billedCostUsd)&&billedCostUsd>=0;
        await env.DB.prepare("UPDATE ai_usage_events SET tokens_in=?,tokens_out=?,estimated_cost_usd=?,metadata_json=? WHERE id=?")
          .bind(tokensKnown?usage.inputTokens:0,tokensKnown?usage.outputTokens:0,costKnown?billedCostUsd:0,JSON.stringify({...receiptMetadata,billingFeeRate,baseCostUsd:costKnown?baseCostUsd:null,cachedInputTokens:tokensKnown?usage.cachedInputTokens:0,cacheWriteInputTokens:tokensKnown?(usage.cacheWriteInputTokens??0):0,costKnown,usageReported:tokensKnown}),usageId).run();
      }}).step({...step,messages});
    }});
    const modelFor=(requested:string):AgentModel=>{
      if(!managed)return cloudflareModel(canonicalNativeModel(requested));
      const model:AgentModel={id:resolveManagedModel(managed,requested),async step(step){
        await assertManagedCostsReconciled(env,input.userId);
        await syncManagedAiUsage(env);
        const reportCount=await managedUsageReportCount(env,input.userId);
        const policy=await getManagedAiBillingSettings(env,{syncUsage:false});
        model.id=resolveManagedModel(policy,requested);
        await assertManagedCostsReconciled(env,input.userId,true);
        step.signal.throwIfAborted();
        return cloudflareModel(model.id,reportCount).step(step);
      }};
      return model;
    };
    const model=modelFor(modelName);
    const backupName=env.ME3_AI_CHAT_BACKUP_MODEL;
    const backup=backupName&&(!managed||managed.models.some(model=>managedModelId(model.id)===managedModelId(backupName)))?modelFor(backupName):undefined;
    const store=createD1TurnStore(env.DB,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId});
    let messages:AgentMessage[]=[];
    if(!await store.load()) {
      const snapshot=await loadOwnerSnapshotContext({db:env.DB,ownerId:input.userId,owner:{id:owner.id,name:owner.name,username:owner.username,timezone,assistantName:owner.assistant_name||"ME3"},meJsonUrl:null});
      const recent=await env.DB.prepare("SELECT role,content FROM assistant_messages WHERE owner_id=? AND thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 80").bind(input.userId,input.threadId).all<{role:"user"|"assistant"|"system";content:string}>();
      messages=[{role:"system",content:buildAgentSystemPrompt({ownerName:owner.name||"the owner",timezone,ownerSnapshot:snapshot.prompt})},...(recent.results||[]).reverse().filter(message=>message.role!=="system")];
      const content=[input.messageText,input.attachmentTextContext].filter(Boolean).join("\n\n");
      const images=await prepareAgentImageInputs(env,imageScope,input.attachments||[],signal);
      messages.push({role:"user",content,...(images.length?{images}:{})});
      const attachments=await loadAgentAttachmentManifest(env,imageScope,input.attachments||[]);
      await env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)").bind(`${input.turnId}:user`,input.userId,input.threadId,input.messageText,JSON.stringify({requestId:input.requestId,runtime:"agent",...(attachments.length?{attachments}:{})})).run();
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
  const imageAction=await loadAgentGeneratedImageAction(env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId});
  const messageId=`${input.turnId}:assistant:${result.status}:${result.approvalId||"final"}`;
  const payload={ok:result.status==="complete"||result.status==="needs_approval",auditId:input.turnId,turnId:input.turnId,threadId:input.threadId,specialist:"core.agent",runtime:"agent",replyText:result.replyText,model:result.trace.model,source:"workers-ai-gateway",mode:input.mode||"default",status:result.status,approvalId:result.approvalId||null,trace:result.trace,streamMetrics:{timeToFirstTokenMs:result.trace.timeToFirstTokenMs,totalDurationMs:result.trace.totalDurationMs,modelRequestCount:result.modelRequestCount,toolCallCount:result.toolCalls.length},...(imageAction?{imageAction}:{}),...(result.status==="failed"?{error:result.replyText}:{})};
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'assistant',?,?)").bind(messageId,input.userId,input.threadId,result.replyText,JSON.stringify(payload)),
    env.DB.prepare("UPDATE me3_agent_turns SET response_json=?,trace_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND turn_id=?").bind(JSON.stringify(payload),JSON.stringify(result.trace),input.userId,input.turnId),
    env.DB.prepare("UPDATE assistant_threads SET updated_at=CURRENT_TIMESTAMP,last_message_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.threadId,input.userId),
    env.DB.prepare(`INSERT INTO agent_turn_results(user_id,request_id,turn_id,response_json) VALUES(?,?,?,?) ON CONFLICT(user_id,request_id) DO UPDATE SET response_json=excluded.response_json,updated_at=CURRENT_TIMESTAMP`).bind(input.userId,input.requestId,input.turnId,JSON.stringify(payload)),
    ...(imageAction?.assets||[]).map(asset=>env.DB.prepare(`INSERT OR IGNORE INTO assistant_message_assets(id,owner_id,thread_id,message_id,attachment_id,role,metadata_json)
      SELECT ?,?,?,?,?, 'generated_output',? WHERE EXISTS(SELECT 1 FROM assistant_attachments WHERE id=? AND owner_id=? AND thread_id=? AND status='ready' AND kind='image')`)
      .bind(`${messageId}:image:${asset.attachmentId}`,input.userId,input.threadId,messageId,asset.attachmentId,JSON.stringify(asset),asset.attachmentId,input.userId,input.threadId)),
  ]);
  const visiblePayload=await revalidateAgentImagePayload(env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId},payload);
  const event=result.status==="failed"?"error":"done";
  const seq=await appendAgentStreamEvent(env.DB,input.userId,input.turnId,event,visiblePayload);
  onEvent?.(event,visiblePayload,seq);
  return visiblePayload;
}

async function newAgentServices(env:Env,ownerId:string):Promise<AgentDomainServices> {
  return {
    scheduling:createStableAgentSchedulingServices(env,ownerId),
    mailbox:createAgentMailboxServices(env,ownerId),
    images:createAgentImageGenerationServices(env,ownerId),
    people:createPeopleSearchToolServices(env,ownerId) as unknown as AgentDomainServices["people"],
    web:createWebResearchToolServices(env,ownerId),landingPageEnv:env as never,
  };
}
function isToolAvailable(name:string,services:AgentDomainServices):boolean {
  if(name==="core_images_generate")return Boolean(services.images);
  if(name.startsWith("core_mailbox_"))return Boolean(services.mailbox);
  if(name==="core_scheduling_request_read")return Boolean(services.scheduling?.getRequest);
  if(name==="core_scheduling_request")return Boolean(services.scheduling?.request);
  if(name==="core_scheduling_request_profile")return Boolean(services.scheduling?.requestNetwork);
  if(name==="core_scheduling_approve")return Boolean(services.scheduling?.approve);
  if(name==="core_scheduling_decline")return Boolean(services.scheduling?.decline);
  return true;
}
function providerModel(provider:string,model:string):string {return provider==="workers-ai"?canonicalNativeModel(model):model.startsWith(`${provider}/`)?model:`${provider}/${model}`;}
function managedModelId(model:string):string {return model.replace(/^@cf\//,"");}
function canonicalNativeModel(model:string):string {
  const nativeModel=`@cf/${managedModelId(model)}`;
  return modelCapabilitiesFor("workers-ai",nativeModel).includes("text")?nativeModel:model;
}
async function managedUsageReportCount(env:Env,ownerId:string):Promise<number> {
  const row=await env.DB.prepare(`SELECT COUNT(*) AS count FROM ai_usage_events WHERE user_id=?
    AND created_at >= datetime('now','start of month')
    AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL`).bind(ownerId).first<{count:number}>();
  return row?.count??0;
}
async function assertManagedCostsReconciled(env:Env,ownerId:string,requireReported=false):Promise<void> {
  const pending=await env.DB.prepare(`SELECT json_extract(metadata_json,'$.costKnown') AS costKnown FROM ai_usage_events WHERE user_id=?
    AND created_at >= datetime('now','start of month')
    AND json_extract(metadata_json,'$.me3_runtime')='agent'
    AND json_extract(metadata_json,'$.billingManaged')=1
    AND ${requireReported?"json_extract(metadata_json,'$.managedBillingReportedAt') IS NULL":"json_extract(metadata_json,'$.costKnown')=0"} LIMIT 1`).bind(ownerId).first<{costKnown:number}>();
  if(pending)throw new Error(`Managed AI ${pending.costKnown===0?"cost":"usage"} is awaiting reconciliation before another model call`);
}
function resolveManagedModel(policy:ManagedAiBillingSettings,requested:string):string {
  if(!policy.available||!policy.eligible)throw new Error(policy.ineligibleReason||"Managed AI is unavailable");
  if(!policy.models.some(model=>managedModelId(model.id)===managedModelId(requested)))throw new Error("Selected model is not permitted by this installation's managed policy");
  if(policy.fallbackActive||policy.currentMonthUsageMicrousd>=policy.effectiveMaximumCents*10_000)return MANAGED_AI_FALLBACK_MODEL;
  return canonicalNativeModel(requested);
}
function bindingModelSupportsImageInput(model:string):boolean {
  if(modelSupportsImageInput("workers-ai",model))return true;
  if(model.startsWith("openai/"))return modelSupportsImageInput("openai",model.slice("openai/".length));
  if(model.startsWith("anthropic/"))return modelSupportsImageInput("anthropic",model.slice("anthropic/".length));
  return false;
}
