import { describe, expect, it } from "vitest";
import type { CarouselTemplateSettings, TextCarouselSlide } from "../stores/social";
import { mainTextSize, resolveSlide, siteLookFrom, slideTooLong, wrapText, type SiteLook } from "./text-carousel";

const settings: CarouselTemplateSettings = {
  background: "site-light",
  photoFileId: null,
  dim: 45,
  accent: "site",
  font: "site",
  weight: "regular",
  position: "middle",
  align: "left",
  rule: true,
  cornerLeft: "",
  cornerRight: "",
  logo: true,
};
const slide = (patch: Partial<TextCarouselSlide> = {}): TextCarouselSlide => ({
  id: "s1", main: "Write before you scroll.", small: "", swap: false, photoFileId: null, ...patch,
});
const paper: SiteLook = { theme: "paper", accentOverride: null, logoUrl: null };

describe("text carousel slides", () => {
  it("follows the site's Look for templates left on Site", () => {
    expect(resolveSlide(slide(), settings, paper).colors).toMatchObject({ bg: "#efe5d7", text: "#2b211b", accent: "#b5522d" });
    expect(resolveSlide(slide(), { ...settings, background: "site-dark" }, paper).colors).toMatchObject({ bg: "#1d1612", accent: "#e07a4f" });
    const meadow = resolveSlide(slide(), settings, { ...paper, theme: "meadow", accentOverride: "#ff0000" });
    expect(meadow.colors).toMatchObject({ bg: "#eef1e8", accent: "#ff0000" });
    expect(meadow.mainFont).toContain("Young Serif");
    expect(meadow.smallFont).toContain("Figtree");
  });

  it("picks readable text for custom colours and swaps colours on request", () => {
    expect(resolveSlide(slide(), { ...settings, background: "#1f6f56" }, paper).colors.text).toBe("#F5F3EE");
    expect(resolveSlide(slide(), { ...settings, background: "#f3ede3" }, paper).colors.text).toBe("#1B1A17");
    expect(resolveSlide(slide({ swap: true }), settings, paper).colors.bg).toBe("#1d1612");
    expect(resolveSlide(slide({ swap: true }), { ...settings, background: "#1f6f56" }, paper).colors.bg).toBe("#F5F3EE");
  });

  it("uses a slide's own photo over the template background", () => {
    const withPhoto = { ...settings, background: "photo" as const, photoFileId: "tpl-photo" };
    expect(resolveSlide(slide(), withPhoto, paper).photoFileId).toBe("tpl-photo");
    expect(resolveSlide(slide({ photoFileId: "own" }), withPhoto, paper).photoFileId).toBe("own");
    expect(resolveSlide(slide({ swap: true }), withPhoto, paper).photoFileId).toBeNull();
    expect(resolveSlide(slide(), withPhoto, paper).colors.text).toBe("#FFFFFF");
  });

  it("sizes text by length and warns when it's too long", () => {
    expect(mainTextSize({ main: "Short", small: "" })).toBeGreaterThan(mainTextSize({ main: "Short", small: "Body" }));
    expect(mainTextSize({ main: "x".repeat(200), small: "" })).toBeLessThan(mainTextSize({ main: "x".repeat(20), small: "" }));
    expect(slideTooLong({ main: "x".repeat(241), small: "" })).toBe(true);
    expect(slideTooLong({ main: "Headline", small: "y".repeat(301) })).toBe(true);
    expect(slideTooLong({ main: "Headline", small: "Fine" })).toBe(false);
  });

  it("wraps on words, keeps line breaks and splits words that don't fit", () => {
    const measure = { measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics };
    expect(wrapText(measure, "one two three four", 90)).toEqual(["one two", "three", "four"]);
    expect(wrapText(measure, "a\n\nb", 90)).toEqual(["a", "", "b"]);
    expect(wrapText(measure, "abcdefghijkl", 50)).toEqual(["abcde", "fghij", "kl"]);
  });

  it("reads theme, accent and logo from the site profile", () => {
    const look = siteLookFrom(
      { logo: "./files/logo.png", extensions: { "me3.app/site": { theme: "tech", accent: "#123456" } } },
      (value) => (value ? `/preview/me/${value.replace("./", "")}` : null),
    );
    expect(look).toEqual({ theme: "tech", accentOverride: "#123456", logoUrl: "/preview/me/files/logo.png" });
    expect(siteLookFrom({ links: { _vibe: "natural" } }, () => null)).toEqual({ theme: "paper", accentOverride: null, logoUrl: null });
  });
});
