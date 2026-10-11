import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeNewAgentTurn, type NewAgentDispatchInput } from "./agent-runtime";
import { Me3Agent } from "./me3-agent";
import { persistAgentInput } from "../../../packages/agent/src/store";
import { persistAgentTargetSelectionInput } from "./agent-target-selection";
import type { AgentDb } from "../../../packages/agent/src/types";
import type { Env } from "./types";

vi.mock("./ai-providers", () => ({ getAiSettings: async () => ({ defaults: { chat: { providerId: "workers-ai", model: "@cf/zai-org/glm-4.7-flash" } } }) }));
vi.mock("./ai-gateway", () => ({ getAiGatewayRuntimeConfig: async () => ({ gatewayId: "synthetic" }) }));
vi.mock("./plugins", () => ({ listCorePluginRecords: async () => [{ id: "me3.calendar", enabled: true, status: "installed" }] }));
vi.mock("../../../packages/agent-chat/src/owner-snapshot", () => ({ loadOwnerSnapshotContext: async () => ({ prompt: "Synthetic owner" }) }));
vi.mock("agents", () => ({ Agent: class {
  env: Env; ctx: unknown;
  constructor(ctx: unknown, env: Env) { this.ctx=ctx; this.env=env; }
  async startFiber(_name:string, fn:(context:unknown)=>Promise<void>) { await fn({id:"synthetic-fiber", signal:new AbortController().signal, stash(){}}); }
} }));
const disposals: Array<() => void> = [];
afterEach(() => { for(const dispose of disposals.splice(0))dispose(); });
function fixture() {
  const directory=mkdtempSync(join(tmpdir(),"me3-target-runtime-"));const file=join(directory,"installation.sqlite");let raw=new DatabaseSync(file);
  disposals.push(()=>{raw.close();rmSync(directory,{recursive:true,force:true});});
  const migrations=new URL("../migrations/",import.meta.url);
  for(const name of readdirSync(migrations).filter(name=>name.endsWith(".sql")).sort())raw.exec(readFileSync(new URL(name,migrations),"utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username,timezone) VALUES('owner','synthetic','Europe/Dublin');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic');
    CREATE TABLE test_reminder_effects(id INTEGER PRIMARY KEY,record_id TEXT);
    CREATE TRIGGER test_reminder_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO test_reminder_effects(record_id) VALUES(new.id); END;
    INSERT INTO user_reminders(id,user_id,title,remind_at,timezone,status) VALUES('first','owner','Same title','2027-01-15T12:00:00Z','Europe/Dublin','pending'),('second','owner','Same title','2027-01-17T12:00:00Z','Europe/Dublin','pending');`);
  const db:AgentDb={prepare(sql){let values:unknown[]=[];const statement={bind(...args:unknown[]){values=args;return statement;},async first<T>(){return(raw.prepare(sql).get(...values as never[])??null) as T|null;},async all<T>(){return{results:raw.prepare(sql).all(...values as never[]) as T[]};},async run(){return{meta:{changes:Number(raw.prepare(sql).run(...values as never[]).changes)}};}};return statement;},async batch(statements){raw.exec("BEGIN IMMEDIATE");try{const result=[];for(const statement of statements)result.push(await statement.run());raw.exec("COMMIT");return result;}catch(error){raw.exec("ROLLBACK");throw error;}}};
  let calls=0;
  const run=vi.fn(async(_model:string,input:{messages:Array<{role:string;content:string}>})=>{
    calls++;
    const usage={prompt_tokens:10,completion_tokens:10,total_tokens:20};
    const tool=(name:string,args:unknown)=>({response:"",tool_calls:[{id:`call-${calls}`,type:"function",function:{name,arguments:JSON.stringify(args)}}],usage});
    if(calls===1)return tool("core_reminders_list",{query:"Same title"});
    if(calls===2){const read=JSON.parse([...input.messages].reverse().find(message=>message.role==="tool")!.content);return tool("core_targets_present",{selectionId:read.data.selectionId,toolName:"core_reminders_update",arguments:{date:"2027-01-16",time:"09:30",timezone:"Europe/Dublin"}});}
    return{response:"Moved the exact selected reminder.",usage};
  });
  const env={DB:db,AI:{run},ME3_DEPLOYMENT_MODE:"self_hosted",ME3_ASSISTANT_RUNTIME:"agent"} as unknown as Env;
  const input:NewAgentDispatchInput={userId:"owner",threadId:"thread",turnId:"origin",requestId:"origin-request",messageText:"Move one of my same-title reminders"};
  const persist=async(value=input)=>persistAgentInput(db,{ownerId:value.userId,threadId:value.threadId,turnId:value.turnId,requestId:value.requestId},value);
  const request=(value=input,stream=false)=>new Request(`https://agent.internal/dispatch/sandbox${stream?"/stream":""}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
  return{env,db,run,input,persist,request,raw:()=>raw,reopen(){raw.close();raw=new DatabaseSync(file);}};
}

describe("new runtime target card persistence and durable delivery",()=>{
  it("persists a terminal card and executes only the authenticated frozen action once after a fresh connection",async()=>{
    const f=fixture();await f.persist();const events:Array<{event:string;data:Record<string,unknown>}>=[];
    const result=await executeNewAgentTurn(f.env,f.input,new AbortController().signal,(event,data)=>events.push({event,data}));
    expect(result.status).toBe("complete");expect(result.targetPresentation).toMatchObject({status:"pending",actionLabel:"Move reminder",candidates:[{id:"first",option:1},{id:"second",option:2}]});
    expect(events.at(-1)).toMatchObject({event:"done",data:{targetPresentation:{status:"pending"}}});
    const saved=JSON.parse((f.raw().prepare("SELECT metadata_json FROM assistant_messages WHERE role='assistant'").get() as {metadata_json:string}).metadata_json);
    expect(saved.targetPresentation).toEqual(result.targetPresentation);expect(JSON.stringify(saved.targetPresentation)).not.toContain("snapshot");expect(f.run).toHaveBeenCalledTimes(2);
    f.reopen();const selection={presentationId:(result.targetPresentation as {id:string}).id,candidateId:"second"};
    const chosen={...f.input,turnId:"choice",requestId:"choice-request",messageText:"Choose option 2",targetSelection:selection};
    await persistAgentTargetSelectionInput(f.env,chosen);const complete=await executeNewAgentTurn(f.env,chosen,new AbortController().signal);
    expect(complete).toMatchObject({status:"complete",targetPresentation:{status:"selected"}});
    expect(f.raw().prepare("SELECT remind_at FROM user_reminders WHERE id='second'").get()).toMatchObject({remind_at:"2027-01-16T09:30:00.000Z"});
    expect(f.raw().prepare("SELECT COUNT(*) count FROM test_reminder_effects").get()).toMatchObject({count:1});
    f.reopen();await persistAgentTargetSelectionInput(f.env,chosen);await executeNewAgentTurn(f.env,chosen,new AbortController().signal);
    expect(f.raw().prepare("SELECT COUNT(*) count FROM test_reminder_effects").get()).toMatchObject({count:1});expect(f.run).toHaveBeenCalledTimes(3);
  });
  it.each(["expired","superseded","cancelled"])("fresh DO cached response and terminal SSE revalidate a %s saved card",async reason=>{
    const f=fixture();await f.persist();const result=await executeNewAgentTurn(f.env,f.input,new AbortController().signal);
    if(reason==="expired")f.raw().exec("UPDATE me3_agent_presentations SET expires_at='2000-01-01T00:00:00Z'");
    if(reason==="cancelled")f.raw().exec("INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES('owner','origin-request')");
    if(reason==="superseded")f.raw().exec(`INSERT INTO me3_agent_presentations SELECT 'newer',owner_id,thread_id,domain,selection_id,ordinal+1,tool_name,arguments_json,candidates_json,created_turn_id,created_at,expires_at,NULL,NULL,NULL,'pending' FROM me3_agent_presentations`);
    f.reopen();const agent=new Me3Agent({} as DurableObjectState,f.env);
    const response=await agent.onRequest(f.request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({targetPresentation:{id:(result.targetPresentation as {id:string}).id,status:"unavailable"}});
    const replay=new Me3Agent({} as DurableObjectState,f.env);const stream=await replay.onRequest(f.request(f.input,true));const text=await stream.text();
    expect(text).toContain('"targetPresentation"');expect(text).toContain('"status":"unavailable"');expect(f.run).toHaveBeenCalledTimes(2);
  });
});
