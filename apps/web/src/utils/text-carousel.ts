/**
 * Text carousel slides, drawn on a canvas so the editor preview and the 1080x1350 JPEGs added to a
 * post come from the same code. Template values left on "site" resolve against the site's Look.
 */
import { siteThemes, normalizeSiteTheme, type SiteThemeId } from "@me3-core/site-renderer";
import { API_BASE } from "../api";
import type { CarouselTemplateSettings, TextCarouselSlide } from "../stores/social";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
/** Instagram takes up to ten photos in one carousel. */
export const INSTAGRAM_SLIDE_LIMIT = 10;

const SERIF = '"Iowan Old Style","Palatino Linotype",Georgia,serif';
const SANS = 'Inter,-apple-system,"Helvetica Neue",Arial,sans-serif';

/** The site's branding from the wizard Look step. */
export type SiteLook = {
  theme: SiteThemeId;
  accentOverride: string | null;
  logoUrl: string | null;
};

export type SlideImages = {
  logo: CanvasImageSource | null;
  photos: Map<string, CanvasImageSource>;
};

export type SlideColors = { bg: string; text: string; muted: string; accent: string; mode: "light" | "dark" };

export type ResolvedSlide = {
  colors: SlideColors;
  photoFileId: string | null;
  mainFont: string;
  smallFont: string;
};

export function siteLookFrom(profile: {
  logo?: string | null;
  links?: Record<string, string | undefined>;
  extensions?: Record<string, unknown>;
} | null | undefined, resolveLogo: (value: string | null | undefined) => string | null): SiteLook {
  const settings = (profile?.extensions?.["me3.app/site"] || null) as { theme?: string; accent?: string } | null;
  const accent = settings?.accent || profile?.links?._accent || null;
  return {
    theme: normalizeSiteTheme(settings?.theme || profile?.links?._vibe),
    accentOverride: accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : null,
    logoUrl: resolveLogo(profile?.logo),
  };
}

export function fileContentUrl(fileId: string): string {
  return `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(fileId)}/content`;
}

