import { describe, expect, it } from "vitest";
import { ownerDateTime } from "../../../packages/agent/src/tools/targets";

describe("approval card dates", () => {
  it("shows owner-local weekday, date and time instead of an ISO timestamp", () => {
    expect(ownerDateTime({ ownerTimezone: "Europe/Dublin" }, "2026-10-22T09:00:00.000Z")).toBe("Thu 22 Oct, 10:00");
    expect(ownerDateTime({ ownerTimezone: "America/New_York" }, "2026-10-22T09:00:00.000Z")).toBe("Thu 22 Oct, 05:00");
  });
  it("leaves an unparseable value unchanged", () => {
    expect(ownerDateTime({ ownerTimezone: "Europe/Dublin" }, "not a date")).toBe("not a date");
  });
});
