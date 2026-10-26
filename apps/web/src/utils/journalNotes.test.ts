import { describe, expect, it } from "vitest";
import { groupNotes } from "./journalNotes";

const note = (id: string, updatedAt: string, projectId: string | null = null, folderId: string | null = null) => ({ id, updatedAt, projectId, folderId });

describe("groupNotes", () => {
  it("groups by project in project order, folders before loose notes, No project last", () => {
    const projects = [{ id: "launch", name: "Launch" }, { id: "garden", name: "Garden" }, { id: "empty", name: "Empty" }];
    const folders = [
      { id: "research", name: "research", projectId: "launch" },
      { id: "posts", name: "Posts", projectId: "launch" },
      { id: "essays", name: "Essays", projectId: null },
    ];
    const groups = groupNotes([
      note("a", "2026-10-01", "launch", "posts"),
      note("b", "2026-10-03", "launch"),
      note("c", "2026-10-02", "launch", "posts"),
      note("d", "2026-10-01", "garden"),
      note("e", "2026-10-01", null, "essays"),
      note("f", "2026-10-04", "deleted-project"),
      note("g", "2026-10-05", "launch", "deleted-folder"),
    ], folders, projects);

    expect(groups.map((group) => group.name)).toEqual(["Launch", "Garden", "No project"]);
    const launch = groups[0]!;
    expect(launch.folders.map((group) => [group.folder.name, group.notes.map((item) => item.id)])).toEqual([["Posts", ["c", "a"]], ["research", []]]);
    expect(launch.notes.map((item) => item.id)).toEqual(["g", "b"]);
    expect(launch.count).toBe(4);
    const none = groups[2]!;
    expect(none.folders[0]?.notes.map((item) => item.id)).toEqual(["e"]);
    expect(none.notes.map((item) => item.id)).toEqual(["f"]);
  });

  it("shows a project that only has folders", () => {
    const groups = groupNotes([], [{ id: "x", name: "X", projectId: "launch" }], [{ id: "launch", name: "Launch" }]);
    expect(groups.map((group) => group.name)).toEqual(["Launch"]);
  });
});