/** Relative luminance of a #rgb or #rrggbb colour. */
export function luminance(hex: string): number {
  let value = hex.replace("#", "");
  if (value.length === 3) value = value.split("").map((char) => char + char).join("");
  const number = parseInt(value.slice(0, 6), 16);
  if (!Number.isFinite(number)) return 1;
  const channels = [number >> 16, (number >> 8) & 255, number & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Text that reads on any background colour. */
function colorsOn(bg: string): Omit<SlideColors, "accent"> {
  return luminance(bg) > 0.32
    ? { bg, text: "#1B1A17", muted: "rgba(27,26,23,.62)", mode: "light" }
    : { bg, text: "#F5F3EE", muted: "rgba(245,243,238,.72)", mode: "dark" };
}

function sitePalette(look: SiteLook, mode: "light" | "dark"): Omit<SlideColors, "accent"> {
  const palette = siteThemes[look.theme][mode];
  return { bg: palette.bg, text: palette.text, muted: palette.muted, mode };
}

export function siteAccent(look: SiteLook, mode: "light" | "dark"): string {
  return look.accentOverride || siteThemes[look.theme][mode].accent;
}

/** Colours, photo and fonts for one slide: a slide's own photo wins, then the template's. */
export function resolveSlide(slide: TextCarouselSlide, settings: CarouselTemplateSettings, look: SiteLook): ResolvedSlide {
  const templatePhoto = settings.background === "photo" ? settings.photoFileId : null;
  const photoFileId = slide.photoFileId || (!slide.swap ? templatePhoto : null);
  let base: Omit<SlideColors, "accent">;
  if (photoFileId) {
    base = { bg: "#222222", text: "#FFFFFF", muted: "rgba(255,255,255,.82)", mode: "dark" };
  } else if (settings.background === "site-light" || settings.background === "site-dark") {
    const mode = settings.background === "site-light" ? "light" : "dark";
    base = sitePalette(look, slide.swap ? (mode === "light" ? "dark" : "light") : mode);
  } else {
    const bg = settings.background === "photo" ? "#F5F3EE" : settings.background;
    base = colorsOn(bg);
    if (slide.swap) base = colorsOn(base.text);
  }
  const accent = settings.accent === "site" ? siteAccent(look, base.mode) : settings.accent;
  const theme = siteThemes[look.theme];
  const family = settings.font === "site" ? null : settings.font === "serif" ? SERIF : SANS;
  return {
    colors: { ...base, accent },
    photoFileId,
    mainFont: family || theme.displayFont,
    smallFont: family || theme.bodyFont,
  };
}

/** Main text size as a share of the slide width: shorter text shows larger. */
export function mainTextSize(slide: Pick<TextCarouselSlide, "main" | "small">): number {
  const length = slide.main.length;
  if (!slide.small.trim()) {
    if (length <= 30) return 9.4;
    if (length <= 60) return 7.8;
    if (length <= 100) return 6.6;
    if (length <= 160) return 5.6;
    return 4.8;
  }
  if (length <= 30) return 7.2;
  if (length <= 60) return 6.2;
  if (length <= 100) return 5.2;
  return 4.6;
}

/** Too much text for one slide, by length. The renderer also flags text that runs out of room. */
export function slideTooLong(slide: Pick<TextCarouselSlide, "main" | "small">): boolean {
  return slide.small.trim()
    ? slide.main.length > 140 || slide.small.length > 300 || slide.main.length + slide.small.length > 380
    : slide.main.length > 240;
}

type Measure = Pick<CanvasRenderingContext2D, "measureText">;

/** Wraps text to a width, keeping the owner's line breaks and splitting words that don't fit. */
export function wrapText(ctx: Measure, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const char of Array.from(word)) {
        if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
          lines.push(chunk);
          chunk = "";
        }
        chunk += char;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

function fitText(ctx: Measure, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return cut ? `${cut.trimEnd()}…` : "";
}

function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number) {
  const size = image as { width: number; height: number };
  const iw = size.width || width;
  const ih = size.height || height;
  const scale = Math.max(width / iw, height / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * Draws one slide at the canvas's width (4:5). Returns whether the text ran out of room.
 * With `placeholder`, an empty slide shows faint "Main text" (the editor, never the JPEG).
 */
export function drawSlide(
  ctx: CanvasRenderingContext2D,
  slide: TextCarouselSlide,
  settings: CarouselTemplateSettings,
  look: SiteLook,
  images: SlideImages,
  options: { placeholder?: boolean } = {},
): { overflow: boolean } {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const u = width / 100;
  const resolved = resolveSlide(slide, settings, look);
  const { colors } = resolved;
  const weight = settings.weight === "bold" ? 700 : 500;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);
  const photo = resolved.photoFileId ? images.photos.get(resolved.photoFileId) : null;
  if (resolved.photoFileId) {
    if (photo) drawCover(ctx, photo, width, height);
    ctx.fillStyle = `rgba(0,0,0,${settings.dim / 100})`;
    ctx.fillRect(0, 0, width, height);
  }

  const left = 7.8 * u;
  const right = width - 7.8 * u;
  const top = 8.9 * u;
  const bottom = height - 15 * u;
  const textWidth = right - left;
  const center = settings.align === "center";
  const x = center ? width / 2 : left;
  ctx.textAlign = center ? "center" : "left";
  ctx.textBaseline = "alphabetic";

  const empty = !slide.main.trim();
  const mainText = empty && options.placeholder ? "Main text" : slide.main;
  const mainSize = mainTextSize(slide) * u;
  const mainLeading = mainSize * 1.12;
  ctx.font = `${weight} ${mainSize}px ${resolved.mainFont}`;
  const mainLines = mainText.trim() ? wrapText(ctx, mainText.replace(/\s+$/, ""), textWidth) : [];
  const small = slide.small.trim();
  const smallSize = 3.5 * u;
  const smallLeading = smallSize * 1.38;
  ctx.font = `400 ${smallSize}px ${resolved.smallFont}`;
  const smallLines = small ? wrapText(ctx, slide.small.replace(/\s+$/, ""), textWidth) : [];

  const ruleHeight = settings.rule ? 0.7 * u + 4 * u : 0;
  const mainHeight = mainLines.length * mainLeading;
  const smallHeight = smallLines.length ? 3 * u + smallLines.length * smallLeading : 0;
  const blockHeight = ruleHeight + mainHeight + smallHeight;
  const room = bottom - top;
  let y = settings.position === "top"
    ? top
    : settings.position === "bottom"
      ? bottom - blockHeight
      : top + (room - blockHeight) / 2;
  y = Math.max(top, y);

  if (settings.rule) {
    ctx.fillStyle = colors.accent;
    const ruleWidth = 9 * u;
    const ruleX = center ? (width - ruleWidth) / 2 : left;
    roundRect(ctx, ruleX, y, ruleWidth, 0.7 * u, 0.35 * u);
    y += ruleHeight;
  }

  ctx.font = `${weight} ${mainSize}px ${resolved.mainFont}`;
  ctx.fillStyle = colors.text;
  if (empty) ctx.globalAlpha = 0.35;
  for (const line of mainLines) {
    // Baseline sits at roughly 80% of the line box, like CSS.
    ctx.fillText(line, x, y + mainLeading * 0.5 + mainSize * 0.35);
    y += mainLeading;
  }
  ctx.globalAlpha = 1;
  if (smallLines.length) {
    y += 3 * u;
    ctx.font = `400 ${smallSize}px ${resolved.smallFont}`;
    ctx.fillStyle = colors.muted;
    for (const line of smallLines) {
      ctx.fillText(line, x, y + smallLeading * 0.5 + smallSize * 0.35);
      y += smallLeading;
    }
  }

  drawCorners(ctx, settings, look, images, colors, resolved.smallFont, u);
  ctx.restore();
  return { overflow: slideTooLong(slide) || blockHeight > room + 1 };
}

function drawCorners(
  ctx: CanvasRenderingContext2D,
  settings: CarouselTemplateSettings,
  look: SiteLook,
  images: SlideImages,
  colors: SlideColors,
  font: string,
  u: number,
) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const size = 2.5 * u;
  const middle = height - 6.2 * u - 2.7 * u;
  const maxWidth = width * 0.44;
  ctx.font = `600 ${size}px ${font}`;
  ctx.fillStyle = colors.muted;
  ctx.textBaseline = "middle";

  let x = 7.8 * u;
  const logo = settings.logo && look.logoUrl ? images.logo : null;
  let room = maxWidth;
  if (logo) {
    const box = logo as { width: number; height: number };
    const logoHeight = 5.4 * u;
    const logoWidth = Math.min(16 * u, (box.width / Math.max(1, box.height)) * logoHeight);
    const drawHeight = Math.min(logoHeight, (box.height / Math.max(1, box.width)) * logoWidth);
    ctx.drawImage(logo, x, middle - drawHeight / 2, logoWidth, drawHeight);
    x += logoWidth + 1.6 * u;
    room -= logoWidth + 1.6 * u;
  }
  if (settings.cornerLeft.trim()) {
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, settings.cornerLeft.trim(), room), x, middle);
  }
  if (settings.cornerRight.trim()) {
    ctx.textAlign = "right";
    ctx.fillText(fitText(ctx, settings.cornerRight.trim(), maxWidth), width - 7.8 * u, middle);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

const imageCache = new Map<string, Promise<CanvasImageSource | null>>();

/** Loads an image for drawing on a canvas without tainting it (Files need the session cookie). */
export function loadCanvasImage(url: string): Promise<CanvasImageSource | null> {
  let pending = imageCache.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        if (url.startsWith("data:") || url.startsWith("blob:")) {
          const image = new Image();
          image.src = url;
          await image.decode();
          return image;
        }
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) return null;
        return await createImageBitmap(await response.blob());
      } catch {
        return null;
      }
    })();
    imageCache.set(url, pending);
    void pending.then((image) => {
      if (!image) imageCache.delete(url);
    });
  }
  return pending;
}

