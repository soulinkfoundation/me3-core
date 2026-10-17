import { AGENT_CONTEXT_LIMITS, appendAgentStreamEvent, buildAgentSystemPrompt, createCloudflareModel, createClefDecider, createClefRouter, createD1TurnStore, runAgentTurn, sampleFastPathTurn, type AgentDecider, type AgentMessage, type AgentModel, type AgentTurnResult, type AgentUsage } from "../../../packages/agent/src";
import type { AgentFastPathRequestMeasurement } from "../../../packages/agent/src/fast-path";
import { createDomainTools, type AgentDomainServices } from "../../../packages/agent/src/tools";
import { saveOwnerQuote } from "./quotes";
import { createAgentPaymentServices } from "./agent-payments";
import { computerAvailability, createComputerChatServices, type ComputerJobHost } from "./agent-computer";
import { computerChatTools } from "../../../packages/agent/src/computer/tools";
import { createOwnerCreateIntentVerifier } from "./agent-owner-create-intent";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { modelSupportsImageInput, modelCapabilitiesFor } from "../../../packages/agent-chat/src/model-capabilities";
import { getAiSettings } from "./ai-providers";
import { getAiGatewayRuntimeConfig } from "./ai-gateway";
import { loadAgentEmailDraft } from "./agent-email-draft";
import { getManagedAiBillingSettings, managedAllowanceNotice, syncManagedAiUsage, MANAGED_AI_FALLBACK_MODEL, type ManagedAiBillingSettings, type ManagedAllowanceNotice } from "./managed-ai-billing";
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
import { loadAgentTargetPresentation, revalidateAgentTargetPayload } from "./agent-target-projection";
import { parseAgentTargetSelection } from "./agent-target-selection";
import type { AgentTargetSelection } from "../../../packages/agent/src/types";
import { notifyAgentTurnFinished } from "./agent-notifications";
import { createTargetIntentVerifier, loadTargetIntentOwnerInputs } from "./agent-target-intent";
import { loadAgentPlannerHistory } from "./agent-planner-history";

export type NewAgentDispatchInput = {
  userId:string;threadId:string;turnId:string;requestId:string;messageText:string;
  targetSelection?:AgentTargetSelection;
  selectedModel?:{providerId:string;model:string}|null;
  attachmentTextContext?:string|null;
  attachments?:AgentAttachmentInput[];
  connectionId?:string;sourceEventId?:string;mode?:string;
};

export function isNewAgentDispatchInput(value:unknown):value is NewAgentDispatchInput {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const input=value as Record<string,unknown>;
  try { parseAgentTargetSelection(input.targetSelection); } catch { return false; }
  return (input.threadId===undefined||(typeof input.threadId==="string"&&Boolean(input.threadId.trim())&&input.threadId.length<=500))&&["userId","turnId","requestId","messageText"].every(key=>typeof input[key]==="string"&&Boolean((input[key] as string).trim())&&(input[key] as string).length<=(key==="messageText"?100_000:500));
}

