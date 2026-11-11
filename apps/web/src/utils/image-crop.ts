/** Crop geometry for the Social post editor, in the image's own pixels. Kept free of Vue for tests. */

export type CropRect = { x: number; y: number; w: number; h: number };
export type CropPreset = { id: string; label: string; ratio: number | null };

const SQUARE: CropPreset = { id: "1:1", label: "1:1", ratio: 1 };
const PORTRAIT: CropPreset = { id: "4:5", label: "4:5", ratio: 4 / 5 };
const WIDE: CropPreset = { id: "16:9", label: "16:9", ratio: 16 / 9 };
const LINK: CropPreset = { id: "1.91:1", label: "1.91:1", ratio: 1.91 };
const FREE: CropPreset = { id: "free", label: "Free", ratio: null };

export const MIN_CROP = 32;

/** The shapes each platform shows best, first one is the default. */
export function cropPresets(platform: string): CropPreset[] {
  if (platform === "instagram" || platform === "instagram_business") return [SQUARE, PORTRAIT, FREE];
  if (platform === "x" || platform === "linkedin") return [WIDE, LINK, FREE];
  return [SQUARE, PORTRAIT, WIDE, LINK, FREE];
}

/** The largest centred crop of that shape; the whole image when the shape is free. */
export function centeredCrop(width: number, height: number, ratio: number | null): CropRect {
  if (!ratio) return { x: 0, y: 0, w: width, h: height };
  let w = width;
  let h = width / ratio;
  if (h > height) {
    h = height;
    w = height * ratio;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function moveCrop(rect: CropRect, dx: number, dy: number, width: number, height: number): CropRect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, width - rect.w),
    y: clamp(rect.y + dy, 0, height - rect.h),
  };
}

/** Drags the bottom-right corner; a fixed shape follows the wider of the two moves. */
export function resizeCrop(
  rect: CropRect,
  dw: number,
  dh: number,
  width: number,
  height: number,
  ratio: number | null,
): CropRect {
  const maxW = width - rect.x;
  const maxH = height - rect.y;
  if (!ratio) {
    return { ...rect, w: clamp(rect.w + dw, MIN_CROP, maxW), h: clamp(rect.h + dh, MIN_CROP, maxH) };
  }
  const wanted = Math.abs(dw) >= Math.abs(dh * ratio) ? rect.w + dw : (rect.h + dh) * ratio;
  const w = clamp(wanted, MIN_CROP * Math.max(1, ratio), Math.min(maxW, maxH * ratio));
  return { ...rect, w, h: w / ratio };
}

/** Whole pixels inside the image, for drawing. */
export function pixelCrop(rect: CropRect, width: number, height: number): CropRect {
  const x = clamp(Math.round(rect.x), 0, width - 1);
  const y = clamp(Math.round(rect.y), 0, height - 1);
  return {
    x,
    y,
    w: clamp(Math.round(rect.w), 1, width - x),
    h: clamp(Math.round(rect.h), 1, height - y),
  };
}

/** "photo.png" → "photo-cropped.png", with the extension the saved type gets. */
export function croppedFilename(filename: string | null | undefined, mimeType: string): string {
  const base = (filename || "image").replace(/\.[^./]+$/, "") || "image";
  return `${base}-cropped.${mimeType === "image/png" ? "png" : "jpg"}`;
}
