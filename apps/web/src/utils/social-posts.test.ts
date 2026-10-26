import { describe, expect, it } from "vitest";
import { account, capabilities, post, version } from "./social-posts.fixtures";
import {
  attentionItems,
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
    expect(versionChecks(long, capabilities)).toContainEqual({ message: "300 characters, X's limit is 280.", blocking: true, field: "text" });
    expect(versionChecks(version({ platform: "instagram" }), capabilities)).toContainEqual({ message: "Instagram needs an image.", blocking: true, field: "images" });
    const undescribed = version({ assetManifest: [{ url: "a", kind: "image", mimeType: "image/png" }] });
    expect(versionChecks(undescribed, capabilities)).toEqual([]);
    const svg = version({ assetManifest: [{ url: "a", kind: "image", mimeType: "image/svg+xml", altText: "Logo" }] });
    expect(versionChecks(svg, capabilities)[0]).toMatchObject({ message: "X can't use image 1 (SVG).", blocking: true });
    expect(versionChecks(version(), capabilities, [account("x", "expired")])).toContainEqual({ message: "Reconnect X to post.", blocking: true, field: "account" });
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
});
