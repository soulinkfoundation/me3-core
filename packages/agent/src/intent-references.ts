import type {AgentDb,AgentMessage,AgentTargetIntentReferenceEvidence,AgentTargetIntentReadContract} from './types';
import {canonicalJson,validateArguments} from './schema';

type Scope={ownerId:string;threadId:string;turnId:string;requestId:string};
type Turn={turn_id:string;request_id:string;status:string;input_json:string;checkpoint_json:string|null;response_json:string|null;seq:number};
type Event={seq:number;turn_id:string;event:string;data_json:string};
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const object=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const exact=(value:unknown,keys:string[])=>{const x=object(value);return x&&Object.keys(x).length===keys.length&&Object.keys(x).every(key=>keys.includes(key));};

// Read/display data provides references, never owner consent or planner authority.
// Fresh inference sees the complete bounded selected inventory; cache checks only
// the exact frozen origins, allowing later planner reads without rerolling consent.
export async function loadIntentReferenceEvidence(db:AgentDb,scope:Scope,contracts:readonly AgentTargetIntentReadContract[],requiredTurnIds:readonly string[]=[],frozen?:AgentTargetIntentReferenceEvidence) {
  if(frozen&&(!exact(frozen,['reads','displays'])||!Array.isArray(frozen.reads)||!Array.isArray(frozen.displays)||frozen.reads.length>32||frozen.displays.length>8))throw Error('Invalid complete read/display reference evidence.');
  const current=await db.prepare(`SELECT t.turn_id,t.request_id,t.status,t.input_json,t.checkpoint_json,t.response_json,MIN(e.seq) AS seq
    FROM me3_agent_turns t JOIN me3_agent_stream_events e ON e.owner_id=t.owner_id AND e.turn_id=t.turn_id AND e.event='status'
    WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=? AND t.request_id=?`).bind(scope.ownerId,scope.threadId,scope.turnId,scope.requestId).first<Turn>();
  if(!current?.seq||!Number.isSafeInteger(current.seq)||current.status!=='running')throw Error('Current read-reference provenance is unavailable.');
  const ids=new Set([scope.turnId,...requiredTurnIds]);
  if(frozen){for(const x of [...frozen.reads,...frozen.displays]){if(!x||typeof x.turnId!=='string')throw Error('Invalid reference origin.');ids.add(x.turnId);}}
  else {
    const prior=await db.prepare(`SELECT t.turn_id,t.status,MIN(e.seq) AS seq FROM me3_agent_turns t
      JOIN me3_agent_stream_events e ON e.owner_id=t.owner_id AND e.turn_id=t.turn_id AND e.event='status'
      WHERE t.owner_id=? AND t.thread_id=? AND julianday(t.created_at)>=julianday((SELECT created_at FROM me3_agent_turns WHERE turn_id=? AND owner_id=?))-1
      GROUP BY t.turn_id HAVING seq<? ORDER BY seq DESC LIMIT 1`).bind(scope.ownerId,scope.threadId,scope.turnId,scope.ownerId,current.seq).first<{turn_id:string;status:string;seq:number}>();
    // Do not resurrect a completed answer across an intervening failed/cancelled turn.
    if(prior?.status==='complete')ids.add(prior.turn_id);
  }
  if(ids.size>8||[...ids].some(id=>typeof id!=='string'||!id||id.length>500))throw Error('Complete reference origin inventory exceeds the bound.');
  const evidence:AgentTargetIntentReferenceEvidence={reads:[],displays:[]};const turns:Turn[]=[],events:Event[]=[],guardEvents:Event[]=[],messages:Array<{id:string;content:string;metadata_json:string}>=[],calls:Array<{turnId:string;callId:string;name:string;argumentsJson:string;resultJson:string}>=[],allReads:AgentTargetIntentReferenceEvidence['reads']=[];
  for(const id of ids) {
    const t=id===scope.turnId?current:await db.prepare(`SELECT t.turn_id,t.request_id,t.status,t.input_json,t.checkpoint_json,t.response_json,MIN(e.seq) AS seq
      FROM me3_agent_turns t JOIN me3_agent_stream_events e ON e.owner_id=t.owner_id AND e.turn_id=t.turn_id AND e.event='status'
      WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=?`).bind(scope.ownerId,scope.threadId,id).first<Turn>();
    if(!t?.seq||!Number.isSafeInteger(t.seq)||t.seq>current.seq||id!==scope.turnId&&t.status!=='complete')throw Error('Required read/display origin is missing, failed or still overlapping.');
    if(await db.prepare(`SELECT 1 FROM me3_agent_cancellations WHERE owner_id=? AND request_id=?
      UNION ALL SELECT 1 FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=?`).bind(scope.ownerId,t.request_id,scope.ownerId,t.request_id).first())throw Error('Read/display origin was cancelled or aliased.');
    const input=object(JSON.parse(t.input_json)),checkpoint=t.checkpoint_json&&object(JSON.parse(t.checkpoint_json));
    if(!input||input.userId!==scope.ownerId||input.threadId!==scope.threadId||input.turnId!==id||input.requestId!==t.request_id||!checkpoint||!Array.isArray(checkpoint.messages))throw Error('Read/display canonical checkpoint is missing.');
    const cp=checkpoint.messages as AgentMessage[];turns.push(t);
    const stored=contracts.length?await db.prepare(`SELECT seq,turn_id,event,CASE WHEN length(CAST(data_json AS BLOB))<=49152 THEN data_json END AS data_json FROM me3_agent_stream_events WHERE owner_id=? AND turn_id=? AND event='tool'
      AND json_extract(data_json,'$.state')='complete' AND json_extract(data_json,'$.result.status')='ok' AND json_extract(data_json,'$.name') IN (${contracts.map(()=>'?').join(',')}) ORDER BY seq LIMIT 33`).bind(scope.ownerId,id,...contracts.map(tool=>tool.name)).all<Event>():{results:[]};
    if((stored.results?.length||0)>32)throw Error('Complete successful read event inventory exceeds the bound.');
    for(const event of stored.results||[]) {
      if(!event.data_json)throw Error('Successful read event exceeds the complete byte bound.');
      const data=object(JSON.parse(event.data_json));if(data?.state!=='complete')continue;
      const result=object(data.result);if(result?.status!=='ok')continue;
      const contract=contracts.find(tool=>tool.name===data.name&&tool.name===data.toolName);if(!contract)continue;
      if(!exact(data,['state','name','toolName','callId','result'])||!exact(result,['status','data'])||typeof data.callId!=='string'||!data.callId||event.seq<=t.seq||id!==scope.turnId&&event.seq>=current.seq)throw Error('Read event provenance or shape differs.');
      const candidates=cp.flatMap(message=>message.role==='assistant'?message.toolCalls||[]:[]).filter(call=>call.id===data.callId);
      const outputs=cp.filter(message=>message.role==='tool'&&message.toolCallId===data.callId);
      if(candidates.length!==1||outputs.length!==1||candidates[0].name!==contract.name||validateArguments(contract.parameters,candidates[0].arguments)||canonicalJson(JSON.parse(outputs[0].content))!==canonicalJson(result))throw Error('Successful read event differs from its exact checkpoint call/result.');
      const trace=object(checkpoint.trace);if(!Array.isArray(trace?.toolCalls)||!trace.toolCalls.some(call=>{const x=object(call);return x?.name===contract.name&&x.effect==='read'&&x.status==='ok';}))throw Error('Successful read lacks a read-only checkpoint trace.');
      if(allReads.some(read=>read.turnId===id&&read.callId===data.callId))throw Error('Duplicate read call identity is ambiguous.');
      const read={turnId:id,requestId:t.request_id,seq:event.seq,callId:data.callId,name:contract.name,arguments:candidates[0].arguments,result:{status:'ok' as const,data:result.data}};allReads.push(read);guardEvents.push(event);
      if(!frozen||frozen.reads.some(value=>value.seq===event.seq&&value.turnId===id)){evidence.reads.push(read);events.push(event);}
      calls.push({turnId:id,callId:data.callId,name:contract.name,argumentsJson:JSON.stringify(candidates[0].arguments),resultJson:outputs[0].content});
    }
    {
      const trace=object(checkpoint.trace);
      for(const contract of contracts) {
        const count=Array.isArray(trace?.toolCalls)?trace.toolCalls.filter(call=>{const x=object(call);return x?.name===contract.name&&x.effect==='read'&&x.status==='ok';}).length:0;
        if(count!==allReads.filter(read=>read.turnId===id&&read.name===contract.name).length)throw Error('A successful checkpoint read lacks its complete owner-scoped event provenance.');
      }
    }
    if(id!==scope.turnId&&(!frozen||frozen.displays.some(display=>display.turnId===id))) {
      const final=t.response_json&&object(JSON.parse(t.response_json));
      const message=await db.prepare("SELECT id,content,metadata_json FROM assistant_messages WHERE id=? AND owner_id=? AND thread_id=? AND role='assistant'").bind(id+':assistant:complete:final',scope.ownerId,scope.threadId).first<{id:string;content:string;metadata_json:string}>();
      const done=await db.prepare("SELECT seq,turn_id,event,data_json FROM me3_agent_stream_events WHERE owner_id=? AND turn_id=? AND event='done' ORDER BY seq DESC LIMIT 1").bind(scope.ownerId,id).first<Event>();
      if(!t.response_json&&!message&&!done)continue; // Older low-level turns published no canonical display.
      const last=[...cp].reverse().find(message=>message.role==='assistant'&&!message.toolCalls?.length);
      if(!final||final.runtime!=='agent'||final.status!=='complete'||final.turnId!==id||final.threadId!==scope.threadId||checkpoint.status!=='complete'||!message||!done||done.seq>=current.seq||message.content!==final.replyText||last?.content!==final.replyText||canonicalJson(JSON.parse(message.metadata_json))!==canonicalJson(final)||canonicalJson(JSON.parse(done.data_json))!==canonicalJson(final))throw Error('Completed assistant display lacks exact canonical publication provenance.');
      evidence.displays.push({turnId:id,requestId:t.request_id,seq:done.seq,replyText:message.content});messages.push(message);events.push(done);guardEvents.push(done);
    }
  }
  evidence.reads.sort((a,b)=>a.seq-b.seq);evidence.displays.sort((a,b)=>a.seq-b.seq);
  if(allReads.length>32||bytes(allReads)>65536||evidence.reads.length>32||evidence.displays.length>8||bytes(evidence)>65536||evidence.displays.some(x=>bytes(x.replyText)>16384)||evidence.reads.some(x=>bytes(x.result)>32768))throw Error('Complete read/display references exceed the bound.');
  if(frozen&&canonicalJson(frozen)!==canonicalJson(evidence))throw Error('Frozen read/display reference evidence changed, is forged or incomplete.');
  const proof={turns:turns.map(t=>({...t,...(t.turn_id===scope.turnId?{status:'current',checkpoint_json:null,response_json:null}:{})})),events,messages,calls:calls.filter(call=>evidence.reads.some(read=>read.turnId===call.turnId&&read.callId===call.callId))};
  if(bytes(proof)>1048576)throw Error('Complete reference provenance exceeds the atomic snapshot bound.');
  const guard={sql:`EXISTS(SELECT 1 FROM assistant_threads WHERE id=? AND owner_id=? AND status='active' AND deleted_at IS NULL AND archived_at IS NULL) AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM me3_agent_turns t WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=json_extract(r.value,'$.turn_id') AND t.request_id=json_extract(r.value,'$.request_id') AND t.input_json=json_extract(r.value,'$.input_json')
    AND (json_extract(r.value,'$.status')='current' AND t.status='running' OR t.status='complete' AND t.checkpoint_json IS json_extract(r.value,'$.checkpoint_json') AND t.response_json IS json_extract(r.value,'$.response_json'))
    AND EXISTS(SELECT 1 FROM assistant_messages m WHERE m.id=t.turn_id||':user' AND m.owner_id=t.owner_id AND m.thread_id=t.thread_id AND m.role='user' AND m.content=json_extract(t.input_json,'$.messageText') AND json_extract(m.metadata_json,'$.requestId')=t.request_id)
    AND (SELECT MIN(seq) FROM me3_agent_stream_events e WHERE e.owner_id=t.owner_id AND e.turn_id=t.turn_id AND e.event='status')=json_extract(r.value,'$.seq')
    AND NOT EXISTS(SELECT 1 FROM me3_agent_cancellations c WHERE c.owner_id=t.owner_id AND c.request_id=t.request_id)
    AND NOT EXISTS(SELECT 1 FROM me3_agent_request_aliases a WHERE a.owner_id=t.owner_id AND a.request_id=t.request_id)))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM me3_agent_stream_events e WHERE e.seq=json_extract(r.value,'$.seq') AND e.owner_id=? AND e.turn_id=json_extract(r.value,'$.turn_id') AND e.event=json_extract(r.value,'$.event') AND e.data_json=json_extract(r.value,'$.data_json')))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM assistant_messages m WHERE m.owner_id=? AND m.thread_id=? AND m.id=json_extract(r.value,'$.id') AND m.content=json_extract(r.value,'$.content') AND m.metadata_json=json_extract(r.value,'$.metadata_json')))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM me3_agent_turns t,json_each(t.checkpoint_json,'$.messages') m,json_each(m.value,'$.toolCalls') c WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id=json_extract(r.value,'$.turnId') AND json_extract(m.value,'$.role')='assistant' AND json_extract(c.value,'$.id')=json_extract(r.value,'$.callId') AND json_extract(c.value,'$.name')=json_extract(r.value,'$.name') AND json_extract(c.value,'$.arguments')=json_extract(r.value,'$.argumentsJson')
      AND EXISTS(SELECT 1 FROM json_each(t.checkpoint_json,'$.trace.toolCalls') trace WHERE json_extract(trace.value,'$.name')=json_extract(r.value,'$.name') AND json_extract(trace.value,'$.effect')='read' AND json_extract(trace.value,'$.status')='ok')
      AND EXISTS(SELECT 1 FROM json_each(t.checkpoint_json,'$.messages') o WHERE json_extract(o.value,'$.role')='tool' AND json_extract(o.value,'$.toolCallId')=json_extract(r.value,'$.callId') AND json_extract(o.value,'$.content')=json_extract(r.value,'$.resultJson'))))
    AND (SELECT COUNT(*) FROM me3_agent_stream_events e,json_each(?) names WHERE e.owner_id=? AND e.turn_id IN(SELECT value FROM json_each(?)) AND e.event='tool' AND json_extract(e.data_json,'$.state')='complete' AND json_extract(e.data_json,'$.result.status')='ok' AND json_extract(e.data_json,'$.name')=names.value)=?
    AND (SELECT COUNT(*) FROM me3_agent_turns t,json_each(t.checkpoint_json,'$.trace.toolCalls') trace,json_each(?) names WHERE t.owner_id=? AND t.thread_id=? AND t.turn_id IN(SELECT value FROM json_each(?)) AND json_extract(trace.value,'$.effect')='read' AND json_extract(trace.value,'$.status')='ok' AND json_extract(trace.value,'$.name')=names.value)=?`,values:[scope.threadId,scope.ownerId,JSON.stringify(proof.turns),scope.ownerId,scope.threadId,JSON.stringify(guardEvents),scope.ownerId,JSON.stringify(messages),scope.ownerId,scope.threadId,JSON.stringify(calls),scope.ownerId,scope.threadId,JSON.stringify(contracts.map(tool=>tool.name)),scope.ownerId,JSON.stringify([...ids]),allReads.length,JSON.stringify(contracts.map(tool=>tool.name)),scope.ownerId,scope.threadId,JSON.stringify([...ids]),allReads.length]};
  return {evidence,proof:canonicalJson(proof),guard};
}
