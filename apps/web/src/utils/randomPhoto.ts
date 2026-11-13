// Random photos for "surprise me" image buttons (wizard banner, page hero,
// editor carousel). Photos are bundled in public/random-photos so the buttons
// never depend on a third-party image service. Sources: public/random-photos/CREDITS.md.
export const RANDOM_PHOTO_COUNT = 20;

let lastPhotoIndex: number | null = null;

export function pickRandomPhotoUrl(random: () => number = Math.random): string {
  let index = Math.floor(random() * RANDOM_PHOTO_COUNT) % RANDOM_PHOTO_COUNT;
  if (index === lastPhotoIndex) index = (index + 1) % RANDOM_PHOTO_COUNT;
  lastPhotoIndex = index;
  const file = `${String(index + 1).padStart(2, "0")}.webp`;
  return `${import.meta.env.BASE_URL}random-photos/${file}`;
}

function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't read the random photo."));
    image.src = objectUrl;
  }).finally(() => URL.revokeObjectURL(objectUrl));
}

/**
 * Loads a random bundled photo, cover-cropped to width x height, as a JPEG blob.
 */
export async function loadRandomPhoto(width: number, height: number): Promise<Blob> {
  const res = await fetch(pickRandomPhotoUrl());
  if (!res.ok) throw new Error(`Couldn't load a random photo (${res.status}).`);
  const image = await decodeImage(await res.blob());

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the random photo.");

  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
  if (!blob) throw new Error("Couldn't prepare the random photo.");
  return blob;
}
