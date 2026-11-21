import { imageDimensions } from "./site-images";
import type { Env } from "./types";

const MAX_BYTES = 10 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
export type GeneratedProviderImage = { bytes: Uint8Array; mimeType: string; width: number; height: number; revisedPrompt: string | null; usage: unknown };

async function boundedResponseBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) throw new Error("Image provider output is unavailable or too large");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new Error("Generated image exceeds the 10MiB limit");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** An input image to edit and the output size to ask for. Both providers take it beside the prompt. */
export type ProviderImageEdit = { reference: { bytes: Uint8Array; mimeType: string }; size: { width: number; height: number } };
function base64(bytes: Uint8Array): string { let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary); }

/** `onCompleted` runs once the provider reports a completed image, before its bytes are fetched. */
export async function generateAgentProviderImage(env: Env, model: string, prompt: string, gatewayId: string, signal: AbortSignal, metadata: Record<string,string>, onCompleted?: () => Promise<void>, edit?: ProviderImageEdit): Promise<GeneratedProviderImage> {
  signal.throwIfAborted();
  const ai = env.AI as unknown as { run(model: string, input: unknown, options: unknown): Promise<unknown> };
  const size = edit?.size ?? { width: 1024, height: 1024 };
  // OpenAI edits take `images[]` as base64 data URIs: https://developers.cloudflare.com/ai/models/openai/gpt-image-2/
  let input: unknown = { prompt, size: `${size.width}x${size.height}`, quality: "medium", output_format: "png", ...(edit ? { images: [`data:${edit.reference.mimeType};base64,${base64(edit.reference.bytes)}`] } : {}) };
  if (model.startsWith("@cf/")) {
    const form = new FormData(); form.set("prompt", prompt); form.set("width", String(size.width)); form.set("height", String(size.height));
    // FLUX.2 reference images are named input_image_0..3: https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/
    if (edit) form.set("input_image_0", new Blob([edit.reference.bytes.slice().buffer], { type: edit.reference.mimeType }), "reference");
    const request = new Request("https://image-generation.invalid", { method: "POST", body: form });
    input = { multipart: { body: request.body, contentType: request.headers.get("content-type") } };
  }
  // A paid image operation cannot be retried behind its durable admission or priced from a cache hit.
  const output = await ai.run(model, input, { gateway: { id: gatewayId, metadata, skipCache: true, retries: { maxAttempts: 1 } }, signal });
  signal.throwIfAborted();
  const root = record(output); const result = record(root?.result) ?? root;
  if (root?.success === false || (typeof result?.state === "string" && result.state !== "Completed")) throw new Error("Image provider did not return a completed image");
  await onCompleted?.();
  const item = Array.isArray(result?.data) && result.data.length === 1 ? record(result.data[0]) : null;
  let source = item?.b64_json ?? result?.image ?? result?.image_base64 ?? result?.b64_json;
  let bytes: Uint8Array;
  if (output instanceof Response) {
    bytes = await boundedResponseBytes(output, signal);
  } else if (output instanceof ArrayBuffer || ArrayBuffer.isView(output)) {
    bytes = output instanceof ArrayBuffer ? new Uint8Array(output) : new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
  } else if (typeof source === "string" && source.startsWith("https://")) {
    const url = new URL(source);
    // Unified Billing returns a presigned R2 URL (*.r2.cloudflarestorage.com); catalog examples use *.r2.dev.
    if (!(url.hostname.endsWith(".r2.dev") || url.hostname.endsWith(".r2.cloudflarestorage.com")) || url.username || url.password) throw new Error("Image provider output URL is not an approved private transport");
    // workerd throws on redirect "error"; "manual" returns a 3xx, which the ok check refuses.
    const response = await fetch(url, { redirect: "manual", signal });
    bytes = await boundedResponseBytes(response, signal);
  } else {
    if (typeof source !== "string") throw new Error("Image provider returned no single image");
    const base64 = source.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    if (base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 4) throw new Error("Generated image exceeds the 10MiB limit");
    const binary = atob(base64); bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("Generated image exceeds the 10MiB limit or is empty");
  const header = Array.from(bytes.slice(0, 8)).join(",");
  const mimeType = header === "137,80,78,71,13,10,26,10" ? "image/png" : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : null;
  const dimensions = imageDimensions(bytes.slice().buffer);
  if (!mimeType || !dimensions || dimensions.width > 4096 || dimensions.height > 4096) throw new Error("Image provider returned unsupported or invalid image bytes");
  const revisedPrompt = typeof item?.revised_prompt === "string" ? item.revised_prompt.slice(0, 4000) : typeof result?.revised_prompt === "string" ? result.revised_prompt.slice(0, 4000) : null;
  return { bytes, mimeType, ...dimensions, revisedPrompt, usage: result?.usage ?? root?.usage };
}

// Official native output-tile price: https://developers.cloudflare.com/workers-ai/platform/pricing/
const FLUX_KLEIN_1024_USD = 4 * 0.000287;
// Medium 1024 square, the size and quality every agent request asks for. See verifiedImageCost.
const GPT_IMAGE_MEDIUM_1024_USD = 0.053;

/** What one requested 1024 square costs before the gateway fee, or null when it is not fixed. */
export function requestedImageCostUsd(model: string): number | null {
  if (model === "@cf/black-forest-labs/flux-2-klein-4b") return FLUX_KLEIN_1024_USD;
  if (model === "openai/gpt-image-2" || model === "openai/gpt-image-2.5-sunburst") return GPT_IMAGE_MEDIUM_1024_USD;
  return null;
}

export function verifiedImageCost(model: string, image: GeneratedProviderImage): { baseCostUsd: number; inputTokens: number; outputTokens: number; pricingBasis: string; usageReported: boolean } | null {
  if (model === "@cf/black-forest-labs/flux-2-klein-4b" && image.width === 1024 && image.height === 1024) return { baseCostUsd: FLUX_KLEIN_1024_USD, inputTokens: 0, outputTokens: 0, pricingBasis: "workers-ai-flux-2-klein-4b-verified-output-tiles", usageReported: false };
  if (model !== "openai/gpt-image-2" && model !== "openai/gpt-image-2.5-sunburst") return null;
  // Direct Images API has text-only input here and no cache. Sunburst uses the same token rates.
  // https://developers.cloudflare.com/ai/models/openai/gpt-image-2/
  // https://developers.cloudflare.com/ai/models/openai/gpt-image-2.5-sunburst/
  // https://developers.openai.com/api/docs/guides/image-generation
  // The AI binding returns only an image URL with no token usage, so price the
  // requested medium 1024 square at the fixed estimate. Malformed usage still holds.
  if (image.usage === undefined) return image.width === 1024 && image.height === 1024 ? { baseCostUsd: GPT_IMAGE_MEDIUM_1024_USD, inputTokens: 0, outputTokens: 0, pricingBasis: `${model.slice("openai/".length)}-medium-1024x1024-estimate`, usageReported: false } : null;
  const usage = record(image.usage); const details = record(usage?.input_tokens_details);
  const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!usage || !details || ![usage.input_tokens, usage.output_tokens, usage.total_tokens, details.text_tokens, details.image_tokens].every(integer)) return null;
  const input = usage.input_tokens as number; const output = usage.output_tokens as number;
  if (details.image_tokens !== 0 || details.text_tokens !== input || usage.total_tokens !== input + output || output <= 0) return null;
  return { baseCostUsd: (input * 5 + output * 30) / 1_000_000, inputTokens: input, outputTokens: output, pricingBasis: `${model.slice("openai/".length)}-verified-text-input-image-output-tokens`, usageReported: true };
}

