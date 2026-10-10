import { applyImageMetadata, type SiteImageMetadata } from '@me3-core/site-renderer';
import type { DbSite, Env } from './types';
import { imageDimensions, saveUploadedImageMetadata } from './site-images';
import { getSiteFileText, putSiteMediaFile, sha256Buffer } from './sites';

export function hasEmbeddedPageImages(path: string, content: string): boolean {
  return /^(?:src|public)\/.*\.(?:md|html)$/i.test(path) && /data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(content);
}

/** Originals and variants are saved before any page reference is changed. */
export async function extractEmbeddedPageImages(env: Env, site: DbSite, path: string, content: string): Promise<string> {
  const images: SiteImageMetadata = {};
  const replacements = new Map<string, string>();
  const published = path.startsWith('public/');
  const pagePath = path.slice(path.indexOf('/') + 1);
  const prefix = published ? '../'.repeat(pagePath.split('/').length - 1) || './' : '/';
  for (const match of content.matchAll(/data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)(?=["'\s)<>]|$)/gi)) {
    const uri = match[0];
    if (replacements.has(uri) || match[2].length > 28_000_000) continue;
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)); } catch { continue; }
    const buffer = bytes.buffer as ArrayBuffer;
    const dimensions = imageDimensions(buffer);
    const type = match[1].toLowerCase().replace('jpg', 'jpeg');
    const signature = String.fromCharCode(...bytes.slice(0, 12));
    const valid = type === 'png' ? signature.startsWith('\x89PNG\r\n\x1a\n')
      : type === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216
      : type === 'gif' ? /^GIF8[79]a/.test(signature)
      : signature.startsWith('RIFF') && signature.slice(8) === 'WEBP';
    if (!valid || !dimensions) continue;
    const hash = await sha256Buffer(buffer);
    const assetPath = `files/content/${hash}.${type === 'jpeg' ? 'jpg' : type}`;
    const existing = await getSiteFileText(env, site.id, `meta/site-images/${encodeURIComponent(assetPath)}.json`);
    let metadata: SiteImageMetadata[string] | undefined;
    try { metadata = existing ? JSON.parse(existing) : undefined; } catch { /* Rebuild damaged metadata. */ }
    // Metadata can outlive a pruned original; restore the bytes before reusing it.
    await putSiteMediaFile(env, site, `public/${assetPath}`, buffer, `image/${type}`);
    if (!metadata || (env.IMAGES && dimensions.width > 320 && !metadata.variants?.length)) {
      const form = new FormData();
      if (env.IMAGES) {
        for (const width of [320, 640, 960, 1280].filter(width => width < dimensions.width)) {
          const result = await env.IMAGES.input(new Response(buffer).body!)
            .transform({width, fit: 'scale-down'}).output({format: 'image/webp', quality: 80});
          const response = result.response();
          if (!response.ok) throw new Error(`Page image transformation failed (${response.status})`);
          form.set(`variant-${width}`, new File([await response.arrayBuffer()], 'image.webp', {type:'image/webp'}));
        }
      }
      await saveUploadedImageMetadata(env, site, assetPath, buffer, form);
      metadata = JSON.parse((await getSiteFileText(env, site.id, `meta/site-images/${encodeURIComponent(assetPath)}.json`))!);
    }
    images[assetPath] = metadata!;
    replacements.set(uri, `${prefix}${assetPath}`);
  }
  if (!replacements.size) return content;
  const replaced = content.replace(/data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+(?=["'\s)<>]|$)/gi, uri => replacements.get(uri) || uri);
  // Source images receive srcset during rendering, after their URLs have been resolved.
  return published ? applyImageMetadata(replaced, images, {pagePath, sizes:'(max-width: 640px) 100vw, 640px'}) : replaced;
}