export async function executeNewAgentTurn(env:Env,input:NewAgentDispatchInput,signal:AbortSignal,onEvent?:(event:string,data:Record<string,unknown>,seq:number)=>void,waitUntil?:(work:Promise<void>)=>void,computerHost?:ComputerJobHost):Promise<Record<string,unknown>> {
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
    const {managed,modelName,gateway,metadata,admitModel,plannerAdmitted,modelFor,model,backup,allowanceFallbackUsed}=await createAgentModels(env,input);
    const imageScope={ownerId:input.userId,threadId:input.threadId};
    const store=createD1TurnStore(env.DB,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId});
    let messages:AgentMessage[]=[];
    if(!await store.load()) {
      const snapshot=await loadOwnerSnapshotContext({db:env.DB,ownerId:input.userId,owner:{id:owner.id,name:owner.name,username:owner.username,timezone,assistantName:owner.assistant_name||"ME3"},meJsonUrl:null});
      const recent=await loadAgentPlannerHistory(env.DB,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId},signal);
      messages=[{role:"system",content:buildAgentSystemPrompt({ownerName:owner.name||"the owner",timezone,ownerSnapshot:snapshot.prompt})},...recent];
      const content=[input.messageText,input.attachmentTextContext].filter(Boolean).join("\n\n");
      const images=await prepareAgentImageInputs(env,imageScope,input.attachments||[],signal);
      messages.push({role:"user",content,...(images.length?{images}:{})});
      const attachments=await loadAgentAttachmentManifest(env,imageScope,input.attachments||[]);
      await env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)").bind(`${input.turnId}:user`,input.userId,input.threadId,input.messageText,JSON.stringify({requestId:input.requestId,runtime:"agent",...(attachments.length?{attachments}:{})})).run();
    }
    const services=await newAgentServices(env,input.userId,computerHost);
    const tools=[...createDomainTools(),...computerChatTools()].filter(tool=>isToolAvailable(tool.name,services));
    // Shadow waits for planner admission, never the other way round. Its receipt
    // remains billable, but cannot change this turn's routing or admission.
    const sampleRate=env.ME3_AGENT_FAST_PATH_SAMPLE_RATE===undefined?1:Number(env.ME3_AGENT_FAST_PATH_SAMPLE_RATE);
    const until=env.ME3_AGENT_FAST_PATH_UNTIL;
    const pilotActive=!until||Date.now()<Date.parse(until);
    const makeDecider=(variant:"clef"|"clef-flash"):AgentDecider=>({id:`@cf/cloudflare/${variant}`,async decide(step){
      let receipt:((usage:AgentUsage,measurement?:AgentFastPathRequestMeasurement)=>Promise<void>)|undefined;
      const argumentMode=variant==="clef"&&env.ME3_AGENT_FAST_PATH_ARGUMENTS==="conditional"?"conditional":"fanout";
      const work=createClefDecider({model:variant,argumentMode,gatewayId:gateway.gatewayId||env.CLOUDFLARE_AI_GATEWAY_ID||"default",metadata:{...metadata,purpose:"fast_path"},recordUsage:(usage,measurement)=>receipt?.(usage,measurement),ai:{async run(selected,payload,options){
        receipt=undefined;
        await new Promise<void>(resolve=>{
          const done=()=>{step.signal.removeEventListener("abort",done);resolve();};
          step.signal.addEventListener("abort",done,{once:true});
          if(step.signal.aborted)done();else void plannerAdmitted.then(done);
        });
        step.signal.throwIfAborted();
        if(managed){
          const policy=await getManagedAiBillingSettings(env,{syncUsage:false});
          if(!policy.available||policy.fallbackActive||policy.currentMonthUsageMicrousd>=policy.effectiveMaximumCents*10_000)throw new Error("Shadow inference unavailable under managed policy");
        }
        const count=managed?await managedUsageReportCount(env,input.userId,input.turnId):0;
        step.signal.throwIfAborted();
        const questions=(payload as {questions:Record<string,unknown>}).questions;
        const stage=questions.tool?(Object.keys(questions).some(id=>id.startsWith("args_"))?"fanout":"routing"):"arguments";
        receipt=await admitModel(selected,count,{purpose:"fast_path",shadow:{stage,argumentMode,sampleRate}},true);
        return env.AI!.run(selected as never,payload as never,options as never);
      }}}).decide(step);
      waitUntil?.(work.then(()=>{},()=>{}));
      return work;
    }});
    const fastPath=env.ME3_AGENT_FAST_PATH==="shadow"&&pilotActive&&sampleFastPathTurn(input.turnId,sampleRate)&&!input.attachments?.length&&!input.attachmentTextContext?{mode:"shadow" as const,decider:makeDecider("clef"),additionalDeciders:[makeDecider("clef-flash")],sampleRate}:undefined;
    const intentTools=tools.filter(tool=>!tool.pluginId||enabledPluginIds.has(tool.pluginId));
    const intentScope={ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId};
    const loadIntentOwnerInputs=(references:Parameters<typeof loadTargetIntentOwnerInputs>[2],intentSignal:AbortSignal)=>
      loadTargetIntentOwnerInputs(env.DB,intentScope,references,intentSignal);
    const verifyTargetIntent=createTargetIntentVerifier({db:env.DB,scope:intentScope,ownerTimezone:timezone,tools:intentTools,requireReferenceEvidence:true,admit:()=>{
      let usageId:string|undefined;
      const verifier=modelFor(modelName,{purpose:"target_intent",onAdmission:id=>{usageId=id;}});
      return {model:verifier,usageId:()=>usageId};
    }});
    const verifyOwnerCreateIntent=createOwnerCreateIntentVerifier({db:env.DB,scope:{...intentScope,ownerTimezone:timezone},tools:intentTools,admit:()=>{
      let usageId:string|undefined;
      const verifier=modelFor(modelName,{purpose:"owner_create_intent",onAdmission:id=>{usageId=id;}});
      return {model:verifier,usageId:()=>usageId};
    }});
    // Routing uses the same unreconciled-receipt exclusions as fast-path
    // decisions, so a late or timed-out routing call never blocks the planner.
    const fastName=env.ME3_AGENT_FAST_MODEL?.trim()||"anthropic/claude-haiku-5.5";
    const fastAllowed=!managed||managed.models.some(item=>managedModelId(item.id)===managedModelId(fastName));
    let routingReceipt:((usage:AgentUsage)=>Promise<void>)|undefined;
    const router=env.ME3_AGENT_ROUTING?.trim()==="on"&&fastAllowed&&managedModelId(fastName)!==managedModelId(model.id)?createClefRouter({model:"clef-flash",fastModel:modelFor(fastName),
      gatewayId:gateway.gatewayId||env.CLOUDFLARE_AI_GATEWAY_ID||"default",metadata:{...metadata,purpose:"routing"},recordUsage:usage=>routingReceipt?.(usage),
      ai:{async run(selected,payload,options){
        routingReceipt=undefined;
        if(managed){
          const policy=await getManagedAiBillingSettings(env,{syncUsage:false});
          if(!policy.available||policy.fallbackActive||policy.currentMonthUsageMicrousd>=policy.effectiveMaximumCents*10_000)throw new Error("Routing unavailable under managed policy");
        }
        const count=managed?await managedUsageReportCount(env,input.userId,input.turnId):0;
        routingReceipt=await admitModel(selected,count,{purpose:"fast_path",shadow:{stage:"routing",argumentMode:"route",sampleRate:1}},true);
        return env.AI!.run(selected as never,payload as never,options as never);
      }}}):undefined;
    const result=await runAgentTurn({model,backupModel:backup,fastPath,router,tools,messages,store,contextWindow:AGENT_CONTEXT_LIMITS,context:{db:env.DB,ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId,ownerTimezone:timezone,messageText:input.messageText,targetSelection:input.targetSelection,loadIntentOwnerInputs,verifyTargetIntent,verifyOwnerCreateIntent,intentReadToolContracts:tools.filter(tool=>tool.effect==="read"&&!tool.endsTurn).map(({name,parameters})=>({name,parameters})),intentToolContracts:intentTools.filter(tool=>tool.target).map(({name,description,parameters,effect,approval,target})=>({name,description,parameters,effect,approval,target:{domain:target!.domain,idParameter:target!.idParameter}})),enabledPluginIds,services:services as unknown as Record<string,unknown>},signal,onEvent:async event=>{
      const seq=await appendAgentStreamEvent(env.DB,input.userId,input.turnId,event.event,event.data);
      onEvent?.(event.event,event.data,seq);
    }});
    const allowanceNotice=managed&&allowanceFallbackUsed()?managedAllowanceNotice(await getManagedAiBillingSettings(env,{syncUsage:false})):null;
    return persistNewAgentResult(env,input,result,onEvent,allowanceNotice);
  } finally {await releaseManagedRuntimeWriteLease(env,lease);}
}

