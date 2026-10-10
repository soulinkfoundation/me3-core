import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AgentCheckpoint, AgentDb } from "../../../packages/agent/src/types";
import { executeNewAgentTurn, type NewAgentDispatchInput } from "./agent-runtime";
import type { Env } from "./types";
import { registerAssistantRoutes } from "./routes/assistant";

vi.mock("./ai-providers", () => ({ getAiSettings: async () => ({ defaults: { chat: { providerId: "openai", model: "gpt-5.5" } } }) }));
vi.mock("./ai-gateway", () => ({ getAiGatewayRuntimeConfig: async () => ({ gatewayId: "fixture" }) }));
vi.mock("./plugins", () => ({ listCorePluginRecords: async () => [] }));
vi.mock("../../../packages/agent-chat/src/owner-snapshot", () => ({ loadOwnerSnapshotContext: async () => ({ prompt: "Synthetic owner" }) }));
vi.mock("./agent-domain-scheduling", () => ({ createStableAgentSchedulingServices: () => ({}) }));
vi.mock("./agent-mailbox-services", () => ({ createAgentMailboxServices: () => ({}) }));
vi.mock("./network-directory", () => ({ createPeopleSearchToolServices: () => ({}) }));
vi.mock("./web-research", () => ({ createWebResearchToolServices: () => ({}) }));
vi.mock("../../../packages/agent/src/tools", () => ({ createDomainTools: () => [] }));
vi.mock("./managed-runtime-lifecycle", () => ({ isManagedRuntime: (env:Env) => env.ME3_DEPLOYMENT_MODE === "managed", beginManagedRuntimeWriteLease: async () => "fixture-lease", releaseManagedRuntimeWriteLease: async () => {} }));

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.unstubAllGlobals(); });
const storageKey = "assistant/owner/synthetic-image.png";
const input = {
  userId: "owner", threadId: "thread", turnId: "turn", requestId: "request", messageText: "Describe this synthetic image",
  attachments: [{ id: "image-1", kind: "image", storageKey, mimeType: "image/jpeg" }],
} as NewAgentDispatchInput;

