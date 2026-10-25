import { describe, expect, it, vi } from "vitest";
import {
  adapterFor,
  normalizeSocialMediaAssets,
} from "@me3-core/plugin-social-publishing";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

describe("LinkedIn publishing adapter", () => {
  it("publishes a current-version personal text post and returns its permalink", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/userinfo")) return Response.json({ sub: "member-1" });
      if (url.endsWith("/rest/posts")) {
        expect(new Headers(init?.headers).get("Linkedin-Version")).toBe("202606");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          author: "urn:li:person:member-1",
          commentary: "A useful LinkedIn post.",
          lifecycleState: "PUBLISHED",
        });
        return new Response("{}", {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:12345" },
        });
      }
      throw new Error(`Unexpected LinkedIn request: ${url}`);
    });

    const result = await adapterFor("linkedin").publish({
      accessToken: "token",
      accountId: "member-1",
      bodyText: "A useful LinkedIn post.",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "urn:li:share:12345",
      platformPostUrl: "https://www.linkedin.com/feed/update/urn:li:share:12345",
    });
  });

  it("uploads one image and attaches its image URN to the post", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/userinfo")) return Response.json({ sub: "member-1" });
      if (url === "https://cdn.example/post.png") {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("/rest/images?action=initializeUpload")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          initializeUploadRequest: { owner: "urn:li:person:member-1" },
        });
        return Response.json({
          value: {
            uploadUrl: "https://upload.linkedin.example/image",
            image: "urn:li:image:image-1",
          },
        });
      }
      if (url === "https://upload.linkedin.example/image") {
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("Content-Type")).toBe("image/png");
        return new Response(null, { status: 201 });
      }
      if (url.endsWith("/rest/posts")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          content: { media: { id: "urn:li:image:image-1" } },
        });
        return new Response("{}", {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:image-post" },
        });
      }
      throw new Error(`Unexpected LinkedIn request: ${url}`);
    });

    const result = await adapterFor("linkedin").publish({
      accessToken: "token",
      accountId: "member-1",
      bodyText: "Post with an image.",
      assets: [{ url: "https://cdn.example/post.png", kind: "image", mimeType: "image/png" }],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({ ok: true, platformPostId: "urn:li:share:image-post" });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("uploads ordered images and publishes a LinkedIn multi-image post", async () => {
    const uploads: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/userinfo")) return Response.json({ sub: "member-1" });
      if (url.startsWith("https://cdn.example/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": url.endsWith(".png") ? "image/png" : "image/jpeg" },
        });
      }
      if (url.includes("/rest/images?action=initializeUpload")) {
        const imageNumber = uploads.length + 1;
        uploads.push(`image-${imageNumber}`);
        return Response.json({
          value: {
            uploadUrl: `https://upload.linkedin.example/image-${imageNumber}`,
            image: `urn:li:image:image-${imageNumber}`,
          },
        });
      }
      if (url.startsWith("https://upload.linkedin.example/")) {
        expect(init?.method).toBe("PUT");
        return new Response(null, { status: 201 });
      }
      if (url.endsWith("/rest/posts")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          commentary: "Two images in order.",
          content: {
            multiImage: {
              images: [
                { id: "urn:li:image:image-1", altText: "First image." },
                { id: "urn:li:image:image-2" },
              ],
            },
          },
        });
        return new Response("{}", {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:multi-image-post" },
        });
      }
      throw new Error(`Unexpected LinkedIn request: ${url}`);
    });

    const result = await adapterFor("linkedin").publish({
      accessToken: "token",
      accountId: "member-1",
      bodyText: "Two images in order.",
      assets: [
        {
          url: "https://cdn.example/first.png",
          kind: "image",
          mimeType: "image/png",
          altText: " First image. ",
        },
        {
          url: "https://cdn.example/second.jpg",
          kind: "image",
          mimeType: "image/jpeg",
        },
      ],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "urn:li:share:multi-image-post",
    });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("rejects unsupported LinkedIn media before delivery", () => {
    expect(adapterFor("linkedin").validateDraft({
      bodyText: "A video.",
      assets: [{
        url: "https://cdn.example/video.mp4",
        kind: "video",
        mimeType: "video/mp4",
      }],
    })).toEqual({
      ok: false,
      error: "LinkedIn publishing currently supports text and image posts.",
    });
    expect(adapterFor("linkedin").validateDraft({
      bodyText: "Too many images.",
      assets: Array.from({ length: 21 }, (_, index) => ({
        url: `https://cdn.example/${index}.png`,
        kind: "image" as const,
        mimeType: "image/png",
      })),
    })).toEqual({
      ok: false,
      error: "LinkedIn multi-image posts support up to 20 images.",
    });
  });

  it("classifies a confirmed rate limit as safely retryable", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v2/userinfo")) return Response.json({ sub: "member-1" });
      return Response.json({ message: "Too many requests" }, { status: 429 });
    });

    const result = await adapterFor("linkedin").publish({
      accessToken: "token",
      accountId: "member-1",
      bodyText: "Retry this later.",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      failureClass: "retryable",
      errorCode: "linkedin_post_error",
    });
  });

  it("does not retry when LinkedIn gives no response after accepting the write request", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v2/userinfo")) return Response.json({ sub: "member-1" });
      throw new Error("connection reset");
    });

    const result = await adapterFor("linkedin").publish({
      accessToken: "token",
      accountId: "member-1",
      bodyText: "Maybe published.",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      failureClass: "outcome_unknown",
      errorCode: "linkedin_outcome_unknown",
    });
  });
});