type ModelPurpose = {purpose:"target_intent"|"owner_create_intent"|"fast_path";onAdmission?(id:string):void;shadow?:{stage:string;argumentMode:string;sampleRate:number}};
export type AgentModelScope = Pick<NewAgentDispatchInput,"userId"|"threadId"|"turnId"|"requestId"|"selectedModel">;

/**
 * Builds the planner model with usage receipts, managed admission and the
 * allowance fallback. Chat turns and background computer jobs share it, so a
 * job's model steps are billed and capped exactly like a turn's.
 */
export async function createAgentModels(env:Env,scope:AgentModelScope) {
  const settings=await getAiSettings(env,scope.userId);
  const managed=isManagedRuntime(env)?await getManagedAiBillingSettings(env):null;
  // `eligible` only says whether paid Stripe overages can be enabled. Trial,
  // App Store and complimentary owners use the included allowance, and
  // effectiveMaximumCents plus the fallback model still cap every owner's spend.
  if(managed&&!managed.available)throw new Error(managed.ineligibleReason||"Managed AI is unavailable");
  const route=settings.defaults.chat;
  const modelName=scope.selectedModel?providerModel(scope.selectedModel.providerId,scope.selectedModel.model):managed?.defaultModel||providerModel(route.providerId,route.model);
  if(managed){await assertManagedCostsReconciled(env,scope.userId,true);resolveManagedModel(managed,modelName);}
  const gateway=await getAiGatewayRuntimeConfig(env,scope.userId);
  if(!env.AI)throw new Error("Cloudflare AI binding is not configured");
  const metadata={me3_runtime:"agent",me3_turn_id:scope.turnId,me3_request_id:scope.requestId,me3_thread_id:scope.threadId};
  const imageScope={ownerId:scope.userId,threadId:scope.threadId};
  let usageIndex=0;
  let firstAdmission: (()=>void)|undefined;
  const plannerAdmitted = new Promise<void>(resolve=>{firstAdmission=resolve;});
  const admitModel=async(selected:string,reportCount=0,purpose?:ModelPurpose,shadow=false)=>{
    const usageId=`${scope.turnId}:model:${crypto.randomUUID()}:${usageIndex++}`;
    const callMetadata={...metadata,...(purpose?{purpose:purpose.purpose}:{}),...(purpose?.shadow?{shadowRequest:purpose.shadow}:{})};
    const receiptMetadata={...callMetadata,billingManaged:Boolean(managed),modelAuthor:selected.replace(/^@cf\//,"").split("/")[0]};
    const billingFeeRate=managed&&!selected.startsWith("@cf/")?0.05:0;
    // An interrupted or unpriced paid request must remain visibly unreconciled.
    // Planner calls ignore shadow receipts from every turn, so a late or unpriced
    // shadow can only stop later shadows, never the owner's own turns.
    const admitted=await env.DB.prepare(`INSERT INTO ai_usage_events(id,user_id,kind,provider,model,tokens_in,tokens_out,estimated_cost_usd,metadata_json)
      SELECT ?,?,'text','workers-ai',?,0,0,0,? WHERE ?=0 OR (NOT EXISTS(
        SELECT 1 FROM ai_usage_events WHERE user_id=? AND created_at >= datetime('now','start of month')
        AND json_extract(metadata_json,'$.me3_runtime')='agent'
        AND json_extract(metadata_json,'$.billingManaged')=1
        AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NULL
        AND NOT (coalesce(json_extract(metadata_json,'$.purpose'),'')='fast_path'
          AND (?=0 OR coalesce(json_extract(metadata_json,'$.me3_turn_id'),'')=?))
        AND NOT (?=1 AND coalesce(json_extract(metadata_json,'$.me3_turn_id'),'')=?)
      ) AND ?=(SELECT COUNT(*) FROM ai_usage_events WHERE user_id=?
        AND created_at >= datetime('now','start of month')
        AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL
        AND NOT (coalesce(json_extract(metadata_json,'$.purpose'),'')='fast_path'
          AND (?=0 OR coalesce(json_extract(metadata_json,'$.me3_turn_id'),'')=?))
      ))`).bind(usageId,scope.userId,selected,JSON.stringify({...receiptMetadata,billingFeeRate,baseCostUsd:null,costKnown:false,usageReported:false}),managed?1:0,scope.userId,shadow?1:0,scope.turnId,shadow?1:0,scope.turnId,reportCount,scope.userId,shadow?1:0,scope.turnId).run();
    if(managed&&!admitted.meta.changes){
      if(!shadow)await assertManagedCostsReconciled(env,scope.userId,true);
      throw new Error("Managed AI budget policy changed before model admission; retry this turn");
    }
    purpose?.onAdmission?.(usageId);
    if(!purpose){firstAdmission?.();firstAdmission=undefined;}
    return Object.assign(async(usage:AgentUsage,measurement?:AgentFastPathRequestMeasurement)=>{
      const tokensKnown=!(purpose?.purpose==="fast_path"&&usage.estimatedCostUsd===null)&&[usage.inputTokens,usage.outputTokens,usage.cachedInputTokens,usage.cacheWriteInputTokens??0].every(value=>typeof value==="number"&&Number.isFinite(value)&&value>=0);
      const baseCostUsd=usage.estimatedCostUsd;
      const billedCostUsd=baseCostUsd===null?null:baseCostUsd*(1+billingFeeRate);
      const costKnown=tokensKnown&&billedCostUsd!==null&&Number.isFinite(billedCostUsd)&&billedCostUsd>=0;
      await env.DB.prepare("UPDATE ai_usage_events SET tokens_in=?,tokens_out=?,estimated_cost_usd=?,metadata_json=? WHERE id=?")
        .bind(tokensKnown?usage.inputTokens:0,tokensKnown?usage.outputTokens:0,costKnown?billedCostUsd:0,JSON.stringify({...receiptMetadata,...(measurement?{shadowRequest:{...purpose?.shadow,...measurement}}:{}),billingFeeRate,baseCostUsd:costKnown?baseCostUsd:null,cachedInputTokens:tokensKnown?usage.cachedInputTokens:0,cacheWriteInputTokens:tokensKnown?(usage.cacheWriteInputTokens??0):0,costKnown,usageReported:tokensKnown}),usageId).run();
    },{usageId});
  };
  const cloudflareModel=(selected:string,reportCount=0,purpose?:ModelPurpose):AgentModel=>({id:selected,async step(step){
    step.signal.throwIfAborted();
    if(step.messages.some(message=>message.images?.length)&&!bindingModelSupportsImageInput(selected))throw new Error("This model cannot read images. Choose an image-input model for this turn.");
    const messages=await resolveAgentImageInputs(env,imageScope,step.messages,step.signal);
    step.signal.throwIfAborted();
    const recordUsage=await admitModel(selected,reportCount,purpose);
    const response=await createCloudflareModel({ai:env.AI as never,model:selected,gatewayId:gateway.gatewayId||env.CLOUDFLARE_AI_GATEWAY_ID||"default",metadata:{...metadata,...(purpose?{purpose:purpose.purpose}:{})},recordUsage}).step({...step,messages});
    return {...response,billingUsageId:recordUsage.usageId};
  }});
  let allowanceFallbackUsed=false;
  const modelFor=(requested:string,purpose?:ModelPurpose):AgentModel=>{
    if(!managed)return cloudflareModel(canonicalNativeModel(requested),0,purpose);
    const model:AgentModel={id:resolveManagedModel(managed,requested),async step(step){
      await assertManagedCostsReconciled(env,scope.userId,false);
      await syncManagedAiUsage(env,{deferFastPathTurnId:scope.turnId});
      const reportCount=await managedUsageReportCount(env,scope.userId,scope.turnId,true);
      const policy=await getManagedAiBillingSettings(env,{syncUsage:false});
      model.id=resolveManagedModel(policy,requested);
      // Haiku also answers routed chat turns; only a budget switch counts here.
      if(managedModelId(model.id)===managedModelId(MANAGED_AI_FALLBACK_MODEL)&&managedModelId(requested)!==managedModelId(model.id))allowanceFallbackUsed=true;
      await assertManagedCostsReconciled(env,scope.userId,true);
      step.signal.throwIfAborted();
      return cloudflareModel(model.id,reportCount,purpose).step(step);
    }};
    return model;
  };
  const model=modelFor(modelName);
  const backupName=env.ME3_AI_CHAT_BACKUP_MODEL;
  const backup=backupName&&(!managed||managed.models.some(model=>managedModelId(model.id)===managedModelId(backupName)))?modelFor(backupName):undefined;
  return {managed,modelName,gateway,metadata,admitModel,plannerAdmitted,modelFor,model,backup,allowanceFallbackUsed:()=>allowanceFallbackUsed};
}

async function persistNewAgentResult(env:Env,input:NewAgentDispatchInput,result:AgentTurnResult,onEvent?: (event:string,data:Record<string,unknown>,seq:number)=>void,allowanceNotice:ManagedAllowanceNotice|null=null) {
  const targetPresentation=result.targetPresentation||input.targetSelection?await loadAgentTargetPresentation(env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId}):null;
  const imageAction=await loadAgentGeneratedImageAction(env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId});
  const emailDraft=await loadAgentEmailDraft(env,{ownerId:input.userId,turnId:input.turnId});
  const messageId=`${input.turnId}:assistant:${result.status}:${result.approvalId||"final"}`;
  const payload={ok:result.status==="complete"||result.status==="needs_approval",auditId:input.turnId,turnId:input.turnId,threadId:input.threadId,specialist:"core.agent",runtime:"agent",replyText:result.replyText,model:result.trace.model,source:"workers-ai-gateway",mode:input.mode||"default",status:result.status,approvalId:result.approvalId||null,trace:result.trace,streamMetrics:{timeToFirstTokenMs:result.trace.timeToFirstTokenMs,totalDurationMs:result.trace.totalDurationMs,modelRequestCount:result.modelRequestCount,toolCallCount:result.toolCalls.length},...(imageAction?{imageAction}:{}),...(targetPresentation?{targetPresentation}:{}),...(allowanceNotice?{allowanceNotice}:{}),...(emailDraft?{emailDraft}:{}),...(result.status==="failed"?{error:result.replyText}:{})};
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'assistant',?,?)").bind(messageId,input.userId,input.threadId,result.replyText,JSON.stringify(payload)),
    env.DB.prepare("UPDATE me3_agent_turns SET response_json=?,trace_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND turn_id=?").bind(JSON.stringify(payload),JSON.stringify(result.trace),input.userId,input.turnId),
    env.DB.prepare("UPDATE assistant_threads SET updated_at=CURRENT_TIMESTAMP,last_message_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.threadId,input.userId),
    env.DB.prepare(`INSERT INTO agent_turn_results(user_id,request_id,turn_id,response_json) VALUES(?,?,?,?) ON CONFLICT(user_id,request_id) DO UPDATE SET response_json=excluded.response_json,updated_at=CURRENT_TIMESTAMP`).bind(input.userId,input.requestId,input.turnId,JSON.stringify(payload)),
    ...(imageAction?.assets||[]).map(asset=>env.DB.prepare(`INSERT OR IGNORE INTO assistant_message_assets(id,owner_id,thread_id,message_id,attachment_id,role,metadata_json)
      SELECT ?,?,?,?,?, 'generated_output',? WHERE EXISTS(SELECT 1 FROM assistant_attachments WHERE id=? AND owner_id=? AND thread_id=? AND status='ready' AND kind='image')`)
      .bind(`${messageId}:image:${asset.attachmentId}`,input.userId,input.threadId,messageId,asset.attachmentId,JSON.stringify(asset),asset.attachmentId,input.userId,input.threadId)),
  ]);
  await notifyAgentTurnFinished(env,input.userId,input.turnId);
  const visiblePayload=await revalidateAgentTargetPayload(env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId},await revalidateAgentImagePayload(env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId},payload));
  const event=result.status==="failed"?"error":"done";
  const seq=await appendAgentStreamEvent(env.DB,input.userId,input.turnId,event,visiblePayload);
  onEvent?.(event,visiblePayload,seq);
  return visiblePayload;
}

