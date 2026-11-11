import { describe, expect, it } from "vitest";
import { fitSize, isHeic, needsImagePrep, planVideo, videoBitrateFor } from "./media-prep";
import type { SocialPlatformContentRule } from "../stores/social";

const rule = (allowedMimeTypes: string[], maxBytesPerItem: number | null): SocialPlatformContentRule => ({
  contentType: "short_video",
  label: "",
  requiresText: true,
  maxTextCharacters: 280,
  minMediaItems: 1,
  maxMediaItems: 1,
  allowedMediaKinds: ["video"],
  allowedMimeTypes,
  maxBytesPerItem,
  guidance: null,
});

describe("media prep", () => {
  it("prepares HEIC, big, and unusual photos, and leaves the rest", () => {
    expect(isHeic({ type: "", name: "IMG_0001.HEIC" })).toBe(true);
    expect(needsImagePrep({ type: "image/heic", name: "a.heic", size: 10 })).toBe(true);
    expect(needsImagePrep({ type: "image/jpeg", name: "a.jpg", size: 6 * 1024 * 1024 })).toBe(true);
    expect(needsImagePrep({ type: "image/tiff", name: "a.tiff", size: 10 })).toBe(true);
    expect(needsImagePrep({ type: "image/png", name: "a.png", size: 10 })).toBe(false);
    expect(needsImagePrep({ type: "image/gif", name: "a.gif", size: 9 * 1024 * 1024 })).toBe(false);
    expect(fitSize(8000, 6000)).toEqual({ width: 4096, height: 3072 });
    expect(fitSize(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it("converts a video only when the platform can't take it as it is", () => {
    const x = rule(["video/mp4"], 512 * 1024 * 1024);
    expect(planVideo({ type: "video/quicktime", size: 1000 }, x)).toEqual({ convert: true, reason: "format", maxBytes: 512 * 1024 * 1024 });
    expect(planVideo({ type: "video/mp4", size: 1000 }, x)).toEqual({ convert: false });
    expect(planVideo({ type: "video/mp4", size: 600 * 1024 * 1024 }, x)).toMatchObject({ convert: true, reason: "size" });
    expect(planVideo({ type: "video/quicktime", size: 1000 }, rule(["video/mp4", "video/quicktime"], null))).toEqual({ convert: false });
    expect(planVideo({ type: "video/webm", size: 1000 }, rule(["video/*"], null))).toEqual({ convert: false });
    expect(planVideo({ type: "video/quicktime", size: 1000 }, null)).toEqual({ convert: false });
  });

  it("picks a bitrate that fits the size", () => {
    const bitrate = videoBitrateFor(100 * 1024 * 1024, 60);
    expect((bitrate + 128_000) * 60 / 8).toBeLessThanOrEqual(100 * 1024 * 1024);
    expect(videoBitrateFor(1024, 600)).toBe(250_000);
  });
});