describe("X publishing adapter", () => {
  it("normalizes optional alt text without retaining unknown manifest fields", () => {
    expect(normalizeSocialMediaAssets([{
      url: "  https://cdn.example/image.png  ",
      fileId: " file-1 ",
      mimeType: " image/png ",
      kind: "image",
      altText: "  A concise image description.  ",
      contentHash: ` SHA256:${"A".repeat(64)} `,
      byteLength: 42.4,
      assetIndex: 1.2,
      ignored: "not part of the provider contract",
    }])).toEqual([{
      url: "https://cdn.example/image.png",
      fileId: "file-1",
      filename: undefined,
      mimeType: "image/png",
      kind: "image",
      altText: "A concise image description.",
      contentHash: `sha256:${"a".repeat(64)}`,
      byteLength: 42,
      path: undefined,
      assetIndex: 1,
    }]);
  });

  it("publishes a text-only post through the current X API host", async () => {
    const markProviderCostStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.x.com/2/tweets");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer x-token");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "A useful X post." });
      return Response.json({ data: { id: "post-123" } }, { status: 201 });
    });

    const result = await adapterFor("x").publish({
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "  A useful X post.  ",
      assets: [],
      fetcher: fetcher as typeof fetch,
      markProviderCostStarted,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "post-123",
      platformPostUrl: "https://x.com/i/web/status/post-123",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(markProviderCostStarted).toHaveBeenCalledTimes(1);
  });

  it("uploads ordered raster images, adds optional alt text, and attaches media ids", async () => {
    const uploadBodies: Array<Record<string, unknown>> = [];
    const markProviderCostStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://cdn.example/one.png") {
        return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
      }
      if (url === "https://cdn.example/two.jpg") {
        return new Response(JPEG_BYTES, { headers: { "content-type": "image/jpeg" } });
      }
      if (url === "https://api.x.com/2/media/upload") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        uploadBodies.push(body);
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer x-token");
        return Response.json({ data: { id: `media-${uploadBodies.length}` } });
      }
      if (url === "https://api.x.com/2/media/metadata") {
        expect(JSON.parse(String(init?.body))).toEqual({
          id: "media-1",
          metadata: { alt_text: { text: "A green field beneath a clear sky." } },
        });
        return Response.json({ data: { id: "media-1" } });
      }
      if (url === "https://api.x.com/2/tweets") {
        expect(JSON.parse(String(init?.body))).toEqual({
          text: "Two useful images.",
          media: { media_ids: ["media-1", "media-2"] },
        });
        return Response.json({ data: { id: "post-with-media" } }, { status: 201 });
      }
      throw new Error(`Unexpected X request: ${url}`);
    });

    const result = await adapterFor("x").publish({
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "Two useful images.",
      assets: [
        {
          url: "https://cdn.example/one.png",
          kind: "image",
          mimeType: "image/png",
          altText: "  A green field beneath a clear sky.  ",
        },
        {
          url: "https://cdn.example/two.jpg",
          kind: "image",
          mimeType: "image/jpeg",
        },
      ],
      fetcher: fetcher as typeof fetch,
      markProviderCostStarted,
    });

    expect(result).toMatchObject({ ok: true, platformPostId: "post-with-media" });
    expect(uploadBodies).toEqual([
      {
        media: btoa(String.fromCharCode(...PNG_BYTES)),
        media_category: "tweet_image",
        media_type: "image/png",
      },
      {
        media: btoa(String.fromCharCode(...JPEG_BYTES)),
        media_category: "tweet_image",
        media_type: "image/jpeg",
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(markProviderCostStarted).toHaveBeenCalledTimes(1);
  });

  it("uploads and publishes one MP4 video through X's chunked media flow", async () => {
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const commands: string[] = [];
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://media.example/short.mp4") {
        expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
        return new Response(videoBytes, { status: 206 });
      }
      if (url === "https://api.x.com/2/media/upload") {
        const body = init?.body as FormData;
        const command = String(body.get("command"));
        commands.push(command);
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer x-token");
        if (command === "INIT") {
          expect(body.get("command")).toBe("INIT");
          expect(body.get("media_type")).toBe("video/mp4");
          expect(body.get("total_bytes")).toBe("4");
          expect(body.get("media_category")).toBe("tweet_video");
          return Response.json({ data: { id: "video-media-1" } });
        }
        if (command === "APPEND") {
          expect(body.get("media_id")).toBe("video-media-1");
          expect(body.get("segment_index")).toBe("0");
          expect(body.get("media")).toBeInstanceOf(Blob);
          return new Response(null, { status: 204 });
        }
        expect(command).toBe("FINALIZE");
        return Response.json({
          data: {
            id: "video-media-1",
            processing_info: { state: "succeeded" },
          },
        });
      }
      if (url === "https://api.x.com/2/tweets") {
        expect(JSON.parse(String(init?.body))).toEqual({
          text: "A useful short video.",
          media: { media_ids: ["video-media-1"] },
        });
        return Response.json({ data: { id: "video-post-1" } }, { status: 201 });
      }
      throw new Error(`Unexpected X request: ${url}`);
    });

    const result = await adapterFor("x").publish({
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "A useful short video.",
      assets: [{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: videoBytes.byteLength,
      }],
      fetcher: fetcher as typeof fetch,
      markProviderWriteStarted,
    });

    expect(result).toMatchObject({ ok: true, platformPostId: "video-post-1" });
    expect(commands).toEqual(["INIT", "APPEND", "FINALIZE"]);
    expect(markProviderWriteStarted).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it.each([
    {
      label: "more than four images",
      assets: Array.from({ length: 5 }, (_, index) => ({
        url: `https://cdn.example/${index}.png`,
        kind: "image" as const,
        mimeType: "image/png",
      })),
      message: "up to 4 raster images",
    },
    {
      label: "non-MP4 video",
      assets: [{
        url: "https://cdn.example/video.mov",
        kind: "video" as const,
        mimeType: "video/quicktime",
        byteLength: 100,
      }],
      message: "supports MP4",
    },
    {
      label: "mixed video and image",
      assets: [
        {
          url: "https://cdn.example/video.mp4",
          kind: "video" as const,
          mimeType: "video/mp4",
          byteLength: 100,
        },
        {
          url: "https://cdn.example/image.png",
          kind: "image" as const,
          mimeType: "image/png",
        },
      ],
      message: "exactly one video and no images",
    },
    {
      label: "SVG",
      assets: [{
        url: "https://cdn.example/image.svg",
        kind: "image" as const,
        mimeType: "image/svg+xml",
      }],
      message: "PNG, JPEG, and WebP",
    },
    {
      label: "overlong alt text",
      assets: [{
        url: "https://cdn.example/image.png",
        kind: "image" as const,
        mimeType: "image/png",
        altText: "a".repeat(1_001),
      }],
      message: "alt text is too long",
    },
  ])("rejects $label before delivery", ({ assets, message }) => {
    const result = adapterFor("x").validateDraft({ bodyText: "Valid text", assets });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) expect(result.error).toContain(message);
  });

  it.each([
    [401, "reconnect_required"],
    [422, "rejected"],
    [429, "retryable"],
    [503, "retryable"],
  ] as const)("classifies a confirmed post status %i as %s", async (status, failureClass) => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({ errors: [{ detail: `X error ${status}` }] }, { status }),
    );

    const result = await adapterFor("x").publish({
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "A confirmed failure.",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      failureClass,
      errorCode: "x_api_error",
      errorMessage: `X error ${status}`,
    });
  });

  it("classifies a confirmed media upload rate limit as retryable", async () => {
    const markProviderCostStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://cdn.example/image.png") {
        return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
      }
      return Response.json({ errors: [{ detail: "Media limit reached" }] }, { status: 429 });
    });

    const result = await adapterFor("x").publish({
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "Upload later.",
      assets: [{
        url: "https://cdn.example/image.png",
        kind: "image",
        mimeType: "image/png",
      }],
      fetcher: fetcher as typeof fetch,
      markProviderCostStarted,
    });

    expect(result).toMatchObject({
      ok: false,
      failureClass: "retryable",
      errorCode: "x_media_upload",
      errorMessage: "Media limit reached",
    });
    expect(markProviderCostStarted).not.toHaveBeenCalled();
  });

  it("rejects oversized and invalid raster bytes before contacting X", async () => {
    const tooLargeFetcher = vi.fn().mockResolvedValue(
      new Response(PNG_BYTES, {
        headers: {
          "content-length": String(5 * 1024 * 1024 + 1),
          "content-type": "image/png",
        },
      }),
    );
    const invalidTypeFetcher = vi.fn().mockResolvedValue(
      new Response("<svg xmlns=\"http://www.w3.org/2000/svg\" />", {
        headers: { "content-type": "image/png" },
      }),
    );
    const input = {
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "Validate the image.",
      assets: [{
        url: "https://cdn.example/image.png",
        kind: "image" as const,
        mimeType: "image/png",
      }],
    };

    await expect(adapterFor("x").publish({
      ...input,
      fetcher: tooLargeFetcher as typeof fetch,
    })).resolves.toMatchObject({
      ok: false,
      failureClass: "unsupported",
      errorCode: "x_image_too_large",
    });
    await expect(adapterFor("x").publish({
      ...input,
      fetcher: invalidTypeFetcher as typeof fetch,
    })).resolves.toMatchObject({
      ok: false,
      failureClass: "unsupported",
      errorCode: "x_image_type",
    });
    expect(tooLargeFetcher).toHaveBeenCalledTimes(1);
    expect(invalidTypeFetcher).toHaveBeenCalledTimes(1);
  });

  it("freezes recovery when the final post request has an ambiguous outcome", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("connection reset after write"));

    const result = await adapterFor("x").publish({
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "Maybe published.",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      failureClass: "outcome_unknown",
      errorCode: "x_outcome_unknown",
    });
  });

  it("treats a successful post response without an id as outcome unknown", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {} }, { status: 201 }));

    const result = await adapterFor("x").publish({
      accessToken: "x-token",
      accountId: "x-owner",
      bodyText: "Maybe published without an id.",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      failureClass: "outcome_unknown",
      errorCode: "x_missing_id",
    });
  });
});

