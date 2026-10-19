import { describe, expect, it } from "vitest";
import { ownMissionStatement } from "./missionStatement";

describe("ownMissionStatement", () => {
  it("treats the fill-in-the-blanks template as no mission", () => {
    expect(ownMissionStatement("I am here to help [who/what] become [desired change].")).toBe("");
  });

  it("keeps a mission the owner wrote", () => {
    expect(ownMissionStatement("  Help small teams ship calm software.  ")).toBe("Help small teams ship calm software.");
  });

  it("handles a missing mission", () => {
    expect(ownMissionStatement(undefined)).toBe("");
  });
});
