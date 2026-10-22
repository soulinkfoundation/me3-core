import { AGENT_CONTEXT_LIMITS, appendAgentStreamEvent, buildAgentSystemPrompt, coalesceAgentStreamEvents, createCloudflareModel, isModelRequestRejected, createIntentVerifierFromModel, createD1TurnStore, runAgentTurn, type AgentToolContext, type AgentMessage, type AgentModel, type AgentTurnResult, type AgentUsage } from "../../../packages/agent/src";
import { createCodingAgentServices } from "./coding-agent";
import { createDomainTools, type AgentDomainServices } from "../../../packages/agent/src/tools";
import { TOOL_LOADER_NAME } from "../../../packages/agent/src/tool-groups";
import { saveOwnerQuote } from "./quotes";
import { createAgentHomeCardServices } from "./home-cards";
import { createAgentPaymentServices } from "./agent-payments";
import { createAgentNetworkPaymentServices } from "./agent-network-commerce";
import { computerAvailability, createComputerChatServices, type ComputerJobHost } from "./agent-computer";
import { computerChatTools } from "../../../packages/agent/src/computer/tools";
import { createOwnerCreateIntentVerifier } from "./agent-owner-create-intent";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { modelSupportsImageInput, modelCapabilitiesFor } from "../../../packages/agent-chat/src/model-capabilities";
import { getAiSettings } from "./ai-providers";
import { getAiGatewayRuntimeConfig } from "./ai-gateway";
import { loadAgentEmailDraft } from "./agent-email-draft";
import { ownerFacingMemory, rememberFromTurn } from "./agent-memory";
import { suggestAgentReplies } from "./agent-suggested-replies";
import { getManagedAiBillingSettings, managedAllowanceNotice, syncManagedAiUsage, MANAGED_AI_FALLBACK_MODEL, type ManagedAiBillingSettings, type ManagedAllowanceNotice } from "./managed-ai-billing";
import { createStableAgentSchedulingServices } from "./agent-domain-scheduling";
import { createAgentMailboxServices } from "./agent-mailbox-services";
import { prepareAgentImageInputs, resolveAgentImageInputs, loadAgentAttachmentManifest, type AgentAttachmentInput } from "./agent-image-input";
import { createAgentImageGenerationServices, loadAgentGeneratedImageAction } from "./agent-image-generation";
import { revalidateAgentImagePayload } from "./agent-image-projection";
import { createPeopleSearchToolServices } from "./network-directory";
import { createWebResearchToolServices } from "./web-research";
import { draftStarterSite, publishStarterSite } from "./site-starter";
import { listCorePluginRecords } from "./plugins";
import { beginManagedRuntimeWriteLease, isManagedRuntime, releaseManagedRuntimeWriteLease } from "./managed-runtime-lifecycle";
import type { Env, OwnerProfile } from "./types";
import { loadAgentTargetPresentation, revalidateAgentTargetPayload } from "./agent-target-projection";
import { parseAgentTargetSelection } from "./agent-target-selection";
import type { AgentTargetSelection, AgentTrace } from "../../../packages/agent/src/types";
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
    const intentScope={ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId};
    const d1Store=createD1TurnStore(env.DB,intentScope);
    // The loop loads the checkpoint once more; hand it the copy loaded below instead of a second round trip.
    let loaded:Awaited<ReturnType<typeof d1Store.load>>|undefined;
    const store={...d1Store,load:async()=>{if(loaded!==undefined){const value=loaded;loaded=undefined;return value;}return d1Store.load();}};
    // Every load here is independent, so they share one round trip instead of
    // queueing before the first model call (20 Oct 2026 probe: 20 serial statements).
    const [owner,thread,plugins,models,checkpoint,recent,threadGroups,services]=await Promise.all([
      env.DB.prepare("SELECT * FROM owner_profile WHERE id=?").bind(input.userId).first<OwnerProfile>(),
      env.DB.prepare("SELECT id FROM assistant_threads WHERE id=? AND owner_id=? AND status='active'").bind(input.threadId,input.userId).first(),
      listCorePluginRecords(env),
      createAgentModels(env,input),
      d1Store.load(),
      loadAgentPlannerHistory(env.DB,intentScope,signal),
      loadThreadToolGroups(env,intentScope),
      newAgentServices(env,input.userId,computerHost),
    ]);
    if(!owner)throw new Error("Agent owner not found");
    if(!thread)throw new Error("Agent conversation is not available for this owner");
    loaded=checkpoint;
    const timezone=owner.timezone||"UTC";
    const enabledPluginIds=new Set(plugins.filter(plugin=>plugin.enabled&&plugin.status==="installed").map(plugin=>plugin.id));
    const {managed,modelName,gateway,metadata,admitModel,modelFor,model,backup,allowanceFallbackUsed}=models;
    const imageScope={ownerId:input.userId,threadId:input.threadId};
    let messages:AgentMessage[]=[];
    let ownerSnapshot:string|undefined;
    if(!checkpoint) {
      const [snapshot,images,attachments]=await Promise.all([
        loadOwnerSnapshotContext({db:env.DB,ownerId:input.userId,owner:{id:owner.id,name:owner.name,username:owner.username,timezone,assistantName:owner.assistant_name||"ME3"},meJsonUrl:null}),
        prepareAgentImageInputs(env,imageScope,input.attachments||[],signal),
        loadAgentAttachmentManifest(env,imageScope,input.attachments||[]),
      ]);
      ownerSnapshot=snapshot.prompt;
      const content=[input.messageText,input.attachmentTextContext].filter(Boolean).join("\n\n");
      messages=[{role:"system",content:buildAgentSystemPrompt({ownerName:owner.name||"the owner",timezone,ownerSnapshot:snapshot.prompt})},...recent,{role:"user",content,...(images.length?{images}:{})}];
      await env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)").bind(`${input.turnId}:user`,input.userId,input.threadId,input.messageText,JSON.stringify({requestId:input.requestId,runtime:"agent",...(attachments.length?{attachments}:{})})).run();
    }
    const tools=[...createDomainTools(),...computerChatTools()].filter(tool=>isToolAvailable(tool.name,services));
    const preloadedToolGroups=[...new Set([...threadGroups,...TOOL_GROUP_HINTS.filter(([pattern])=>pattern.test(input.messageText)).map(([,group])=>group)])];
    const intentTools=tools.filter(tool=>!tool.pluginId||enabledPluginIds.has(tool.pluginId));
    const loadIntentOwnerInputs=(references:Parameters<typeof loadTargetIntentOwnerInputs>[2],intentSignal:AbortSignal)=>
      loadTargetIntentOwnerInputs(env.DB,intentScope,references,intentSignal);
    // Independent intent checks default to the planner model; a faster verifier can be set per installation.
    const verifierName=env.ME3_AGENT_VERIFIER_MODEL?.trim()||modelName;
    const verifyTargetIntent=createTargetIntentVerifier({db:env.DB,scope:intentScope,ownerTimezone:timezone,tools:intentTools,requireReferenceEvidence:true,admit:()=>{
      let usageId:string|undefined;
      const verifier=modelFor(verifierName,{purpose:"target_intent",onAdmission:id=>{usageId=id;}});
      return {model:verifier,usageId:()=>usageId};
    }});
    // New calendar events, reminders and tasks are checked against what the owner asked (me3-ahsk.48).
    // A model checking its own create approved DeepSeek's unrequested event; Haiku blocked it and
    // allowed every requested Sol create, faster than Sol (20 Oct 2026). Managed installs offer Haiku.
    const createVerifierName=env.ME3_AGENT_CREATE_VERIFIER_MODEL?.trim()
      ||(managed?.models.some(item=>managedModelId(item.id)===managedModelId(CREATE_VERIFIER_MODEL))?CREATE_VERIFIER_MODEL:verifierName);
    const verifyCreateIntent=(evidence:Parameters<NonNullable<AgentToolContext["verifyCreateIntent"]>>[0],intentSignal:AbortSignal)=>{
      let usageId:string|undefined;
      const verifier=modelFor(createVerifierName,{purpose:"create_intent",onAdmission:id=>{usageId=id;}});
      return createIntentVerifierFromModel(verifier,()=>usageId)(evidence,intentSignal);
    };
    const verifyOwnerCreateIntent=createOwnerCreateIntentVerifier({db:env.DB,scope:{...intentScope,ownerTimezone:timezone},tools:intentTools,admit:()=>{
      let usageId:string|undefined;
      const verifier=modelFor(verifierName,{purpose:"owner_create_intent",onAdmission:id=>{usageId=id;}});
      return {model:verifier,usageId:()=>usageId};
    }});
    // The fast model answers follow-up suggestions and memory extraction after the reply.
    const fastName=env.ME3_AGENT_FAST_MODEL?.trim()||"anthropic/claude-haiku-5.5";
    const fastAllowed=!managed||managed.models.some(item=>managedModelId(item.id)===managedModelId(fastName));
    // Model text is forwarded in ~100ms batches so the phone is not paced by one D1 write per token.
    const stream=coalesceAgentStreamEvents(async(event,data)=>{
      const seq=await appendAgentStreamEvent(env.DB,input.userId,input.turnId,event,data);
      onEvent?.(event,data,seq);
    });
    let result:AgentTurnResult;
    try {result=await runAgentTurn({model,backupModel:backup,tools,preloadedToolGroups,messages,store,contextWindow:AGENT_CONTEXT_LIMITS,context:{db:env.DB,ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId,ownerTimezone:timezone,messageText:input.messageText,targetSelection:input.targetSelection,loadIntentOwnerInputs,verifyTargetIntent,verifyOwnerCreateIntent,verifyCreateIntent,intentReadToolContracts:tools.filter(tool=>tool.effect==="read"&&!tool.endsTurn).map(({name,parameters})=>({name,parameters})),intentToolContracts:intentTools.filter(tool=>tool.target).map(({name,description,parameters,effect,approval,target})=>({name,description,parameters,effect,approval,target:{domain:target!.domain,idParameter:target!.idParameter}})),enabledPluginIds,services:services as unknown as Record<string,unknown>},signal,onEvent:stream.push});}
    finally {await stream.flush();}
    const allowanceNotice=managed&&allowanceFallbackUsed()?getManagedAiBillingSettings(env,{syncUsage:false}).then(managedAllowanceNotice):Promise.resolve(null);
    // The reply has already streamed. Follow-ups and memory finish inside the turn so their
    // usage receipts reconcile before the owner's next turn; a miss only means none this time.
    const finished=result.status==="complete"&&Boolean(result.replyText.trim())&&fastAllowed;
    const followUps=finished&&env.ME3_AGENT_SUGGESTED_REPLIES?.trim()!=="off"
      ?suggestAgentReplies(modelFor(fastName,{purpose:"suggested_replies"}),{ownerMessage:input.messageText,replyText:result.replyText},AbortSignal.any([signal,AbortSignal.timeout(8_000)])).catch(()=>[] as string[])
      :Promise.resolve([] as string[]);
    const remembered=finished&&env.ME3_AGENT_MEMORY?.trim()!=="off"
      ?rememberFromTurn(env.DB,modelFor(fastName,{purpose:"memory_extraction"}),{ownerId:input.userId,turnId:input.turnId,ownerMessage:input.messageText,replyText:result.replyText,ownerSnapshot},AbortSignal.any([signal,AbortSignal.timeout(10_000)])).catch(()=>undefined)
      :Promise.resolve(undefined);
    // At most one "Remember this?" card per reply: the most important memory held back this turn.
    const memoryReview=remembered.then(memory=>memory?.held[0]?{memoryId:memory.held[0].id,id:memory.held[0].id,body:memory.held[0].body,displayBody:ownerFacingMemory(memory.held[0].body),status:"pending" as const}:null);
    return persistNewAgentResult(env,input,result,onEvent,allowanceNotice,followUps,memoryReview);
  } finally {await releaseManagedRuntimeWriteLease(env,lease);}
}

