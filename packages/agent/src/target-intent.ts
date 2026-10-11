import type { AgentToolCall } from "./types";
import type { AgentTargetIntentContext, AgentTargetIntentEvidence, AgentTargetIntentCandidate, AgentTargetIntentPresentation, AgentTargetIntentOwnerInput, AgentTargetIntentVerdict, AgentTargetIntentInference, AgentTargetIntentAction, AgentTargetIntentAuthorizedAction, AgentTargetIntentSourceRead } from "./types";
type IntentRecord = {verdict?:AgentTargetIntentVerdict;inference?:AgentTargetIntentInference;authorizedActionKey?:string;authorizedActions?:AgentTargetIntentAuthorizedAction[];uncertain?:boolean};
type SelectionRow = {id:string;domain:string;read_turn_id:string;candidates_json:string;seq:number|null};
type SelectionGroup = SelectionRow & {candidates:Array<{id:string;snapshot:Record<string,unknown>&{id:string}}>};
type EvidenceScope = {selectionId?:string;domain?:string;recordId?:string};
import { canonicalJson, toolIdempotencyKey, validateArguments } from './schema';
import { isAgentCancellationRequested } from './store';
import { loadTargetPresentation } from './presentations';
// Independent intent is reconstructed outside the planner, then bound to an exact effect.
const INTERNAL_TOOL = '__me3_target_intent_v1';
const verdictBase = { type:'object', additionalProperties:false };
const actionProperties = {selectedCandidateId:{type:'string',minLength:1},authorizedCall:{...verdictBase,required:['name','arguments'],properties:{name:{type:'string',minLength:1},arguments:{type:'object'}}}};
const verdictSchema = { anyOf:[
  { ...verdictBase, required:['decision','selectedCandidateId','authorizedCall'], properties:{ decision:{enum:['allow']}, ...actionProperties } },
  { ...verdictBase, required:['decision','actions'], properties:{decision:{enum:['allow']},actions:{type:'array',minItems:1,maxItems:8,items:{...verdictBase,required:['selectedCandidateId','authorizedCall'],properties:actionProperties}}} },
  { ...verdictBase, required:['decision','reason'], properties:{decision:{enum:['deny','clarify']},reason:{type:'string',minLength:1,maxLength:1000}} }
] };
export class TargetIntentMismatch extends Error { constructor(message:string,public data:unknown) { super(message); this.data=data; } }
export class TargetIntentOrderMismatch extends TargetIntentMismatch {}
export function targetIntentActions(verdict:Extract<AgentTargetIntentVerdict,{decision:'allow'}>):AgentTargetIntentAction[] {
  return 'actions' in verdict ? verdict.actions : [{selectedCandidateId:verdict.selectedCandidateId,authorizedCall:verdict.authorizedCall}];
}
export function connectedTargetIntentSources(groups:readonly {selectionId:string;domain:string;readTurnId:string;candidateIds:readonly string[]}[],domain:string,anchorIds:readonly string[]) {
  const ids=new Set(anchorIds);
  const relevant=groups.filter(group=>group.domain===domain);
  let previous;
  do {previous=ids.size;for(const group of relevant)if(group.candidateIds.some(id=>ids.has(id)))group.candidateIds.forEach(id=>ids.add(id));} while(previous!==ids.size);
  const sourceReads=relevant.filter(group=>group.candidateIds.some(id=>ids.has(id))).map(({selectionId,domain,readTurnId})=>({selectionId,domain,readTurnId})).sort((a,b)=>a.selectionId.localeCompare(b.selectionId));
  return {candidateIds:[...ids].sort(),sourceReads};
}
async function active(c:AgentTargetIntentContext) { c.signal.throwIfAborted(); if(await isAgentCancellationRequested(c.db,c.ownerId,c.requestId)) throw Error('Owner cancelled before effect admission.'); c.signal.throwIfAborted(); }
async function shownPresentation(c:AgentTargetIntentContext):Promise<AgentTargetIntentPresentation|undefined> {
  const row=await c.db.prepare('SELECT id FROM me3_agent_presentations WHERE owner_id=? AND thread_id=? ORDER BY ordinal DESC LIMIT 1').bind(c.ownerId,c.threadId).first<{id:string}>();
  if(!row)return undefined;
  const p=await loadTargetPresentation(c.db,{ownerId:c.ownerId,threadId:c.threadId,presentationId:row.id});
  if(!p || p.status!=='pending')return undefined;
  const origin=await c.db.prepare('SELECT status,checkpoint_json,response_json FROM me3_agent_turns WHERE owner_id=? AND thread_id=? AND turn_id=?').bind(c.ownerId,c.threadId,p.createdTurnId).first<{status:string;checkpoint_json:string|null;response_json:string|null}>();
  if(origin?.status!=='complete' || ![origin.checkpoint_json,origin.response_json].filter((value):value is string=>Boolean(value)).some(value=>JSON.parse(value).targetPresentation?.id===p.id))return undefined;
  return {id:p.id,ordinal:p.ordinal,createdTurnId:p.createdTurnId,selectionId:p.selectionId,domain:p.domain,action:{name:p.toolName,arguments:p.arguments},candidates:p.candidates.map(({id,option,snapshot})=>({id,option,snapshot:snapshot as Record<string,unknown>&{id:string}}))};
}
async function ownerInputs(c:AgentTargetIntentContext,targets:AgentTargetIntentEvidence["targets"],presentation?:AgentTargetIntentPresentation,sourceReads?:AgentTargetIntentSourceRead[]):Promise<AgentTargetIntentOwnerInput[]> {
  if(sourceReads!==undefined) {
    if(!Array.isArray(sourceReads)||sourceReads.length>64||new Set(sourceReads.map(read=>read.selectionId)).size!==sourceReads.length)throw Error('Invalid retained source-read origins.');
    for(const read of sourceReads) {
      if(Object.keys(read).some(key=>!['selectionId','domain','readTurnId'].includes(key))||![read.selectionId,read.domain,read.readTurnId].every(value=>typeof value==='string'&&value.length))throw Error('Invalid retained source-read tuple.');
      const row=await c.db.prepare('SELECT domain,read_turn_id,candidates_json FROM me3_agent_selections WHERE owner_id=? AND thread_id=? AND id=?').bind(c.ownerId,c.threadId,read.selectionId).first<{domain:string;read_turn_id:string;candidates_json:string}>();
      const panel=targets.find(panel=>panel.domain===read.domain);
      const candidates=row&&JSON.parse(row.candidates_json) as Array<{id:string}>;
      if(!row||row.domain!==read.domain||row.read_turn_id!==read.readTurnId||!panel||!Array.isArray(candidates)||!candidates.some(candidate=>panel.candidates.some(value=>value.id===candidate.id)))throw Error('Retained source-read origin changed or is unrelated.');
    }
  }
  const refs={readTurnIds:[...new Set([...targets.flatMap(panel=>panel.candidates.map(value=>value.readTurnId)),...(sourceReads||[]).map(read=>read.readTurnId)])].sort(),...(presentation?{presentationTurnId:presentation.createdTurnId}:{})};
  const inputs=c.loadIntentOwnerInputs?await c.loadIntentOwnerInputs(refs,c.signal):c.intentOwnerInputs;
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>80)throw Error('The complete necessary owner history is unavailable or too large.');
  const last=inputs.at(-1);
  if(!last||last.turnId!==c.turnId||last.requestId!==c.requestId||last.messageText!==c.messageText)throw Error('Canonical owner history differs from this request.');
  for(const input of inputs) {
    if(!input||Object.keys(input).some(key=>!['turnId','requestId','messageText'].includes(key))||![input.turnId,input.requestId,input.messageText].every(v=>typeof v==='string'&&v.length))throw Error('Invalid canonical owner input.');
    const row=await c.db.prepare(`SELECT t.input_json,t.status FROM me3_agent_turns t WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=? AND t.request_id=?
      AND EXISTS(SELECT 1 FROM assistant_messages m WHERE m.owner_id=t.owner_id AND m.thread_id=t.thread_id AND m.role='user' AND json_extract(m.metadata_json,'$.requestId')=t.request_id AND m.content=?)`).bind(c.ownerId,c.threadId,input.turnId,input.requestId,input.messageText).first<{input_json:string;status:string}>();
    const saved=row?.input_json&&JSON.parse(row.input_json);
    if(!saved||saved.userId!==c.ownerId||saved.threadId!==c.threadId||saved.messageText!==input.messageText||(input.turnId===c.turnId&&['cancelled','failed'].includes(row.status)))throw Error('Owner input lacks canonical server provenance.');
  }
  for(const turnId of [...refs.readTurnIds,refs.presentationTurnId].filter(Boolean))if(!inputs.some(input=>input.turnId===turnId))throw Error('A necessary read or presentation owner turn is absent.');
  return structuredClone(inputs);
}
async function buildEvidence(c:AgentTargetIntentContext,{selectionId,domain:sourceDomain,recordId}:EvidenceScope):Promise<AgentTargetIntentEvidence> {
  const contracts=c.intentToolContracts;
  if(!Array.isArray(contracts)||!contracts.length)throw Error('Authoritative mutation contracts are unavailable.');
  const rows=await c.db.prepare(`SELECT s.*, (SELECT MIN(e.seq) FROM me3_agent_stream_events e WHERE e.owner_id=s.owner_id AND e.turn_id=s.read_turn_id AND e.event='status') AS seq
    FROM me3_agent_selections s WHERE s.owner_id=? AND s.thread_id=? AND julianday(s.created_at)>=
      (SELECT julianday(created_at)-1 FROM me3_agent_turns WHERE owner_id=? AND thread_id=? AND turn_id=? AND request_id=?)`).bind(c.ownerId,c.threadId,c.ownerId,c.threadId,c.turnId,c.requestId).all<SelectionRow>();
  const current=await c.db.prepare("SELECT MIN(seq) AS seq FROM me3_agent_stream_events WHERE owner_id=? AND turn_id=? AND event='status'").bind(c.ownerId,c.turnId).first<{seq:number|null}>();
  if(!current?.seq)throw Error('The current canonical turn ordering is unavailable.');
  const groups:SelectionGroup[]=(rows.results||[]).filter(row=>row.seq&&row.seq<=current.seq!).map(row=>({...row,candidates:JSON.parse(row.candidates_json)}));
  if(groups.some(row=>!Array.isArray(row.candidates)))throw Error('Invalid immutable candidate group.');
  // An already-read ID locates its full evidence group; the independent judge still decides whether the owner selected it.
  // Unrelated earlier turns must not become required evidence for a fresh action.
  const anchors=groups.filter(row=>row.read_turn_id===c.turnId||row.id===selectionId||(row.domain===sourceDomain&&row.candidates.some(candidate=>candidate.id===recordId)));
  if(selectionId&&!anchors.some(row=>row.id===selectionId))throw Error('The proposed selection lacks a current scoped immutable read.');
  const presentation=await shownPresentation(c);
  const idsByDomain=new Map<string,Set<string>>();
  for(const row of anchors) { if(!contracts.some(tool=>tool.target.domain===row.domain))continue; const ids=idsByDomain.get(row.domain)||new Set(); row.candidates.forEach(candidate=>ids.add(candidate.id)); idsByDomain.set(row.domain,ids); }
  if(presentation) {
    const ids=idsByDomain.get(presentation.domain)||new Set<string>();
    presentation.candidates.forEach(candidate=>ids.add(candidate.id));
    idsByDomain.set(presentation.domain,ids);
  }
  const targets:AgentTargetIntentEvidence["targets"]=[];
  const sourceReads:AgentTargetIntentSourceRead[]=[];
  for(const [domain,ids] of [...idsByDomain].sort(([a],[b])=>a.localeCompare(b))) {
    const relevant=groups.filter(row=>row.domain===domain);
    // Preserve broader intersecting groups even when their labels differ.
    const connected=connectedTargetIntentSources(relevant.map(group=>({selectionId:group.id,domain:group.domain,readTurnId:group.read_turn_id,candidateIds:group.candidates.map(candidate=>candidate.id)})),domain,[...ids]);
    connected.candidateIds.forEach(id=>ids.add(id));
    sourceReads.push(...connected.sourceReads);
    if(ids.size>50)throw Error('The complete relevant source set is too large; use a reviewed choice.');
    const candidates:AgentTargetIntentCandidate[]=[];
    for(const id of [...ids].sort()) {
      const displayed=presentation?.domain===domain?presentation.candidates.find(candidate=>candidate.id===id):undefined;
      if(displayed&&presentation) {
        const source=relevant.find(group=>group.id===presentation.selectionId&&group.candidates.some(candidate=>candidate.id===id&&canonicalJson(candidate.snapshot)===canonicalJson(displayed.snapshot)));
        if(!source)throw Error('The displayed target lacks its original immutable source read.');
        candidates.push({id,snapshot:displayed.snapshot,selectionId:source.id,readTurnId:source.read_turn_id});
        continue;
      }
      const captured=await c.db.prepare('SELECT snapshot_json,read_turn_id FROM me3_agent_targets WHERE owner_id=? AND thread_id=? AND domain=? AND record_id=?').bind(c.ownerId,c.threadId,domain,id).first<{snapshot_json:string;read_turn_id:string}>();
      const snapshot=captured?.snapshot_json&&JSON.parse(captured.snapshot_json);
      const group=relevant.filter(row=>row.read_turn_id===captured?.read_turn_id&&row.candidates.some(candidate=>candidate.id===id&&canonicalJson(candidate.snapshot)===canonicalJson(snapshot))).sort((a,b)=>a.id.localeCompare(b.id))[0];
      if(!group||!snapshot||snapshot.id!==id)throw Error('A source needs a fresh complete immutable capture.');
      candidates.push({id,selectionId:group.id,readTurnId:group.read_turn_id,snapshot});
    }
    if(candidates.length)targets.push({domain,candidates});
  }
  if(!targets.length)throw Error('Read the source candidates before verification.');
  const domains=new Set(targets.map(panel=>panel.domain));
  const operations=contracts.filter(tool=>domains.has(tool.target.domain)).map(({target,...tool})=>({...tool,target:{domain:target.domain,idParameter:target.idParameter}})).sort((a,b)=>a.name.localeCompare(b.name));
  const inputs=await ownerInputs(c,targets,presentation,sourceReads);
  const evidence:AgentTargetIntentEvidence={version:1,ownerId:c.ownerId,threadId:c.threadId,turnId:c.turnId,requestId:c.requestId,ownerTimezone:c.ownerTimezone,ownerInputs:inputs,targets,operations,sourceReads,...(presentation?{presentation}:{})};
  if(canonicalJson(evidence).length>64000)throw Error('Complete necessary intent evidence is too large; use a reviewed choice.');
  return evidence;
}
function inferenceMetadata(value:unknown):AgentTargetIntentInference|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid server inference provenance.");
  const metadata=value as Record<string,unknown>;
  if(typeof metadata.modelId!=="string"||!metadata.modelId||Object.keys(metadata).some(key=>!["modelId","usageId","usage"].includes(key)) || metadata.usageId!==undefined&&typeof metadata.usageId!=="string")throw Error("Invalid server inference provenance.");
  if(metadata.usage!==undefined) {
    const usage=metadata.usage as Record<string,unknown>;
    const valid=usage&&typeof usage==="object"&&!Array.isArray(usage)&&["inputTokens","outputTokens","cachedInputTokens"].every(key=>Number.isSafeInteger(usage[key])&&Number(usage[key])>=0)
      &&(usage.cacheWriteInputTokens===undefined||Number.isSafeInteger(usage.cacheWriteInputTokens)&&Number(usage.cacheWriteInputTokens)>=0)
      &&Number(usage.cachedInputTokens)+Number(usage.cacheWriteInputTokens??0)<=Number(usage.inputTokens)
      &&(usage.estimatedCostUsd===null||Number.isFinite(usage.estimatedCostUsd)&&Number(usage.estimatedCostUsd)>=0);
    // A malformed counter must not erase an admitted request or become a zero-cost effect authorization.
    if(!valid)return {modelId:metadata.modelId,...(typeof metadata.usageId==="string"?{usageId:metadata.usageId}:{})};
  }
  return value as AgentTargetIntentInference;
}
function checkedVerdict(raw:unknown,evidence:AgentTargetIntentEvidence):{verdict:AgentTargetIntentVerdict;inference?:AgentTargetIntentInference} {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid independent verdict.');
  const {inference,...untypedVerdict}=raw as Record<string,unknown>;
  const verdict=untypedVerdict as AgentTargetIntentVerdict;
  const invalid=validateArguments(verdictSchema,verdict); if(invalid)throw Error(`Invalid independent verdict: ${invalid}`);
  if(verdict.decision==='allow') {
    const actions=targetIntentActions(verdict);
    if(!Array.isArray(actions)||actions.length<1||actions.length>8)throw Error('Independent action plan requires one to eight complete actions.');
    const sources=new Set<string>();
    for(const action of actions) {
      const operation=evidence.operations.find(tool=>tool.name===action.authorizedCall.name);
      const candidate=operation&&evidence.targets.find(panel=>panel.domain===operation.target.domain)?.candidates.find(candidate=>candidate.id===action.selectedCandidateId);
      if(!operation||!candidate||action.authorizedCall.arguments[operation.target.idParameter]!==candidate.id||validateArguments(operation.parameters,action.authorizedCall.arguments))throw Error('Unsupported independently authorized operation/source/arguments.');
      const source=canonicalJson([operation.target.domain,candidate.id]);
      if(sources.has(source))throw Error('Duplicate or dependent same-source actions are unsupported.');
      sources.add(source);
    }
  }
  return {verdict,...(inference!==undefined?{inference:inferenceMetadata(inference)}:{})};
}
async function observe(c:AgentTargetIntentContext,key:string,record:IntentRecord,cacheHit:boolean) { await c.onTargetIntentReceipt?.({receiptId:key,...record,cacheHit}); }
export async function verifyTargetIntent(c:AgentTargetIntentContext,scope:EvidenceScope={}):Promise<{receiptId:string;evidence:AgentTargetIntentEvidence;verdict:AgentTargetIntentVerdict;inference?:AgentTargetIntentInference;authorizedActionKey?:string;authorizedActions?:AgentTargetIntentAuthorizedAction[]}> {
  await active(c);
  if(typeof c.verifyTargetIntent!=='function')throw Error('Independent intent verification is unavailable; use a reviewed owner choice.');
  // This request's first evidence is immutable across planner correction/read attempts.
  const prior=await c.db.prepare('SELECT idempotency_key,arguments_json,status,result_json FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? AND tool_name=?').bind(c.ownerId,c.turnId,INTERNAL_TOOL).all<{idempotency_key:string;arguments_json:string;status:string;result_json:string|null}>();
  if((prior.results||[]).length>1)throw Error('Multiple independent intent histories are ambiguous.');
  let evidence:AgentTargetIntentEvidence,record:IntentRecord,key:string;
  if(prior.results?.length) {
    const row=prior.results[0]; evidence=JSON.parse(row.arguments_json); key=row.idempotency_key; record=row.result_json?JSON.parse(row.result_json):{};
    const domains=new Set(evidence.targets.map(panel=>panel.domain));
    const currentContracts=(c.intentToolContracts||[]).filter(tool=>domains.has(tool.target.domain)).map(({target,...tool})=>({...tool,target:{domain:target.domain,idParameter:target.idParameter}})).sort((a,b)=>a.name.localeCompare(b.name));
    if(canonicalJson(currentContracts)!==canonicalJson(evidence.operations))throw Error("The authoritative operation contracts changed after independent verification.");
    const currentInputs=await ownerInputs(c,evidence.targets,evidence.presentation,evidence.sourceReads);
    if(evidence.ownerId!==c.ownerId||evidence.threadId!==c.threadId||evidence.turnId!==c.turnId||evidence.requestId!==c.requestId||evidence.ownerTimezone!==c.ownerTimezone||canonicalJson(evidence.ownerInputs)!==canonicalJson(currentInputs))throw Error('The cached independent intent context changed.');
    if(canonicalJson(evidence.presentation)!==canonicalJson(await shownPresentation(c)))throw Error('The shown source action changed after verification.');
    if(row.status!=='finished'||!record.verdict) { if(record)await observe(c,key,record,true); throw Error('Independent inference has an uncertain saved outcome; do not replay or write.'); }
  } else {
    evidence=await buildEvidence(c,scope);
    key=await toolIdempotencyKey(c.ownerId,c.requestId,INTERNAL_TOOL,{evidence});
    const claim=await c.db.prepare("INSERT OR IGNORE INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,'running')").bind(c.ownerId,key,c.turnId,INTERNAL_TOOL,canonicalJson(evidence)).run();
    if(!claim.meta?.changes)throw Error('Independent intent admission raced another attempt.');
    await active(c);
    let raw;
    try { raw=await c.verifyTargetIntent(structuredClone(evidence),c.signal); }
    catch(error) {
      if(error&&typeof error==="object"&&"inference" in error) { record={inference:inferenceMetadata(error.inference),uncertain:true}; await observe(c,key,record,false); await c.db.prepare("UPDATE me3_agent_tool_receipts SET result_json=? WHERE owner_id=? AND idempotency_key=? AND status='running'").bind(canonicalJson(record),c.ownerId,key).run(); }
      throw error;
    }
    try { record=checkedVerdict(raw,evidence); }
    catch(error) { record={verdict:{decision:"deny",reason:error instanceof Error?error.message:"Invalid independent verdict"},...(raw&&typeof raw==="object"&&"inference" in raw?{inference:inferenceMetadata(raw.inference)}:{})}; }
    if(record.inference&&(!record.inference.usage||record.inference.usage.estimatedCostUsd===null))record.verdict={decision:'deny',reason:'Independent usage is incomplete; effect admission is blocked.'};
    if(c.signal.aborted||await isAgentCancellationRequested(c.db,c.ownerId,c.requestId))record.verdict={decision:'deny',reason:'Owner cancelled after verification.'};
    if(record.verdict?.decision==='allow') {
      record.authorizedActions=[];
      for(const action of targetIntentActions(record.verdict)) {
        const operation=evidence.operations.find(operation=>operation.name===action.authorizedCall.name)!;
        record.authorizedActions.push({...action,domain:operation.target.domain,actionKey:await toolIdempotencyKey(c.ownerId,c.requestId,action.authorizedCall.name,action.authorizedCall.arguments)});
      }
      if(!('actions' in record.verdict))record.authorizedActionKey=record.authorizedActions[0].actionKey;
    }
    await observe(c,key,record,false);
    const stored=await c.db.prepare("UPDATE me3_agent_tool_receipts SET status='finished',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND idempotency_key=? AND turn_id=? AND status='running'").bind(canonicalJson(record),c.ownerId,key,c.turnId).run();
    if(!stored.meta?.changes)throw Error('Independent verdict could not be durably finished.');
  }
  if(!record.verdict)throw Error("Independent verdict is incomplete.");
  checkedVerdict({...record.verdict,...(record.inference?{inference:record.inference}:{})},evidence);
  await observe(c,key,record,true); await active(c);
  return {receiptId:key,evidence,...record,verdict:record.verdict};
}
type VerifiedIntent = Awaited<ReturnType<typeof verifyTargetIntent>>;
async function authorizedActions(c:AgentTargetIntentContext,verified:VerifiedIntent) {
  if(verified.verdict.decision!=='allow')throw Error(`Owner target intent requires clarification: ${verified.verdict.reason}`);
  const actions:AgentTargetIntentAuthorizedAction[]=[];
  for(const action of targetIntentActions(verified.verdict)) {
    const operation=verified.evidence.operations.find(operation=>operation.name===action.authorizedCall.name)!;
    actions.push({...action,domain:operation.target.domain,actionKey:await toolIdempotencyKey(c.ownerId,c.requestId,action.authorizedCall.name,action.authorizedCall.arguments)});
  }
  if(verified.authorizedActions ? canonicalJson(actions)!==canonicalJson(verified.authorizedActions) : actions.length!==1||actions[0].actionKey!==verified.authorizedActionKey)throw Error('The cached authorized action keys are invalid.');
  return actions;
}
async function planProgress(c:AgentTargetIntentContext,verified:VerifiedIntent) {
  const actions=await authorizedActions(c,verified);
  const receipts=await c.db.prepare(`SELECT idempotency_key,turn_id,tool_name,arguments_json,status,result_json FROM me3_agent_tool_receipts
    WHERE owner_id=? AND idempotency_key IN (${actions.map(()=>'?').join(',')})`).bind(c.ownerId,...actions.map(action=>action.actionKey)).all<{idempotency_key:string;turn_id:string;tool_name:string;arguments_json:string;status:string;result_json:string|null}>();
  for(let index=0;index<actions.length;index++) {
    const action=actions[index];
    const row=receipts.results?.find(row=>row.idempotency_key===action.actionKey);
    if(row&&(row.turn_id!==c.turnId||row.tool_name!==action.authorizedCall.name||canonicalJson(JSON.parse(row.arguments_json))!==canonicalJson(action.authorizedCall.arguments)))throw Error('Authorized action receipt scope or arguments changed.');
    if(row?.status==='finished'&&row.result_json&&JSON.parse(row.result_json).status==='ok')continue;
    return {actions,index,row};
  }
  return {actions,index:actions.length,row:undefined};
}
// Completion reads the saved plan; it must never infer or admit another action.
export async function savedTargetIntentProgress(c:AgentTargetIntentContext) {
  const rows=await c.db.prepare('SELECT idempotency_key,arguments_json,status,result_json FROM me3_agent_tool_receipts WHERE owner_id=? AND turn_id=? AND tool_name=?')
    .bind(c.ownerId,c.turnId,INTERNAL_TOOL).all<{idempotency_key:string;arguments_json:string;status:string;result_json:string|null}>();
  if(!rows.results?.length)return undefined;
  if(rows.results.length!==1)throw Error('Independent action history is ambiguous and unfinished.');
  const row=rows.results[0],record:IntentRecord=row.result_json?JSON.parse(row.result_json):{};
  const evidence:AgentTargetIntentEvidence=JSON.parse(row.arguments_json);
  if(evidence.ownerId!==c.ownerId||evidence.threadId!==c.threadId||evidence.turnId!==c.turnId||evidence.requestId!==c.requestId
    ||row.status!=='finished'||!record.verdict||record.uncertain)throw Error('Independent verification remains unfinished or uncertain.');
  checkedVerdict({...record.verdict,...(record.inference?{inference:record.inference}:{})},evidence);
  if(record.verdict.decision!=='allow')return undefined;
  const progress=await planProgress(c,{receiptId:row.idempotency_key,evidence,...record,verdict:record.verdict});
  const next=progress.actions[progress.index];
  const declined=next&&progress.row?.status==='waiting'&&await c.db.prepare("SELECT id FROM me3_agent_approvals WHERE owner_id=? AND thread_id=? AND turn_id=? AND idempotency_key=? AND status='declined'")
    .bind(c.ownerId,c.threadId,c.turnId,next.actionKey).first();
  return {completed:progress.index,total:progress.actions.length,declined:!!declined};
}
export async function nextTargetIntentAction(c:AgentTargetIntentContext,verified:VerifiedIntent) {
  const progress=await planProgress(c,verified);
  const action=progress.actions[progress.index];
  if(progress.row&&progress.row.status!=='not_admitted')throw Error('The next authorized action has a pending, failed or uncertain native outcome. Inspect its saved receipt before continuing.');
  return action;
}
export async function preflightTargetIntent(c:AgentTargetIntentContext,domain:string,id:string,call:AgentToolCall|undefined=c.toolCall) {
  if(!call||typeof call.name!=='string')throw Error('The complete proposed operation is unavailable.');
  const verified=await verifyTargetIntent(c,{domain,recordId:id});
  const progress=await planProgress(c,verified);
  const planned=progress.actions[progress.index];
  const exact=progress.actions.findIndex(action=>canonicalJson(action.authorizedCall)===canonicalJson({name:call.name,arguments:call.arguments}));
  const hint={...(planned?{authorizedCall:planned.authorizedCall}:{}),verificationReceiptId:verified.receiptId,actionApplied:false};
  if(exact>progress.index)throw new TargetIntentOrderMismatch('Complete the earlier independently authorized action first; this later action was not admitted.',hint);
  if(!planned||exact!==progress.index)throw new TargetIntentMismatch('Correct the proposed call to the next independently authorized owner action; no effect occurred.',hint);
  const authorized=planned.authorizedCall;
  if(planned.domain!==domain||planned.selectedCandidateId!==id)throw Error('The selected operation and source domain disagree.');
  if(progress.row&&progress.row.status!=='not_admitted'&&!(progress.row.status==='running'&&c.effectReceiptClaimed===true&&c.idempotencyKey===planned.actionKey))throw Error('The exact action has a pending, failed or uncertain native outcome; do not replay it.');
  const candidate=verified.evidence.targets.find(panel=>panel.domain===domain)?.candidates.find(candidate=>candidate.id===id);
  if(!candidate)throw Error('The independently selected source is unavailable.');
  const row=await c.db.prepare('SELECT snapshot_json FROM me3_agent_targets WHERE owner_id=? AND thread_id=? AND domain=? AND record_id=?').bind(c.ownerId,c.threadId,domain,id).first<{snapshot_json:string;read_turn_id:string}>();
  if(!row||canonicalJson(JSON.parse(row.snapshot_json))!==canonicalJson(candidate.snapshot))throw Error('The reviewed source capture changed before effect admission.');
  await active(c);
  return {receiptId:verified.receiptId,expectedSnapshot:candidate.snapshot,authorizedCall:authorized};
}
