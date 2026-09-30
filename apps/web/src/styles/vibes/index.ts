/** Picker compatibility layer. Published theme data lives in the renderer. */
import { normalizeSiteTheme, siteThemes, type SiteThemeId } from "@me3-core/site-renderer";

export type VibeId = SiteThemeId;
export type VibeMode = "light" | "dark";

export const vibes = Object.fromEntries(
  (Object.keys(siteThemes) as VibeId[]).map((id) => {
    const theme = siteThemes[id];
    const palette = theme[theme.defaultMode];
    return [id, {
      id,
      name: theme.name,
      description: theme.description,
      fontFamily: theme.displayFont,
      colors: {
        bg: palette.bg,
        text: palette.text,
        textMuted: palette.muted,
        border: palette.border,
        accent: palette.accent,
      },
      mode: theme.defaultMode,
      fontUrl: theme.fontUrl,
    }];
  }),
) as Record<VibeId, {
  id: VibeId;
  name: string;
  description: string;
  fontFamily: string;
  colors: { bg: string; text: string; textMuted: string; border: string; accent: string };
  mode: VibeMode;
  fontUrl: string | null;
}>;

export const vibeIds = Object.keys(siteThemes) as VibeId[];
export const selectableVibeIds = vibeIds;
export const legacyVibeIds = ["retro", "natural"] as const;
export const defaultVibe: VibeId = "warm";
export const normalizeVibeId = normalizeSiteTheme;
export function getVibe(vibeId: VibeId) { return vibes[vibeId] || vibes[defaultVibe]; }
export function isVibeId(value: string): value is VibeId { return vibeIds.includes(value as VibeId); }
export function getVibeColorScheme(vibeId: VibeId): VibeMode { return getVibe(vibeId).mode; }
export function getVibeFontUrl(vibeId: VibeId): string | null { return getVibe(vibeId).fontUrl; }
