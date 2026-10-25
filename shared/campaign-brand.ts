/**
 * Colour rules that keep every campaign readable whatever the Site's brand is (me3-bli3.2.12).
 * The card is always white; the Site only picks the outer background (when light), text and accent.
 */

export const CAMPAIGN_CARD_COLOR = "#ffffff";
export const CAMPAIGN_FALLBACK_BACKGROUND = "#f4f5f4";
export const CAMPAIGN_FALLBACK_TEXT = "#18201d";
export const CAMPAIGN_DARK = {
  background: "#121514",
  card: "#1c201f",
  text: "#e6ebe8",
  muted: "#9aa39f",
  rule: "#2e3532",
} as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export type CampaignSiteBrandInput = {
  /** The email copy of the Site logo (PNG on white), not the original. */
  emailLogoUrl?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
};

export type CampaignBrandLook = {
  logoUrl: string | null;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  accentColor: string;
};

/** The logo and colours a campaign takes from its Site. */
export function campaignBrandFromSite(input: CampaignSiteBrandInput): CampaignBrandLook {
  const accent = hexOr(input.accentColor, "#147d64");
  return {
    logoUrl: input.emailLogoUrl || null,
    backgroundColor: campaignBackground(hexOr(input.backgroundColor, CAMPAIGN_FALLBACK_BACKGROUND)),
    surfaceColor: CAMPAIGN_CARD_COLOR,
    textColor: campaignTextColor(hexOr(input.textColor, CAMPAIGN_FALLBACK_TEXT)),
    accentColor: accent,
  };
}

/** A dark or strong outer background turns muddy in Gmail's dark mode, so only light ones are kept. */
export function campaignBackground(color: string): string {
  return HEX_COLOR.test(color) && luminance(color) > 0.8 ? color.toLowerCase() : CAMPAIGN_FALLBACK_BACKGROUND;
}

/** Body text must reach 7:1 on the white card. */
export function campaignTextColor(color: string): string {
  return HEX_COLOR.test(color) && contrastRatio(color, CAMPAIGN_CARD_COLOR) >= 7
    ? color.toLowerCase()
    : CAMPAIGN_FALLBACK_TEXT;
}

/** White or near-black button text, whichever reads on the accent. */
export function campaignButtonTextColor(accent: string): string {
  return contrastRatio("#ffffff", accent) >= 4.5 ? "#ffffff" : "#111111";
}

/** The accent, darkened (or lightened on a dark surface) until links reach 4.5:1. */
export function campaignLinkColor(accent: string, surface: string = CAMPAIGN_CARD_COLOR): string {
  const towards = luminance(surface) > 0.5 ? "#000000" : "#ffffff";
  let color = hexOr(accent, "#147d64").toLowerCase();
  for (let step = 0; step < 12 && contrastRatio(color, surface) < 4.5; step += 1) {
    color = mixColors(color, towards, 0.15);
  }
  return color;
}

/** Links in the dark version: a lighter accent that still reaches 4.5:1 on the dark card. */
export function campaignDarkLinkColor(accent: string): string {
  return campaignLinkColor(mixColors(hexOr(accent, "#147d64"), "#ffffff", 0.25), CAMPAIGN_DARK.card);
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function luminance(hex: string): number {
  const weights = [0.2126, 0.7152, 0.0722];
  return channels(hex).reduce((total, value, index) => {
    const channel = value / 255;
    const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return total + linear * weights[index];
  }, 0);
}

export function mixColors(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

function channels(hex: string): number[] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}
