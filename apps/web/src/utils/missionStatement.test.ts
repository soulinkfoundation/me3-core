import { describe, expect, it, vi } from "vitest";
import { missionSentence, ownMissionStatement, saveMission } from "./missionStatement";

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

// The preview has to read exactly as ME3 will save it. Failure modes: the preview and the saved sentence differ;
// trailing punctuation doubles up; a sentence appears before anyone is named; saving still goes through the site.
describe("missionSentence", () => {
  it("builds the same sentence ME3 saves", () => {
    expect(missionSentence({ who: "first-time founders", change: "launch with confidence", how: "coaching and simple tools." }))
      .toBe("I help first-time founders launch with confidence by coaching and simple tools.");
    expect(missionSentence({ who: "my family", how: "being present", why: "they matter most" })).toBe("I help my family by being present, because they matter most.");
    expect(missionSentence({ change: "grow", how: "teaching" })).toBe("");
  });
});

describe("saveMission", () => {
  it("saves privately through Mission, never the site", async () => {
    const { api } = await import("../api");
    const put = vi.spyOn(api, "put").mockResolvedValue({ mission: { statement: "I help makers ship.", answers: { who: "makers" } } });
    const upload = vi.spyOn(api, "upload");
    await expect(saveMission({ answers: { who: "makers", change: "ship" } })).resolves.toEqual({ statement: "I help makers ship.", answers: { who: "makers" } });
    expect(put).toHaveBeenCalledWith("/mission-control/mission", { answers: { who: "makers", change: "ship" } });
    expect(upload).not.toHaveBeenCalled();
  });
});
