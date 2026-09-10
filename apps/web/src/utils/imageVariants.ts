type OutputType = "image/webp";

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: OutputType,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Failed to encode image"));
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

export async function generateImageVariants(
  blob: Blob,
  sizes: number[],
  quality: number = 0.9,
): Promise<Array<{ size: number; blob: Blob; type: OutputType }>> {
  const img = await loadImageFromBlob(blob);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error("Invalid image");

  const outputType: OutputType = "image/webp";
  const uniqueSizes = Array.from(new Set(sizes))
    .filter((size) => Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b);

  const variants: Array<{ size: number; blob: Blob; type: OutputType }> = [];

  for (const size of uniqueSizes) {
    if (width < size) continue;
    const scale = size / width;
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const outBlob = await canvasToBlob(canvas, outputType, quality);
    variants.push({ size, blob: outBlob, type: outputType });
  }

  return variants;
}

/** Upload real responsive candidates beside the original, never upscale or flatten GIFs. */
export async function appendResponsiveImageVariants(form: FormData, blob: Blob): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type)) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Animated WebP/APNG must retain their original animation.
  if ((blob.type === "image/webp" && String.fromCharCode(...bytes.slice(12, 16)) === "VP8X" && (bytes[20] & 2)) || (blob.type === "image/png" && new TextDecoder('latin1').decode(bytes).includes('acTL'))) return;
  try {
    for (const variant of await generateImageVariants(blob, [320, 640, 960, 1280], 0.82)) {
      if (variant.blob.type !== "image/webp" || variant.blob.size >= blob.size) continue;
      form.append(`variant-${variant.size}`, new File([variant.blob], `image-${variant.size}.webp`, { type: "image/webp" }));
    }
  } catch {
    // Original uploads remain usable on browsers without canvas/WebP encoding.
  }
}
