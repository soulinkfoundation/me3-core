export type SiteThemeId = "warm" | "paper" | "meadow" | "me3" | "tech";
export type SiteColorMode = "auto" | "light" | "dark";

type Palette = {
  bg: string;
  surface: string;
  raised: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
};

export const siteThemes: Record<SiteThemeId, {
  name: string;
  description: string;
  displayFont: string;
  bodyFont: string;
  fontUrl: string | null;
  radius: string;
  buttonRadius: string;
  nameCase: "normal" | "lowercase";
  defaultMode: "light" | "dark";
  light: Palette;
  dark: Palette;
}> = {
  warm: {
    name: "Warm", description: "Cozy and personal", displayFont: 'Georgia,"Times New Roman",serif',
    bodyFont: 'Georgia,"Times New Roman",serif', fontUrl: null, radius: "16px", buttonRadius: "12px", nameCase: "normal", defaultMode: "light",
    light: { bg: "#faf8f5", surface: "#fff", raised: "#f0ebe5", text: "#2d2a26", muted: "#6b6560", border: "#e8e4df", accent: "#2d2a26", accentText: "#faf8f5" },
    dark: { bg: "#1a1816", surface: "#22201d", raised: "#2d2a26", text: "#efe9e1", muted: "#a89f94", border: "#3a3631", accent: "#efe9e1", accentText: "#1a1816" },
  },
  paper: {
    name: "Paper", description: "Editorial and expressive", displayFont: '"Fraunces","Iowan Old Style",Georgia,serif',
    bodyFont: '"Newsreader","Iowan Old Style","Palatino Linotype",serif',
    fontUrl: "https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap",
    radius: "6px", buttonRadius: "6px", nameCase: "normal", defaultMode: "light",
    light: { bg: "#efe5d7", surface: "#fffaf2", raised: "#f5eadb", text: "#2b211b", muted: "#6f6258", border: "#d8c8b6", accent: "#b5522d", accentText: "#fffaf2" },
    dark: { bg: "#1d1612", surface: "#261d18", raised: "#30251f", text: "#f2e6d8", muted: "#b3a292", border: "#45362c", accent: "#e07a4f", accentText: "#1d1612" },
  },
  meadow: {
    name: "Meadow", description: "Soft greens and natural warmth", displayFont: '"Young Serif",Georgia,serif',
    bodyFont: 'Figtree,system-ui,sans-serif',
    fontUrl: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Young+Serif&display=swap",
    radius: "16px", buttonRadius: "999px", nameCase: "normal", defaultMode: "light",
    light: { bg: "#eef1e8", surface: "#fbfcf8", raised: "#e3e9da", text: "#1f2a1c", muted: "#5b6655", border: "#d3dbc8", accent: "#3f6b35", accentText: "#ffffff" },
    dark: { bg: "#121711", surface: "#192018", raised: "#222b20", text: "#e6eddf", muted: "#9fac98", border: "#2f3a2c", accent: "#8fc27f", accentText: "#121711" },
  },
  me3: {
    name: "ME3", description: "Clean and modern", displayFont: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    bodyFont: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', fontUrl: null,
    radius: "14px", buttonRadius: "10px", nameCase: "normal", defaultMode: "light",
    light: { bg: "#ffffff", surface: "#ffffff", raised: "#f2f5f4", text: "#232428", muted: "#5d6368", border: "rgba(35,36,40,.12)", accent: "#3d9b7c", accentText: "#ffffff" },
    dark: { bg: "#141718", surface: "#1b1e1f", raised: "#242829", text: "#eceeee", muted: "#9aa1a4", border: "#2e3334", accent: "#5cc09d", accentText: "#141718" },
  },
  tech: {
    name: "Tech", description: "Terminal aesthetic for builders", displayFont: '"JetBrains Mono",ui-monospace,monospace',
    bodyFont: '"JetBrains Mono",ui-monospace,monospace',
    fontUrl: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap",
    radius: "0", buttonRadius: "0", nameCase: "lowercase", defaultMode: "dark",
    light: { bg: "#f4f4f0", surface: "#ffffff", raised: "#e9e9e3", text: "#111111", muted: "#555550", border: "#d0d0c8", accent: "#00804a", accentText: "#ffffff" },
    dark: { bg: "#0a0a0a", surface: "#0a0a0a", raised: "#242424", text: "#e0e0e0", muted: "#8f8f8f", border: "#2a2a2a", accent: "#00ff88", accentText: "#050505" },
  },
};

export function normalizeSiteTheme(value: unknown): SiteThemeId {
  if (value === "natural") return "paper";
  return typeof value === "string" && value in siteThemes ? value as SiteThemeId : "warm";
}
