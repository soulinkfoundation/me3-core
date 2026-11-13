import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RANDOM_PHOTO_COUNT, pickRandomPhotoUrl } from "./randomPhoto";

describe("pickRandomPhotoUrl", () => {
  it("points at a bundled photo that exists", () => {
    for (let i = 0; i < RANDOM_PHOTO_COUNT; i++) {
      const url = pickRandomPhotoUrl(() => i / RANDOM_PHOTO_COUNT);
      const file = url.split("/random-photos/")[1];
      expect(existsSync(resolve(__dirname, "../../public/random-photos", file))).toBe(true);
    }
  });

  it("never serves the same photo twice in a row", () => {
    const first = pickRandomPhotoUrl(() => 0.5);
    const second = pickRandomPhotoUrl(() => 0.5);
    expect(second).not.toBe(first);
  });

  it("stays in range when random returns its upper edge", () => {
    const url = pickRandomPhotoUrl(() => 0.9999999);
    expect(url).toMatch(/random-photos\/(0[1-9]|1\d|20)\.webp$/);
  });
});
