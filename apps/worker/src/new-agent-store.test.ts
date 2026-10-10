import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AGENT_SCHEMA_STATEMENTS, createD1TurnStore, decideAgentApproval, persistAgentInput } from "../../../packages/agent/src/store";
import type { AgentDb, AgentCheckpoint } from "../../../packages/agent/src/types";

function database(): AgentDb {
  const raw=new DatabaseSync(":memory:");for(const sql of AGENT_SCHEMA_STATEMENTS)raw.exec(sql);
  return {prepare(sql){const query=raw.prepare(sql);let args:unknown[]=[];const statement={bind(...values:unknown[]){args=values;return statement;},async first<T>(){return (query.get(...args as never[]) ?? null) as T|null;},async all<T>(){return {results:query.all(...args as never[]) as T[]};},async run(){return {meta:{changes:Number(query.run(...args as never[]).changes)}};}};return statement;}};
}
describe("canonical D1 agent checkpoints and approvals",()=>{
  it("reopens owner-scoped cancellation intent before input and refuses a later approval",async()=>{
    const db=database(),identity={ownerId:"a",threadId:"thread",turnId:"turn",requestId:"req"};
    await db.prepare("INSERT INTO me3_agent_cancellations(owner_id,request_id) VALUES(?,?)").bind("a","req").run();
    const store=createD1TurnStore(db,identity);
    expect(await store.cancellationRequested!()).toBe(true);
    expect(await createD1TurnStore(db,{...identity,ownerId:"b"}).cancellationRequested!()).toBe(false);
    expect(await createD1TurnStore(db,{...identity,requestId:"other"}).cancellationRequested!()).toBe(false);
    await expect(store.requestApproval("key",{id:"call",name:"send",arguments:{}},{title:"Send",summary:"Review"})).rejects.toThrow();
    expect((await db.prepare("SELECT COUNT(*) count FROM me3_agent_approvals").first<{count:number}>())!.count).toBe(0);
  });
  it("rejects altered duplicate input without replacing the canonical request",async()=>{
    const db=database(),identity={ownerId:"a",threadId:"thread",turnId:"turn",requestId:"req"};
    const input={messageText:"Save the journal note",selectedModel:{model:"model",providerId:"test"}};
    await persistAgentInput(db,identity,input);
    await expect(persistAgentInput(db,identity,{...input,messageText:"Delete the journal note"})).rejects.toThrow("saved turn");
    await expect(persistAgentInput(db,identity,{selectedModel:{providerId:"test",model:"model"},messageText:input.messageText})).resolves.toBeUndefined();
    expect(await db.prepare("SELECT input_json FROM me3_agent_turns WHERE turn_id='turn'").first()).toMatchObject({input_json:JSON.stringify(input)});
  });
  it("restores checkpoints and receipts with a new store instance",async()=>{
    const db=database();const input={ownerId:"a",threadId:"thread",turnId:"turn",requestId:"req"};
    const first=createD1TurnStore(db,input);
    const checkpoint:AgentCheckpoint={messages:[{role:"user",content:"save"}],steps:0,status:"running",trace:{model:"test",steps:0,toolCalls:[],startedAt:"now",totalDurationMs:0,timeToFirstTokenMs:null,usage:{inputTokens:0,outputTokens:0,cachedInputTokens:0,estimatedCostUsd:0}}};
    await first.save(checkpoint);expect(await first.claimReceipt("key",{id:"call",name:"save",arguments:{}})).toBe(true);
    expect(await createD1TurnStore(db,input).claimReceipt("key",{id:"other",name:"save",arguments:{}})).toBe(false);
    await first.finishReceipt("key",{status:"ok",data:{id:"saved"}});
    const reopened=createD1TurnStore(db,input);expect(await reopened.load()).toEqual(checkpoint);expect(await reopened.getReceipt("key")).toMatchObject({status:"ok"});
    expect(await createD1TurnStore(db,{...input,ownerId:"b"}).load()).toBeNull();
    expect(await createD1TurnStore(db,{...input,ownerId:"b"}).getReceipt("key")).toBeNull();
  });
  it("binds approval to exact args and snapshot, enforces owner scope and first decision",async()=>{
    const db=database();const input={ownerId:"a",threadId:"thread",turnId:"turn",requestId:"req"};
    const store=createD1TurnStore(db,input);const call={id:"call",name:"send",arguments:{draftId:"one"}};
    const id=await store.requestApproval("key",call,{title:"Send",summary:"One",target:{id:"one",body:"reviewed"}});
    expect(await store.requestApproval("key",call,{title:"Send",summary:"One"})).toBe(id);
    expect(await decideAgentApproval(db,"b",id,"approved")).toBe(false);
    expect(await store.approvalDecision(id)).toBe("pending");
    expect(await decideAgentApproval(db,"a",id,"approved")).toBe(true);
    expect(await decideAgentApproval(db,"a",id,"declined")).toBe(false);
    expect(await store.approvalData!(id)).toMatchObject({target:{body:"reviewed"}});
  });
});
