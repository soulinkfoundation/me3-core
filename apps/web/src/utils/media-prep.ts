import type { SocialPlatformContentRule } from "../stores/social";

/**
 * Gets photos and videos into a shape every platform takes, in the browser, before upload:
 * HEIC and oversized photos become JPEGs under 5 MB, and a MOV (or a video over a platform's
 * size limit) becomes an MP4. Video work loads Mediabunny only when it's needed.
 */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 4096;
const WEB_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isHeic(file: { type: string; name: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function needsImagePrep(file: { type: string; name: string; size: number }): boolean {
  if (file.type === "image/gif") return false; // Re-encoding would drop the animation.
  return isHeic(file) || file.size > IMAGE_MAX_BYTES || !WEB_IMAGE_TYPES.has(file.type);
}

/** The size that keeps the longest side within the limit. */
export function fitSize(width: number, height: number, maxSide = IMAGE_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function renamed(name: string, extension: string): string {
  return `${name.replace(/\.[^./]+$/, "") || "media"}.${extension}`;
}

export async function prepareImage(file: File): Promise<File> {
  if (!needsImagePrep(file)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      isHeic(file)
        ? "This browser can't open HEIC photos. Try Safari, or export the photo as JPEG and add it again."
        : `Couldn't open ${file.name}.`,
    );
  }
  try {
    let { width, height } = fitSize(bitmap.width, bitmap.height);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) break;
      context.fillStyle = "#fff"; // JPEG has no transparency.
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.9, 0.8, 0.7]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= IMAGE_MAX_BYTES) return new File([blob], renamed(file.name, "jpg"), { type: "image/jpeg" });
      }
      width = Math.round(width * 0.8);
      height = Math.round(height * 0.8);
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`Couldn't make ${file.name} small enough to post.`);
}

export type VideoPlan = { convert: false } | { convert: true; reason: "format" | "size"; maxBytes: number | null };

function typeAllowed(type: string, allowed: string[]): boolean {
  return allowed.some((item) => item === type || (item.endsWith("/*") && type.startsWith(item.slice(0, -1))));
}

/** Whether a video needs converting for this platform: a type it doesn't take (when it takes MP4), or too big. */
export function planVideo(file: { type: string; size: number }, rule: SocialPlatformContentRule | null): VideoPlan {
  if (!rule) return { convert: false };
  const maxBytes = rule.maxBytesPerItem;
  const type = file.type.split(";", 1)[0]!.trim().toLowerCase();
  if (rule.allowedMimeTypes.length && !typeAllowed(type, rule.allowedMimeTypes) && typeAllowed("video/mp4", rule.allowedMimeTypes)) {
    return { convert: true, reason: "format", maxBytes };
  }
  if (maxBytes && file.size > maxBytes) return { convert: true, reason: "size", maxBytes };
  return { convert: false };
}

/** Bits per second that land a video of this length under the size, leaving room for audio and the container. */
export function videoBitrateFor(maxBytes: number, durationSeconds: number): number {
  const audio = 128_000;
  return Math.max(250_000, Math.floor(((maxBytes * 0.9 * 8) / Math.max(1, durationSeconds)) - audio));
}

/** MOV (or an oversized video) to an MP4 with H.264 and AAC. H.264 sources are copied, not re-encoded. */
export async function convertVideo(
  file: File,
  options: { maxBytes?: number | null; onProgress?: (fraction: number) => void } = {},
): Promise<File> {
  const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const shrink = Boolean(options.maxBytes && file.size > options.maxBytes);
  const bitrate = shrink ? videoBitrateFor(options.maxBytes!, await input.computeDuration()) : undefined;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    video: { codec: "avc", ...(bitrate ? { bitrate, forceTranscode: true } : {}) },
    audio: { codec: "aac" },
    showWarnings: false,
  });
  if (!conversion.isValid) {
    throw new Error("This browser can't convert that video. Try Chrome or Safari, or export it as MP4 and add it again.");
  }
  if (options.onProgress) conversion.onProgress = (progress) => options.onProgress!(progress);
  await conversion.execute();
  const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
  if (!buffer) throw new Error("The video didn't finish converting.");
  if (options.maxBytes && buffer.byteLength > options.maxBytes) throw new Error("The video is still too big after converting.");
  return new File([buffer], renamed(file.name, "mp4"), { type: "video/mp4" });
}

/** A copy of the video between two times (seconds), as MP4. */
export async function trimVideo(
  file: File,
  range: { start: number; end: number },
  onProgress?: (fraction: number) => void,
): Promise<File> {
  if (!(range.end > range.start)) throw new Error("The end must come after the start.");
  const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: range.start, end: range.end },
    video: { codec: "avc" },
    audio: { codec: "aac" },
    showWarnings: false,
  });
  if (!conversion.isValid) throw new Error("This browser can't trim that video. Try Chrome or Safari.");
  if (onProgress) conversion.onProgress = (progress) => onProgress(progress);
  await conversion.execute();
  const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
  if (!buffer) throw new Error("The video didn't finish trimming.");
  return new File([buffer], renamed(file.name, "mp4").replace(/\.mp4$/, "-trimmed.mp4"), { type: "video/mp4" });
}

/** "75.5" → "1:15.5" */
export function formatSeconds(value: number): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = (safe - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}
