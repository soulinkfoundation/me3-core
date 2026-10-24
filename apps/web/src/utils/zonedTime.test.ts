import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "./zonedTime";

describe("zonedLocalToUtc", () => {
  it("reads the time in the owner's timezone, across summer and winter time", () => {
    expect(zonedLocalToUtc("2026-10-24T09:00", "Europe/Dublin")).toBe("2026-10-24T08:00:00.000Z");
    expect(zonedLocalToUtc("2026-10-26T09:00", "Europe/Dublin")).toBe("2026-10-26T09:00:00.000Z");
    expect(zonedLocalToUtc("2026-10-25T09:00", "America/New_York")).toBe("2026-10-25T13:00:00.000Z");
  });

  it("rejects anything that isn't a date and time", () => {
    expect(zonedLocalToUtc("", "UTC")).toBeNull();
    expect(zonedLocalToUtc("tomorrow", "UTC")).toBeNull();
  });
});
