import { siteThemes } from "./themes.js";
import type { SitePresentationSettings, Me3Button } from "./index.js";

export const MAX_STARTER_BUTTONS = 100;
export const STARTER_LINK_KEYS = ["website", "instagram", "x", "twitter", "linkedin", "youtube", "tiktok", "github", "substack", "facebook", "mastodon", "bluesky", "threads", "email"] as const;
export type StarterButton = Me3Button & { id: string; text: string; url: string };
export type StarterPresentation = Pick<SitePresentationSettings, "theme" | "layout" | "colorMode" | "accent">;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function safeUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Enter a valid HTTPS, mailto or tel URL");
  try {
    const url = new URL(value.trim());
    if (!["https:", "mailto:", "tel:"].includes(url.protocol) || url.username || url.password || !url.pathname) throw new Error();
    return url.toString();
  } catch { throw new Error("Enter a valid HTTPS, mailto or tel URL"); }
}

export function normalizeStarterButtons(value: unknown): StarterButton[] {
  if (!Array.isArray(value) || value.length > MAX_STARTER_BUTTONS) throw new Error("Use up to 100 buttons");
  const ids = new Set<string>();
  return value.map(entry => {
    const button = record(entry);
    if (typeof button.id !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(button.id) || ids.has(button.id)) throw new Error("Buttons need unique IDs");
    ids.add(button.id);
    if (typeof button.text !== "string" || !button.text.trim() || button.text.trim().length > 80) throw new Error("Button labels must be 1–80 characters");
    const style = button.style ?? "primary";
    if (!["primary", "secondary", "outline"].includes(String(style))) throw new Error("Choose a supported button style");
    return { id: button.id, text: button.text.trim(), url: safeUrl(button.url), style: String(style) };
  });
}

export function normalizeStarterLinks(value: unknown): Record<string, string> {
  const links = record(value);
  return Object.fromEntries(STARTER_LINK_KEYS.filter(key => typeof links[key] === "string" && String(links[key]).trim()).map(key => [key, safeUrl(links[key])]));
}

export function normalizeStarterPresentation(value: unknown): StarterPresentation {
  const look = record(value);
  if (Object.keys(look).some(key => !["theme", "layout", "colorMode", "accent"].includes(key))) throw new Error("Unsupported appearance setting");
  if (look.theme !== undefined && (typeof look.theme !== "string" || !Object.prototype.hasOwnProperty.call(siteThemes, look.theme))) throw new Error("Choose a supported theme");
  if (look.layout !== undefined && !["classic", "portrait", "card", "split", "cover", "minimal"].includes(String(look.layout))) throw new Error("Choose a supported layout");
  if (look.colorMode !== undefined && !["auto", "light", "dark"].includes(String(look.colorMode))) throw new Error("Choose a supported colour mode");
  if (look.accent !== undefined && (typeof look.accent !== "string" || !/^#[a-f0-9]{6}$/i.test(look.accent))) throw new Error("Use a six-digit hex accent colour");
  return look as StarterPresentation;
}

export function readStoredStarterValue<T>(json: string | null | undefined, normalize: (value: unknown) => T, fallback: T): T {
  try { return normalize(JSON.parse(json || "null")); } catch { return fallback; }
}
