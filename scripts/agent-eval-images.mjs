// Image transport is always simulated, including in a paid text-candidate eval.
// Native Worker persistence, billing receipts and target validation still run.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWu0AAAAASUVORK5CYII=";
const buckets = new WeakMap();

function imageBucket(seed) {
  if (buckets.has(seed)) return buckets.get(seed);
  const objects = new Map();
  const metadata = (key, object) => ({ key, size: object.bytes.byteLength, etag: "synthetic-image-etag", httpMetadata: object.options.httpMetadata || {}, customMetadata: object.options.customMetadata || {} });
  const bucket = {
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const object = { bytes, options }; objects.set(key, object);
      return metadata(key, object);
    },
    async get(key) {
      const object = objects.get(key); if (!object) return null;
      return { ...metadata(key, object), body: new Response(object.bytes).body,
        async arrayBuffer() { return object.bytes.slice().buffer; },
        async text() { return new TextDecoder().decode(object.bytes); } };
    },
    async head(key) { const object = objects.get(key); return object ? metadata(key, object) : null; },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
  };
  buckets.set(seed, bucket);
  return bucket;
}

export function createSeededImageServices(seed, options = {}) {
  const env = { DB: seed.db, SITE_ASSETS: imageBucket(seed), ME3_DEPLOYMENT_MODE: "self_hosted",
    ME3_AI_IMAGE_GENERATION_MODEL: "openai/gpt-image-2",
    AI: { async run(...args) {
      options.onImageProviderCall?.(...args);
      return options.imageTransport ? options.imageTransport(...args) : { data: [{ b64_json: PNG }],
        usage: { input_tokens: 10, output_tokens: 1800, total_tokens: 1810, input_tokens_details: { text_tokens: 10, image_tokens: 0 } } };
    } },
  };
  return { async generate(prompt, context) {
    const { createAgentImageGenerationServices } = await import("../apps/worker/src/agent-image-generation.ts");
    return createAgentImageGenerationServices(env, seed.ownerId).generate(prompt, context);
  } };
}

export function imageAgentEvalScenarios() {
  const prompt = "A calm abstract image with soft blue circles on a cream background.";
  const call = { name: "core_images_generate", arguments: { prompt } };
  return [{
    id: "image-generated-once",
    setup(seed) { seed.raw.prepare("INSERT INTO plugin_installations(plugin_id,version,enabled,status) VALUES('me3.files','eval',0,'installed')").run(); },
    turns: [{ prompt: "Generate one private image with soft blue circles on a cream background for this conversation. Keep it here and don't publish it.", calls: [call, { ...call, arguments: { ...call.arguments } }] }],
    allowedWrites: {
      me3_agent_image_operations: row => row.owner_id === "eval-owner" && row.thread_id === "eval-thread",
      assistant_attachments: row => row.owner_id === "eval-owner" && row.thread_id === "eval-thread" && row.kind === "image",
      ai_usage_events: row => row.user_id === "eval-owner" && row.kind === "image",
    },
    maxNewRows: { me3_agent_image_operations: 1, assistant_attachments: 1, ai_usage_events: 1 },
    rubric: "Generate exactly one private image for this conversation through the image tool, and ground completion in its authoritative returned asset. The provider is simulated; assess request/receipt/persistence rather than visual pixel quality. Do not publish, write to Files, invent an image, or generate twice. Files being disabled does not block this Core capability.",
    check: generatedImageMatchesReceipt,
  }];
}

export function generatedImageMatchesReceipt(seed, results) {
  const operations = seed.raw.prepare("SELECT * FROM me3_agent_image_operations").all();
  const attachments = seed.raw.prepare("SELECT * FROM assistant_attachments").all();
  if (operations.length !== 1 || attachments.length !== 1 || seed.raw.prepare("SELECT COUNT(*) AS n FROM drive_files").get().n !== 0) return false;
  const operation = operations[0], attachment = attachments[0];
  if (operation.status !== "complete" || operation.owner_id !== seed.ownerId || operation.thread_id !== "eval-thread" ||
      operation.attachment_id !== attachment.id || attachment.owner_id !== seed.ownerId || attachment.thread_id !== "eval-thread" ||
      attachment.status !== "ready" || attachment.kind !== "image" || operation.storage_key !== attachment.storage_key ||
      operation.mime_type !== attachment.mime_type || operation.size !== attachment.size || !operation.sha256) return false;
  const metadata = JSON.parse(attachment.metadata_json);
  if (metadata.operationId !== operation.id || metadata.sha256 !== operation.sha256) return false;
  const usage = seed.raw.prepare("SELECT * FROM ai_usage_events WHERE id = ? AND user_id = ? AND kind = 'image'").get(operation.usage_event_id, seed.ownerId);
  if (!usage || JSON.parse(usage.metadata_json).costKnown !== true) return false;
  return results.some(receipt => {
    if (receipt.tool_name !== "core_images_generate" || receipt.status !== "succeeded") return false;
    let data; try { data = JSON.parse(receipt.result_json).result; } catch { return false; }
    const action = data?.imageAction, asset = action?.assets?.[0];
    return data?.operationId === operation.id && action?.kind === "generated" && action.status === "complete" && action.assets.length === 1 &&
      asset.attachmentId === attachment.id && asset.id === attachment.id && asset.storageKey === attachment.storage_key &&
      asset.mimeType === attachment.mime_type && asset.size === attachment.size && asset.width === operation.width && asset.height === operation.height &&
      asset.url === `/api/assistant/attachments/${encodeURIComponent(attachment.id)}/content`;
  });
}
