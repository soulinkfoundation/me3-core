import type { AgentImageEditRegion } from "../../../packages/agent/src/tools";
import { imageDimensions } from "./site-images";
import type { Env, ImageTransformationsPipeline } from "./types";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 4096;
// FLUX.2 on Workers AI: "All input images must be smaller than 512x512."
// https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/
const FLUX_REFERENCE_EDGE = 504;
const OPENAI_REFERENCE_EDGE = 1536;
type Size = { width: number; height: number };
type Rect = Size & { left: number; top: number };
type Encoded = Size & { bytes: Uint8Array; mimeType: string };
export type ImageEditRequest = { attachmentId?: string; region?: AgentImageEditRegion };
export type ImageEditPlan = {
  sourceId: string;
  /** What the provider receives and the output size asked of it. */
  reference: { bytes: Uint8Array; mimeType: string }; size: Size;
  /** Set for a region edit: the photo the patch goes back into, and where. */
  paste: null | { base: Encoded; context: Rect; patch: Rect };
};

export const IMAGE_EDIT_PROMPT_SUFFIX = "Change only what is asked. Keep everything else in the image exactly as it is: the same people, composition, colours, lighting and framing.";

/**
 * The model redraws a square of context around the region; only the region plus a margin is
 * pasted back, so the rest of the photo keeps its original pixels. Null when the region is too
 * large for that to mean anything.
 */
export function planRegionEdit(image: Size, region: AgentImageEditRegion): { context: Rect; patch: Rect } | null {
  const left = Math.round(region.x * image.width), top = Math.round(region.y * image.height);
  const width = Math.round(region.width * image.width), height = Math.round(region.height * image.height);
  const margin = Math.round(0.15 * Math.max(width, height));
  const patchLeft = Math.max(0, left - margin), patchTop = Math.max(0, top - margin);
  const patch = { left: patchLeft, top: patchTop, width: Math.min(image.width, left + width + margin) - patchLeft, height: Math.min(image.height, top + height + margin) - patchTop };
  const limit = Math.min(image.width, image.height);
  if (patch.width < 1 || patch.height < 1 || Math.max(patch.width, patch.height) > limit) return null;
  const side = Math.min(limit, Math.max(256, Math.round(2.5 * Math.max(patch.width, patch.height))));
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return { patch, context: { width: side, height: side,
    left: clamp(Math.round(patch.left + patch.width / 2 - side / 2), image.width - side),
    top: clamp(Math.round(patch.top + patch.height / 2 - side / 2), image.height - side) } };
}

/** The provider's nearest supported shape to the source, so a portrait is not squashed square. */
function outputSize(image: Size): Size {
  const aspect = image.width / image.height;
  return aspect > 1.25 ? { width: 1536, height: 1024 } : aspect < 0.8 ? { width: 1024, height: 1536 } : { width: 1024, height: 1024 };
}

