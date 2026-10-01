import { describe, expect, it } from "vitest";
import {
  APP_FEATURE_ICONS,
  appFeatureForPath,
  appFeatureIconForPath,
} from "./appFeatures";

describe("app feature utilities", () => {
  it("uses the shared plugin emoji for plugin-backed features", () => {
    expect(APP_FEATURE_ICONS["mission-control"]).toBe("🚀");
    expect(APP_FEATURE_ICONS.journal).toBe("✍️");
    expect(APP_FEATURE_ICONS.calendar).toBe("🗓️");
    expect(APP_FEATURE_ICONS["wheel-of-life"]).toBe("🛞");
  });

  it("matches feature paths and nested routes", () => {
    expect(appFeatureForPath("/journal")).toBe("journal");
    expect(appFeatureForPath("/wheel-of-life")).toBe("wheel-of-life");
    expect(appFeatureForPath("/tasks")).toBe("mission-control");
    expect(appFeatureForPath("/mission-control/wheel-of-life")).toBe(
      "mission-control",
    );
    expect(appFeatureForPath("/sites/kieran/build")).toBe("sites");
    expect(appFeatureForPath("/create")).toBe("sites");
  });

  it("keeps account and accounts routes distinct", () => {
    expect(appFeatureForPath("/account")).toBe("account");
    expect(appFeatureForPath("/account/plugins")).toBe("account");
    expect(appFeatureForPath("/settings")).toBe("account");
    expect(appFeatureForPath("/accounts")).toBe("accounts");
    expect(appFeatureForPath("/accounts/reports")).toBe("accounts");
  });

  it("returns the icon for known feature paths only", () => {
    expect(appFeatureIconForPath("/assistant")).toBe("🤖");
    expect(appFeatureIconForPath("/login")).toBeNull();
  });
});
