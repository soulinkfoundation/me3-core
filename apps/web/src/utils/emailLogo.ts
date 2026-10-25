import { API_BASE, api } from "../api";

/** Display box for the logo at the top of a campaign email; the PNG is drawn at 2x. */
const MAX_WIDTH = 200;
const MAX_HEIGHT = 64;
const SCALE = 2;
const PAD_X = 12;
const PAD_Y = 8;

export type EmailLogo = { blob: Blob; width: number; height: number };

export type EmailLogoBranding = {
  logoRef: string | null;
  emailLogoUrl?: string | null;
  emailLogoWidth?: number | null;
  emailLogoHeight?: number | null;
};

/**
 * The email copy of a Site logo: a PNG on a white tile with padding, up to 400x128 (shown at
 * 200x64). The tile keeps transparent logos readable when Gmail inverts an email for dark mode,
 * and PNG works in classic Outlook, which can't show WebP.
 */
export async function makeEmailLogo(source: Blob): Promise<EmailLogo> {
  const image = await loadImage(source);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) throw new Error("The logo has no size.");

  const innerWidth = (MAX_WIDTH - PAD_X * 2) * SCALE;
  const innerHeight = (MAX_HEIGHT - PAD_Y * 2) * SCALE;
  const fit = Math.min(innerWidth / naturalWidth, innerHeight / naturalHeight);
  const drawWidth = Math.max(1, Math.round(naturalWidth * fit));
  const drawHeight = Math.max(1, Math.round(naturalHeight * fit));
  // Whole CSS pixels, so the email can state the exact display size.
  const width = Math.ceil((drawWidth + PAD_X * 2 * SCALE) / SCALE);
  const height = Math.ceil((drawHeight + PAD_Y * 2 * SCALE) / SCALE);

  const canvas = document.createElement("canvas");
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't prepare the email logo.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    Math.round((canvas.width - drawWidth) / 2),
    Math.round((canvas.height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser can't prepare the email logo.");
  return { blob, width, height };
}

/** Makes and stores the email copy of a Site's logo, from `source` or the logo already on the Site. */
export async function saveEmailLogo<T>(username: string, source?: Blob): Promise<T> {
  const logo = await makeEmailLogo(source || (await fetchSiteLogo(username)));
  const form = new FormData();
  form.append("file", logo.blob, "email-logo.png");
  form.append("width", String(logo.width));
  form.append("height", String(logo.height));
  const response = await api.upload<{ branding: T }>(
    `/sites/${encodeURIComponent(username)}/branding/email-logo`,
    form,
  );
  return response.branding;
}

export function needsEmailLogo(branding: EmailLogoBranding | null | undefined): boolean {
  return Boolean(branding?.logoRef && !branding.emailLogoUrl);
}

async function fetchSiteLogo(username: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/sites/${encodeURIComponent(username)}/branding/logo`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("The Site logo couldn't be read.");
  return response.blob();
}

function loadImage(source: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(source);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The logo couldn't be read."));
    };
    image.src = url;
  });
}
