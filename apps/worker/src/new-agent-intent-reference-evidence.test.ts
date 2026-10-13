import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNewAgentTurn, type NewAgentDispatchInput } from './agent-runtime';
import { persistAgentInput } from '../../../packages/agent/src/store';
import type { AgentDb } from '../../../packages/agent/src/types';
import type { Env } from './types';
import { createTargetIntentVerifier } from './agent-target-intent';
import { createDomainTools } from '../../../packages/agent/src/tools';

vi.mock('./ai-providers',()=>({getAiSettings:async()=>({defaults:{chat:{providerId:'workers-ai',model:'@cf/zai-org/glm-4.7-flash'}}})}));
vi.mock('./ai-gateway',()=>({getAiGatewayRuntimeConfig:async()=>({gatewayId:'synthetic'})}));
vi.mock('./plugins',()=>({listCorePluginRecords:async()=>[{id:'me3.calendar',enabled:true,status:'installed'}]}));
vi.mock('../../../packages/agent-chat/src/owner-snapshot',()=>({loadOwnerSnapshotContext:async()=>({prompt:'Synthetic owner'})}));
// Only calendar availability and model transport are simulated; mailbox/contacts,
// loop/checkpoint/events/intent and draft persistence use the native Worker path.
const slot={startsAt:'2026-10-15T08:00:00.000Z',endsAt:'2026-10-15T08:30:00.000Z',timezone:'Europe/Dublin'};
vi.mock('./agent-domain-scheduling',()=>({createStableAgentSchedulingServices:()=>({availability:async()=>({slots:[slot],limitReached:false})})}));
vi.mock('./network-directory',()=>({createPeopleSearchToolServices:()=>({})}));
vi.mock('./web-research',()=>({createWebResearchToolServices:()=>({})}));
const firstPrompt='Find a free 30-minute slot this coming Thursday and find Ada in my contacts.';
const displayed='The first free slot is Thursday, 15 October 2026, 9:00–9:30 a.m. Europe/Dublin. Ada Example is ada@example.invalid. Nothing has been booked or sent.';
const followup='Use the first slot and save an email draft proposing it. Do not send anything.';
const draftArgs={to:'ada@example.invalid',subject:'Re: QA launch review',body:'Hi Ada, would Thursday, 15 October 2026, 9:00–9:30 a.m. Europe/Dublin work for a review?',replyToMessageId:'source-email'};
const dispose:Array<()=>void>=[];
afterEach(()=>dispose.splice(0).forEach(fn=>fn()));
function fixture({recovery=false}:{recovery?:boolean}={}) {
  const directory=mkdtempSync(join(tmpdir(),'me3-intent-reference-'));const file=join(directory,'installation.sqlite');let raw=new DatabaseSync(file);let beforeStatement:((sql:string,values:unknown[])=>void)|undefined;
  dispose.push(()=>{raw.close();rmSync(directory,{recursive:true,force:true});});
  const migrations=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())raw.exec(readFileSync(new URL(name,migrations),'utf8'));
  raw.exec(`INSERT INTO owner_profile(id,username,timezone)VALUES('owner','synthetic','Europe/Dublin'),('foreign','foreign','UTC');
    INSERT INTO assistant_threads(id,owner_id,title)VALUES('thread','owner','Synthetic'),('foreign-thread','foreign','Foreign');
    INSERT INTO contacts(id,user_id,name,email)VALUES('ada-contact','owner','Ada Example','ada@example.invalid');
    INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email)VALUES('mailbox','owner','synthetic','owner@example.invalid');
    INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,from_address,to_address,subject,text_body,raw_headers_json,metadata_json,folder,created_by)
      VALUES('source-email','mailbox','inbound','email','received','ada@example.invalid','synthetic@me3.local','QA launch review','I am free in the afternoon.',
      '{"Message-ID":"<source@example.invalid>","References":"<earlier@example.invalid>"}','{}','inbox','provider');`);
  const db:AgentDb={prepare(sql){let values:unknown[]=[];const statement={bind(...args:unknown[]){values=args;return statement;},async first<T>(){return(raw.prepare(sql).get(...values as never[])??null)as T|null;},async all<T>(){return{results:raw.prepare(sql).all(...values as never[])as T[]};},async run(){beforeStatement?.(sql,values);return{meta:{changes:Number(raw.prepare(sql).run(...values as never[]).changes)}};}};return statement;},async batch(statements){raw.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());raw.exec('COMMIT');return results;}catch(error){raw.exec('ROLLBACK');throw error;}}};
  const requests:Array<{intent:boolean;input:Record<string,unknown>}>=[];let firstStep=0,secondStep=0;let duringIntent:(()=>void)|undefined;
  const run=vi.fn(async(_model:string,input:Record<string,unknown>)=>{
    const tools=input.tools as Array<{function?:{name:string};name?:string}>;const intent=tools.length===1&&(tools[0].function?.name??tools[0].name)==='core_target_intent_verdict';requests.push({intent,input});
    const tool=(calls:Array<{name:string;arguments:unknown}>)=>({choices:[{message:{content:'',tool_calls:calls.map((call,n)=>({id:`reference-call-${requests.length}-${n}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}))},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}});
    if(intent){const messages=input.messages as Array<{role:string;content:string}>;const evidence=JSON.parse(messages.at(-1)!.content);const refs=evidence.referenceEvidence;const hasSlot=refs?.reads?.some((read:{name:string;result:unknown})=>read.name==='core_calendar_availability'&&JSON.stringify(read.result).includes(slot.startsAt));const hasDisplay=refs?.displays?.some((display:{replyText:string})=>display.replyText===displayed);duringIntent?.();return tool([{name:'core_target_intent_verdict',arguments:hasSlot&&hasDisplay?{decision:'allow',selectedCandidateId:'source-email',authorizedCall:{name:'core_mailbox_draft',arguments:draftArgs}}:{decision:'clarify',reason:'The independent evidence lacks the successful availability read and completed first-slot display.'}}]);}
    const messages=input.messages as Array<{role:string;content:string}>;const text=[...messages].reverse().find(message=>message.role==='user')!.content;
    if(text.includes(firstPrompt)){
      if(firstStep++===0)return tool([{name:'core_calendar_availability',arguments:{dateFrom:'2026-10-15',dateTo:'2026-10-15',durationMinutes:30}},{name:'core_contacts_search',arguments:{query:'Ada'}}]);
      return{choices:[{message:{content:displayed},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}};
    }
    if(secondStep++===0)return tool([{name:'core_mailbox_search',arguments:{query:'QA launch review'}}]);
    if(recovery){if(secondStep===2)return tool([{name:'core_mailbox_draft',arguments:{...draftArgs,body:'A planner-invented afternoon slot.'}}]);if(secondStep===3)return tool([{name:'core_mailbox_search',arguments:{query:'QA launch review'}}]);if(secondStep===4)return tool([{name:'core_mailbox_draft',arguments:draftArgs}]);}
    if(secondStep===2)return tool([{name:'core_mailbox_draft',arguments:draftArgs}]);
    return{choices:[{message:{content:'The draft operation has been checked; nothing was sent.'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}};
  });
  const send=vi.fn(async()=>{throw Error('No test permits external email');});const env={DB:db,AI:{run},EMAIL:{send},ME3_DEPLOYMENT_MODE:'self_hosted'}as unknown as Env;
  const input=(turnId:string,messageText:string):NewAgentDispatchInput=>({userId:'owner',threadId:'thread',turnId,requestId:turnId+'-request',messageText,selectedModel:{providerId:'workers-ai',model:'@cf/zai-org/glm-4.7-flash'}});
  async function execute(turnId:string,messageText:string){const value=input(turnId,messageText);await persistAgentInput(db,{ownerId:'owner',threadId:'thread',turnId,requestId:value.requestId},value);return executeNewAgentTurn(env,value,new AbortController().signal);}
  return{raw:()=>raw,db,requests,send,execute,reopen(){raw.close();raw=new DatabaseSync(file);},duringIntent(fn:()=>void){duringIntent=fn;},beforeStatement(fn:(sql:string,values:unknown[])=>void){beforeStatement=fn;},drafts:()=>raw.prepare("SELECT * FROM mailbox_messages WHERE direction='outbound'").all()};
}

describe('persisted independent read and displayed-reference evidence',()=>{
  it('after a fresh connection resolves the previously displayed first slot into one unsent threaded native draft',async()=>{
    const f=fixture();expect(await f.execute('prior-read',firstPrompt)).toMatchObject({status:'complete',replyText:displayed});f.reopen();
    expect(await f.execute('draft-followup',followup)).toMatchObject({status:'complete'});
    expect(f.drafts()).toHaveLength(1);const draft=f.drafts()[0];expect(draft).toMatchObject({source_id:'source-email',text_body:draftArgs.body,subject:draftArgs.subject,to_address:draftArgs.to,message_kind:'draft',status:'pending_approval'});expect(JSON.parse(String(draft.metadata_json)).outbound_headers).toMatchObject({in_reply_to:'<source@example.invalid>',references:'<earlier@example.invalid> <source@example.invalid>'});expect(f.send).not.toHaveBeenCalled();
    f.reopen();expect(f.drafts()).toHaveLength(1);expect(f.raw().prepare('SELECT COUNT(*) n FROM email_send_audit').get()).toMatchObject({n:0});
    const judge=f.requests.find(request=>request.intent)!;const evidence=JSON.parse(String((judge.input.messages as Array<{content:string}>).at(-1)!.content));expect(evidence.ownerInputs.map((input:{messageText:string})=>input.messageText)).toEqual([firstPrompt,followup]);expect(evidence.referenceEvidence.reads.some((read:{name:string})=>read.name==='core_calendar_availability')).toBe(true);expect(evidence.referenceEvidence.displays).toContainEqual(expect.objectContaining({turnId:'prior-read',replyText:displayed}));expect(evidence).not.toHaveProperty('proposedCall');
  });
  it.each(['missing successful event','foreign event owner','changed call identity','forged checkpoint result','extra read field','mismatched display metadata','mismatched completed display event','cancelled source'])('rejects %s before isolated verification or any draft',async mode=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);f.reopen();const row=f.raw().prepare("SELECT seq,data_json FROM me3_agent_stream_events WHERE turn_id='prior-read'AND event='tool'AND json_extract(data_json,'$.state')='complete'AND json_extract(data_json,'$.name')='core_calendar_availability'").get()!;
    if(mode==='missing successful event')f.raw().prepare('DELETE FROM me3_agent_stream_events WHERE seq=?').run(row.seq);
    else if(mode==='foreign event owner')f.raw().prepare("UPDATE me3_agent_stream_events SET owner_id='foreign'WHERE seq=?").run(row.seq);
    else if(mode==='cancelled source')f.raw().prepare("INSERT INTO me3_agent_cancellations(owner_id,request_id)VALUES('owner','prior-read-request')").run();
    else if(mode==='forged checkpoint result'){const turn=f.raw().prepare("SELECT checkpoint_json FROM me3_agent_turns WHERE turn_id='prior-read'").get()!;const cp=JSON.parse(String(turn.checkpoint_json));cp.messages.find((message:{role:string;content:string})=>message.role==='tool'&&message.content.includes('slots')).content=JSON.stringify({status:'ok',data:{slots:[{...slot,startsAt:'2026-10-15T12:00:00Z'}]}});f.raw().prepare("UPDATE me3_agent_turns SET checkpoint_json=?WHERE turn_id='prior-read'").run(JSON.stringify(cp));}
    else if(mode==='mismatched display metadata')f.raw().prepare("UPDATE assistant_messages SET metadata_json='{}'WHERE id='prior-read:assistant:complete:final'").run();
    else if(mode==='mismatched completed display event')f.raw().prepare("UPDATE me3_agent_stream_events SET data_json='{}'WHERE turn_id='prior-read'AND event='done'").run();
    else {const data=JSON.parse(String(row.data_json));if(mode==='changed call identity')data.callId='invented';else data.authorizedCall={name:'core_mailbox_send',arguments:{draftId:'invented'}};f.raw().prepare('UPDATE me3_agent_stream_events SET data_json=?WHERE seq=?').run(JSON.stringify(data),row.seq);}
    await f.execute('draft-followup',followup);expect(f.requests.filter(request=>request.intent)).toHaveLength(0);expect(f.drafts()).toHaveLength(0);expect(f.send).not.toHaveBeenCalled();
  });
  it('refuses read provenance changed after a priced verdict, retaining accounting with zero drafts',async()=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);f.reopen();f.duringIntent(()=>f.raw().prepare("UPDATE assistant_messages SET content='A changed displayed answer'WHERE id='prior-read:assistant:complete:final'").run());
    const result=await f.execute('draft-followup',followup);expect(f.drafts()).toHaveLength(0);expect(f.requests.filter(request=>request.intent)).toHaveLength(1);const receipt=f.raw().prepare("SELECT status,result_json FROM me3_agent_tool_receipts WHERE turn_id='draft-followup'AND tool_name='__me3_target_intent_v1'").get()!;expect(JSON.parse(String(receipt.result_json))).toMatchObject({verdict:{decision:'deny'},inference:{usageId:expect.any(String)}});expect((result.trace as {targetIntentRequests:unknown[]}).targetIntentRequests).toHaveLength(1);
  });
  it('does not admit a verifier if the stored display changes at atomic receipt claim',async()=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);let changed=false;f.beforeStatement((sql,values)=>{if(!changed&&sql.startsWith('INSERT OR IGNORE INTO me3_agent_tool_receipts')&&values[3]==='__me3_target_intent_v1'){changed=true;f.raw().prepare("UPDATE assistant_messages SET content='Changed during admission'WHERE id='prior-read:assistant:complete:final'").run();}});await f.execute('draft-followup',followup);expect(changed).toBe(true);expect(f.requests.filter(request=>request.intent)).toHaveLength(0);expect(f.drafts()).toHaveLength(0);
  });

  it('retains known inference provenance when the read publication changes at atomic verdict finish',async()=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);let changed=false;f.beforeStatement((sql,values)=>{if(!changed&&sql.startsWith("UPDATE me3_agent_tool_receipts SET status='finished'")&&String(values[0]).includes('sourceReadProof')){changed=true;f.raw().prepare("UPDATE assistant_messages SET content='Changed at verdict finish'WHERE id='prior-read:assistant:complete:final'").run();}});
    await f.execute('draft-followup',followup);expect(changed).toBe(true);expect(f.drafts()).toHaveLength(0);expect(f.requests.filter(request=>request.intent)).toHaveLength(1);const receipt=f.raw().prepare("SELECT status,result_json FROM me3_agent_tool_receipts WHERE turn_id='draft-followup'AND tool_name='__me3_target_intent_v1'").get()!;expect(JSON.parse(String(receipt.result_json))).toMatchObject({inference:{usageId:expect.any(String),usage:{inputTokens:100,outputTokens:10}},verdict:{decision:'deny'}});expect(receipt.status).toBe('finished');
  });
  it.each(['complete','alias','cancel'])('blocks a %s current-scope race before inference admission',async mode=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);let changed=false;f.beforeStatement((sql,values)=>{if(!changed&&sql.startsWith('INSERT OR IGNORE INTO me3_agent_tool_receipts')&&values[3]==='__me3_target_intent_v1'){changed=true;if(mode==='complete')f.raw().prepare("UPDATE me3_agent_turns SET status='complete'WHERE turn_id='draft-followup'").run();else if(mode==='alias')f.raw().prepare("INSERT INTO me3_agent_request_aliases(owner_id,request_id,turn_id,input_json)VALUES('owner','draft-followup-request','draft-followup','{}')").run();else f.raw().prepare("INSERT INTO me3_agent_cancellations(owner_id,request_id)VALUES('owner','draft-followup-request')").run();}});await f.execute('draft-followup',followup);expect(changed).toBe(true);expect(f.requests.filter(request=>request.intent)).toHaveLength(0);expect(f.drafts()).toHaveLength(0);expect(f.send).not.toHaveBeenCalled();
  });

  it('permits a complete later reread while retaining the original independent reference proof and one inference',async()=>{
    const f=fixture({recovery:true});await f.execute('prior-read',firstPrompt);f.reopen();await f.execute('draft-followup',followup);expect(f.drafts()).toHaveLength(1);expect(f.drafts()[0]).toMatchObject({text_body:draftArgs.body,source_id:'source-email'});expect(f.requests.filter(request=>request.intent)).toHaveLength(1);const receipt=f.raw().prepare("SELECT arguments_json FROM me3_agent_tool_receipts WHERE turn_id='draft-followup'AND tool_name='__me3_target_intent_v1'").get()!;const evidence=JSON.parse(String(receipt.arguments_json));expect(evidence.referenceEvidence.reads.filter((read:{turnId:string})=>read.turnId==='draft-followup')).toHaveLength(1);expect(f.raw().prepare("SELECT COUNT(*)n FROM me3_agent_stream_events WHERE turn_id='draft-followup'AND event='tool'AND json_extract(data_json,'$.name')='core_mailbox_search'AND json_extract(data_json,'$.state')='complete'").get()).toMatchObject({n:2});expect(f.send).not.toHaveBeenCalled();
  });
  it('does not adopt a stale prior displayed slot',async()=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);f.raw().prepare("UPDATE me3_agent_turns SET created_at=datetime('now','-2 days')WHERE turn_id='prior-read'").run();await f.execute('draft-followup',followup);expect(f.drafts()).toHaveLength(0);expect(f.send).not.toHaveBeenCalled();
  });
  it('rejects an extra registered-read argument even when checkpoint result and event agree',async()=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);const row=f.raw().prepare("SELECT checkpoint_json FROM me3_agent_turns WHERE turn_id='prior-read'").get()!;const cp=JSON.parse(String(row.checkpoint_json));cp.messages.flatMap((message:{toolCalls?:Array<{name:string;arguments:Record<string,unknown>}>})=>message.toolCalls||[]).find((call:{name:string})=>call.name==='core_calendar_availability').arguments.provider='forged';f.raw().prepare("UPDATE me3_agent_turns SET checkpoint_json=?WHERE turn_id='prior-read'").run(JSON.stringify(cp));await f.execute('draft-followup',followup);expect(f.requests.filter(request=>request.intent)).toHaveLength(0);expect(f.drafts()).toHaveLength(0);
  });

  it('defaults the native verifier to strict references when a caller omits the factory flag',async()=>{
    const f=fixture();await f.execute('prior-read',firstPrompt);await f.execute('draft-followup',followup);const row=f.raw().prepare("SELECT arguments_json FROM me3_agent_tool_receipts WHERE turn_id='draft-followup'AND tool_name='__me3_target_intent_v1'").get()!;const evidence=JSON.parse(String(row.arguments_json));delete evidence.referenceEvidence;f.raw().prepare("UPDATE me3_agent_turns SET status='running'WHERE turn_id='draft-followup'").run();let admitted=0;const verify=createTargetIntentVerifier({db:f.db,scope:{ownerId:'owner',threadId:'thread',turnId:'draft-followup',requestId:'draft-followup-request'},ownerTimezone:'Europe/Dublin',tools:createDomainTools(),admit(){admitted++;throw Error('Must refuse before any model admission');}});await expect(verify(evidence,new AbortController().signal)).rejects.toThrow(/references.*missing/);expect(admitted).toBe(0);
  });

});