describe("YouTube upload adapter", () => {
  it("uploads a video with the reviewed settings and returns YouTube Studio", async () => {
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const uploadUrl = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=one";
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable")) {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("X-Upload-Content-Length")).toBe("4");
        expect(JSON.parse(String(init?.body))).toEqual({
          snippet: {
            title: "My useful Short",
            description: "A concise YouTube description.",
            categoryId: "22",
          },
          status: {
            privacyStatus: "unlisted",
            selfDeclaredMadeForKids: true,
            containsSyntheticMedia: true,
          },
        });
        return new Response(null, {
          status: 200,
          headers: { Location: uploadUrl },
        });
      }
      if (url === "https://media.example/short.mp4") {
        expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
        return new Response(videoBytes, { status: 206 });
      }
      if (url === uploadUrl) {
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("Content-Range")).toBe("bytes 0-3/4");
        expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(videoBytes);
        return Response.json({ id: "youtube-video-1" }, { status: 201 });
      }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?part=status")) {
        return Response.json({
          items: [{
            id: "youtube-video-1",
            status: { uploadStatus: "uploaded", privacyStatus: "unlisted" },
            processingDetails: { processingStatus: "processing" },
          }],
        });
      }
      throw new Error(`Unexpected YouTube request: ${url}`);
    });

    const result = await adapterFor("youtube").publish({
      accessToken: "youtube-token",
      accountId: "channel-1",
      title: "My useful Short",
      bodyText: "A concise YouTube description.",
      assets: [{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: videoBytes.byteLength,
      }],
      fetcher: fetcher as typeof fetch,
      providerOptions: {
        privacyStatus: "unlisted",
        madeForKids: true,
        containsSyntheticMedia: true,
      },
      markProviderWriteStarted,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "youtube-video-1",
      platformPostUrl: "https://studio.youtube.com/video/youtube-video-1/edit",
      providerResponse: {
        privacyStatus: "unlisted",
        madeForKids: true,
        containsSyntheticMedia: true,
        processing: {
          items: [{
            processingDetails: { processingStatus: "processing" },
          }],
        },
      },
    });
    expect(markProviderWriteStarted).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("queries an interrupted upload and resumes from YouTube's confirmed byte offset", async () => {
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const sourceRanges: string[] = [];
    const uploadRanges: string[] = [];
    const uploadUrl = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=resume";
    let uploadAttempt = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("uploadType=resumable")) {
        return new Response(null, { status: 200, headers: { Location: uploadUrl } });
      }
      if (url === "https://media.example/resume.mp4") {
        const range = new Headers(init?.headers).get("Range")!;
        sourceRanges.push(range);
        return new Response(
          range === "bytes=0-3" ? videoBytes : videoBytes.slice(2),
          { status: 206 },
        );
      }
      if (url === uploadUrl) {
        const range = new Headers(init?.headers).get("Content-Range")!;
        uploadRanges.push(range);
        if (range === "bytes */4") {
          return new Response(null, {
            status: 308,
            headers: { Range: "bytes=0-1" },
          });
        }
        uploadAttempt += 1;
        if (uploadAttempt === 1) throw new Error("connection reset");
        return Response.json({ id: "youtube-video-resumed" }, { status: 201 });
      }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?part=status")) {
        return Response.json({ items: [] });
      }
      throw new Error(`Unexpected YouTube request: ${url}`);
    });

    await expect(adapterFor("youtube").publish({
      accessToken: "youtube-token",
      accountId: "channel-1",
      title: "Resume safely",
      bodyText: "No duplicate private video.",
      assets: [{
        url: "https://media.example/resume.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: videoBytes.byteLength,
      }],
      fetcher: fetcher as typeof fetch,
      providerOptions: {
        privacyStatus: "private",
        madeForKids: false,
        containsSyntheticMedia: false,
      },
    })).resolves.toMatchObject({
      ok: true,
      platformPostId: "youtube-video-resumed",
    });

    expect(sourceRanges).toEqual(["bytes=0-3", "bytes=2-3"]);
    expect(uploadRanges).toEqual(["bytes 0-3/4", "bytes */4", "bytes 2-3/4"]);
  });

  it("requires reviewed publishing settings before contacting YouTube", async () => {
    const fetcher = vi.fn();
    await expect(adapterFor("youtube").publish({
      accessToken: "youtube-token",
      accountId: "channel-1",
      title: "Valid title",
      bodyText: "Description",
      assets: [{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }],
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "youtube_privacy_required",
    });
    await expect(adapterFor("youtube").publish({
      accessToken: "youtube-token",
      accountId: "channel-1",
      title: "Valid title",
      bodyText: "Description",
      assets: [{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }],
      fetcher: fetcher as typeof fetch,
      providerOptions: {
        privacyStatus: "public",
        containsSyntheticMedia: false,
      },
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "youtube_audience_required",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires complete video metadata before contacting YouTube", () => {
    expect(adapterFor("youtube").validateDraft({
      title: "",
      bodyText: "Description",
      assets: [{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }],
    })).toEqual({ ok: false, error: "YouTube needs a video title." });
    expect(adapterFor("youtube").validateDraft({
      title: "Valid title",
      bodyText: "Description",
      assets: [{
        url: "https://media.example/short.mov",
        kind: "video",
        mimeType: "image/png",
        byteLength: 4,
      }],
    })).toEqual({ ok: false, error: "YouTube requires a video file." });
  });
});

describe("Instagram publishing adapter", () => {
  it("creates ordered child containers and publishes an image carousel", async () => {
    const mediaBodies: URLSearchParams[] = [];
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/ig-owner/media")) {
        const body = init?.body as URLSearchParams;
        mediaBodies.push(body);
        return Response.json({ id: `container-${mediaBodies.length}` });
      }
      if (url.includes("?fields=status_code")) {
        return Response.json({ status_code: "FINISHED" });
      }
      if (url.endsWith("/ig-owner/media_publish")) {
        expect(String(init?.body)).toContain("creation_id=container-3");
        return Response.json({ id: "instagram-post-1" });
      }
      if (url.includes("/instagram-post-1?fields=permalink")) {
        return Response.json({ permalink: "https://www.instagram.com/p/abc123/" });
      }
      throw new Error(`Unexpected Instagram request: ${url}`);
    });

    const result = await adapterFor("instagram").publish({
      accessToken: "ig-token",
      accountId: "ig-owner",
      bodyText: "An ordered carousel.",
      assets: [
        { url: "https://media.example/one.jpg", kind: "image", assetIndex: 0 },
        { url: "https://media.example/two.jpg", kind: "image", assetIndex: 1 },
      ],
      fetcher: fetcher as typeof fetch,
      markProviderWriteStarted,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "instagram-post-1",
      platformPostUrl: "https://www.instagram.com/p/abc123/",
    });
    expect(mediaBodies.map((body) => Object.fromEntries(body))).toEqual([
      {
        image_url: "https://media.example/one.jpg",
        is_carousel_item: "true",
        access_token: "ig-token",
      },
      {
        image_url: "https://media.example/two.jpg",
        is_carousel_item: "true",
        access_token: "ig-token",
      },
      {
        media_type: "CAROUSEL",
        children: "container-1,container-2",
        caption: "An ordered carousel.",
        access_token: "ig-token",
      },
    ]);
    expect(markProviderWriteStarted).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("https://graph.instagram.com/v25.0/ig-owner/media"),
      expect.any(Object),
    );
    expect(fetcher.mock.calls.map(([request]) => String(request))).toEqual([
      "https://graph.instagram.com/v25.0/ig-owner/media",
      expect.stringContaining("/container-1?fields=status_code"),
      "https://graph.instagram.com/v25.0/ig-owner/media",
      expect.stringContaining("/container-2?fields=status_code"),
      "https://graph.instagram.com/v25.0/ig-owner/media",
      expect.stringContaining("/container-3?fields=status_code"),
      "https://graph.instagram.com/v25.0/ig-owner/media_publish",
      expect.stringContaining("/instagram-post-1?fields=permalink"),
    ]);
  });

  it("waits for a single image container before publishing it", async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/ig-owner/media")) {
        return Response.json({ id: "single-image-container" });
      }
      if (url.includes("/single-image-container?fields=status_code")) {
        return Response.json({ status_code: "FINISHED" });
      }
      if (url.endsWith("/ig-owner/media_publish")) {
        return Response.json({ id: "instagram-image-1" });
      }
      throw new Error(`Unexpected Instagram request: ${url}`);
    });

    await expect(adapterFor("instagram").publish({
      accessToken: "ig-token",
      accountId: "ig-owner",
      bodyText: "A single image.",
      assets: [{ url: "https://media.example/image.jpg", kind: "image" }],
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ ok: true, platformPostId: "instagram-image-1" });

    expect(requests).toEqual([
      "https://graph.instagram.com/v25.0/ig-owner/media",
      expect.stringContaining("/single-image-container?fields=status_code"),
      "https://graph.instagram.com/v25.0/ig-owner/media_publish",
      // The link lookup fails here, which keeps the publish successful without a View link.
      expect.stringContaining("/instagram-image-1?fields=permalink"),
    ]);
  });

  it("waits for Reel processing before publishing", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/ig-owner/media")) {
        expect(Object.fromEntries(init?.body as URLSearchParams)).toMatchObject({
          media_type: "REELS",
          video_url: "https://media.example/reel.mp4",
          share_to_feed: "true",
        });
        return Response.json({ id: "reel-container" });
      }
      if (url.includes("/reel-container?fields=status_code")) {
        return Response.json({ status_code: "FINISHED" });
      }
      if (url.endsWith("/ig-owner/media_publish")) {
        return Response.json({ id: "instagram-reel-1" });
      }
      throw new Error(`Unexpected Instagram request: ${url}`);
    });

    await expect(adapterFor("instagram").publish({
      accessToken: "ig-token",
      accountId: "ig-owner",
      bodyText: "A short Reel.",
      assets: [{ url: "https://media.example/reel.mp4", kind: "video", mimeType: "video/mp4" }],
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ ok: true, platformPostId: "instagram-reel-1" });
  });

  it("rejects mixed Reel media and oversized carousels before delivery", () => {
    expect(adapterFor("instagram").validateDraft({
      bodyText: "Mixed media.",
      assets: [
        { url: "https://media.example/reel.mp4", kind: "video" },
        { url: "https://media.example/image.jpg", kind: "image" },
      ],
    })).toEqual({ ok: false, error: "An Instagram Reel must contain one video and no images." });

    expect(adapterFor("instagram").validateDraft({
      bodyText: "Too many images.",
      assets: Array.from({ length: 11 }, (_, index) => ({
        url: `https://media.example/${index}.jpg`,
        kind: "image" as const,
      })),
    })).toEqual({ ok: false, error: "Instagram carousels support up to 10 images." });
  });
});

