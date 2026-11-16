import { describe, expect, it } from "vitest";
import {
  composerRows,
  formatVideoDuration,
  youtubeVideoKind,
  type ComposerInput,
  type ComposerRow,
} from "@me3-core/plugin-social-publishing/composer";
import fixture from "@me3-core/plugin-social-publishing/fixtures/new-post-cases.json";

// The same cases run in me3-ios, so web and iPhone can't drift (me3-s0ib).
const cases = fixture.cases as unknown as Array<{ name: string; input: ComposerInput; expected: ComposerRow[] }>;

const accounts: ComposerInput["accounts"] = [
  { id: "x", network: "x" },
  { id: "linkedin", network: "linkedin" },
  { id: "instagram", network: "instagram" },
  { id: "facebook", network: "facebook" },
  { id: "youtube", network: "youtube" },
  { id: "tiktok", network: "tiktok", tiktokMaxVideoSeconds: 600 },
];
const clip = { durationSeconds: 31, width: 1080, height: 1920 };
const row = (rows: ComposerRow[], id: string) => rows.find((item) => item.accountId === id)!;

describe("New post: what each account gets", () => {
  it.each(cases.map((item) => [item.name, item] as const))("%s", (_name, item) => {
    expect(composerRows(item.input)).toEqual(item.expected);
  });

  it("covers the design cases and the edge cases the bead names", () => {
    const names = cases.map((item) => item.name);
    for (const name of [
      "Text only",
      "6 images",
      "Video 0:48, vertical",
      "Video 3:20, vertical",
      "Images, then a video",
      "10 images and a video",
      "Video, then images",
      "Video 0:48, landscape",
      "TikTok length unknown",
      "Two accounts on one platform",
    ]) expect(names).toContain(name);
  });

  // This reverses the old rule, where the video always won on X and LinkedIn.
  it("lets the kind picked first lead on X and LinkedIn, with a swap", () => {
    const imagesFirst = composerRows({ type: "images", media: { items: ["image", "image", "video"], video: clip, firstKind: "image" }, accounts });
    expect(row(imagesFirst, "x")).toMatchObject({ items: [0, 1], format: null, label: "2 images, not the video" });
    expect(row(imagesFirst, "x").actions).toContainEqual({ kind: "swap_to_video", label: "Send the video instead" });
    expect(row(imagesFirst, "linkedin").items).toEqual([0, 1]);

    const videoFirst = composerRows({ type: "video", media: { items: ["video", "image", "image"], video: clip, firstKind: "video" }, accounts });
    expect(row(videoFirst, "x")).toMatchObject({ items: [0], format: "short_video", label: "The video, not the images" });
    expect(row(videoFirst, "linkedin").actions).toEqual([{ kind: "swap_to_images", label: "Send the images instead" }]);
  });

  it("gives Instagram one carousel with both, Facebook the images, and leaves YouTube and TikTok unticked when images lead", () => {
    const rows = composerRows({ type: "images", media: { items: ["image", "video", "image"], video: clip, firstKind: "image" }, accounts });
    expect(row(rows, "instagram")).toMatchObject({ ticked: true, items: [0, 1, 2], label: "Carousel: 2 images and the video" });
    expect(row(rows, "facebook")).toMatchObject({ ticked: true, items: [0, 2] });
    expect(row(rows, "youtube")).toMatchObject({ canTake: true, ticked: false, items: [1] });
    expect(row(rows, "tiktok")).toMatchObject({ canTake: true, ticked: false, items: [1] });
  });

  it("decides Short or Regular video from length and shape", () => {
    expect(youtubeVideoKind({ durationSeconds: 180, width: 1080, height: 1080 })).toBe("short");
    expect(youtubeVideoKind({ durationSeconds: 181, width: 1080, height: 1920 })).toBe("regular");
    expect(youtubeVideoKind({ durationSeconds: 48, width: 1920, height: 1080 })).toBe("regular");
    expect(youtubeVideoKind({ durationSeconds: 48, width: null, height: null })).toBeNull();
    expect(youtubeVideoKind({ durationSeconds: null, width: 1080, height: 1920 })).toBeNull();
  });

  it("writes lengths the way the rows say them", () => {
    expect(formatVideoDuration(48)).toBe("0:48");
    expect(formatVideoDuration(1200)).toBe("20:00");
    expect(formatVideoDuration(3725)).toBe("1:02:05");
    expect(formatVideoDuration(0.5)).toBe("half a second");
  });
});

describe("New post: accounts and caption counter (me3-hzsw)", () => {
  it("lists connected accounts in the accounts sheet's order and names ones that share a network", async () => {
    const { account } = await import("./social-posts.fixtures");
    const { newPostAccounts } = await import("./social-posts");
    const second = { ...account("x"), id: "x-2" };
    expect(newPostAccounts([account("tiktok"), account("facebook", "expired"), second, account("x"), account("linkedin")])
      .map(({ account: item, network, named }) => [item.id, network, named]))
      .toEqual([["x-2", "x", true], ["account-x", "x", true], ["account-linkedin", "linkedin", false], ["account-tiktok", "tiktok", false]]);
  });

  it("uses the tightest ticked limit and names it", async () => {
    const { capabilities } = await import("./social-posts.fixtures");
    const { newPostCaptionNote } = await import("./social-posts");
    expect(newPostCaptionNote("a".repeat(67), ["linkedin", "x"], capabilities)).toEqual({ text: "213 left for X", over: false });
    expect(newPostCaptionNote("a".repeat(2_201), ["linkedin", "instagram"], capabilities)).toEqual({ text: "1 over for Instagram. You can shorten it on the next screen.", over: true });
    expect(newPostCaptionNote("hi", [], capabilities)).toBeNull();
  });
});