// Workers AI bills FLUX.2 klein per 512x512 tile: https://developers.cloudflare.com/workers-ai/platform/pricing/
const FLUX_KLEIN_OUTPUT_TILE_USD = 0.000287;
const FLUX_KLEIN_INPUT_TILE_USD = 0.000059;
// The AI binding reports no token usage, so one reference image is charged this allowance:
// about 2,500 image-input tokens at $8 per million. An estimate, like the output price above.
const GPT_IMAGE_EDIT_INPUT_USD = 0.02;
type Size = { width: number; height: number };
const openAiImage = (model: string) => model === "openai/gpt-image-2" || model === "openai/gpt-image-2.5-sunburst";

/** What one edit of this output size costs before the gateway fee, or null when it is not fixed. */
export function requestedImageEditCostUsd(model: string, size: Size): number | null {
  // The reference is at most one input tile (agent-image-edit.ts keeps it under 512px).
  if (model === "@cf/black-forest-labs/flux-2-klein-4b") return Math.ceil(size.width / 512) * Math.ceil(size.height / 512) * FLUX_KLEIN_OUTPUT_TILE_USD + FLUX_KLEIN_INPUT_TILE_USD;
  if (openAiImage(model)) return GPT_IMAGE_MEDIUM_1024_USD * (size.width * size.height) / (1024 * 1024) + GPT_IMAGE_EDIT_INPUT_USD;
  return null;
}

export function verifiedImageEditCost(model: string, image: GeneratedProviderImage, size: Size): ReturnType<typeof verifiedImageCost> {
  const requested = requestedImageEditCostUsd(model, size);
  const asRequested = image.width === size.width && image.height === size.height;
  if (requested === null) return null;
  if (!openAiImage(model)) return asRequested ? { baseCostUsd: requested, inputTokens: 0, outputTokens: 0, pricingBasis: "workers-ai-flux-2-klein-4b-edit-verified-tiles", usageReported: false } : null;
  const name = model.slice("openai/".length);
  if (image.usage === undefined) return asRequested ? { baseCostUsd: requested, inputTokens: 0, outputTokens: 0, pricingBasis: `${name}-edit-medium-${size.width}x${size.height}-estimate`, usageReported: false } : null;
  const usage = record(image.usage); const details = record(usage?.input_tokens_details);
  const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!usage || !details || ![usage.input_tokens, usage.output_tokens, usage.total_tokens, details.text_tokens, details.image_tokens].every(integer)) return null;
  const input = usage.input_tokens as number; const output = usage.output_tokens as number; const text = details.text_tokens as number; const imageTokens = details.image_tokens as number;
  if (text + imageTokens !== input || usage.total_tokens !== input + output || output <= 0) return null;
  // Text input $5, image input $8, image output $30 per million tokens.
  return { baseCostUsd: (text * 5 + imageTokens * 8 + output * 30) / 1_000_000, inputTokens: input, outputTokens: output, pricingBasis: `${name}-edit-verified-text-and-image-input-image-output-tokens`, usageReported: true };
}
