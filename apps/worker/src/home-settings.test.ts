import { afterEach, describe, expect, it } from "vitest";
import { getHomeSettings, updateHomeSettings, HOME_SETTINGS_SCHEMA } from "./home-layout";
import { gratitudeFixture } from "./test-utils/gratitude-fixture";

// Failure modes written first: existing installs (no saved row) losing Today's
// page, a hide not persisting, one switch resetting another, non-boolean or
// unknown input stored, and one owner's choice leaking to another.
const fixtures: ReturnType<typeof gratitudeFixture>[] = [];
function fixture() {
  const f = gratitudeFixture();
  for (const sql of HOME_SETTINGS_SCHEMA) f.raw.exec(sql);
  fixtures.push(f); return f;
}
afterEach(() => { fixtures.splice(0).forEach(f => f.raw.close()); });

describe("Home settings", () => {
  it("shows Today's page on an install that never saved a choice", async () => {
    expect(await getHomeSettings(fixture().env, "owner")).toEqual({ todayPage: true });
  });

  it("persists hiding and showing Today's page", async () => {
    const f = fixture();
    expect(await updateHomeSettings(f.env, "owner", { todayPage: false })).toEqual({ todayPage: false });
    expect(await getHomeSettings(f.env, "owner")).toEqual({ todayPage: false });
    expect(await updateHomeSettings(f.env, "owner", {})).toEqual({ todayPage: false });
    expect(await updateHomeSettings(f.env, "owner", { todayPage: true })).toEqual({ todayPage: true });
  });

  it("rejects invalid input without storing it", async () => {
    const f = fixture();
    for (const bad of [null, [], { todayPage: "no" }, { todayPage: 0 }, { other: false }]) {
      await expect(updateHomeSettings(f.env, "owner", bad)).rejects.toThrow();
    }
    expect(await getHomeSettings(f.env, "owner")).toEqual({ todayPage: true });
  });
});
