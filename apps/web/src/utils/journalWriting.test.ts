import { describe, expect, it } from "vitest";
import { reorderJournalBlocks } from "./journalWriting";

describe("journal paragraph order", () => {
  it("moves only blocks and preserves every character, including blank blocks", () => {
    const blocks = [
      { id: "a", text: "First sentence, exactly." },
      { id: "blank", text: "" },
      { id: "b", text: "Second: with punctuation!" },
    ];
    const moved = reorderJournalBlocks(blocks, ["b", "a"]);
    expect(moved?.map((block) => block.id)).toEqual(["b", "blank", "a"]);
    expect(moved?.map((block) => block.text).sort()).toEqual(blocks.map((block) => block.text).sort());
    expect(reorderJournalBlocks(blocks, ["a", "a"])).toBeNull();
  });
});
