import { describe, expect, it } from "vitest";
import { bannerCropSpec, bannerOutputSize } from "./bannerCrop";

describe("banner crop per layout", () => {
  it("keeps the 1200x400 strip for Card, Split and Minimal", () => {
    for (const layout of ["card", "split", "minimal", "classic", undefined]) {
      const spec = bannerCropSpec(layout);
      expect(spec.aspectRatio).toBe(3);
      expect(bannerOutputSize(spec, 600)).toEqual({ width: 1200, height: 400 });
      expect(bannerOutputSize(spec, 4000)).toEqual({ width: 1200, height: 400 });
    }
  });
  it("saves a tall, sharp Cover photo without upscaling", () => {
    const spec = bannerCropSpec("cover");
    expect(spec.aspectRatio).toBe(1.6);
    expect(spec.title).toBe("Crop the cover photo");
    expect(bannerOutputSize(spec, 1536)).toEqual({ width: 1536, height: 960 });
    expect(bannerOutputSize(spec, 6000)).toEqual({ width: 2400, height: 1500 });
  });
});
