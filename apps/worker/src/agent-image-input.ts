import type { AgentImage, AgentMessage } from "../../../packages/agent/src/types";
import type { Env } from "./types";

export type AgentAttachmentInput = { id?: string | null; kind?: string | null; storageKey?: string | null; mimeType?: string | null };
type ImageScope = { ownerId: string; threadId: string };
type ImageAsset = { id: string; thread_id: string | null; storage_key: string; mime_type: string; size: number };
const REFERENCE_PREFIX = "me3-attachment:";
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const unavailable = () => new Error("Image is unavailable for this conversation");

async function readAsset(env: Env, scope: ImageScope, id: string, allowStaged: boolean): Promise<ImageAsset> {
  const asset = await env.DB.prepare(`SELECT id,thread_id,storage_key,mime_type,size FROM assistant_attachments
    WHERE id=? AND owner_id=? AND (thread_id=? OR (?=1 AND thread_id IS NULL))
    AND kind='image' AND status='ready'`).bind(id, scope.ownerId, scope.threadId, allowStaged ? 1 : 0).first<ImageAsset>();
  if (!asset?.storage_key || !/^image\/(png|jpeg|webp|gif)$/i.test(asset.mime_type) || !Number.isFinite(asset.size) || asset.size <= 0) throw unavailable();
  return asset;
}

function checkSize(bytes: number) {
  if (bytes > MAX_IMAGE_BYTES) throw new Error("Image input exceeds the combined 10MiB limit");
}
function checkCount(count: number) {
  if (count > MAX_IMAGES) throw new Error("Use at most four image attachments in one model request");
}

// D1 holds references, never the encoded image bytes that can exceed its row limit.
export async function prepareAgentImageInputs(env: Env, scope: ImageScope, attachments: readonly AgentAttachmentInput[], signal: AbortSignal): Promise<AgentImage[]> {
  const images = attachments.filter(attachment => attachment.kind === "image");
  checkCount(images.length);
  if (images.length && !env.SITE_ASSETS) throw new Error("Image attachment storage is unavailable");
  const assets: ImageAsset[] = []; let metadataBytes = 0;
  for (const image of images) {
    signal.throwIfAborted();
    if (!image.id || !image.storageKey) throw unavailable();
    const asset = await readAsset(env, scope, image.id, true);
    if (asset.storage_key !== image.storageKey) throw unavailable();
    metadataBytes += asset.size; checkSize(metadataBytes); assets.push(asset);
  }
  for (const asset of assets) {
    signal.throwIfAborted();
    if (asset.thread_id === null) {
      const claimed = await env.DB.prepare(`UPDATE assistant_attachments SET thread_id=?
        WHERE id=? AND owner_id=? AND thread_id IS NULL AND storage_key=? AND mime_type=? AND size=? AND kind='image' AND status='ready'
        AND EXISTS(SELECT 1 FROM assistant_threads WHERE id=? AND owner_id=? AND status='active')`)
        .bind(scope.threadId, asset.id, scope.ownerId, asset.storage_key, asset.mime_type, asset.size, scope.threadId, scope.ownerId).run();
      if (claimed.meta.changes !== 1) throw unavailable();
    }
  }
  return assets.map(asset => ({ url: `${REFERENCE_PREFIX}${encodeURIComponent(asset.id)}` }));
}

export async function loadAgentAttachmentManifest(env: Env, scope: ImageScope, attachments: readonly AgentAttachmentInput[]) {
  const manifest = [];
  for (const attachment of attachments) {
    if (!attachment.id) continue;
    const asset = await env.DB.prepare(`SELECT id,filename,mime_type,size,kind,status,storage_key,text_truncated,
      CASE WHEN length(extracted_text)>0 THEN 1 ELSE 0 END AS has_text FROM assistant_attachments
      WHERE id=? AND owner_id=? AND status='ready' AND (thread_id=? OR (thread_id IS NULL AND kind='text'))`)
      .bind(attachment.id, scope.ownerId, scope.threadId).first<ImageAsset & {filename:string;kind:string;status:string;text_truncated:number;has_text:number}>();
    if (asset && (!attachment.storageKey || asset.storage_key === attachment.storageKey)) manifest.push({id:asset.id,name:asset.filename,mimeType:asset.mime_type,size:asset.size,kind:asset.kind,status:asset.status,storageKey:asset.storage_key,hasText:Boolean(asset.has_text),textTruncated:Boolean(asset.text_truncated)});
  }
  return manifest;
}

// Every model step/recovery rechecks authority. Only its ephemeral request gets data URLs.
export async function resolveAgentImageInputs(env: Env, scope: ImageScope, messages: readonly AgentMessage[], signal: AbortSignal): Promise<readonly AgentMessage[]> {
  const references = messages.flatMap(message => message.images || []);
  checkCount(references.length);
  if (!references.length) return messages;
  if (!env.SITE_ASSETS) throw new Error("Image attachment storage is unavailable");
  const assets: ImageAsset[] = []; let metadataBytes = 0;
  for (const image of references) {
    signal.throwIfAborted();
    if (!image.url.startsWith(REFERENCE_PREFIX)) throw unavailable();
    let id: string;
    try { id = decodeURIComponent(image.url.slice(REFERENCE_PREFIX.length)); } catch { throw unavailable(); }
    const asset = await readAsset(env, scope, id, false);
    metadataBytes += asset.size; checkSize(metadataBytes); assets.push(asset);
  }
  const resolved: AgentImage[] = []; let objectBytes = 0; let actualBytes = 0;
  for (const asset of assets) {
    signal.throwIfAborted();
    const object = await env.SITE_ASSETS.get(asset.storage_key);
    signal.throwIfAborted();
    if (!object || !Number.isFinite(object.size) || object.size <= 0) throw unavailable();
    objectBytes += object.size; checkSize(objectBytes);
    const bytes = new Uint8Array(await object.arrayBuffer());
    signal.throwIfAborted();
    if (!bytes.byteLength) throw unavailable();
    actualBytes += bytes.byteLength; checkSize(actualBytes);
    let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192));
    resolved.push({ url: `data:${asset.mime_type.toLowerCase()};base64,${btoa(binary)}` });
  }
  // Storage awaits can race revocation/replacement; do not admit the loaded snapshot afterward.
  for (const asset of assets) {
    signal.throwIfAborted();
    const current = await readAsset(env, scope, asset.id, false);
    if (current.storage_key !== asset.storage_key || current.mime_type !== asset.mime_type || current.size !== asset.size) throw unavailable();
  }
  signal.throwIfAborted();
  let index = 0;
  return messages.map(message => message.images?.length ? { ...message, images: message.images.map(() => resolved[index++]) } : message);
}