type ModelPurpose = {purpose:"target_intent"|"owner_create_intent"|"create_intent"|"suggested_replies"|"memory_extraction";onAdmission?(id:string):void};
export type AgentModelScope = Pick<NewAgentDispatchInput,"userId"|"threadId"|"turnId"|"requestId"|"selectedModel">;

/**
 * Builds the planner model with usage receipts, managed admission and the
 * allowance fallback. Chat turns and background computer jobs share it, so a
 * job's model steps are billed and capped exactly like a turn's.
 */
export async function createAgentModels(env:Env,scope:AgentModelScope) {
  const [settings,managed,gateway]=await Promise.all([getAiSettings(env,scope.userId),isManagedRuntime(env)?getManagedAiBillingSettings(env):null,getAiGatewayRuntimeConfig(env,scope.userId)]);
  // `eligible` only says whether paid Stripe overages can be enabled. Trial,
  // App Store and complimentary owners use the included allowance, and
  // effectiveMaximumCents plus the fallback model still cap every owner's spend.
  if(managed&&!managed.available)throw new Error(managed.ineligibleReason||"Managed AI is unavailable");
  const route=settings.defaults.chat;
  const modelName=scope.selectedModel?providerModel(scope.selectedModel.providerId,scope.selectedModel.model):managed?.defaultModel||providerModel(route.providerId,route.model);
  if(managed){await assertManagedCostsReconciled(env,scope.userId,true);resolveManagedModel(managed,modelName);}
  if(!env.AI)throw new Error("Cloudflare AI binding is not configured");
  const metadata={me3_runtime:"agent",me3_turn_id:scope.turnId,me3_request_id:scope.requestId,me3_thread_id:scope.threadId};
  const imageScope={ownerId:scope.userId,threadId:scope.threadId};
  let usageIndex=0;
  const admitModel=async(selected:string,reportCount=0,purpose?:ModelPurpose)=>{
    const usageId=`${scope.turnId}:model:${crypto.randomUUID()}:${usageIndex++}`;
    const callMetadata={...metadata,...(purpose?{purpose:purpose.purpose}:{})};
    const receiptMetadata={...callMetadata,billingManaged:Boolean(managed),modelAuthor:selected.replace(/^@cf\//,"").split("/")[0]};
    const billingFeeRate=managed&&!selected.startsWith("@cf/")?0.05:0;
    // An interrupted or unpriced paid request must remain visibly unreconciled.
    // Receipts left by the removed Clef routing pilot (purpose fast_path) never gate the planner.
    const admitted=await env.DB.prepare(`INSERT INTO ai_usage_events(id,user_id,kind,provider,model,tokens_in,tokens_out,estimated_cost_usd,metadata_json)
      SELECT ?,?,'text','workers-ai',?,0,0,0,? WHERE ?=0 OR (NOT EXISTS(
        SELECT 1 FROM ai_usage_events WHERE user_id=? AND created_at >= datetime('now','start of month')
        AND json_extract(metadata_json,'$.me3_runtime')='agent'
        AND json_extract(metadata_json,'$.billingManaged')=1
        AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NULL
        AND coalesce(json_extract(metadata_json,'$.purpose'),'')<>'fast_path'
      ) AND ?=(SELECT COUNT(*) FROM ai_usage_events WHERE user_id=?
        AND created_at >= datetime('now','start of month')
        AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL
        AND coalesce(json_extract(metadata_json,'$.purpose'),'')<>'fast_path'
      ))`).bind(usageId,scope.userId,selected,JSON.stringify({...receiptMetadata,billingFeeRate,baseCostUsd:null,costKnown:false,usageReported:false}),managed?1:0,scope.userId,reportCount,scope.userId).run();
    if(managed&&!admitted.meta.changes){
      await assertManagedCostsReconciled(env,scope.userId,true);
      throw new Error("Managed AI budget policy changed before model admission; retry this turn");
    }
    purpose?.onAdmission?.(usageId);
    // The provider refused before generating, so nothing was billed: close the receipt at zero so it reports
    // and cannot hold later calls. Unknown outcomes (timeouts, broken streams) stay unreconciled.
    const rejected=async(error:string)=>{
      await env.DB.prepare("UPDATE ai_usage_events SET tokens_in=0,tokens_out=0,estimated_cost_usd=0,metadata_json=? WHERE id=? AND json_extract(metadata_json,'$.costKnown')=0")
        .bind(JSON.stringify({...receiptMetadata,billingFeeRate,baseCostUsd:0,cachedInputTokens:0,cacheWriteInputTokens:0,costKnown:true,usageReported:true,rejectedBeforeGeneration:true,failure:error.slice(0,200)}),usageId).run();
    };
    return Object.assign(async(usage:AgentUsage)=>{
      const tokensKnown=[usage.inputTokens,usage.outputTokens,usage.cachedInputTokens,usage.cacheWriteInputTokens??0].every(value=>typeof value==="number"&&Number.isFinite(value)&&value>=0);
      const baseCostUsd=usage.estimatedCostUsd;
      const billedCostUsd=baseCostUsd===null?null:baseCostUsd*(1+billingFeeRate);
      const costKnown=tokensKnown&&billedCostUsd!==null&&Number.isFinite(billedCostUsd)&&billedCostUsd>=0;
      await env.DB.prepare("UPDATE ai_usage_events SET tokens_in=?,tokens_out=?,estimated_cost_usd=?,metadata_json=? WHERE id=?")
        .bind(tokensKnown?usage.inputTokens:0,tokensKnown?usage.outputTokens:0,costKnown?billedCostUsd:0,JSON.stringify({...receiptMetadata,billingFeeRate,baseCostUsd:costKnown?baseCostUsd:null,cachedInputTokens:tokensKnown?usage.cachedInputTokens:0,cacheWriteInputTokens:tokensKnown?(usage.cacheWriteInputTokens??0):0,costKnown,usageReported:tokensKnown}),usageId).run();
    },{usageId,rejected});
  };
  const gatewayId=gateway.gatewayId||env.CLOUDFLARE_AI_GATEWAY_ID||"default";
  // Claude pays from the installation's stored Anthropic key first. Managed
  // usage is still metered at catalog price; only the payer changes.
  const byokAlias=env.ANTHROPIC_BYOK_ALIAS?.trim(),byokToken=env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim()||gateway.apiToken;
  const byokBaseUrl=byokAlias&&byokToken?await anthropicGatewayUrl(env,gateway.accountId,gatewayId):null;
  const anthropicByok=byokAlias&&byokToken&&byokBaseUrl?{baseUrl:byokBaseUrl,token:byokToken,alias:byokAlias}:undefined;
  const cloudflareModel=(selected:string,reportCount=0,purpose?:ModelPurpose):AgentModel=>({id:selected,async step(step){
    step.signal.throwIfAborted();
    if(step.messages.some(message=>message.images?.length)&&!bindingModelSupportsImageInput(selected))throw new Error("This model cannot read images. Choose an image-input model for this turn.");
    const messages=await resolveAgentImageInputs(env,imageScope,step.messages,step.signal);
    step.signal.throwIfAborted();
    const recordUsage=await admitModel(selected,reportCount,purpose);
    let response;
    try {
      response=await createCloudflareModel({ai:env.AI as never,model:selected,gatewayId,anthropicByok,metadata:{...metadata,...(purpose?{purpose:purpose.purpose}:{})},recordUsage}).step({...step,messages});
    } catch(error) {
      if(isModelRequestRejected(error))await recordUsage.rejected(error.message);
      throw error;
    }
    return {...response,billingUsageId:recordUsage.usageId};
  }});
  let allowanceFallbackUsed=false;
  const modelFor=(requested:string,purpose?:ModelPurpose):AgentModel=>{
    if(!managed)return cloudflareModel(canonicalNativeModel(requested),0,purpose);
    const model:AgentModel={id:resolveManagedModel(managed,requested),async step(step){
      // The bridge answers a usage report with the current policy, so a step that
      // reported the previous step's receipt skips the separate policy fetch.
      const [,synced]=await Promise.all([assertManagedCostsReconciled(env,scope.userId,false),syncManagedAiUsage(env)]);
      const [reportCount,policy]=await Promise.all([managedUsageReportCount(env,scope.userId),synced??getManagedAiBillingSettings(env,{syncUsage:false})]);
      model.id=resolveManagedModel(policy,requested);
      // Only a budget switch to the fallback model counts here.
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
  return {managed,modelName,gateway,metadata,admitModel,modelFor,model,backup,allowanceFallbackUsed:()=>allowanceFallbackUsed};
}

async function persistNewAgentResult(env:Env,input:NewAgentDispatchInput,result:AgentTurnResult,onEvent?: (event:string,data:Record<string,unknown>,seq:number)=>void,allowanceNotice:Promise<ManagedAllowanceNotice|null>=Promise.resolve(null),followUps:Promise<string[]>=Promise.resolve([]),memoryReview:Promise<{memoryId:string;id:string;body:string;displayBody:string;status:"pending"}|null>=Promise.resolve(null)) {
  const scope={ownerId:input.userId,threadId:input.threadId,turnId:input.turnId};
  // The record loads overlap the follow-up and memory model calls rather than waiting behind them.
  const [targetPresentation,imageAction,emailDraft,notice,suggestedReplies,memory]=await Promise.all([
    result.targetPresentation||input.targetSelection?loadAgentTargetPresentation(env,scope):null,
    loadAgentGeneratedImageAction(env,scope),
    loadAgentEmailDraft(env,{ownerId:input.userId,turnId:input.turnId}),
    allowanceNotice,followUps,memoryReview,
  ]);
  const messageId=`${input.turnId}:assistant:${result.status}:${result.approvalId||"final"}`;
  const payload={ok:result.status==="complete"||result.status==="needs_approval",auditId:input.turnId,turnId:input.turnId,threadId:input.threadId,specialist:"core.agent",runtime:"agent",replyText:result.replyText,model:result.trace.model,source:"workers-ai-gateway",mode:input.mode||"default",status:result.status,approvalId:result.approvalId||null,trace:result.trace,streamMetrics:{timeToFirstTokenMs:result.trace.timeToFirstTokenMs,totalDurationMs:result.trace.totalDurationMs,modelRequestCount:result.modelRequestCount,toolCallCount:result.toolCalls.length},...(imageAction?{imageAction}:{}),...(targetPresentation?{targetPresentation}:{}),...(notice?{allowanceNotice:notice}:{}),...(emailDraft?{emailDraft}:{}),...(suggestedReplies.length?{suggestedReplies}:{}),...(memory?{memoryReview:memory}:{}),...(result.status==="failed"?{error:result.replyText}:{})};
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

export function parkedFeaturesOn(env:Pick<Env,"ME3_PARKED_FEATURES">):boolean {return env.ME3_PARKED_FEATURES?.trim().toLowerCase()==="on";}
async function newAgentServices(env:Env,ownerId:string,computerHost?:ComputerJobHost):Promise<AgentDomainServices> {
  return {
    // Hidden unless the installation has Browser Run and the turn runs in the owner's agent instance.
    computer:computerHost&&computerAvailability(env).available?createComputerChatServices(env,ownerId,computerHost):undefined,
    quotes: { save: (input, options) => saveOwnerQuote(env, ownerId, input, "agent", options?.signal, options?.authorization) },
    scheduling:createStableAgentSchedulingServices(env,ownerId),
    mailbox:createAgentMailboxServices(env,ownerId),
    images:createAgentImageGenerationServices(env,ownerId),
    payments:parkedFeaturesOn(env)?{...createAgentPaymentServices(env,ownerId),...createAgentNetworkPaymentServices(env,ownerId)}:undefined,
    people:createPeopleSearchToolServices(env,ownerId) as unknown as AgentDomainServices["people"],
    web:createWebResearchToolServices(env,ownerId),landingPageEnv:env as never,
    sites:{draft:input=>draftStarterSite(env,ownerId,input),publish:()=>publishStarterSite(env,ownerId)},
    // Parked after the first release (me3-5u97.6): tools hide until ME3_PARKED_FEATURES is "on".
    cards:parkedFeaturesOn(env)?createAgentHomeCardServices(env,ownerId):undefined,
    coding:await createCodingAgentServices(env),
  };
}
export function isToolAvailable(name:string,services:AgentDomainServices):boolean {
  if(name==="core_quotes_save")return Boolean(services.quotes);
  if(name==="core_images_generate")return Boolean(services.images);
  if(name.startsWith("core_mailbox_"))return Boolean(services.mailbox);
  if(name.startsWith("core_payments_"))return Boolean(services.payments);
  if(name.startsWith("core_computer_"))return Boolean(services.computer);
  if(name==="core_scheduling_request_read")return Boolean(services.scheduling?.getRequest);
  if(name==="core_scheduling_request")return Boolean(services.scheduling?.request);
  if(name==="core_scheduling_request_profile")return Boolean(services.scheduling?.requestNetwork);
  if(name==="core_scheduling_book_free_call")return Boolean(services.scheduling?.planFreeCall&&services.scheduling?.bookFreeCall);
  if(name.startsWith("core_cards_"))return Boolean(services.cards);
  if(name.startsWith("core_coding_"))return Boolean(services.coding);
  if(name==="core_scheduling_approve")return Boolean(services.scheduling?.approve);
  if(name==="core_scheduling_decline")return Boolean(services.scheduling?.decline);
  return true;
}
// Deferred tool groups this conversation already loaded stay visible on later
// turns, and the first-run site build (the web app's "Build me a landing page
// site for" starter) starts with the sites group, so neither pays a loader step.
const THREAD_TOOL_GROUP_TURNS=8;
const TOOL_GROUP_HINTS:Array<[RegExp,string]>=[[/\b(?:landing page|web ?site|web ?page|home ?page|my site)\b/i,"sites"]];
async function loadThreadToolGroups(env:Env,scope:{ownerId:string;threadId:string;turnId:string}):Promise<string[]> {
  const rows=await env.DB.prepare("SELECT trace_json FROM me3_agent_turns WHERE owner_id=? AND thread_id=? AND turn_id<>? AND trace_json IS NOT NULL ORDER BY updated_at DESC LIMIT ?").bind(scope.ownerId,scope.threadId,scope.turnId,THREAD_TOOL_GROUP_TURNS).all<{trace_json:string}>();
  const groups=new Set<string>();
  for(const row of rows.results||[]) {
    let trace:AgentTrace;
    try {trace=JSON.parse(row.trace_json) as AgentTrace;} catch {continue;}
    for(const group of trace.toolGroups??[])groups.add(group);
    for(const step of trace.modelSteps??[])for(const call of step.toolCalls)if(call.name===TOOL_LOADER_NAME&&Array.isArray(call.arguments.groups))for(const group of call.arguments.groups)groups.add(String(group));
  }
  return [...groups];
}
// Managed Workers carry no account id, so the AI binding names the gateway URL.
async function anthropicGatewayUrl(env:Env,accountId:string|null,gatewayId:string):Promise<string|null> {
  if(accountId)return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/anthropic`;
  try {return (await (env.AI as unknown as {gateway(id:string):{getUrl(provider:string):Promise<string>}}).gateway(gatewayId).getUrl("anthropic")).replace(/\/$/,"");}
  catch {return null;}
}
function providerModel(provider:string,model:string):string {return provider==="workers-ai"?canonicalNativeModel(model):model.startsWith(`${provider}/`)?model:`${provider}/${model}`;}
const CREATE_VERIFIER_MODEL="anthropic/claude-haiku-5.5";
function managedModelId(model:string):string {return model.replace(/^@cf\//,"");}
function canonicalNativeModel(model:string):string {
  const nativeModel=`@cf/${managedModelId(model)}`;
  return modelCapabilitiesFor("workers-ai",nativeModel).includes("text")?nativeModel:model;
}
async function managedUsageReportCount(env:Env,ownerId:string):Promise<number> {
  const row=await env.DB.prepare(`SELECT COUNT(*) AS count FROM ai_usage_events WHERE user_id=?
    AND created_at >= datetime('now','start of month')
    AND json_extract(metadata_json,'$.managedBillingReportedAt') IS NOT NULL
    AND coalesce(json_extract(metadata_json,'$.purpose'),'')<>'fast_path'`).bind(ownerId).first<{count:number}>();
  return row?.count??0;
}
// Receipts from the removed Clef routing pilot (purpose fast_path) never block this gate.
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
