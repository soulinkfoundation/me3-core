import type { SiteImageMetadata } from '@me3-core/site-renderer';
import type { DbSite, Env } from './types';
import { listSiteFiles, deleteSiteFile, getR2SiteFile, getSiteFile, siteFileContentToArrayBuffer, putSiteFile, putSiteMediaFile } from './sites';

const METADATA_PREFIX = 'meta/site-images/';
export async function getSiteImageMetadata(env: Env, site: DbSite, sources: string[] = []): Promise<SiteImageMetadata> {
  const images: SiteImageMetadata = {};
  for (const file of await listSiteFiles(env, site.id, METADATA_PREFIX)) {
    try {
      const { path, ...metadata } = JSON.parse(new TextDecoder().decode(siteFileContentToArrayBuffer(file.content)));
      if (typeof path === 'string') images[path] = metadata;
    } catch { /* A malformed metadata record must not block publication. */ }
  }
  const paths = new Set(sources.flatMap(source => [...source.matchAll(/files\/[a-z0-9_./-]+\.(?:png|jpe?g|webp|gif)\b/gi)].map(match => match[0])));
  for (const path of [...paths].slice(0, 128)) {
    if (images[path] || path.split('/').includes('..')) continue;
    const file = await getR2SiteFile(env, site, `public/${path}`) || await getSiteFile(env, site.id, `public/${path}`);
    if (!file) continue;
    const size = imageDimensions(siteFileContentToArrayBuffer(file.content));
    if (size) images[path] = size;
  }
  return images;
}

/** Dimensions from the uploaded bytes, including older clients without metadata fields. */
export function imageDimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
  const b = new Uint8Array(buffer), v = new DataView(buffer);
  let width = 0, height = 0, rotated = false;
  const ascii = (start: number, end: number) => String.fromCharCode(...b.slice(start, end));
  if (b.length >= 24 && ascii(1, 4) === 'PNG') { width = v.getUint32(16); height = v.getUint32(20); }
  else if (b.length >= 10 && ascii(0, 3) === 'GIF') { width = v.getUint16(6, true); height = v.getUint16(8, true); }
  else if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const kind = ascii(12, 16);
    if (kind === 'VP8X') { width = 1 + b[24] + (b[25] << 8) + (b[26] << 16); height = 1 + b[27] + (b[28] << 8) + (b[29] << 16); }
    else if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) { width = v.getUint16(26, true) & 0x3fff; height = v.getUint16(28, true) & 0x3fff; }
    else if (kind === 'VP8L' && b[20] === 0x2f) { width = 1 + b[21] + ((b[22] & 0x3f) << 8); height = 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 0xf) << 10); }
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 8 < b.length;) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const size = v.getUint16(i + 2);
      if (size < 2 || i + size + 2 > b.length) break;
      if (marker === 0xe1 && ascii(i + 4, i + 10) === 'Exif\0\0') {
        const tiff = i + 10, end = i + size + 2;
        if (tiff + 8 <= end) {
          const little = ascii(tiff, tiff + 2) === 'II';
          const directory = tiff + v.getUint32(tiff + 4, little);
          if (directory >= tiff && directory + 2 <= end) {
            const count = Math.min(v.getUint16(directory, little), 128);
            for (let entry = directory + 2; entry + 12 <= end && entry < directory + 2 + count * 12; entry += 12) {
              if (v.getUint16(entry, little) === 0x112 && v.getUint16(entry + 2, little) === 3 && v.getUint32(entry + 4, little) === 1) rotated = [5, 6, 7, 8].includes(v.getUint16(entry + 8, little));
            }
          }
        }
      }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { height = v.getUint16(i + 5); width = v.getUint16(i + 7); break; }
      i += size + 2;
    }
  }
  return width > 0 && height > 0 ? rotated ? { width: height, height: width } : { width, height } : null;
}

export async function saveUploadedImageMetadata(env: Env, site: DbSite, path: string, buffer: ArrayBuffer, form?: FormData): Promise<void> {
  const dimensions = imageDimensions(buffer);
  const metadataPath = `${METADATA_PREFIX}${encodeURIComponent(path)}.json`;
  if (!dimensions) { await deleteSiteFile(env, site.id, metadataPath); }
  else {
    const variants: Array<{ path: string; width: number }> = [];
    for (const width of [320, 640, 960, 1280]) {
      const file = form?.get(`variant-${width}`);
      if (!(file instanceof File) || file.type !== 'image/webp' || file.size > 1_900_000) continue;
      const bytes = await file.arrayBuffer(), size = imageDimensions(bytes);
      const signature = new Uint8Array(bytes);
      if (String.fromCharCode(...signature.slice(0, 4)) !== "RIFF" || String.fromCharCode(...signature.slice(8, 12)) !== "WEBP") continue;
      if (!size || size.width !== width || width >= dimensions.width || Math.abs(size.height - dimensions.height * width / dimensions.width) > 1) continue;
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      const variantPath = `files/responsive/${hash}.webp`;
      await putSiteMediaFile(env, site, `public/${variantPath}`, bytes, 'image/webp');
      variants.push({ path: variantPath, width });
    }
    await putSiteFile(env, site.id, metadataPath, JSON.stringify({ path, ...dimensions, variants }), "application/json");
  }
}