describe("TikTok draft upload adapter", () => {
  it("initializes FILE_UPLOAD and streams a short video into the creator inbox", async () => {
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/post/publish/inbox/video/init/")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tiktok-token");
        expect(JSON.parse(String(init?.body))).toEqual({
          source_info: {
            source: "FILE_UPLOAD",
            video_size: 4,
            chunk_size: 4,
            total_chunk_count: 1,
          },
        });
        return Response.json({
          data: {
            publish_id: "v_inbox_file~demo-1",
            upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=demo-1",
          },
          error: { code: "ok", message: "", log_id: "log-1" },
        });
      }
      if (url === "https://media.example/short.mp4") {
        expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
        return new Response(videoBytes, { status: 206 });
      }
      if (url.startsWith("https://open-upload.tiktokapis.com/video/")) {
        const headers = new Headers(init?.headers);
        expect(init?.method).toBe("PUT");
        expect(headers.get("Content-Type")).toBe("video/mp4");
        expect(headers.get("Content-Length")).toBe("4");
        expect(headers.get("Content-Range")).toBe("bytes 0-3/4");
        expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(videoBytes);
        return new Response(null, { status: 201 });
      }
      if (url.endsWith("/v2/post/publish/status/fetch/")) {
        expect(JSON.parse(String(init?.body))).toEqual({ publish_id: "v_inbox_file~demo-1" });
        return Response.json({
          data: { status: "SEND_TO_USER_INBOX", uploaded_bytes: 4 },
          error: { code: "ok", message: "", log_id: "log-2" },
        });
      }
      throw new Error(`Unexpected TikTok request: ${url}`);
    });

    const result = await adapterFor("tiktok").publish({
      accessToken: "tiktok-token",
      accountId: "creator-open-id",
      bodyText: "Editable in TikTok.",
      assets: [{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: videoBytes.byteLength,
      }],
      fetcher: fetcher as typeof fetch,
      markProviderWriteStarted,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "v_inbox_file~demo-1",
      providerResponse: {
        delivery: "creator_draft",
        creatorActionRequired: true,
      },
    });
    expect(markProviderWriteStarted).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("queries creator settings and sends the exact caption through Direct Post", async () => {
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/post/publish/creator_info/query/")) {
        expect(init?.method).toBe("POST");
        return Response.json({
          data: {
            creator_avatar_url: "https://media.example/avatar.jpg",
            creator_username: "owner",
            creator_nickname: "Owner TikTok",
            privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            comment_disabled: false,
            duet_disabled: true,
            stitch_disabled: false,
            max_video_post_duration_sec: 60,
          },
          error: { code: "ok" },
        });
      }
      if (url.endsWith("/v2/post/publish/video/init/")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          post_info: {
            title: "The exact caption #ME3",
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_comment: false,
            disable_duet: true,
            disable_stitch: true,
            brand_content_toggle: false,
            brand_organic_toggle: true,
            is_aigc: false,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: 4,
            chunk_size: 4,
            total_chunk_count: 1,
          },
        });
        return Response.json({
          data: {
            publish_id: "v_pub_file~direct-1",
            upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=direct-1",
          },
          error: { code: "ok" },
        });
      }
      if (url === "https://media.example/direct.mp4") {
        return new Response(videoBytes, { status: 206 });
      }
      if (url.startsWith("https://open-upload.tiktokapis.com/video/")) {
        return new Response(null, { status: 201 });
      }
      if (url.endsWith("/v2/post/publish/status/fetch/")) {
        return Response.json({
          data: { status: "PUBLISH_COMPLETE", uploaded_bytes: 4 },
          error: { code: "ok" },
        });
      }
      throw new Error(`Unexpected TikTok request: ${url}`);
    });

    const result = await adapterFor("tiktok").publish({
      accessToken: "tiktok-token",
      accountId: "creator-open-id",
      bodyText: "The exact caption #ME3",
      assets: [{
        url: "https://media.example/direct.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: videoBytes.byteLength,
      }],
      providerOptions: {
        deliveryMode: "direct_publish",
        privacyLevel: "PUBLIC_TO_EVERYONE",
        allowComment: true,
        allowDuet: true,
        allowStitch: false,
        brandContent: false,
        brandOrganic: true,
        isAiGenerated: false,
        consent: true,
        videoDurationSeconds: 12,
      },
      fetcher: fetcher as typeof fetch,
      markProviderWriteStarted,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "v_pub_file~direct-1",
      providerResponse: {
        delivery: "direct_publish",
        creatorActionRequired: false,
      },
    });
    expect(markProviderWriteStarted).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("requires a reconnect when Direct Post scope is missing", async () => {
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async () => Response.json({
      data: {},
      error: {
        code: "scope_not_authorized",
        message: "The access token does not have video.publish.",
      },
    }, { status: 401 }));

    await expect(adapterFor("tiktok").publish({
      accessToken: "draft-only-token",
      accountId: "creator-open-id",
      bodyText: "Direct caption",
      assets: [{
        url: "https://media.example/direct.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }],
      providerOptions: {
        deliveryMode: "direct_publish",
        privacyLevel: "SELF_ONLY",
        consent: true,
        videoDurationSeconds: 12,
      },
      fetcher: fetcher as typeof fetch,
      markProviderWriteStarted,
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "scope_not_authorized",
      errorMessage: "Reconnect TikTok to grant Direct Post access.",
      failureClass: "reconnect_required",
    });
    expect(markProviderWriteStarted).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the TikTok account connected when an unaudited app must use Only me", async () => {
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v2/post/publish/creator_info/query/")) {
        return Response.json({
          data: {
            creator_username: "owner",
            creator_nickname: "Owner TikTok",
            privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            comment_disabled: false,
            duet_disabled: false,
            stitch_disabled: false,
            max_video_post_duration_sec: 60,
          },
          error: { code: "ok" },
        });
      }
      if (url.endsWith("/v2/post/publish/video/init/")) {
        return Response.json({
          data: {},
          error: {
            code: "unaudited_client_can_only_post_to_private_accounts",
            message: "Please review our integration guidelines.",
          },
        }, { status: 403 });
      }
      throw new Error(`Unexpected TikTok request: ${url}`);
    });

    await expect(adapterFor("tiktok").publish({
      accessToken: "unaudited-token",
      accountId: "creator-open-id",
      bodyText: "Direct caption",
      assets: [{
        url: "https://media.example/direct.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }],
      providerOptions: {
        deliveryMode: "direct_publish",
        privacyLevel: "PUBLIC_TO_EVERYONE",
        consent: true,
        videoDurationSeconds: 12,
      },
      fetcher: fetcher as typeof fetch,
      markProviderWriteStarted,
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "unaudited_client_can_only_post_to_private_accounts",
      errorMessage:
        "Until app review is approved, set this TikTok account to private and choose Only me visibility.",
      failureClass: "rejected",
    });
    expect(markProviderWriteStarted).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("resumes a pending upload by polling its existing publish id", async () => {
    const markProviderWriteStarted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://open.tiktokapis.com/v2/post/publish/status/fetch/");
      expect(JSON.parse(String(init?.body))).toEqual({ publish_id: "pending-draft" });
      return Response.json({
        data: { status: "SEND_TO_USER_INBOX", uploaded_bytes: 4 },
        error: { code: "ok" },
      });
    });

    const result = await adapterFor("tiktok").publish({
      accessToken: "tiktok-token",
      accountId: "creator-open-id",
      bodyText: "Editable in TikTok.",
      assets: [{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }],
      fetcher: fetcher as typeof fetch,
      resumeProviderResponse: { publishId: "pending-draft" },
      markProviderWriteStarted,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "pending-draft",
      providerResponse: {
        delivery: "creator_draft",
        creatorActionRequired: true,
      },
    });
    expect(markProviderWriteStarted).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("queues another status check while TikTok is still processing", async () => {
    vi.useFakeTimers();
    try {
      const videoBytes = new Uint8Array([1, 2, 3, 4]);
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v2/post/publish/inbox/video/init/")) {
          return Response.json({
            data: {
              publish_id: "processing-draft",
              upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=processing",
            },
            error: { code: "ok" },
          });
        }
        if (url === "https://media.example/short.mp4") {
          return new Response(videoBytes, { status: 206 });
        }
        if (url.startsWith("https://open-upload.tiktokapis.com/video/")) {
          return new Response(null, { status: 201 });
        }
        if (url.endsWith("/v2/post/publish/status/fetch/")) {
          return Response.json({
            data: { status: "PROCESSING_UPLOAD", uploaded_bytes: 4 },
            error: { code: "ok" },
          });
        }
        throw new Error(`Unexpected TikTok request: ${url}`);
      });

      const resultPromise = adapterFor("tiktok").publish({
        accessToken: "tiktok-token",
        accountId: "creator-open-id",
        bodyText: "Editable in TikTok.",
        assets: [{
          url: "https://media.example/short.mp4",
          kind: "video",
          mimeType: "video/mp4",
          byteLength: videoBytes.byteLength,
        }],
        fetcher: fetcher as typeof fetch,
      });
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        errorCode: "tiktok_processing_pending",
        failureClass: "retryable",
        providerResponse: {
          publishId: "processing-draft",
          status: { data: { status: "PROCESSING_UPLOAD" } },
        },
      });
      expect(fetcher).toHaveBeenCalledTimes(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses sequential chunks and merges trailing bytes into the final chunk", async () => {
    const byteLength = 70 * 1024 * 1024;
    const uploadStatuses = [206, 201];
    const sourceRanges: string[] = [];
    const uploadRanges: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/post/publish/inbox/video/init/")) {
        expect(JSON.parse(String(init?.body)).source_info).toEqual({
          source: "FILE_UPLOAD",
          video_size: byteLength,
          chunk_size: 32 * 1024 * 1024,
          total_chunk_count: 2,
        });
        return Response.json({
          data: { publish_id: "chunked", upload_url: "https://upload.example/chunked" },
          error: { code: "ok" },
        });
      }
      if (url === "https://media.example/large.mp4") {
        sourceRanges.push(new Headers(init?.headers).get("Range")!);
        return new Response(new Uint8Array([1]), { status: 206 });
      }
      if (url === "https://upload.example/chunked") {
        uploadRanges.push(new Headers(init?.headers).get("Content-Range")!);
        return new Response(null, { status: uploadStatuses.shift()! });
      }
      if (url.endsWith("/v2/post/publish/status/fetch/")) {
        return Response.json({
          data: { status: "SEND_TO_USER_INBOX", uploaded_bytes: byteLength },
          error: { code: "ok" },
        });
      }
      throw new Error(`Unexpected TikTok request: ${url}`);
    });

    await expect(adapterFor("tiktok").publish({
      accessToken: "token",
      accountId: "creator",
      bodyText: "",
      assets: [{
        url: "https://media.example/large.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength,
      }],
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ ok: true, platformPostId: "chunked" });

    expect(sourceRanges).toEqual([
      "bytes=0-33554431",
      `bytes=33554432-${byteLength - 1}`,
    ]);
    expect(uploadRanges).toEqual([
      `bytes 0-33554431/${byteLength}`,
      `bytes 33554432-${byteLength - 1}/${byteLength}`,
    ]);
  });

  it("rejects missing, mixed, or unsupported video manifests", () => {
    expect(adapterFor("tiktok").validateDraft({ bodyText: "", assets: [] })).toEqual({
      ok: false,
      error: "TikTok draft upload requires exactly one video.",
    });
    expect(adapterFor("tiktok").validateDraft({
      bodyText: "",
      assets: [{ url: "https://media.example/video.avi", kind: "video", mimeType: "video/avi", byteLength: 12 }],
    })).toEqual({
      ok: false,
      error: "TikTok supports MP4, QuickTime, and WebM video uploads.",
    });
  });
});

