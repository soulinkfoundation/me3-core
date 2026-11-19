import { describe, expect, it } from "vitest";
import { stripeWebReturnPath } from "./commerce";

describe("Stripe web return path", () => {
  it("returns to the site editor step the owner started from", () => {
    expect(stripeWebReturnPath("/create?site=clara&step=bookings")).toBe("/create?site=clara&step=bookings");
    expect(stripeWebReturnPath("/create")).toBe("/create");
  });

  it("falls back to Settings for anything else", () => {
    for (const value of [undefined, 3, "https://evil.example/create", "//evil.example/create", "/settings", "/create/../x", "/create?x=<script>", "/created"]) {
      expect(stripeWebReturnPath(value)).toBe("/settings?section=payments");
    }
  });
});
