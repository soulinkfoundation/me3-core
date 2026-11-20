import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFETTI_COLORS, createConfettiPieces, launchConfetti } from "./confetti";

describe("createConfettiPieces", () => {
  it("fires 60 pieces up and inward from each bottom corner", () => {
    const pieces = createConfettiPieces(400, 800);
    expect(pieces).toHaveLength(120);
    const left = pieces.filter((p) => p.x === 0);
    const right = pieces.filter((p) => p.x === 400);
    expect(left).toHaveLength(60);
    expect(right).toHaveLength(60);
    for (const p of pieces) {
      expect(p.y).toBe(800);
      expect(p.vy).toBeLessThan(0);
      const angle = (Math.atan2(-p.vy, Math.abs(p.vx)) * 180) / Math.PI;
      expect(angle).toBeGreaterThanOrEqual(62 - 1e-9);
      expect(angle).toBeLessThanOrEqual(84 + 1e-9);
      const speed = Math.hypot(p.vx, p.vy);
      expect(speed).toBeGreaterThanOrEqual(800 * 2.2 - 1e-6);
      expect(speed).toBeLessThanOrEqual(800 * 2.9 + 1e-6);
      expect(p.delay).toBeLessThanOrEqual(0.15);
      expect(p.lifetime).toBeGreaterThanOrEqual(2.2);
      expect(p.lifetime).toBeLessThanOrEqual(2.8);
      expect(CONFETTI_COLORS).toContain(p.color);
    }
    expect(left.every((p) => p.vx > 0)).toBe(true);
    expect(right.every((p) => p.vx < 0)).toBe(true);
  });
});

describe("launchConfetti", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("does nothing when reduced motion is preferred", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    launchConfetti();
    expect(getContext).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("adds a click-through canvas and removes it after 3 seconds", () => {
    vi.useFakeTimers();
    if (typeof window.matchMedia === "function") {
      vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    }
    const ctx = new Proxy({}, { get: (_t, key) => (key === "canvas" ? undefined : () => {}), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    launchConfetti();
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.style.pointerEvents).toBe("none");
    expect(canvas!.style.position).toBe("fixed");
    vi.advanceTimersByTime(3000);
    expect(document.querySelector("canvas")).toBeNull();
  });
});