async function newAgentServices(env:Env,ownerId:string,computerHost?:ComputerJobHost):Promise<AgentDomainServices> {
  return {
    // Hidden unless the installation has Browser Run and the turn runs in the owner's agent instance.
    computer:computerHost&&computerAvailability(env).available?createComputerChatServices(env,ownerId,computerHost):undefined,
    quotes: { save: (input, options) => saveOwnerQuote(env, ownerId, input, "agent", options?.signal, options?.authorization) },
    scheduling:createStableAgentSchedulingServices(env,ownerId),
    mailbox:createAgentMailboxServices(env,ownerId),
    images:createAgentImageGenerationServices(env,ownerId),
    payments:createAgentPaymentServices(env,ownerId),
    people:createPeopleSearchToolServices(env,ownerId) as unknown as AgentDomainServices["people"],
    web:createWebResearchToolServices(env,ownerId),landingPageEnv:env as never,
  };
}
function isToolAvailable(name:string,services:AgentDomainServices):boolean {
  if(name==="core_quotes_save")return Boolean(services.quotes);
  if(name==="core_images_generate")return Boolean(services.images);
  if(name.startsWith("core_mailbox_"))return Boolean(services.mailbox);
  if(name.startsWith("core_payments_"))return Boolean(services.payments);
  if(name.startsWith("core_computer_"))return Boolean(services.computer);
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
async function managedUsageReportCount(env:Env,ownerId:string,shadowTurnId:string,planner=false):Promise<number> {
  const row=await env.DB.prepare(`SELECT COUNT(*) AS count FROM ai_usage_events WHERE user_id=?
    AND created_at >= datetime('now','start of month')
    AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL
    AND NOT (coalesce(json_extract(metadata_json,'$.purpose'),'')='fast_path'
      AND (?=1 OR coalesce(json_extract(metadata_json,'$.me3_turn_id'),'')=?))`).bind(ownerId,planner?1:0,shadowTurnId).first<{count:number}>();
  return row?.count??0;
}
// Only planner admission uses this gate; shadow receipts never block it.
async function assertManagedCostsReconciled(env:Env,ownerId:string,requireReported=false):Promise<void> {
  const pending=await env.DB.prepare(`SELECT json_extract(metadata_json,'$.costKnown') AS costKnown FROM ai_usage_events WHERE user_id=?
    AND created_at >= datetime('now','start of month')
    AND json_extract(metadata_json,'$.me3_runtime')='agent'
    AND json_extract(metadata_json,'$.billingManaged')=1
    AND coalesce(json_extract(metadata_json,'$.purpose'),'')<>'fast_path'
    AND ${requireReported?"json_extract(metadata_json,'$.managedBillingReportedAt') IS NULL":"json_extract(metadata_json,'$.costKnown')=0"} LIMIT 1`).bind(ownerId).first<{costKnown:number}>();
  if(pending)throw new Error(`Managed AI ${pending.costKnown===0?"cost":"usage"} is awaiting reconciliation before another model call`);
}
function resolveManagedModel(policy:ManagedAiBillingSettings,requested:string):string {
  if(!policy.available)throw new Error(policy.ineligibleReason||"Managed AI is unavailable");
  if(!policy.models.some(model=>managedModelId(model.id)===managedModelId(requested)))throw new Error("Selected model is not permitted by this installation's managed policy");
  if(policy.fallbackActive||policy.currentMonthUsageMicrousd>=policy.effectiveMaximumCents*10_000)return MANAGED_AI_FALLBACK_MODEL;
  return canonicalNativeModel(requested);
}
export function bindingModelSupportsImageInput(model:string):boolean {
  if(modelSupportsImageInput("workers-ai",model))return true;
  if(model.startsWith("openai/"))return modelSupportsImageInput("openai",model.slice("openai/".length));
  if(model.startsWith("anthropic/"))return modelSupportsImageInput("anthropic",model.slice("anthropic/".length));
  return false;
}
