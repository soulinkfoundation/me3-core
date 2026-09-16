/**
 * Vibes - picker metadata for generated me3 sites
 *
 * Published styling is owned by @me3-core/site-renderer.
 */

export type VibeId =
  | "warm"
  | "tech"
  | "retro"
  | "natural"
  | "paper"
  | "me3";
export type VibeMode = "light" | "dark";

export interface VibePalette {
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
}

export interface Vibe {
  id: VibeId;
  name: string;
  description: string;
  colors: VibePalette;
  fontFamily: string;
  mode: VibeMode;
  fontUrl: string | null;
}

export const vibes: Record<VibeId, Vibe> = {
  warm: {
    id: "warm",
    name: "warm",
    description: "Cozy and personal, like a handwritten letter",
    fontFamily: "Georgia, serif",
    colors: {
      bg: "#faf8f5",
      text: "#2d2a26",
      textMuted: "#6b6560",
      border: "#e8e4df",
      accent: "#2d2a26",
    },
    mode: "light",
    fontUrl: null,
  },
  tech: {
    id: "tech",
    name: "tech",
    description: "Terminal aesthetic for builders",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    colors: {
      bg: "#0a0a0a",
      text: "#e0e0e0",
      textMuted: "#9a9a9a",
      border: "#2a2a2a",
      accent: "#00ff88",
    },
    mode: "dark",
    fontUrl:
      "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap",
  },
  retro: {
    id: "retro",
    name: "retro",
    description: "Pixel art vibes, 8-bit nostalgia",
    fontFamily: "'Press Start 2P', monospace",
    colors: {
      bg: "#1a1a2e",
      text: "#eaeaea",
      textMuted: "#8888aa",
      border: "#16213e",
      accent: "#ff2a6d",
    },
    mode: "dark",
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap",
  },
  natural: {
    id: "natural",
    name: "paper",
    description: "Paper-white and editorial with a burnt-orange accent",
    fontFamily: "'Fraunces', 'Newsreader', serif",
    colors: {
      bg: "#fffaf2",
      text: "#2b211b",
      textMuted: "#6f6258",
      border: "#d8c8b6",
      accent: "#b5522d",
    },
    mode: "light",
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap",
  },
  paper: {
    id: "paper",
    name: "paper",
    description: "Paper-white and editorial with a burnt-orange accent",
    fontFamily: "'Fraunces', 'Newsreader', serif",
    colors: {
      bg: "#fffaf2",
      text: "#2b211b",
      textMuted: "#6f6258",
      border: "#d8c8b6",
      accent: "#b5522d",
    },
    mode: "light",
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap",
  },
  me3: {
    id: "me3",
    name: "me3",
    description: "Clean white ME3 look with brand green accents",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    colors: {
      bg: "#ffffff",
      text: "#232428",
      textMuted: "#5d6368",
      border: "rgba(35, 36, 40, 0.12)",
      /* sRGB fallback for <input type="color"> (matches --brand-primary) */
      accent: "#3d9b7c",
    },
    mode: "light",
    fontUrl: null,
  },
};

export const vibeIds = Object.keys(vibes) as VibeId[];
export const selectableVibeIds: VibeId[] = ["warm", "tech", "paper", "me3"];
export const legacyVibeIds: VibeId[] = ["retro", "natural"];
export const defaultVibe: VibeId = "warm";

/** Map retired theme names to their current selectable equivalent. */
export function normalizeVibeId(value: unknown): VibeId {
  if (value === "natural") return "paper";
  return typeof value === "string" && isVibeId(value)
    ? value
    : defaultVibe;
}

/**
 * Get vibe metadata by ID
 */
export function getVibe(vibeId: VibeId): Vibe {
  return vibes[vibeId] || vibes[defaultVibe];
}

export function isVibeId(value: string): value is VibeId {
  return vibeIds.includes(value as VibeId);
}

export function getVibeColorScheme(vibeId: VibeId): VibeMode {
  return getVibe(vibeId).mode;
}

/**
 * Get the Google Fonts URL for a vibe (if needed)
 */
export function getVibeFontUrl(vibeId: VibeId): string | null {
  return getVibe(vibeId).fontUrl;
}