function fixture(imageSize=3) {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username) VALUES('owner','synthetic'),('other-owner','other-synthetic');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic'),('other-thread','owner','Other synthetic'),('foreign-thread','other-owner','Foreign synthetic');`);
  raw.prepare(`INSERT INTO assistant_attachments(id,owner_id,thread_id,filename,mime_type,size,kind,status,storage_key)
    VALUES('image-1','owner','thread','synthetic.png','image/png',?,'image','ready',?)`).run(imageSize,storageKey);
  const db: AgentDb = { prepare(sql) {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { if(args.some(value=>typeof value==="string"&&new TextEncoder().encode(value).byteLength>2_000_000))throw new Error("Simulated D1 string/BLOB row limit"); values = args; return statement; }, async first<T>() { return (query.get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: query.all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; } }; return statement;
  }, async batch(statements) { raw.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
  const bytes=new Uint8Array(imageSize); bytes.set([1,2,3]);
  const readR2 = vi.fn(async () => ({ size: imageSize, arrayBuffer: async () => bytes.buffer }));
  const runModel = vi.fn(async () => ({ choices: [{ message: { content: "Synthetic image inspected." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  const env = { DB: db, ME3_DEPLOYMENT_MODE: "self_hosted", SITE_ASSETS: { get: readR2 }, AI: { run: runModel } } as unknown as Env;
  return { raw, env, readR2, runModel };
}

function resumeSavedTurn(raw:DatabaseSync) {
  const saved=String(raw.prepare("SELECT checkpoint_json FROM me3_agent_turns WHERE turn_id='turn'").get()!.checkpoint_json);
  const state=JSON.parse(saved) as AgentCheckpoint; state.status="running";
  raw.prepare("UPDATE me3_agent_turns SET status='running',checkpoint_json=? WHERE turn_id='turn'").run(JSON.stringify(state));
  return saved;
}

describe("new runtime image input from canonical uploaded attachments", () => {
  it("loads an actual uploaded image from migrated tables and uses authoritative MIME rather than client MIME", async () => {
    const f = fixture();
    expect(await executeNewAgentTurn(f.env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(f.readR2).toHaveBeenCalledExactlyOnceWith(storageKey);
    expect(f.runModel).toHaveBeenCalledTimes(1);
    const request = f.runModel.mock.calls[0] as unknown as [string, { messages: Array<{ role: string; content: unknown }> }];
    expect(request[1].messages.find(message => message.role === "user")?.content).toEqual([
      { type: "text", text: input.messageText }, { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
  });
  it("accepts an owner-scoped upload staged without a thread for the first message", async () => {
    const f = fixture(); f.raw.exec("UPDATE assistant_attachments SET thread_id=NULL WHERE id='image-1'");
    expect(await executeNewAgentTurn(f.env, input, new AbortController().signal)).toMatchObject({ status: "complete" });
    expect(f.raw.prepare("SELECT thread_id FROM assistant_attachments WHERE id='image-1'").get()).toMatchObject({ thread_id: "thread" });
    expect(f.readR2).toHaveBeenCalledExactlyOnceWith(storageKey);
    expect(f.runModel).toHaveBeenCalledTimes(1);
  });
  it("keeps authoritative uploaded image metadata visible through the actual history route after reload",async()=>{
    const f=fixture(); await executeNewAgentTurn(f.env,input,new AbortController().signal);
    const app=new Hono<{Bindings:Env}>();
    registerAssistantRoutes(app,{requireOwner:async()=>"owner",unauthorized:()=>new Response("Unauthorized",{status:401}),getSessionOwnerId:async()=>"owner",getSetupRequired:async()=>[]});
    const response=await app.request("/api/assistant/threads/thread/messages",{},f.env);
    expect(response.status).toBe(200);
    const history=await response.json() as {messages:Array<{role:string;attachments?:unknown[]}>};
    expect(history.messages.find(message=>message.role==="user")?.attachments).toEqual([
      {id:"image-1",name:"synthetic.png",mimeType:"image/png",size:3,kind:"image",status:"ready",storageKey,hasText:false,textTruncated:false},
    ]);
  });
  it("blocks a selected text-only native model before R2 or paid admission",async()=>{
    const f=fixture();
    expect(await executeNewAgentTurn(f.env,{...input,selectedModel:{providerId:"workers-ai",model:"@cf/zai-org/glm-4.7-flash"}},new AbortController().signal)).toMatchObject({status:"failed",replyText:expect.stringMatching(/model.*cannot read images/i)});
    expect(f.readR2).not.toHaveBeenCalled(); expect(f.runModel).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({count:0});
  });
  it("rechecks vision capability on a text-only backup after the primary transport fails",async()=>{
    const f=fixture(); f.env.ME3_AI_CHAT_BACKUP_MODEL="@cf/zai-org/glm-4.7-flash";
    f.runModel.mockRejectedValue(new Error("Synthetic primary transport failure"));
    expect(await executeNewAgentTurn(f.env,input,new AbortController().signal)).toMatchObject({status:"failed",replyText:expect.stringMatching(/model.*cannot read images/i)});
    expect(f.readR2).toHaveBeenCalledTimes(1); expect(f.runModel).toHaveBeenCalledTimes(1);
    expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({count:1});
  });
  it("blocks the actual hosted text-only budget fallback before R2 or paid admission",async()=>{
    const f=fixture(); f.env.ME3_DEPLOYMENT_MODE="managed";
    f.env.ME3_COMMERCE_BRIDGE_ORIGIN="https://billing.example.invalid"; f.env.ME3_COMMERCE_BRIDGE_TOKEN="synthetic-fixture";
    const policy={available:true,managed:true,currency:"usd",billingSource:"internal",defaultModel:"openai/gpt-5.5",models:[{id:"openai/gpt-5.5",label:"Synthetic",description:"Synthetic",recommended:false}],eligible:true,ineligibleReason:null,overagesEnabled:false,includedMonthlyCents:500,monthlyMaximumCents:500,minimumMonthlyMaximumCents:600,maximumMonthlyMaximumCents:50000,currentMonth:new Date().toISOString().slice(0,7),currentMonthUsageMicrousd:5000000,currentMonthBillableMicrousd:0,effectiveMaximumCents:500,fallbackActive:true};
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json(policy)));
    expect(await executeNewAgentTurn(f.env,input,new AbortController().signal)).toMatchObject({status:"failed",replyText:expect.stringMatching(/model.*cannot read images/i)});
    expect(f.readR2).not.toHaveBeenCalled(); expect(f.runModel).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({count:0});
  });
  it("atomically binds a staged image to only one of two concurrent conversations before bytes/model admission", async () => {
    const f = fixture(); f.raw.exec("UPDATE assistant_attachments SET thread_id=NULL WHERE id='image-1'");
    const outcomes = await Promise.allSettled([
      executeNewAgentTurn(f.env, input, new AbortController().signal),
      executeNewAgentTurn(f.env, { ...input, threadId: "other-thread", turnId: "other-turn", requestId: "other-request" }, new AbortController().signal),
    ]);
    const success = outcomes.filter(result => result.status === "fulfilled");
    expect(success).toHaveLength(1); expect(success[0]).toMatchObject({ value: { status: "complete" } });
    expect(outcomes.filter(result => result.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ message: expect.stringMatching(/image.*unavailable/i) }) })]);
    expect(f.raw.prepare("SELECT thread_id FROM assistant_attachments WHERE id='image-1'").get()).toMatchObject({ thread_id: success[0].status === "fulfilled" ? success[0].value.threadId : undefined });
    expect(f.readR2).toHaveBeenCalledTimes(1); expect(f.runModel).toHaveBeenCalledTimes(1);
  });
  it("keeps a normal 2MB+ photo out of canonical D1 while sending true image bytes, then resolves it again on fresh runtime resume", async () => {
    const f=fixture(2_100_000);
    expect(await executeNewAgentTurn(f.env,input,new AbortController().signal)).toMatchObject({status:"complete"});
    const saved=resumeSavedTurn(f.raw);
    expect(new TextEncoder().encode(saved).byteLength).toBeLessThan(10_000);
    expect(saved).toContain("me3-attachment:image-1"); expect(saved).not.toContain("data:image");
    const request=f.runModel.mock.calls[0] as unknown as [string,{messages:Array<{role:string;content:unknown}>}];
    const content=request[1].messages.find(message=>message.role==="user")!.content as Array<{image_url?:{url:string}}>;
    expect(content[1].image_url?.url).toMatch(/^data:image\/png;base64,AQID/);
    expect(content[1].image_url!.url.length).toBeGreaterThan(2_000_000);
    f.readR2.mockClear(); f.runModel.mockClear();
    expect(await executeNewAgentTurn({...f.env},input,new AbortController().signal)).toMatchObject({status:"complete"});
    expect(f.readR2).toHaveBeenCalledExactlyOnceWith(storageKey); expect(f.runModel).toHaveBeenCalledTimes(1);
  });
  it.each([
    "UPDATE assistant_attachments SET owner_id='other-owner',thread_id='foreign-thread' WHERE id='image-1'",
    "UPDATE assistant_attachments SET thread_id='other-thread' WHERE id='image-1'",
    "UPDATE assistant_attachments SET status='deleted' WHERE id='image-1'",
    "UPDATE assistant_attachments SET status='error' WHERE id='image-1'",
  ])("revalidates persisted image references on fresh resume before bytes/model admission: %s", async update=>{
    const f=fixture(); await executeNewAgentTurn(f.env,input,new AbortController().signal); resumeSavedTurn(f.raw);
    f.raw.exec(update); f.readR2.mockClear(); f.runModel.mockClear();
    expect(await executeNewAgentTurn({...f.env},input,new AbortController().signal)).toMatchObject({status:"failed",replyText:expect.stringMatching(/image.*unavailable/i)});
    expect(f.readR2).not.toHaveBeenCalled(); expect(f.runModel).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({count:1});
  });
  it("rejects more than four images or aggregate metadata over 10MiB before reading bytes or admitting a model", async()=>{
    const f=fixture();
    await expect(executeNewAgentTurn(f.env,{...input,attachments:Array.from({length:5},()=>input.attachments![0])},new AbortController().signal)).rejects.toThrow(/four/i);
    f.raw.exec("UPDATE assistant_attachments SET size=6291456 WHERE id='image-1'");
    f.raw.exec("INSERT INTO assistant_attachments(id,owner_id,thread_id,filename,mime_type,size,kind,status,storage_key) VALUES('image-2','owner','thread','second.png','image/png',6291456,'image','ready','assistant/owner/second.png')");
    await expect(executeNewAgentTurn(f.env,{...input,attachments:[input.attachments![0],{id:"image-2",kind:"image",storageKey:"assistant/owner/second.png"}]},new AbortController().signal)).rejects.toThrow(/10MiB/i);
    expect(f.readR2).not.toHaveBeenCalled(); expect(f.runModel).not.toHaveBeenCalled();
  });
  it("checks aggregate object size and actual bytes rather than trusting smaller stored metadata", async()=>{
    const f=fixture();
    f.readR2.mockResolvedValue({size:10*1024*1024+1,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
    expect(await executeNewAgentTurn(f.env,input,new AbortController().signal)).toMatchObject({status:"failed",replyText:expect.stringContaining("10MiB")});
    expect(f.runModel).not.toHaveBeenCalled();
    f.readR2.mockResolvedValue({size:3,arrayBuffer:async()=>new Uint8Array(10*1024*1024+1).buffer});
    expect(await executeNewAgentTurn(f.env,{...input,turnId:"bytes-turn",requestId:"bytes-request"},new AbortController().signal)).toMatchObject({status:"failed",replyText:expect.stringContaining("10MiB")});
    expect(f.runModel).not.toHaveBeenCalled(); expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({count:0});
  });
  it("honors cancellation after R2 access and before paid receipt/model admission", async()=>{
    const f=fixture(); const controller=new AbortController();
    f.readR2.mockImplementation(async()=>{controller.abort("Synthetic owner Stop");return{size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};});
    expect(await executeNewAgentTurn(f.env,input,controller.signal)).toMatchObject({status:"cancelled"});
    expect(f.runModel).not.toHaveBeenCalled(); expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({count:0});
  });
  it.each([
    "UPDATE assistant_attachments SET status='deleted' WHERE id='image-1'",
    "UPDATE assistant_attachments SET owner_id='other-owner',thread_id='foreign-thread' WHERE id='image-1'",
    "UPDATE assistant_attachments SET thread_id='other-thread' WHERE id='image-1'",
    "UPDATE assistant_attachments SET kind='text' WHERE id='image-1'",
    "UPDATE assistant_attachments SET storage_key='assistant/owner/replacement.png' WHERE id='image-1'",
    "UPDATE assistant_attachments SET mime_type='image/jpeg' WHERE id='image-1'",
    "UPDATE assistant_attachments SET size=4 WHERE id='image-1'",
  ])("rejects the stored image snapshot changed while R2 bytes load, before paid receipt/model admission: %s", async update=>{
    const f=fixture();
    f.readR2.mockResolvedValue({size:3,arrayBuffer:async()=>{f.raw.exec(update);return new Uint8Array([1,2,3]).buffer;}});
    expect(await executeNewAgentTurn(f.env,input,new AbortController().signal)).toMatchObject({status:"failed",replyText:expect.stringMatching(/image.*unavailable/i)});
    expect(f.runModel).not.toHaveBeenCalled(); expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({count:0});
  });
  it("cannot claim a staged owner upload into a foreign owner's conversation",async()=>{
    const f=fixture(); f.raw.exec("UPDATE assistant_attachments SET thread_id=NULL WHERE id='image-1'");
    await expect(executeNewAgentTurn(f.env,{...input,threadId:"foreign-thread"},new AbortController().signal)).rejects.toThrow(/conversation.*owner/i);
    expect(f.readR2).not.toHaveBeenCalled(); expect(f.runModel).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT thread_id FROM assistant_attachments WHERE id='image-1'").get()).toMatchObject({thread_id:null});
  });
  it.each([
    ["another owner", "UPDATE assistant_attachments SET owner_id='other-owner',thread_id='foreign-thread' WHERE id='image-1'"],
    ["another conversation", "UPDATE assistant_attachments SET thread_id='other-thread' WHERE id='image-1'"],
    ["unready image", "UPDATE assistant_attachments SET status='error' WHERE id='image-1'"],
    ["deleted image", "UPDATE assistant_attachments SET status='deleted' WHERE id='image-1'"],
    ["text attachment", "UPDATE assistant_attachments SET kind='text' WHERE id='image-1'"],
    ["non-image stored MIME", "UPDATE assistant_attachments SET mime_type='text/plain' WHERE id='image-1'"],
    ["unsupported SVG", "UPDATE assistant_attachments SET mime_type='image/svg+xml' WHERE id='image-1'"],
    ["unsupported HEIC", "UPDATE assistant_attachments SET mime_type='image/heic' WHERE id='image-1'"],
  ])("rejects %s before reading bytes or calling the model", async (_label, update) => {
    const f = fixture(); f.raw.exec(update);
    await expect(executeNewAgentTurn(f.env, input, new AbortController().signal)).rejects.toThrow(/image.*unavailable/i);
    expect(f.readR2).not.toHaveBeenCalled(); expect(f.runModel).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({ count: 0 });
  });
  it.each([
    { id: "image-1", kind: "image", storageKey: "assistant/arbitrary/not-the-upload.png" },
    { id: "invented", kind: "image", storageKey },
    { kind: "image", storageKey },
  ])("rejects an unverified attachment identity or storage key: %j", async attachment => {
    const f = fixture();
    await expect(executeNewAgentTurn(f.env, { ...input, attachments: [attachment] }, new AbortController().signal)).rejects.toThrow(/image.*unavailable/i);
    expect(f.readR2).not.toHaveBeenCalled(); expect(f.runModel).not.toHaveBeenCalled();
  });
});
