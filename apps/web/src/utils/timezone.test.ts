import { describe, expect, it } from "vitest";
import {
  getTimeZoneSearchAliases,
  instantToLocalDateTimeParts,
  listSupportedTimeZones,
  localDateTimeToUtcIso,
  resolveLocalDateTimeToUtc,
} from "./timezone";

describe("timezone scheduling helpers", () => {
  it("includes Spain timezones and useful city search aliases", () => {
    const zones = listSupportedTimeZones();
    expect(zones).toContain("Europe/Madrid");
    expect(zones).toContain("Atlantic/Canary");
    expect(getTimeZoneSearchAliases("Europe/Madrid")).toContain("Barcelona");
    expect(getTimeZoneSearchAliases("Europe/Madrid")).toContain("Valencia");
  });

  it("converts owner-entered wall time with its named timezone", () => {
    expect(
      localDateTimeToUtcIso("2026-07-20", "10:30", "Europe/Dublin"),
    ).toBe("2026-07-20T09:30:00.000Z");
    expect(
      localDateTimeToUtcIso("2026-07-20", "10:30", "America/New_York"),
    ).toBe("2026-07-20T14:30:00.000Z");
  });

  it("round-trips an instant into the Publication timezone", () => {
    expect(
      instantToLocalDateTimeParts(
        "2026-07-20T09:30:00.000Z",
        "Europe/Dublin",
      ),
    ).toEqual({ date: "2026-07-20", time: "10:30" });
  });

  it("distinguishes invalid input from wall times skipped by daylight saving", () => {
    expect(
      resolveLocalDateTimeToUtc(
        "2026-03-08",
        "02:30",
        "America/New_York",
      ),
    ).toEqual({ ok: false, reason: "nonexistent" });
    expect(
      localDateTimeToUtcIso("2026-03-08", "02:30", "America/New_York"),
    ).toBeNull();
    expect(
      resolveLocalDateTimeToUtc("2026-07-20", "10:30", "Not/A_Timezone"),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      resolveLocalDateTimeToUtc("2026-02-30", "10:30", "Europe/Dublin"),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects repeated fall-back wall times instead of guessing an offset", () => {
    expect(
      resolveLocalDateTimeToUtc(
        "2026-11-01",
        "01:30",
        "America/New_York",
      ),
    ).toEqual({ ok: false, reason: "ambiguous" });
    expect(
      resolveLocalDateTimeToUtc("2026-10-25", "01:30", "Europe/Dublin"),
    ).toEqual({ ok: false, reason: "ambiguous" });
    expect(
      localDateTimeToUtcIso("2026-11-01", "01:30", "America/New_York"),
    ).toBeNull();
  });
});
