import { describe, expect, it } from "vitest";
import { newsSharedLine } from "./news";

describe("who shared a story on X", () => {
  it("names the first account and counts the rest", () => {
    expect(newsSharedLine({ sharedBy: { count: 4, handles: ["rtenews", "IrishTimes"] } })).toBe("Shared on X by @rtenews and 3 others");
    expect(newsSharedLine({ sharedBy: { count: 2, handles: ["rtenews"] } })).toBe("Shared on X by @rtenews and 1 other");
    expect(newsSharedLine({ sharedBy: { count: 1, handles: ["Reuters"] } })).toBe("Shared on X by @Reuters");
  });
  it("says nothing when no one shared it, and stays honest without a handle", () => {
    expect(newsSharedLine({})).toBeNull();
    expect(newsSharedLine({ sharedBy: { count: 0, handles: [] } })).toBeNull();
    expect(newsSharedLine({ sharedBy: { count: 3, handles: [] } })).toBe("Shared on X by 3 accounts you trust");
  });
});