async function encode(pipeline: ImageTransformationsPipeline, format: "image/png" | "image/jpeg", signal: AbortSignal): Promise<Encoded> {
  signal.throwIfAborted();
  const response = (await pipeline.output(format === "image/jpeg" ? { format, quality: 92 } : { format })).response();
  if (!response.ok) throw new Error(`Image transformation failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  const dimensions = imageDimensions(bytes.slice().buffer);
  if (!dimensions || !bytes.length) throw new Error("Image transformation returned no image");
  return { bytes, mimeType: format, ...dimensions };
}
const stream = (bytes: Uint8Array) => new Response(bytes.slice().buffer).body!;

/** Loads and authorizes the source and prepares the provider input. Nothing is reserved or charged here. */
export async function prepareImageEdit(env: Env, scope: { ownerId: string; threadId: string }, request: ImageEditRequest, model: string, signal: AbortSignal): Promise<ImageEditPlan> {
  const unavailable = new Error("That image is not available in this conversation");
  const asset = await env.DB.prepare(`SELECT id,storage_key,mime_type,size FROM assistant_attachments
    WHERE owner_id=? AND thread_id=? AND kind='image' AND status='ready' AND (? IS NULL OR id=?)
    ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(scope.ownerId, scope.threadId, request.attachmentId ?? null, request.attachmentId ?? null)
    .first<{ id: string; storage_key: string | null; mime_type: string; size: number }>();
  if (!asset?.storage_key || !/^image\/(png|jpeg|webp|gif)$/i.test(asset.mime_type)) throw request.attachmentId ? unavailable : new Error("There is no image in this conversation to edit");
  const object = await env.SITE_ASSETS!.get(asset.storage_key);
  signal.throwIfAborted();
  if (!object || !object.size || object.size > MAX_BYTES) throw unavailable;
  const original = new Uint8Array(await object.arrayBuffer());
  const originalSize = imageDimensions(original.slice().buffer);
  if (!original.length || original.length > MAX_BYTES || !originalSize) throw unavailable;
  const flux = model.startsWith("@cf/");
  const images = env.IMAGES;
  if (!images) {
    if (request.region) throw new Error("Editing part of an image needs the Cloudflare Images binding, which this installation does not have");
    if (flux) throw new Error("Editing with this image model needs the Cloudflare Images binding, which this installation does not have");
    if (!/^image\/(png|jpeg|webp)$/i.test(asset.mime_type)) throw new Error("This image format cannot be edited on this installation");
    return { sourceId: asset.id, reference: { bytes: original, mimeType: asset.mime_type.toLowerCase() }, size: outputSize(originalSize), paste: null };
  }
  // Re-encoding bakes in any EXIF rotation, so pixel offsets below match what is drawn.
  const format = /jpeg/i.test(asset.mime_type) ? "image/jpeg" as const : "image/png" as const;
  const base = await encode(images.input(stream(original)).transform({ width: MAX_EDGE, height: MAX_EDGE, fit: "scale-down" }), format, signal);
  const edge = flux ? FLUX_REFERENCE_EDGE : OPENAI_REFERENCE_EDGE;
  const region = request.region ? planRegionEdit(base, request.region) : null;
  if (region) {
    const reference = await encode(images.input(stream(base.bytes)).transform({ trim: region.context }).transform({ width: Math.min(edge, 1024), height: Math.min(edge, 1024), fit: "scale-down" }), "image/png", signal);
    return { sourceId: asset.id, reference, size: { width: 1024, height: 1024 }, paste: { base, ...region } };
  }
  const reference = await encode(images.input(stream(base.bytes)).transform({ width: edge, height: edge, fit: "scale-down" }), "image/png", signal);
  return { sourceId: asset.id, reference, size: outputSize(base), paste: null };
}

/** The image to save: the provider's output, or the original photo with the edited patch drawn in. */
export async function finishImageEdit(env: Env, plan: ImageEditPlan, output: Encoded, signal: AbortSignal): Promise<Encoded> {
  if (!plan.paste) return output;
  const { base, context, patch } = plan.paste;
  const scaleX = output.width / context.width, scaleY = output.height / context.height;
  const overlay = () => env.IMAGES!.input(stream(output.bytes))
    .transform({ trim: { left: Math.round((patch.left - context.left) * scaleX), top: Math.round((patch.top - context.top) * scaleY), width: Math.round(patch.width * scaleX), height: Math.round(patch.height * scaleY) } })
    .transform({ width: patch.width, height: patch.height, fit: "squeeze" });
  const draw = () => env.IMAGES!.input(stream(base.bytes)).draw(overlay(), { left: patch.left, top: patch.top });
  const result = await encode(draw(), base.mimeType as "image/png" | "image/jpeg", signal);
  // A large PNG can pass the private attachment limit; JPEG keeps the edit deliverable.
  return result.bytes.length > MAX_BYTES ? encode(draw(), "image/jpeg", signal) : result;
}
