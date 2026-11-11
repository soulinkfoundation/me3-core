import { describe, expect, it } from "vitest";
import { centeredCrop, cropPresets, croppedFilename, moveCrop, pixelCrop, resizeCrop } from "./image-crop";

describe("image crop", () => {
  it("offers each platform's shapes, with Free last", () => {
    expect(cropPresets("instagram").map((preset) => preset.label)).toEqual(["1:1", "4:5", "Free"]);
    expect(cropPresets("x").map((preset) => preset.label)).toEqual(["16:9", "1.91:1", "Free"]);
    expect(cropPresets("linkedin").map((preset) => preset.label)).toEqual(["16:9", "1.91:1", "Free"]);
    expect(cropPresets("facebook").at(-1)?.label).toBe("Free");
  });

  it("starts from the largest centred crop of the shape", () => {
    expect(centeredCrop(1600, 900, 1)).toEqual({ x: 350, y: 0, w: 900, h: 900 });
    expect(centeredCrop(1000, 1000, 16 / 9)).toEqual({ x: 0, y: 218.75, w: 1000, h: 562.5 });
    expect(centeredCrop(800, 600, null)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it("keeps the crop inside the image when moved or resized", () => {
    const rect = { x: 100, y: 100, w: 200, h: 200 };
    expect(moveCrop(rect, 1000, -1000, 400, 400)).toEqual({ x: 200, y: 0, w: 200, h: 200 });
    expect(resizeCrop(rect, 500, 0, 400, 400, 1)).toEqual({ x: 100, y: 100, w: 300, h: 300 });
    expect(resizeCrop(rect, -1000, 0, 400, 400, 1).w).toBe(32);
    const wide = resizeCrop({ x: 0, y: 0, w: 160, h: 90 }, 40, 0, 1000, 1000, 16 / 9);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9);
    expect(resizeCrop(rect, 50, -20, 400, 400, null)).toEqual({ x: 100, y: 100, w: 250, h: 180 });
  });

  it("rounds to whole pixels and names the copy", () => {
    expect(pixelCrop({ x: 0.4, y: 218.75, w: 999.9, h: 562.5 }, 1000, 1000)).toEqual({ x: 0, y: 219, w: 1000, h: 563 });
    expect(croppedFilename("launch.PNG", "image/png")).toBe("launch-cropped.png");
    expect(croppedFilename("IMG_1.heic", "image/jpeg")).toBe("IMG_1-cropped.jpg");
    expect(croppedFilename(null, "image/jpeg")).toBe("image-cropped.jpg");
  });
});