describe("Facebook Page publishing adapter", () => {
  function graphFetcher(responses: Array<{ status?: number; body: unknown }>) {
    const calls: Array<{ url: string; body: Record<string, string> }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: Object.fromEntries(new URLSearchParams(String(init?.body))) });
      const next = responses.shift() || { body: {} };
      return new Response(JSON.stringify(next.body), { status: next.status || 200 });
    });
    return { fetcher, calls };
  }

  it("posts text with its first link to the Page feed", async () => {
    const { fetcher, calls } = graphFetcher([{ body: { id: "page_1" } }]);
    const result = await adapterFor("facebook").publish({
      accessToken: "page-token",
      accountId: "page",
      bodyText: "Booking page is live: https://maya.me3.app/book.",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      platformPostId: "page_1",
      platformPostUrl: "https://www.facebook.com/page_1",
    });
    expect(calls).toEqual([{
      url: "https://graph.facebook.com/v25.0/page/feed",
      body: {
        message: "Booking page is live: https://maya.me3.app/book.",
        link: "https://maya.me3.app/book",
        access_token: "page-token",
      },
    }]);
  });

  it("publishes several images in order as one post", async () => {
    const { fetcher, calls } = graphFetcher([
      { body: { id: "photo-1" } },
      { body: { id: "photo-2" } },
      { body: { id: "page_2" } },
    ]);
    const result = await adapterFor("facebook").publish({
      accessToken: "page-token",
      accountId: "page",
      bodyText: "Open day",
      assets: [
        { url: "https://media.example/one.jpg", kind: "image", altText: "The studio" },
        { url: "https://media.example/two.jpg", kind: "image" },
      ],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({ ok: true, platformPostId: "page_2" });
    expect(calls.map((call) => call.body)).toEqual([
      { url: "https://media.example/one.jpg", published: "false", alt_text_custom: "The studio", access_token: "page-token" },
      { url: "https://media.example/two.jpg", published: "false", access_token: "page-token" },
      {
        message: "Open day",
        "attached_media[0]": JSON.stringify({ media_fbid: "photo-1" }),
        "attached_media[1]": JSON.stringify({ media_fbid: "photo-2" }),
        access_token: "page-token",
      },
    ]);
  });

  it("asks to reconnect when the Page token was revoked", async () => {
    const { fetcher } = graphFetcher([
      { status: 400, body: { error: { message: "Session has expired", code: 190 } } },
    ]);
    const result = await adapterFor("facebook").publish({
      accessToken: "page-token",
      accountId: "page",
      bodyText: "Hello",
      assets: [],
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, failureClass: "reconnect_required" });
  });

  it("rejects video", () => {
    expect(adapterFor("facebook").validateDraft({
      bodyText: "Clip",
      assets: [{ url: "https://media.example/a.mp4", kind: "video" }],
    })).toEqual({ ok: false, error: "Facebook posts from ME3 support images, not video." });
  });
});
