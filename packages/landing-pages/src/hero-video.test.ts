import { describe, expect, it } from "vitest";
import { parseHeroVideo, renderHeroVideo, heroVideoControls } from "./hero-video";

describe("background video", () => {
  it("keeps YouTube disconnected until a visitor opts in", () => {
    const html = renderHeroVideo("https://www.youtube.com/watch?v=w2Pao1UZaTI");
    expect(html).toContain('data-video-src="https://www.youtube-nocookie.com/embed/w2Pao1UZaTI');
    expect(html).not.toMatch(/\ssrc=/);
    const controls = heroVideoControls("https://youtu.be/w2Pao1UZaTI");
    expect(controls).toContain('value="reject"');
    expect(controls).toContain('value="accept"');
    expect(controls).toContain("data-cookie-settings");
    expect(controls).toContain(">Accept</button>");
    expect(controls).toContain(">Reject</button>");
    expect(controls).toContain("data-consent-preferences");
    expect(controls).toContain("data-consent-media");
    expect(controls).toContain("data-consent-save");
  });

  it("supports direct video without downloading it during initial rendering", () => {
    expect(parseHeroVideo("https://media.example/hero.webm")).toEqual({ kind: "file", url: "https://media.example/hero.webm" });
    const html = renderHeroVideo("https://media.example/hero.mp4");
    expect(html).toContain("muted loop playsinline");
    expect(html).not.toMatch(/\ssrc=/);
    expect(heroVideoControls("https://media.example/hero.mp4")).not.toContain("hero-consent");
  });

  it("rejects executable, credential-bearing, insecure and unsupported URLs", () => {
    for (const value of ["javascript:alert(1)", "http://media.example/hero.mp4", "https://user:secret@media.example/hero.mp4", "https://youtube.com.evil.test/watch?v=w2Pao1UZaTI", "https://youtube.com/watch?v=invalid", "https://example.com/page", {}]) {
      expect(parseHeroVideo(value)).toBeNull();
      expect(renderHeroVideo(value)).toBe("");
    }
  });
});
