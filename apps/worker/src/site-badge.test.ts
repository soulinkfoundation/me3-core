import { describe, expect, it } from "vitest";
import { normalizeSiteBadgePreference, siteBadgeAutomaticallyShown, siteBadgeVisible } from "./site-badge";

describe("site badge", () => {
  it("shows on self-hosted sites by default", () => {
    expect(siteBadgeAutomaticallyShown({ managed: false, billingSource: null })).toBe(true);
  });

  it("shows on managed installs during the free trial", () => {
    expect(siteBadgeAutomaticallyShown({ managed: true, billingSource: "trial" })).toBe(true);
  });

  it("is off by default once a managed install is paying", () => {
    for (const billingSource of ["stripe", "storekit", "google_play", "complimentary", "internal"] as const) {
      expect(siteBadgeAutomaticallyShown({ managed: true, billingSource })).toBe(false);
    }
  });

  it("stays off on a managed install whose billing is not known yet", () => {
    expect(siteBadgeAutomaticallyShown({ managed: true, billingSource: null })).toBe(false);
  });

  it("follows the owner's choice over the default", () => {
    expect(siteBadgeVisible({ preference: "hidden", managed: false, billingSource: null, customDomainActive: false })).toBe(false);
    expect(siteBadgeVisible({ preference: "shown", managed: true, billingSource: "stripe", customDomainActive: true })).toBe(true);
  });

  it("leaves a custom domain unbranded by default", () => {
    expect(siteBadgeVisible({ preference: "auto", managed: false, billingSource: null, customDomainActive: true })).toBe(false);
  });

  it("reads unknown stored values as automatic", () => {
    expect(normalizeSiteBadgePreference(null)).toBe("auto");
    expect(normalizeSiteBadgePreference("sometimes")).toBe("auto");
    expect(normalizeSiteBadgePreference("hidden")).toBe("hidden");
  });
});
