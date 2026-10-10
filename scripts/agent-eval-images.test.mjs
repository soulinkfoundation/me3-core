import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

const PROMPT = "A calm abstract image with soft blue circles on a cream background.";
function scope(seed, key = "image-fixture-key") {
  seed.raw.prepare("INSERT OR IGNORE INTO assistant_threads (id,owner_id,title) VALUES ('eval-thread',?,'Synthetic image evaluation')").run(seed.ownerId);
  seed.raw.prepare("INSERT OR IGNORE INTO me3_agent_turns (turn_id,owner_id,thread_id,request_id) VALUES ('image-fixture-turn',?,'eval-thread','image-fixture-request')").run(seed.ownerId);
  seed.raw.prepare("INSERT OR IGNORE INTO me3_agent_tool_receipts (owner_id,idempotency_key,turn_id,tool_name,arguments_json,status) VALUES (?,?,'image-fixture-turn','core_images_generate',?,'running')").run(seed.ownerId, key, JSON.stringify({ prompt: PROMPT }));
  return { idempotencyKey: key, threadId: "eval-thread", turnId: "image-fixture-turn", requestId: "image-fixture-request", signal: new AbortController().signal };
}

test("synthetic image generation uses native owned receipts and reopens without a second provider operation", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  let providerCalls = 0;
  try {
    const options = scope(seed);
    const service = createSeededEvalServices(seed, { onImageProviderCall() { providerCalls++; } }).images;
    const first = await service.generate(PROMPT, options);
    assert.equal(first.status, "complete"); assert.equal(first.action.kind, "generated");
    assert.equal(first.action.status, "complete"); assert.equal(first.action.assets.length, 1);
    const asset = first.action.assets[0];
    const attachment = seed.raw.prepare("SELECT * FROM assistant_attachments WHERE id = ?").get(asset.attachmentId);
    assert.equal(attachment.owner_id, seed.ownerId); assert.equal(attachment.thread_id, options.threadId);
    assert.equal(attachment.status, "ready"); assert.equal(attachment.mime_type, "image/png");
    assert.ok(attachment.size > 0); assert.equal(attachment.storage_key, asset.storageKey);
    const original = seed.raw; seed.reopen(); assert.notEqual(seed.raw, original);
    const repeated = await createSeededEvalServices(seed, { onImageProviderCall() { providerCalls++; } }).images.generate(PROMPT, options);
    assert.equal(repeated.status, "complete"); assert.equal(repeated.operationId, first.operationId);
    assert.deepEqual(repeated.action.assets, first.action.assets);
    assert.equal(providerCalls, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM me3_agent_image_operations").get().n, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM assistant_attachments").get().n, 1);
    assert.equal(seed.raw.prepare("SELECT status FROM me3_agent_tool_receipts WHERE idempotency_key = ?").get(options.idempotencyKey).status, "finished");
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM drive_files").get().n, 0);
  } finally { seed.close(); }
});

test("stopped image requests never reach the synthetic provider or create an attachment", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10"); let providerCalls = 0;
  try {
    const options = scope(seed); const controller = new AbortController(); controller.abort();
    const result = await createSeededEvalServices(seed, { onImageProviderCall() { providerCalls++; } }).images.generate(PROMPT, { ...options, signal: controller.signal });
    assert.notEqual(result.status, "complete"); assert.equal(providerCalls, 0);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM assistant_attachments").get().n, 0);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM me3_agent_image_operations").get().n, 0);
  } finally { seed.close(); }
});

test("uncertain synthetic image failures preserve an unknown operation and billing hold across reopen", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10"); let providerCalls = 0;
  try {
    const options = scope(seed);
    const transport = { onImageProviderCall() { providerCalls++; }, imageTransport: async () => { throw new Error("Synthetic image provider rejected the request"); } };
    const result = await createSeededEvalServices(seed, transport).images.generate(PROMPT, options);
    assert.equal(result.status, "unknown"); assert.equal(providerCalls, 1);
    assert.match(result.error, /synthetic|provider|image/i);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM assistant_attachments").get().n, 0);
    const operation = seed.raw.prepare("SELECT * FROM me3_agent_image_operations WHERE id = ?").get(result.operationId);
    assert.equal(operation.status, "unknown");
    const hold = seed.raw.prepare("SELECT metadata_json FROM ai_usage_events WHERE id = ?").get(operation.usage_event_id);
    assert.equal(JSON.parse(hold.metadata_json).costKnown, false);
    seed.reopen();
    const repeated = await createSeededEvalServices(seed, transport).images.generate(PROMPT, options);
    assert.equal(repeated.status, "unknown"); assert.equal(repeated.operationId, result.operationId); assert.equal(providerCalls, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM ai_usage_events").get().n, 1);
  } finally { seed.close(); }
});

test("the real runtime adapter generates one private image with Files disabled and preserves the authoritative receipt", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10"); let providerCalls = 0;
  try {
    const { createAgentEvalScenarios } = await import("./agent-eval-scenarios.mjs");
    const { createRuntimeAdapter } = await import("./agent-eval-adapters.mjs");
    const scenario = createAgentEvalScenarios(seed.baseDate).find(item => item.id === "image-generated-once");
    scenario.setup(seed);
    const response = await createRuntimeAdapter("new").runTurn({ seed, ownerId: seed.ownerId,
      messages: [{ role: "user", content: scenario.turns[0].prompt }], requestId: "image-runtime-request", turnId: "image-runtime-turn", ownerTimezone: "Europe/Dublin",
      modelRoute: { model: "scripted-fixture" }, services: createSeededEvalServices(seed, { onImageProviderCall() { providerCalls++; } }),
      enabledPluginIds: new Set(), fixtureCalls: scenario.turns[0].calls, fixtureReply: "The private image is ready in this conversation.", onEvent() {} });
    assert.equal(response.status, "complete"); assert.equal(providerCalls, 1);
    seed.reopen();
    assert.equal(scenario.check(seed, response.toolResults), true);
    assert.equal(seed.raw.prepare("SELECT enabled FROM plugin_installations WHERE plugin_id = 'me3.files'").get().enabled, 0);
    seed.raw.prepare("UPDATE assistant_attachments SET status = 'deleted'").run();
    assert.equal(scenario.check(seed, response.toolResults), false);
  } finally { seed.close(); }
});