const loadedFontSheets = new Set<string>();

/** Loads the site theme's web fonts so canvas text uses them. */
export async function loadThemeFonts(look: SiteLook): Promise<void> {
  const theme = siteThemes[look.theme];
  if (typeof document === "undefined") return;
  if (theme.fontUrl && !loadedFontSheets.has(theme.fontUrl)) {
    loadedFontSheets.add(theme.fontUrl);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = theme.fontUrl;
    const loaded = new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    document.head.appendChild(link);
    await loaded;
  }
  if (!document.fonts?.load) return;
  await Promise.all(
    [theme.displayFont, theme.bodyFont].flatMap((family) =>
      ["400", "500", "700"].map((weight) => document.fonts.load(`${weight} 40px ${family}`).catch(() => [])),
    ),
  );
}

/** Renders one slide as a 1080x1350 JPEG. */
export async function renderSlideJpeg(
  slide: TextCarouselSlide,
  settings: CarouselTemplateSettings,
  look: SiteLook,
  images: SlideImages,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_WIDTH;
  canvas.height = SLIDE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw slides.");
  drawSlide(ctx, slide, settings, look, images);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Couldn't make the slide image.");
  return blob;
}

export function newSlide(main = "", small = ""): TextCarouselSlide {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return { id: `s${id}`.replace(/[^\w-]/g, ""), main, small, swap: false, photoFileId: null };
}
