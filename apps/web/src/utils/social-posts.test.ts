import { describe, expect, it } from "vitest";
import { account, capabilities, post, version } from "./social-posts.fixtures";
import {
  attentionItems,
  foldIndex,
  moveLinkOut,
  splitIntoThread,
  threadParts,
  postRowDetail,
  postTab,
  postTitle,
  resultFor,
  suggestedTime,
  versionChecks,
  visibleVersions,
} from "./social-posts";

describe("social posts", () => {
  it("puts each post in one tab", () => {
    expect(postTab(post([version()]))).toBe("drafts");
    expect(postTab(post([version({ publicationStatus: "scheduled" }), version({ platform: "linkedin", publicationStatus: "published" })]))).toBe("scheduled");
    expect(postTab(post([version({ publicationStatus: "published" })]))).toBe("posted");
    expect(postTab(post([version({ publicationStatus: "failed" })]))).toBe("scheduled");
  });

  it("keeps TikTok out of the owner's view", () => {
    expect(visibleVersions(post([version({ platform: "tiktok" }), version({ platform: "linkedin" })])).map((item) => item.platform)).toEqual(["linkedin"]);
  });

  it("titles a pasted post from its first line, not an internal name", () => {
    expect(postTitle(post([version()]))).toBe("Studio open day on Saturday.");
    expect(postTitle(post([version()], { sourceTitle: "Why we stopped spec work", sourceType: "journal" }))).toBe("Why we stopped spec work");
  });

  it("flags problems beside the field they affect", () => {
    const long = version({ bodyText: "x".repeat(300) });
    expect(versionChecks(long, capabilities)).toContainEqual({ message: "300 characters, X's limit is 280.", blocking: true, field: "text", fix: "thread_or_shorten" });
    expect(versionChecks(version({ platform: "instagram" }), capabilities)).toContainEqual({ message: "Instagram needs an image or a video.", blocking: true, field: "images" });
    const undescribed = version({ assetManifest: [{ url: "a", kind: "image", mimeType: "image/png" }] });
    expect(versionChecks(undescribed, capabilities)).toEqual([]);
    const svg = version({ assetManifest: [{ url: "a", kind: "image", mimeType: "image/svg+xml", altText: "Logo" }] });
    expect(versionChecks(svg, capabilities)[0]).toMatchObject({ message: "X can't use image 1 (SVG).", blocking: true });
    expect(versionChecks(version(), capabilities, [account("x", "expired")])).toContainEqual({ message: "Reconnect X to post.", blocking: true, field: "account" });
    const mov = { url: "/v.mov", kind: "video" as const, mimeType: "video/quicktime", byteLength: 1000, filename: "IMG_1.MOV", altText: "" };
    expect(versionChecks(version({ assetManifest: [mov] }), capabilities)).toEqual([
      { message: "X takes MP4 video, and this is a MOV (iPhone) file.", blocking: true, field: "images", fix: "convert_video" },
    ]);
    expect(versionChecks(version({ assetManifest: [{ ...mov, mimeType: "video/mp4" }] }), capabilities)).toEqual([]);
    expect(versionChecks(version({ platform: "facebook", assetManifest: [mov] }), capabilities)[0]).toMatchObject({ message: "Facebook doesn't take video here. Remove it or use images." });
  });

  it("gives each failure class one next step", () => {
    expect(resultFor(version({ publicationStatus: "failed", failureClass: "retryable" }))).toMatchObject({ action: "retry", actionLabel: "Try again" });
    expect(resultFor(version({ publicationStatus: "failed", failureClass: "reconnect_required" }))).toMatchObject({ action: "reconnect" });
    expect(resultFor(version({ publicationStatus: "failed", failureClass: "outcome_unknown" }))).toMatchObject({ action: "mark_posted", message: "Not confirmed. Check your profile." });
    expect(resultFor(version({ publicationStatus: "failed", failureClass: "rejected", errorMessage: "Text is too long." }))).toMatchObject({ action: "edit", message: "Text is too long." });
    // Provider codes and internal names never reach the owner.
    expect(resultFor(version({ publicationStatus: "failed", failureClass: "rejected", errorMessage: "Publication x_media_upload failed (#100)" })).message).toBe("X didn't accept this post.");
    expect(resultFor(version({ platform: "youtube", publicationStatus: "published" }))).toMatchObject({ message: "Uploaded as a private draft", action: "open_youtube", actionLabel: "Publish in YouTube" });
  });

  it("shows Needs attention only when something needs the owner", () => {
    const scheduled = post([version({ platform: "instagram", publicationStatus: "scheduled" })]);
    expect(attentionItems([scheduled], [account("instagram")])).toEqual([]);
    expect(attentionItems([scheduled], [account("instagram", "expired")])).toEqual([
      { kind: "disconnected", network: "instagram", label: "Instagram", paused: 1 },
    ]);
    expect(postRowDetail(scheduled, capabilities, [account("instagram", "expired")])).toEqual({
      text: "Paused until Instagram reconnects",
      tone: "danger",
    });
  });

  it("suggests the next weekday at 12:30", () => {
    const friday = new Date(2026, 9, 23, 15, 0);
    const suggestion = suggestedTime(friday);
    expect([suggestion.getDay(), suggestion.getHours(), suggestion.getMinutes()]).toEqual([1, 12, 30]);
  });

  it("finds where each feed folds a caption", () => {
    expect(foldIndex("x", "a".repeat(400))).toBeNull();
    expect(foldIndex("linkedin", "short")).toBeNull();
    expect(foldIndex("linkedin", "a".repeat(300))).toBe(210);
    expect(foldIndex("instagram", "one\ntwo\nthree")).toBe(7);
    expect(foldIndex("instagram_business", "one\ntwo\n")).toBeNull();
    expect(foldIndex("linkedin", "😀".repeat(220))).toBe(420);
  });

  it("lets Instagram mix photos and videos, and LinkedIn post a PDF on its own", () => {
    const photo = { url: "/p.jpg", kind: "image" as const, mimeType: "image/jpeg" };
    const clip = { url: "/c.mov", kind: "video" as const, mimeType: "video/quicktime", byteLength: 1000 };
    const pdf = { url: "/d.pdf", kind: "document" as const, mimeType: "application/pdf", byteLength: 1000, filename: "Deck.pdf" };
    expect(versionChecks(version({ platform: "instagram", assetManifest: [clip, photo] }), capabilities)).toEqual([]);
    expect(versionChecks(version({ platform: "instagram", assetManifest: Array.from({ length: 11 }, () => clip) }), capabilities)[0]?.message)
      .toBe("Instagram takes up to 10 photos and videos.");
    expect(versionChecks(version({ platform: "linkedin", assetManifest: [pdf] }), capabilities)).toEqual([]);
    expect(versionChecks(version({ platform: "linkedin", assetManifest: [pdf, photo] }), capabilities)[0]?.message)
      .toBe("LinkedIn posts a PDF on its own, without photos or video.");
    expect(versionChecks(version({ assetManifest: [pdf] }), capabilities)[0]?.message).toBe("X doesn't take PDFs. Remove it to post here.");
  });

  it("splits long X text into a thread at sentence boundaries", () => {
    const text = `${"One sentence here. ".repeat(10).trim()}\n\n${"Another thought follows. ".repeat(8).trim()}`;
    const parts = splitIntoThread(text, 280);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => Array.from(part).length <= 280)).toBe(true);
    expect(parts.every((part) => /[.]$/.test(part))).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
    expect(splitIntoThread("w".repeat(600), 280).map((part) => part.length)).toEqual([600]);
    expect(splitIntoThread("word ".repeat(120).trim(), 280).every((part) => part.length <= 280)).toBe(true);
    expect(threadParts("A\n\n---\n\nB\n---\nC")).toEqual(["A", "B", "C"]);
    const thread = version({ bodyText: `${"a".repeat(300)}\n---\nok`, publishingSettings: { post: { thread: true } } });
    expect(versionChecks(thread, capabilities)).toContainEqual({ message: "Post 1 of the thread is 300 characters, X's limit is 280.", blocking: true, field: "text" });
  });

  it("moves the first link out of the text for a first comment", () => {
    expect(moveLinkOut("We launched ME3 today: https://me3.app/launch.\n\nTry it.")).toEqual({ text: "We launched ME3 today: .\n\nTry it.", link: "https://me3.app/launch" });
    expect(moveLinkOut("No link here.")).toBeNull();
    expect(resultFor(version({ publicationStatus: "published", publishedAt: "2026-11-11T12:00:00.000Z", errorMessage: "Posted, but the first comment didn't go up. Add it on X." })).message)
      .toMatch(/^Posted .+\. Posted, but the first comment didn't go up\. Add it on X\.$/);
  });
});

