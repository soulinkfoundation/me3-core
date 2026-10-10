import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AGENT_SCHEMA_STATEMENTS, createD1TurnStore } from "../../../packages/agent/src/store";
import { registerNewAgentRoutes } from "./routes/new-agent";
import type { AgentDb } from "../../../packages/agent/src/types";
import type { AppBindings } from "./http/types";

function database():AgentDb {const raw=new DatabaseSync(":memory:");for(const sql of AGENT_SCHEMA_STATEMENTS)raw.exec(sql);return {prepare(sql){const stmt=raw.prepare(sql);let args:unknown[]=[];const query={bind(...values:unknown[]){args=values;return query;},async first<T>(){return (stmt.get(...args as never[])??null) as T|null;},async all<T>(){return{results:stmt.all(...args as never[]) as T[]};},async run(){return{meta:{changes:Number(stmt.run(...args as never[]).changes)}};}};return query;}};}
describe("owner approval and abort route integration",()=>{
  it("explicit stop resolves the authenticated request to its original turn",async()=>{
    const db=database();await db.prepare("INSERT INTO me3_agent_turns(turn_id,owner_id,thread_id,request_id) VALUES('turn','owner','thread','request')").run();
    let cancelled:unknown;const app=new Hono<AppBindings>();registerNewAgentRoutes(app,{requireOwner:async()=>"owner",unauthorized:c=>c.json({error:"Unauthorized"},401)});
    const env={DB:db,ME3_ASSISTANT_RUNTIME:"agent",ME3_AGENT:{idFromName:()=>"owner",get:()=>({fetch:async(_url:string,init:RequestInit)=>{cancelled=JSON.parse(init.body as string);return Response.json({ok:true});}})}};
    const response=await app.request("/api/assistant/chat/turn/abort",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"requestId":"request"}'},env);
    expect(response.status).toBe(200);expect(cancelled).toEqual({userId:"owner",requestId:"request"});
    const hidden=await app.request("/api/assistant/chat/turn/abort",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"requestId":"other-owner-request"}'},env);expect(hidden.status).toBe(200);expect(cancelled).toEqual({userId:"owner",requestId:"other-owner-request"});
  });
  it("persists exact approval and resumes its same owner turn only once",async()=>{
    const db=database();let resumes=0;let resumed:unknown;
    const store=createD1TurnStore(db,{ownerId:"owner",threadId:"thread",turnId:"original",requestId:"req"});
    const id=await store.requestApproval("key",{id:"call",name:"send",arguments:{id:"draft"}},{title:"Send",summary:"Review",target:{id:"draft",body:"exact"}});
    const app=new Hono<AppBindings>();registerNewAgentRoutes(app,{requireOwner:async()=>"owner",unauthorized:c=>c.json({error:"Unauthorized"},401)});
    const env={DB:db,ME3_ASSISTANT_RUNTIME:"agent",ME3_AGENT:{idFromName:()=>"owner",get:()=>({fetch:async(_url:string,init:RequestInit)=>{resumes++;resumed=JSON.parse(init.body as string);return Response.json({ok:true,turnId:"original"});}})}};
    const first=await app.request(`/api/assistant/approvals/${id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:'{"decision":"approved"}'},env);
    expect(first.status).toBe(200);expect(resumed).toEqual({userId:"owner",turnId:"original"});
    const second=await app.request(`/api/assistant/approvals/${id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:'{"decision":"declined"}'},env);
    expect(second.status).toBe(409);expect(resumes).toBe(1);expect(await store.approvalDecision(id)).toBe("approved");
  });
  it("does not disclose or approve another owner's record and does not allow model confirmation fields",async()=>{
    const db=database();let calls=0;const store=createD1TurnStore(db,{ownerId:"other",threadId:"thread",turnId:"turn",requestId:"req"});
    const id=await store.requestApproval("key",{id:"call",name:"delete",arguments:{}},{title:"Delete",summary:"Private"});
    const app=new Hono<AppBindings>();registerNewAgentRoutes(app,{requireOwner:async()=>"owner",unauthorized:c=>c.json({error:"Unauthorized"},401)});
    const env={DB:db,ME3_ASSISTANT_RUNTIME:"agent",ME3_AGENT:{idFromName:()=>"owner",get:()=>({fetch:async()=>{calls++;return Response.json({ok:true});}})}};
    const list=await app.request("/api/assistant/approvals",{},env);expect((await list.json() as {approvals:unknown[]}).approvals).toHaveLength(0);
    const hidden=await app.request(`/api/assistant/approvals/${id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:'{"decision":"approved"}'},env);expect(hidden.status).toBe(404);
    const invalid=await app.request(`/api/assistant/approvals/${id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:'{"confirmed":true}'},env);expect(invalid.status).toBe(400);expect(calls).toBe(0);
  });
});
