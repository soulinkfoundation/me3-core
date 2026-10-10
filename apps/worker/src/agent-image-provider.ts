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

export async function generateAgentProviderImage(env: Env, model: string, prompt: string, gatewayId: string, signal: AbortSignal, metadata: Record<string,string>): Promise<GeneratedProviderImage> {
  signal.throwIfAborted();
  const ai = env.AI as unknown as { run(model: string, input: unknown, options: unknown): Promise<unknown> };
  let input: unknown = { prompt, size: "1024x1024", quality: "medium", output_format: "png" };
  if (model.startsWith("@cf/")) {
    const form = new FormData(); form.set("prompt", prompt); form.set("width", "1024"); form.set("height", "1024");
    const request = new Request("https://image-generation.invalid", { method: "POST", body: form });
    input = { multipart: { body: request.body, contentType: request.headers.get("content-type") } };
  }
  // A paid image operation cannot be retried behind its durable admission or priced from a cache hit.
  const output = await ai.run(model, input, { gateway: { id: gatewayId, metadata, skipCache: true, retries: { maxAttempts: 1 } }, signal });
  signal.throwIfAborted();
  const root = record(output); const result = record(root?.result) ?? root;
  if (root?.success === false || (typeof result?.state === "string" && result.state !== "Completed")) throw new Error("Image provider did not return a completed image");
  const item = Array.isArray(result?.data) && result.data.length === 1 ? record(result.data[0]) : null;
  let source = item?.b64_json ?? result?.image ?? result?.image_base64 ?? result?.b64_json;
  let bytes: Uint8Array;
  if (output instanceof Response) {
    bytes = await boundedResponseBytes(output, signal);
  } else if (output instanceof ArrayBuffer || ArrayBuffer.isView(output)) {
    bytes = output instanceof ArrayBuffer ? new Uint8Array(output) : new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
  } else if (typeof source === "string" && source.startsWith("https://")) {
    const url = new URL(source);
    if (!url.hostname.endsWith(".r2.dev") || url.username || url.password) throw new Error("Image provider output URL is not an approved private transport");
    const response = await fetch(url, { redirect: "error", signal });
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

export function verifiedImageCost(model: string, image: GeneratedProviderImage): { baseCostUsd: number; inputTokens: number; outputTokens: number; pricingBasis: string; usageReported: boolean } | null {
  // Official native output-tile price: https://developers.cloudflare.com/workers-ai/platform/pricing/
  if (model === "@cf/black-forest-labs/flux-2-klein-4b" && image.width === 1024 && image.height === 1024) return { baseCostUsd: 4 * 0.000287, inputTokens: 0, outputTokens: 0, pricingBasis: "workers-ai-flux-2-klein-4b-verified-output-tiles", usageReported: false };
  if (model !== "openai/gpt-image-2") return null;
  // Direct Images API has text-only input here and no cache. Do not use per-image estimates.
  // https://developers.cloudflare.com/ai/models/openai/gpt-image-2/
  // https://developers.openai.com/api/docs/guides/image-generation
  const usage = record(image.usage); const details = record(usage?.input_tokens_details);
  const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!usage || !details || ![usage.input_tokens, usage.output_tokens, usage.total_tokens, details.text_tokens, details.image_tokens].every(integer)) return null;
  const input = usage.input_tokens as number; const output = usage.output_tokens as number;
  if (details.image_tokens !== 0 || details.text_tokens !== input || usage.total_tokens !== input + output || output <= 0) return null;
  return { baseCostUsd: (input * 5 + output * 30) / 1_000_000, inputTokens: input, outputTokens: output, pricingBasis: "gpt-image-2-verified-text-input-image-output-tokens", usageReported: true };
}
