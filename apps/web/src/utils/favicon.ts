import { appFeatureForPath, appFeatureIconForPath } from "./appFeatures";
import { ASSISTANT_AVATAR_SRC } from "./assistantBranding";

const FEATURE_FAVICON_ID = "me3-feature-favicon";

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function emojiFaviconHref(emoji: string) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '<text x="50" y="50" text-anchor="middle" dominant-baseline="central"',
    ' font-size="82" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">',
    escapeSvgText(emoji),
    "</text></svg>",
  ].join("");

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function updateFeatureFavicon(path: string) {
  if (typeof document === "undefined") return;

  const feature = appFeatureForPath(path);
  const emoji = appFeatureIconForPath(path);
  const existing = document.getElementById(
    FEATURE_FAVICON_ID,
  ) as HTMLLinkElement | null;

  if (!feature || !emoji) {
    existing?.remove();
    return;
  }

  const element = existing ?? document.createElement("link");
  element.id = FEATURE_FAVICON_ID;
  element.setAttribute("rel", "icon");
  element.setAttribute(
    "type",
    feature === "assistant" ? "image/webp" : "image/svg+xml",
  );
  element.setAttribute("sizes", "any");
  element.href =
    feature === "assistant" ? ASSISTANT_AVATAR_SRC : emojiFaviconHref(emoji);

  if (!existing) {
    document.head.appendChild(element);
  }
}
