import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1TurnStore, runAgentTurn } from "../../../packages/agent/src";
import { createDomainTools } from "../../../packages/agent/src/tools";
import type { AgentDb, AgentMessage, AgentModel, AgentToolContext } from "../../../packages/agent/src/types";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
const identity = { ownerId: "owner", threadId: "thread", turnId: "image-turn", requestId: "image-request" };
const prompt = "A small blue bird on a plain background";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "me3-image-tool-"));
  const path = join(directory, "fixture.sqlite");
  let raw = new DatabaseSync(path);
  cleanup.push(() => { raw.close(); rmSync(directory, { recursive: true, force: true }); });
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username) VALUES('owner','synthetic');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic image');`);
  const db: AgentDb = { prepare(sql) {
    let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; } };
    return statement;
  } };
  // Simulated image provider; the real turn loop, receipts and attachment table use migrated SQLite.
  const generate = vi.fn(async (text: string, input: { threadId: string; idempotencyKey: string }) => {
    const asset = { id: "generated-asset", attachmentId: "generated-asset", name: "generated.png", mimeType: "image/png", size: 68, width: 1024, height: 1024, url: "/api/assistant/attachments/generated-asset/content", storageKey: "assistant/owner/generated/generated.png" };
    raw.prepare(`INSERT INTO assistant_attachments(id,owner_id,thread_id,filename,mime_type,size,kind,status,storage_key,metadata_json)
      VALUES(?,'owner',?,?,?,?,'image','ready',?,?)`).run(asset.id,input.threadId,asset.name,asset.mimeType,asset.size,asset.storageKey,JSON.stringify({ operationId: input.idempotencyKey }));
    return { status: "complete", operationId: input.idempotencyKey, action: { kind: "generated", status: "complete", prompt: text, revisedPrompt: null, providerId: "workers-ai", model: "openai/gpt-image-2", reason: null, assets: [asset] } };
  });
  const context: AgentToolContext = { ...identity, db, toolCallId: "image-call", idempotencyKey: "direct-key", ownerTimezone: "UTC", messageText: `Generate an image: ${prompt}`, messages: [], enabledPluginIds: new Set(), services: { images: { generate } }, signal: new AbortController().signal };
  const tool = createDomainTools().find(tool => tool.name === "core_images_generate");
  if (!tool) throw new Error("Missing declarative Core image generation tool");
  const model: AgentModel = { id: "synthetic", async step(input) {
    const outputs = input.messages.filter(message => message.role === "tool");
    return { text: outputs.length ? "The image result is saved." : "", toolCalls: outputs.length ? [] : [{ id: "image-call", name: tool.name, arguments: { prompt } }] };
  } };
  const run = () => runAgentTurn({ model, tools: [tool], messages: [{ role: "user", content: context.messageText }], context, store: createD1TurnStore(db, identity), signal: context.signal });
  return { get raw() { return raw; }, db, context, tool, generate, model, run, reopen() { raw.close(); raw = new DatabaseSync(path); } };
}

describe("declarative private Core image generation", () => {
  it("declares a prompt-only private write without a publication or provider override", () => {
    const f = fixture();
    expect(f.tool).toMatchObject({ effect: "write", approval: "none", pluginId: null });
    expect(f.tool.parameters).toMatchObject({ required: ["prompt"], additionalProperties: false });
    expect(Object.keys(f.tool.parameters.properties as object)).toEqual(["prompt"]);
  });

  it("saves an authenticated image result with Files disabled and passes only server-owned context", async () => {
    const f = fixture(); const result = await f.tool.execute({ prompt }, f.context);
    expect(result).toMatchObject({ status: "ok", data: { operationId: "direct-key", imageAction: { kind: "generated", status: "complete", assets: [{ attachmentId: "generated-asset", url: "/api/assistant/attachments/generated-asset/content" }] } } });
    expect(f.generate).toHaveBeenCalledExactlyOnceWith(prompt, { idempotencyKey: "direct-key", threadId: "thread", turnId: "image-turn", requestId: "image-request", signal: f.context.signal });
    expect(f.raw.prepare("SELECT owner_id,thread_id,kind,status FROM assistant_attachments").get()).toMatchObject({ owner_id: "owner", thread_id: "thread", kind: "image", status: "ready" });
    expect(f.raw.prepare("SELECT COUNT(*) count FROM drive_files").get()).toMatchObject({ count: 0 });
  });

  it.each([{ model: "unapproved/model" }, { provider: "direct-key" }, { assetId: "foreign-asset" }, { publish: true }, { prompt: " " }, { prompt: "x".repeat(4_001) }])("rejects undeclared or invalid input before an image operation: %j", async extra => {
    const f = fixture();
    expect(await f.tool.execute({ prompt, ...extra }, f.context)).toMatchObject({ status: "error" });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM assistant_attachments").get()).toMatchObject({ count: 0 });
  });

  it("does not admit an image operation after Stop", async () => {
    const f = fixture(); const controller = new AbortController(); f.context.signal = controller.signal; controller.abort("Owner Stop");
    expect(await f.tool.execute({ prompt }, f.context)).toMatchObject({ status: "error" });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM assistant_attachments").get()).toMatchObject({ count: 0 });
  });

  it("reports an unknown provider result as a held operation rather than an asset or success", async () => {
    const f = fixture(); f.context.services = { images: { generate: vi.fn(async () => ({ status: "unknown", operationId: "held-operation", error: "Provider outcome needs reconciliation" })) } };
    expect(await f.tool.execute({ prompt }, f.context)).toMatchObject({ status: "error", operationId: "held-operation", reconciliationRequired: true });
    expect(f.raw.prepare("SELECT COUNT(*) count FROM assistant_attachments").get()).toMatchObject({ count: 0 });
  });

  it("recovers the successful receipt after reopening without a second simulated provider operation", async () => {
    const f = fixture(); expect((await f.run()).status).toBe("complete");
    const state = JSON.parse(String(f.raw.prepare("SELECT checkpoint_json FROM me3_agent_turns WHERE turn_id=?").get(identity.turnId)!.checkpoint_json));
    state.status = "running"; state.pendingCalls = [{ id: "image-call", name: f.tool.name, arguments: { prompt } }]; state.nextCallIndex = 0;
    state.messages = state.messages.filter((message: AgentMessage) => message.role !== "tool" && !(message.role === "assistant" && !message.toolCalls?.length));
    f.raw.prepare("UPDATE me3_agent_turns SET status='running',checkpoint_json=? WHERE turn_id=?").run(JSON.stringify(state),identity.turnId);
    f.reopen(); expect((await f.run()).status).toBe("complete");
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.raw.prepare("SELECT COUNT(*) count FROM assistant_attachments").get()).toMatchObject({ count: 1 });
    expect(f.raw.prepare("SELECT status,result_json FROM me3_agent_tool_receipts").get()).toMatchObject({ status: "finished", result_json: expect.stringContaining('"imageAction"') });
    expect(String(f.raw.prepare("SELECT checkpoint_json FROM me3_agent_turns").get()!.checkpoint_json)).not.toContain("data:image");
  });
});
