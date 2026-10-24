import type { SocialMediaAsset, SocialPlatform } from "./index";
import { sniffCarouselRasterMimeType } from "./carousel-renderer";
import type { CarouselRasterMimeType } from "./carousel-render-model";

export type SocialPublishAdapterResult = {
  ok: boolean;
  platformPostId?: string;
  platformPostUrl?: string;
  providerResponse?: unknown;
  errorCode?: string;
  errorMessage?: string;
  failureClass?: SocialPublishFailureClass;
};

export type SocialPublishFailureClass =
  | "retryable"
  | "reconnect_required"
  | "rejected"
  | "unsupported"
  | "outcome_unknown";

export type SocialPublishAdapter = {
  validateDraft(input: {
    title?: string;
    bodyText: string;
    assets: SocialMediaAsset[];
  }): { ok: true } | { ok: false; error: string };
  publish(input: {
    accessToken: string;
    accountId: string;
    title?: string;
    bodyText: string;
    assets: SocialMediaAsset[];
    fetcher: typeof fetch;
    providerOptions?: unknown;
    resumeProviderResponse?: unknown;
    markProviderCostStarted?: () => Promise<void>;
    markProviderWriteStarted?: () => Promise<void>;
  }): Promise<SocialPublishAdapterResult>;
};

const X_CHAR_LIMIT = 280;
const X_IMAGE_COUNT_LIMIT = 4;
const X_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const X_ALT_TEXT_LIMIT = 1_000;
const X_VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const X_VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;
const X_VIDEO_PROCESSING_ATTEMPTS = 10;
const X_VIDEO_MIME_TYPES = new Set(["video/mp4"]);
const X_IMAGE_MIME_TYPES = new Set<CarouselRasterMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const LINKEDIN_MAX_CHARS = 3000;
const LINKEDIN_IMAGE_COUNT_LIMIT = 20;
const LINKEDIN_ALT_TEXT_LIMIT = 4_086;
const LINKEDIN_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
]);
const LINKEDIN_VERSION = "202606";
const INSTAGRAM_MAX_CHARS = 2200;
const INSTAGRAM_CAROUSEL_MAX_ITEMS = 10;
const INSTAGRAM_VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
const INSTAGRAM_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
]);
const INSTAGRAM_GRAPH_VERSION = "v25.0";
const FACEBOOK_MAX_CHARS = 63_206;
const FACEBOOK_IMAGE_COUNT_LIMIT = 10;
const FACEBOOK_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TIKTOK_UPLOAD_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";
const TIKTOK_DIRECT_POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TIKTOK_CREATOR_INFO_URL =
  "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const TIKTOK_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";
const TIKTOK_SINGLE_CHUNK_MAX_BYTES = 64 * 1024 * 1024;
const TIKTOK_MULTI_CHUNK_BYTES = 32 * 1024 * 1024;
const TIKTOK_MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const TIKTOK_STATUS_ATTEMPTS = 6;
const TIKTOK_STATUS_POLL_MS = 2_000;
const TIKTOK_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const TIKTOK_CAPTION_MAX_CHARS = 2_200;
const YOUTUBE_TITLE_MAX_CHARS = 100;
const YOUTUBE_DESCRIPTION_MAX_CHARS = 5_000;
const YOUTUBE_VIDEO_MAX_BYTES = 256 * 1024 * 1024 * 1024;
const YOUTUBE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export function adapterFor(platform: SocialPlatform): SocialPublishAdapter {
  if (platform === "x") return xAdapter;
  if (platform === "linkedin") return linkedInAdapter;
  if (platform === "tiktok") return tikTokAdapter;
  if (platform === "youtube") return youtubeAdapter;
  if (platform === "facebook") return facebookAdapter;
  return createInstagramAdapter(platform);
}

function providerError(
  errorCode: string,
  errorMessage: string,
  providerResponse?: unknown,
  failureClass: SocialPublishFailureClass = "rejected",
): SocialPublishAdapterResult {
  return { ok: false, errorCode, errorMessage, providerResponse, failureClass };
}

function failureClassForStatus(status: number): SocialPublishFailureClass {
  if (status === 401 || status === 403) return "reconnect_required";
  if (status === 409 || status === 429 || status >= 500) return "retryable";
  if (status === 400 || status === 422) return "rejected";
  return "unsupported";
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}

type XErrorBody = {
  data?: {
    id?: string;
    processing_info?: {
      state?: string;
      check_after_secs?: number;
      progress_percent?: number;
      error?: { code?: number; name?: string; message?: string };
    };
  };
  errors?: Array<{ title?: string; detail?: string }>;
  title?: string;
  detail?: string;
};

function xErrorMessage(body: XErrorBody, fallback: string): string {
  return body.data?.processing_info?.error?.message ||
    body.errors?.[0]?.detail ||
    body.errors?.[0]?.title ||
    body.detail ||
    body.title ||
    fallback;
}

function normalizeMimeType(value: string | null | undefined): string | null {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType || null;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function describeFetchError(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}

function xHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

function xAuthorizationHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function validateXDraft(input: {
  bodyText: string;
  assets: SocialMediaAsset[];
}): { ok: true } | { ok: false; error: string } {
  const body = input.bodyText.trim();
  if (!body) return { ok: false, error: "This X draft is empty." };
  if (characterLength(body) > X_CHAR_LIMIT) {
    return { ok: false, error: `This X draft is too long (max ${X_CHAR_LIMIT} characters).` };
  }
  const videos = input.assets.filter((asset) => asset.kind === "video");
  if (videos.length > 0) {
    if (input.assets.length !== 1 || videos.length !== 1) {
      return { ok: false, error: "An X video post must contain exactly one video and no images." };
    }
    const video = videos[0]!;
    if (!video.url?.trim()) {
      return { ok: false, error: "The X video needs a delivery URL." };
    }
    const mimeType = normalizeMimeType(video.mimeType);
    if (!mimeType || !X_VIDEO_MIME_TYPES.has(mimeType)) {
      return { ok: false, error: "X video publishing currently supports MP4 files." };
    }
    if (!Number.isSafeInteger(video.byteLength) || (video.byteLength ?? 0) <= 0) {
      return { ok: false, error: "X needs the video file size before it can upload." };
    }
    if (video.byteLength! > X_VIDEO_MAX_BYTES) {
      return { ok: false, error: "The X video is larger than 512 MB." };
    }
    return { ok: true };
  }
  if (input.assets.length > X_IMAGE_COUNT_LIMIT) {
    return {
      ok: false,
      error: `X publishing currently supports up to ${X_IMAGE_COUNT_LIMIT} raster images per post.`,
    };
  }
  for (const [index, asset] of input.assets.entries()) {
    if (!asset.url?.trim()) {
      return { ok: false, error: `X image ${index + 1} needs a URL.` };
    }
    const mimeType = normalizeMimeType(asset.mimeType);
    if (mimeType && !X_IMAGE_MIME_TYPES.has(mimeType as CarouselRasterMimeType)) {
      return {
        ok: false,
        error: "X publishing currently supports PNG, JPEG, and WebP raster images only.",
      };
    }
    const altText = asset.altText?.trim();
    if (altText && characterLength(altText) > X_ALT_TEXT_LIMIT) {
      return {
        ok: false,
        error: `X image ${index + 1} alt text is too long (max ${X_ALT_TEXT_LIMIT} characters).`,
      };
    }
  }
  return { ok: true };
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel("Provider media exceeds the upload limit").catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function fetchFailureClass(status: number): SocialPublishFailureClass {
  return status === 409 || status === 429 || status >= 500 ? "retryable" : "rejected";
}

function linkedInHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Linkedin-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

const linkedInAdapter: SocialPublishAdapter = {
  validateDraft(input) {
    const body = input.bodyText.trim();
    if (!body) return { ok: false, error: "This LinkedIn draft is empty." };
    if (characterLength(body) > LINKEDIN_MAX_CHARS) {
      return {
        ok: false,
        error: `This LinkedIn draft is too long (max ${LINKEDIN_MAX_CHARS} characters).`,
      };
    }
    if (input.assets.some((asset) => asset.kind === "video")) {
      return { ok: false, error: "LinkedIn publishing currently supports text and image posts." };
    }
    if (input.assets.length > LINKEDIN_IMAGE_COUNT_LIMIT) {
      return {
        ok: false,
        error: `LinkedIn multi-image posts support up to ${LINKEDIN_IMAGE_COUNT_LIMIT} images.`,
      };
    }
    for (const [index, asset] of input.assets.entries()) {
      if (!asset.url?.trim()) {
        return { ok: false, error: `LinkedIn image ${index + 1} needs a URL.` };
      }
      const mimeType = normalizeMimeType(asset.mimeType);
      if (mimeType && !LINKEDIN_IMAGE_MIME_TYPES.has(mimeType)) {
        return {
          ok: false,
          error: "LinkedIn image posts support JPEG, PNG, and GIF files.",
        };
      }
      const altText = asset.altText?.trim();
      if (altText && characterLength(altText) > LINKEDIN_ALT_TEXT_LIMIT) {
        return {
          ok: false,
          error: `LinkedIn image ${index + 1} alt text is too long (max ${LINKEDIN_ALT_TEXT_LIMIT} characters).`,
        };
      }
    }
    return { ok: true };
  },

  async publish(input) {
    const validation = linkedInAdapter.validateDraft(input);
    if (!validation.ok) {
      return providerError(
        "linkedin_validation_failed",
        validation.error,
        undefined,
        validation.error.includes("support") ? "unsupported" : "rejected",
      );
    }

    let userinfoResponse: Response;
    try {
      userinfoResponse = await input.fetcher("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });
    } catch (error) {
      return providerError(
        "linkedin_userinfo_unavailable",
        "LinkedIn account verification did not finish. ME3 can safely try again.",
        { message: error instanceof Error ? error.message : String(error) },
        "retryable",
      );
    }
    if (!userinfoResponse.ok) {
      return providerError(
        "linkedin_userinfo",
        "Your LinkedIn connection may have expired.",
        await userinfoResponse.text().catch(() => ""),
        failureClassForStatus(userinfoResponse.status),
      );
    }

    const userinfo = await readJson<{ sub?: string }>(userinfoResponse);
    const sub = userinfo.sub?.trim();
    if (!sub) {
      return providerError("linkedin_person_urn", "Could not resolve LinkedIn member id.", userinfo);
    }

    const author = sub.startsWith("urn:li:") ? sub : `urn:li:person:${sub}`;
    const uploadedImages: Array<{ id: string; altText?: string }> = [];
    for (const [index, asset] of input.assets.entries()) {
      let imageResponse: Response;
      try {
        imageResponse = await input.fetcher(asset.url);
      } catch (error) {
        return providerError(
          "linkedin_image_fetch",
          `Could not load LinkedIn image ${index + 1}. ME3 can safely try again.`,
          { message: error instanceof Error ? error.message : String(error) },
          "retryable",
        );
      }
      if (!imageResponse.ok) {
        return providerError(
          "linkedin_image_fetch",
          `Could not load LinkedIn image ${index + 1}.`,
          undefined,
          failureClassForStatus(imageResponse.status),
        );
      }
      let initializeResponse: Response;
      try {
        initializeResponse = await input.fetcher(
          "https://api.linkedin.com/rest/images?action=initializeUpload",
          {
            method: "POST",
            headers: linkedInHeaders(input.accessToken),
            body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
          },
        );
      } catch (error) {
        return providerError(
          "linkedin_image_initialize",
          `LinkedIn did not finish preparing image ${index + 1}. ME3 can safely try again.`,
          { message: error instanceof Error ? error.message : String(error) },
          "retryable",
        );
      }
      const initialized = await readJson<{
        value?: { uploadUrl?: string; image?: string };
        message?: string;
      }>(initializeResponse);
      if (!initializeResponse.ok || !initialized.value?.uploadUrl || !initialized.value.image) {
        return providerError(
          "linkedin_image_initialize",
          initialized.message || `LinkedIn could not initialize image ${index + 1}.`,
          initialized,
          failureClassForStatus(initializeResponse.status),
        );
      }
      let uploadResponse: Response;
      try {
        uploadResponse = await input.fetcher(initialized.value.uploadUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Type": asset.mimeType || imageResponse.headers.get("content-type") || "application/octet-stream",
          },
          body: await imageResponse.arrayBuffer(),
        });
      } catch (error) {
        return providerError(
          "linkedin_image_upload",
          `LinkedIn did not finish uploading image ${index + 1}. ME3 can safely try again.`,
          { message: error instanceof Error ? error.message : String(error) },
          "retryable",
        );
      }
      if (!uploadResponse.ok) {
        return providerError(
          "linkedin_image_upload",
          `LinkedIn could not upload image ${index + 1}.`,
          await uploadResponse.text().catch(() => ""),
          failureClassForStatus(uploadResponse.status),
        );
      }
      const altText = asset.altText?.trim();
      uploadedImages.push({
        id: initialized.value.image,
        ...(altText ? { altText } : {}),
      });
    }

    const content = uploadedImages.length === 1
      ? { media: uploadedImages[0]! }
      : uploadedImages.length > 1
        ? { multiImage: { images: uploadedImages } }
        : undefined;

    let postResponse: Response;
    await input.markProviderWriteStarted?.();
    try {
      postResponse = await input.fetcher("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: linkedInHeaders(input.accessToken),
        body: JSON.stringify({
          author,
          commentary: input.bodyText,
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
          ...(content ? { content } : {}),
        }),
      });
    } catch (error) {
      return providerError(
        "linkedin_outcome_unknown",
        "LinkedIn did not confirm whether the post was published. Check LinkedIn before trying again.",
        { message: error instanceof Error ? error.message : String(error) },
        "outcome_unknown",
      );
    }
    const json = await readJson<Record<string, unknown>>(postResponse);
    if (!postResponse.ok) {
      return providerError(
        "linkedin_post_error",
        (json.message as string) || (json.error as string) || `LinkedIn API error (${postResponse.status})`,
        json,
        failureClassForStatus(postResponse.status),
      );
    }

    const id =
      (json.id as string | undefined) ||
      postResponse.headers.get("x-restli-id") ||
      undefined;
    if (!id) {
      return providerError(
        "linkedin_missing_post_id",
        "LinkedIn accepted the request but did not return a post id. Check LinkedIn before trying again.",
        json,
        "outcome_unknown",
      );
    }
    return {
      ok: true,
      platformPostId: id,
      platformPostUrl: `https://www.linkedin.com/feed/update/${id}`,
      providerResponse: json,
    };
  },
};

type XVideoUploadResult =
  | { ok: true; mediaId: string; providerResponses: unknown[] }
  | { ok: false; result: SocialPublishAdapterResult };

async function uploadXVideo(
  input: Parameters<SocialPublishAdapter["publish"]>[0],
  asset: SocialMediaAsset,
): Promise<XVideoUploadResult> {
  const byteLength = asset.byteLength!;
  const mimeType = normalizeMimeType(asset.mimeType)!;
  const providerResponses: unknown[] = [];
  const initBody = new FormData();
  initBody.set("command", "INIT");
  initBody.set("media_type", mimeType);
  initBody.set("total_bytes", String(byteLength));
  initBody.set("media_category", "tweet_video");

  let initResponse: Response;
  try {
    initResponse = await input.fetcher("https://api.x.com/2/media/upload", {
      method: "POST",
      headers: xAuthorizationHeaders(input.accessToken),
      body: initBody,
    });
  } catch (error) {
    return {
      ok: false,
      result: providerError(
        "x_video_initialize",
        "X did not finish preparing the video upload. ME3 can safely try again.",
        describeFetchError(error),
        "retryable",
      ),
    };
  }
  const initialized = await readJson<XErrorBody>(initResponse);
  providerResponses.push(initialized);
  if (!initResponse.ok) {
    return {
      ok: false,
      result: providerError(
        "x_video_initialize",
        xErrorMessage(initialized, `X could not initialize the video (${initResponse.status}).`),
        initialized,
        failureClassForStatus(initResponse.status),
      ),
    };
  }
  const mediaId = initialized.data?.id?.trim();
  if (!mediaId) {
    return {
      ok: false,
      result: providerError(
        "x_media_missing_id",
        "X prepared a video upload but did not return its media id.",
        initialized,
        "retryable",
      ),
    };
  }

  let segmentIndex = 0;
  for (let start = 0; start < byteLength; start += X_VIDEO_CHUNK_BYTES) {
    const end = Math.min(byteLength - 1, start + X_VIDEO_CHUNK_BYTES - 1);
    const expectedBytes = end - start + 1;
    let sourceResponse: Response;
    try {
      sourceResponse = await input.fetcher(asset.url, {
        headers: { Range: `bytes=${start}-${end}` },
      });
    } catch (error) {
      return {
        ok: false,
        result: providerError(
          "x_video_fetch",
          `Could not load X video segment ${segmentIndex + 1}. ME3 can safely try again.`,
          describeFetchError(error),
          "retryable",
        ),
      };
    }
    if (!sourceResponse.ok || (byteLength > X_VIDEO_CHUNK_BYTES && sourceResponse.status !== 206)) {
      return {
        ok: false,
        result: providerError(
          "x_video_fetch",
          `Could not load X video segment ${segmentIndex + 1} (${sourceResponse.status}).`,
          await sourceResponse.text().catch(() => ""),
          failureClassForStatus(sourceResponse.status),
        ),
      };
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await readBoundedBytes(sourceResponse, expectedBytes);
    } catch (error) {
      return {
        ok: false,
        result: providerError(
          "x_video_fetch",
          `Could not finish loading X video segment ${segmentIndex + 1}.`,
          describeFetchError(error),
          "retryable",
        ),
      };
    }
    if (!bytes || bytes.byteLength !== expectedBytes) {
      return {
        ok: false,
        result: providerError(
          "x_video_range",
          `X video segment ${segmentIndex + 1} did not contain the expected bytes.`,
          { expectedBytes, receivedBytes: bytes?.byteLength ?? null },
          "retryable",
        ),
      };
    }

    const appendBody = new FormData();
    appendBody.set("command", "APPEND");
    appendBody.set("media_id", mediaId);
    appendBody.set("segment_index", String(segmentIndex));
    appendBody.set(
      "media",
      new Blob([copyBytesToArrayBuffer(bytes)], { type: mimeType }),
      `segment-${segmentIndex}.mp4`,
    );
    let appendResponse: Response;
    try {
      appendResponse = await input.fetcher("https://api.x.com/2/media/upload", {
        method: "POST",
        headers: xAuthorizationHeaders(input.accessToken),
        body: appendBody,
      });
    } catch (error) {
      return {
        ok: false,
        result: providerError(
          "x_video_append",
          `X did not finish uploading video segment ${segmentIndex + 1}. ME3 can safely try again.`,
          { ...describeFetchError(error), mediaId, segmentIndex },
          "retryable",
        ),
      };
    }
    const appended = await readJson<XErrorBody>(appendResponse);
    providerResponses.push(appended);
    if (!appendResponse.ok) {
      return {
        ok: false,
        result: providerError(
          "x_video_append",
          xErrorMessage(
            appended,
            `X could not upload video segment ${segmentIndex + 1} (${appendResponse.status}).`,
          ),
          appended,
          failureClassForStatus(appendResponse.status),
        ),
      };
    }
    segmentIndex += 1;
  }

  const finalizeBody = new FormData();
  finalizeBody.set("command", "FINALIZE");
  finalizeBody.set("media_id", mediaId);
  let finalizeResponse: Response;
  try {
    finalizeResponse = await input.fetcher("https://api.x.com/2/media/upload", {
      method: "POST",
      headers: xAuthorizationHeaders(input.accessToken),
      body: finalizeBody,
    });
  } catch (error) {
    return {
      ok: false,
      result: providerError(
        "x_video_finalize",
        "X did not finish finalizing the video. ME3 can safely check or try again.",
        { ...describeFetchError(error), mediaId },
        "retryable",
      ),
    };
  }
  let processing = await readJson<XErrorBody>(finalizeResponse);
  providerResponses.push(processing);
  if (!finalizeResponse.ok) {
    return {
      ok: false,
      result: providerError(
        "x_video_finalize",
        xErrorMessage(processing, `X could not finalize the video (${finalizeResponse.status}).`),
        processing,
        failureClassForStatus(finalizeResponse.status),
      ),
    };
  }

  for (let attempt = 0; attempt < X_VIDEO_PROCESSING_ATTEMPTS; attempt += 1) {
    const processingInfo = processing.data?.processing_info;
    if (!processingInfo || processingInfo.state === "succeeded") {
      return { ok: true, mediaId, providerResponses };
    }
    if (processingInfo.state === "failed") {
      return {
        ok: false,
        result: providerError(
          "x_video_processing",
          xErrorMessage(processing, "X could not process the uploaded video."),
          processing,
          "rejected",
        ),
      };
    }
    const checkAfterSeconds = Math.min(
      5,
      Math.max(1, Math.ceil(processingInfo.check_after_secs || 1)),
    );
    await wait(checkAfterSeconds * 1_000);
    const statusUrl = new URL("https://api.x.com/2/media/upload");
    statusUrl.searchParams.set("command", "STATUS");
    statusUrl.searchParams.set("media_id", mediaId);
    let statusResponse: Response;
    try {
      statusResponse = await input.fetcher(statusUrl, {
        headers: xAuthorizationHeaders(input.accessToken),
      });
    } catch (error) {
      return {
        ok: false,
        result: providerError(
          "x_video_status",
          "X did not finish checking the video. ME3 can safely try again.",
          { ...describeFetchError(error), mediaId },
          "retryable",
        ),
      };
    }
    processing = await readJson<XErrorBody>(statusResponse);
    providerResponses.push(processing);
    if (!statusResponse.ok) {
      return {
        ok: false,
        result: providerError(
          "x_video_status",
          xErrorMessage(processing, `X could not check the video (${statusResponse.status}).`),
          processing,
          failureClassForStatus(statusResponse.status),
        ),
      };
    }
  }

  return {
    ok: false,
    result: providerError(
      "x_video_processing_timeout",
      "X is still processing the video. ME3 can safely try again later.",
      { mediaId, providerResponses },
      "retryable",
    ),
  };
}

const xAdapter: SocialPublishAdapter = {
  validateDraft: validateXDraft,

  async publish(input) {
    const validation = validateXDraft(input);
    if (!validation.ok) {
      return providerError(
        "x_validation_failed",
        validation.error,
        undefined,
        validation.error.includes("currently supports") ? "unsupported" : "rejected",
      );
    }

    const mediaIds: string[] = [];
    const mediaResponses: unknown[] = [];
    let providerCostStarted = false;
    const markProviderCostStarted = async () => {
      if (providerCostStarted) return;
      await input.markProviderCostStarted?.();
      providerCostStarted = true;
    };
    const videoAsset = input.assets.find((asset) => asset.kind === "video");
    if (videoAsset) {
      const upload = await uploadXVideo(input, videoAsset);
      if (!upload.ok) return upload.result;
      mediaIds.push(upload.mediaId);
      mediaResponses.push(...upload.providerResponses);
    } else {
      for (const [index, asset] of input.assets.entries()) {
        let imageResponse: Response;
        try {
          imageResponse = await input.fetcher(asset.url);
        } catch (error) {
          return providerError(
            "x_image_fetch",
            `Could not load X image ${index + 1}.`,
            { message: error instanceof Error ? error.message : String(error) },
            "retryable",
          );
        }
        if (!imageResponse.ok) {
          return providerError(
            "x_image_fetch",
            `Could not load X image ${index + 1} (${imageResponse.status}).`,
            await imageResponse.text().catch(() => ""),
            fetchFailureClass(imageResponse.status),
          );
        }

      let bytes: Uint8Array | null;
      try {
        bytes = await readBoundedBytes(imageResponse, X_IMAGE_MAX_BYTES);
      } catch (error) {
        return providerError(
          "x_image_fetch",
          `Could not finish loading X image ${index + 1}.`,
          { message: error instanceof Error ? error.message : String(error) },
          "retryable",
        );
      }
      if (!bytes) {
        return providerError(
          "x_image_too_large",
          `X image ${index + 1} is larger than 5 MB.`,
          undefined,
          "unsupported",
        );
      }
      if (bytes.byteLength === 0) {
        return providerError(
          "x_image_empty",
          `X image ${index + 1} is empty.`,
        );
      }

      const sniffedMimeType = sniffCarouselRasterMimeType(bytes);
      const declaredMimeType = normalizeMimeType(asset.mimeType);
      const responseMimeType = normalizeMimeType(imageResponse.headers.get("content-type"));
      if (
        !sniffedMimeType ||
        (declaredMimeType && declaredMimeType !== sniffedMimeType) ||
        (responseMimeType &&
          X_IMAGE_MIME_TYPES.has(responseMimeType as CarouselRasterMimeType) &&
          responseMimeType !== sniffedMimeType)
      ) {
        return providerError(
          "x_image_type",
          `X image ${index + 1} must be a valid PNG, JPEG, or WebP raster image.`,
          { declaredMimeType, responseMimeType, sniffedMimeType },
          "unsupported",
        );
      }

      let uploadResponse: Response;
      try {
        uploadResponse = await input.fetcher("https://api.x.com/2/media/upload", {
          method: "POST",
          headers: xHeaders(input.accessToken),
          body: JSON.stringify({
            media: bytesToBase64(bytes),
            media_category: "tweet_image",
            media_type: sniffedMimeType,
          }),
        });
      } catch (error) {
        return providerError(
          "x_media_upload",
          `X did not finish uploading image ${index + 1}.`,
          { message: error instanceof Error ? error.message : String(error) },
          "retryable",
        );
      }
      const uploadJson = await readJson<XErrorBody>(uploadResponse);
      if (!uploadResponse.ok) {
        return providerError(
          "x_media_upload",
          xErrorMessage(uploadJson, `X image upload failed (${uploadResponse.status}).`),
          uploadJson,
          failureClassForStatus(uploadResponse.status),
        );
      }
      const mediaId = uploadJson.data?.id?.trim();
      if (!mediaId) {
        return providerError(
          "x_media_missing_id",
          "X uploaded an image but did not return its media id.",
          uploadJson,
          "retryable",
        );
      }
      mediaIds.push(mediaId);
      mediaResponses.push(uploadJson);

      const altText = asset.altText?.trim();
      if (!altText) continue;
      let metadataResponse: Response;
      try {
        await markProviderCostStarted();
        metadataResponse = await input.fetcher("https://api.x.com/2/media/metadata", {
          method: "POST",
          headers: xHeaders(input.accessToken),
          body: JSON.stringify({
            id: mediaId,
            metadata: { alt_text: { text: altText } },
          }),
        });
      } catch (error) {
        return providerError(
          "x_media_metadata",
          `X did not finish adding alt text to image ${index + 1}.`,
          { message: error instanceof Error ? error.message : String(error), mediaId },
          "retryable",
        );
      }
      const metadataJson = await readJson<XErrorBody>(metadataResponse);
      if (!metadataResponse.ok) {
        return providerError(
          "x_media_metadata",
          xErrorMessage(
            metadataJson,
            `X could not add alt text to image ${index + 1} (${metadataResponse.status}).`,
          ),
          metadataJson,
          failureClassForStatus(metadataResponse.status),
        );
      }
        mediaResponses.push(metadataJson);
      }
    }

    let response: Response;
    await markProviderCostStarted();
    await input.markProviderWriteStarted?.();
    try {
      response = await input.fetcher("https://api.x.com/2/tweets", {
        method: "POST",
        headers: xHeaders(input.accessToken),
        body: JSON.stringify({
          text: input.bodyText.trim(),
          ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
        }),
      });
    } catch (error) {
      return providerError(
        "x_outcome_unknown",
        "X did not confirm whether the post was published. Check X before trying again.",
        {
          message: error instanceof Error ? error.message : String(error),
          mediaIds,
        },
        "outcome_unknown",
      );
    }
    const json = await readJson<XErrorBody>(response);
    if (!response.ok) {
      return providerError(
        "x_api_error",
        xErrorMessage(json, `X API error (${response.status})`),
        { media: mediaResponses, post: json },
        failureClassForStatus(response.status),
      );
    }
    const id = json.data?.id;
    if (!id) {
      return providerError(
        "x_missing_id",
        "X accepted the request but did not return a post id. Check X before trying again.",
        { media: mediaResponses, post: json },
        "outcome_unknown",
      );
    }
    return {
      ok: true,
      platformPostId: id,
      platformPostUrl: `https://x.com/i/web/status/${id}`,
      providerResponse: { media: mediaResponses, post: json },
    };
  },
};

function validateTikTokDraft(input: {
  bodyText: string;
  assets: SocialMediaAsset[];
}): { ok: true } | { ok: false; error: string } {
  if (input.assets.length !== 1 || input.assets[0]?.kind !== "video") {
    return { ok: false, error: "TikTok draft upload requires exactly one video." };
  }
  const asset = input.assets[0];
  if (!asset.url?.trim()) {
    return { ok: false, error: "The TikTok video needs a delivery URL." };
  }
  const mimeType = normalizeMimeType(asset.mimeType);
  if (!mimeType || !TIKTOK_VIDEO_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: "TikTok supports MP4, QuickTime, and WebM video uploads." };
  }
  const byteLength = asset.byteLength;
  if (!Number.isSafeInteger(byteLength) || (byteLength ?? 0) <= 0) {
    return { ok: false, error: "TikTok needs the video file size before it can upload the draft." };
  }
  if (byteLength! > TIKTOK_MAX_VIDEO_BYTES) {
    return { ok: false, error: "The TikTok video is larger than 4 GB." };
  }
  return { ok: true };
}

function tikTokChunkPlan(byteLength: number): {
  chunkSize: number;
  totalChunkCount: number;
  ranges: Array<{ start: number; end: number }>;
} {
  const chunkSize = byteLength <= TIKTOK_SINGLE_CHUNK_MAX_BYTES
    ? byteLength
    : TIKTOK_MULTI_CHUNK_BYTES;
  const totalChunkCount = Math.max(1, Math.floor(byteLength / chunkSize));
  const ranges = Array.from({ length: totalChunkCount }, (_, index) => {
    const start = index * chunkSize;
    const end = index === totalChunkCount - 1
      ? byteLength - 1
      : start + chunkSize - 1;
    return { start, end };
  });
  return { chunkSize, totalChunkCount, ranges };
}

type TikTokApiResponse = {
  data?: {
    publish_id?: string;
    upload_url?: string;
    status?: string;
    fail_reason?: string;
    uploaded_bytes?: number;
  };
  error?: { code?: string; message?: string; log_id?: string };
};

export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type TikTokCreatorInfo = {
  avatarUrl: string | null;
  username: string;
  nickname: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSeconds: number;
};

export type TikTokDeliveryOptions =
  | { deliveryMode: "provider_draft" }
  | {
    deliveryMode: "direct_publish";
    privacyLevel: TikTokPrivacyLevel | null;
    allowComment: boolean;
    allowDuet: boolean;
    allowStitch: boolean;
    brandContent: boolean;
    brandOrganic: boolean;
    isAiGenerated: boolean;
    consent: boolean;
    videoDurationSeconds: number;
  };

export type YouTubePrivacyStatus = "private" | "unlisted" | "public";

export type YouTubePublishingSettings = {
  privacyStatus: YouTubePrivacyStatus | null;
  madeForKids: boolean | null;
  containsSyntheticMedia: boolean;
};

type TikTokCreatorInfoApiResponse = {
  data?: {
    creator_avatar_url?: string;
    creator_username?: string;
    creator_nickname?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  };
  error?: { code?: string; message?: string; log_id?: string };
};

export type TikTokCreatorInfoQueryResult =
  | {
    ok: true;
    creatorInfo: TikTokCreatorInfo;
    providerResponse: TikTokCreatorInfoApiResponse;
  }
  | {
    ok: false;
    status: number;
    errorCode: string;
    errorMessage: string;
    providerResponse: TikTokCreatorInfoApiResponse;
  };

const TIKTOK_PRIVACY_LEVELS = new Set<TikTokPrivacyLevel>([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

export async function queryTikTokCreatorInfo(
  accessToken: string,
  fetcher: typeof fetch,
): Promise<TikTokCreatorInfoQueryResult> {
  let response: Response;
  try {
    response = await fetcher(TIKTOK_CREATOR_INFO_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      errorCode: "tiktok_creator_info_unavailable",
      errorMessage: `TikTok creator settings could not be loaded: ${describeFetchError(error).message}`,
      providerResponse: {},
    };
  }

  const body = await readJson<TikTokCreatorInfoApiResponse>(response);
  const apiError = body.error?.code?.trim();
  if (!response.ok || (apiError && apiError !== "ok")) {
    return {
      ok: false,
      status: response.status,
      errorCode: apiError || "tiktok_creator_info",
      errorMessage:
        body.error?.message ||
        `TikTok creator settings could not be loaded (${response.status}).`,
      providerResponse: body,
    };
  }

  const data = body.data;
  const privacyLevelOptions = (data?.privacy_level_options || []).filter(
    (value): value is TikTokPrivacyLevel =>
      TIKTOK_PRIVACY_LEVELS.has(value as TikTokPrivacyLevel),
  );
  const maxVideoPostDurationSeconds = Number(data?.max_video_post_duration_sec);
  if (
    !data?.creator_username?.trim() ||
    !data.creator_nickname?.trim() ||
    privacyLevelOptions.length === 0 ||
    !Number.isFinite(maxVideoPostDurationSeconds) ||
    maxVideoPostDurationSeconds <= 0
  ) {
    return {
      ok: false,
      status: 502,
      errorCode: "tiktok_creator_info_incomplete",
      errorMessage: "TikTok returned incomplete Direct Post settings. Reconnect and try again.",
      providerResponse: body,
    };
  }

  return {
    ok: true,
    creatorInfo: {
      avatarUrl: data.creator_avatar_url?.trim() || null,
      username: data.creator_username.trim(),
      nickname: data.creator_nickname.trim(),
      privacyLevelOptions,
      commentDisabled: data.comment_disabled === true,
      duetDisabled: data.duet_disabled === true,
      stitchDisabled: data.stitch_disabled === true,
      maxVideoPostDurationSeconds,
    },
    providerResponse: body,
  };
}

export function normalizeTikTokDeliveryOptions(value: unknown): TikTokDeliveryOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { deliveryMode: "provider_draft" };
  }
  const options = value as Record<string, unknown>;
  if (options.deliveryMode !== "direct_publish") {
    return { deliveryMode: "provider_draft" };
  }
  const privacyLevel = typeof options.privacyLevel === "string" &&
      TIKTOK_PRIVACY_LEVELS.has(options.privacyLevel as TikTokPrivacyLevel)
    ? options.privacyLevel as TikTokPrivacyLevel
    : null;
  return {
    deliveryMode: "direct_publish",
    privacyLevel,
    allowComment: options.allowComment === true,
    allowDuet: options.allowDuet === true,
    allowStitch: options.allowStitch === true,
    brandContent: options.brandContent === true,
    brandOrganic: options.brandOrganic === true,
    isAiGenerated: options.isAiGenerated === true,
    consent: options.consent === true,
    videoDurationSeconds: Number(options.videoDurationSeconds),
  };
}

const YOUTUBE_PRIVACY_STATUSES = new Set<YouTubePrivacyStatus>([
  "private",
  "unlisted",
  "public",
]);

export function normalizeYouTubePublishingSettings(
  value: unknown,
): YouTubePublishingSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      privacyStatus: null,
      madeForKids: null,
      containsSyntheticMedia: false,
    };
  }
  const settings = value as Record<string, unknown>;
  return {
    privacyStatus:
      typeof settings.privacyStatus === "string" &&
        YOUTUBE_PRIVACY_STATUSES.has(settings.privacyStatus as YouTubePrivacyStatus)
        ? settings.privacyStatus as YouTubePrivacyStatus
        : null,
    madeForKids:
      typeof settings.madeForKids === "boolean" ? settings.madeForKids : null,
    containsSyntheticMedia: settings.containsSyntheticMedia === true,
  };
}

function tikTokFailureClass(
  status: number,
  errorCode: string | undefined,
): SocialPublishFailureClass {
  if (errorCode === "access_token_invalid" || errorCode === "scope_not_authorized") {
    return "reconnect_required";
  }
  if (errorCode === "rate_limit_exceeded" || status === 429 || status >= 500) {
    return "retryable";
  }
  if (
    errorCode === "unaudited_client_can_only_post_to_private_accounts" ||
    errorCode === "privacy_level_option_mismatch" ||
    errorCode?.startsWith("spam_risk_") ||
    status === 400 ||
    status === 403 ||
    status === 422
  ) {
    return "rejected";
  }
  return failureClassForStatus(status);
}

function tikTokResumePublishId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const publishId = (value as Record<string, unknown>).publishId;
  return typeof publishId === "string" && publishId.trim()
    ? publishId.trim()
    : null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const tikTokAdapter: SocialPublishAdapter = {
  validateDraft: validateTikTokDraft,

  async publish(input) {
    const validation = validateTikTokDraft(input);
    if (!validation.ok) {
      return providerError("tiktok_validation_failed", validation.error, undefined, "unsupported");
    }

    const deliveryOptions = normalizeTikTokDeliveryOptions(input.providerOptions);
    let publishId = tikTokResumePublishId(input.resumeProviderResponse);
    let initialized: TikTokApiResponse | null = null;
    let creatorInfoResponse: TikTokCreatorInfoApiResponse | null = null;

    if (!publishId) {
      const asset = input.assets[0]!;
      const byteLength = asset.byteLength!;
      const mimeType = normalizeMimeType(asset.mimeType)!;
      const plan = tikTokChunkPlan(byteLength);
      let initUrl = TIKTOK_UPLOAD_INIT_URL;
      let postInfo: Record<string, unknown> | null = null;

      if (deliveryOptions.deliveryMode === "direct_publish") {
        const caption = input.bodyText.trim();
        if (characterLength(caption) > TIKTOK_CAPTION_MAX_CHARS) {
          return providerError(
            "tiktok_caption_too_long",
            `The TikTok caption is too long (max ${TIKTOK_CAPTION_MAX_CHARS} characters).`,
          );
        }
        if (!deliveryOptions.consent) {
          return providerError(
            "tiktok_consent_required",
            "Confirm TikTok's music usage terms before posting directly.",
          );
        }
        if (!deliveryOptions.privacyLevel) {
          return providerError(
            "tiktok_privacy_required",
            "Choose who can view this TikTok before posting directly.",
          );
        }
        if (
          !Number.isFinite(deliveryOptions.videoDurationSeconds) ||
          deliveryOptions.videoDurationSeconds <= 0
        ) {
          return providerError(
            "tiktok_video_duration_required",
            "ME3 needs the TikTok video duration before posting directly.",
          );
        }
        if (
          deliveryOptions.brandContent &&
          deliveryOptions.privacyLevel === "SELF_ONLY"
        ) {
          return providerError(
            "tiktok_branded_content_privacy",
            "Branded TikTok content cannot use Only me visibility.",
          );
        }

        const creatorInfo = await queryTikTokCreatorInfo(
          input.accessToken,
          input.fetcher,
        );
        if (!creatorInfo.ok) {
          return providerError(
            creatorInfo.errorCode,
            creatorInfo.errorCode === "scope_not_authorized"
              ? "Reconnect TikTok to grant Direct Post access."
              : creatorInfo.errorMessage,
            creatorInfo.providerResponse,
            tikTokFailureClass(creatorInfo.status, creatorInfo.errorCode),
          );
        }
        creatorInfoResponse = creatorInfo.providerResponse;
        if (
          !creatorInfo.creatorInfo.privacyLevelOptions.includes(
            deliveryOptions.privacyLevel,
          )
        ) {
          return providerError(
            "privacy_level_option_mismatch",
            "Choose a TikTok privacy option currently available for this account.",
            creatorInfo.providerResponse,
          );
        }
        if (
          deliveryOptions.videoDurationSeconds >
          creatorInfo.creatorInfo.maxVideoPostDurationSeconds
        ) {
          return providerError(
            "tiktok_video_too_long",
            `This TikTok account accepts videos up to ${creatorInfo.creatorInfo.maxVideoPostDurationSeconds} seconds.`,
            creatorInfo.providerResponse,
          );
        }

        initUrl = TIKTOK_DIRECT_POST_INIT_URL;
        postInfo = {
          title: caption,
          privacy_level: deliveryOptions.privacyLevel,
          disable_comment:
            creatorInfo.creatorInfo.commentDisabled || !deliveryOptions.allowComment,
          disable_duet:
            creatorInfo.creatorInfo.duetDisabled || !deliveryOptions.allowDuet,
          disable_stitch:
            creatorInfo.creatorInfo.stitchDisabled || !deliveryOptions.allowStitch,
          brand_content_toggle: deliveryOptions.brandContent,
          brand_organic_toggle: deliveryOptions.brandOrganic,
          is_aigc: deliveryOptions.isAiGenerated,
        };
      }

      let initResponse: Response;
      try {
        await input.markProviderWriteStarted?.();
        initResponse = await input.fetcher(initUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({
            ...(postInfo ? { post_info: postInfo } : {}),
            source_info: {
              source: "FILE_UPLOAD",
              video_size: byteLength,
              chunk_size: plan.chunkSize,
              total_chunk_count: plan.totalChunkCount,
            },
          }),
        });
      } catch (error) {
        return providerError(
          "tiktok_init_outcome_unknown",
          "TikTok did not confirm whether it initialized the draft upload. Check TikTok before trying again.",
          describeFetchError(error),
          "outcome_unknown",
        );
      }

      initialized = await readJson<TikTokApiResponse>(initResponse);
      const apiError = initialized.error?.code?.trim();
      if (!initResponse.ok || (apiError && apiError !== "ok")) {
        const unauditedPrivateOnly =
          apiError === "unaudited_client_can_only_post_to_private_accounts";
        return providerError(
          apiError || "tiktok_upload_init",
          unauditedPrivateOnly
            ? "Until app review is approved, set this TikTok account to private and choose Only me visibility."
            : initialized.error?.message ||
              `TikTok could not initialize the ${
                deliveryOptions.deliveryMode === "direct_publish" ? "Direct Post" : "draft upload"
              } (${initResponse.status}).`,
          initialized,
          tikTokFailureClass(initResponse.status, apiError),
        );
      }

      publishId = initialized.data?.publish_id?.trim() || null;
      const uploadUrl = initialized.data?.upload_url?.trim();
      if (!publishId || !uploadUrl) {
        return providerError(
          "tiktok_upload_init_incomplete",
          "TikTok accepted the draft upload request without returning all upload details. Check TikTok before trying again.",
          initialized,
          "outcome_unknown",
        );
      }

      for (const [index, range] of plan.ranges.entries()) {
        const contentLength = range.end - range.start + 1;
        let videoResponse: Response;
        try {
          videoResponse = await input.fetcher(asset.url, {
            headers: { Range: `bytes=${range.start}-${range.end}` },
          });
        } catch (error) {
          return providerError(
            "tiktok_video_fetch",
            `ME3 could not load video chunk ${index + 1} for TikTok.`,
            { ...describeFetchError(error), publishId },
            "outcome_unknown",
          );
        }
        if (!videoResponse.ok || !videoResponse.body) {
          return providerError(
            "tiktok_video_fetch",
            `ME3 could not load video chunk ${index + 1} for TikTok (${videoResponse.status}).`,
            { publishId },
            "outcome_unknown",
          );
        }

        let uploadResponse: Response;
        try {
          uploadResponse = await input.fetcher(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": mimeType,
              "Content-Length": String(contentLength),
              "Content-Range": `bytes ${range.start}-${range.end}/${byteLength}`,
            },
            body: videoResponse.body,
          });
        } catch (error) {
          return providerError(
            "tiktok_video_upload_outcome_unknown",
            "TikTok did not confirm whether it received the full video. Check TikTok before trying again.",
            { ...describeFetchError(error), publishId, chunk: index + 1 },
            "outcome_unknown",
          );
        }

        const expectedStatus = index === plan.ranges.length - 1 ? 201 : 206;
        if (uploadResponse.status !== expectedStatus) {
          return providerError(
            "tiktok_video_upload",
            `TikTok did not accept video chunk ${index + 1} (${uploadResponse.status}).`,
            {
              publishId,
              chunk: index + 1,
              response: await uploadResponse.text().catch(() => ""),
            },
            "outcome_unknown",
          );
        }
      }
    }

    let lastStatus: TikTokApiResponse | null = null;
    for (let attempt = 0; attempt < TIKTOK_STATUS_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await wait(TIKTOK_STATUS_POLL_MS);
      let statusResponse: Response;
      try {
        statusResponse = await input.fetcher(TIKTOK_STATUS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({ publish_id: publishId }),
        });
      } catch (error) {
        return providerError(
          "tiktok_status_outcome_unknown",
          "TikTok received the video, but ME3 could not confirm whether the draft reached your inbox. Check TikTok before trying again.",
          { ...describeFetchError(error), publishId },
          "outcome_unknown",
        );
      }

      lastStatus = await readJson<TikTokApiResponse>(statusResponse);
      const statusError = lastStatus.error?.code?.trim();
      if (!statusResponse.ok || (statusError && statusError !== "ok")) {
        return providerError(
          statusError || "tiktok_status_error",
          lastStatus.error?.message || "TikTok received the video, but its draft status could not be confirmed.",
          { publishId, status: lastStatus },
          "outcome_unknown",
        );
      }

      const status = lastStatus.data?.status?.trim();
      const deliveryComplete = deliveryOptions.deliveryMode === "direct_publish"
        ? status === "PUBLISH_COMPLETE"
        : status === "SEND_TO_USER_INBOX" || status === "PUBLISH_COMPLETE";
      if (deliveryComplete) {
        return {
          ok: true,
          platformPostId: publishId,
          providerResponse: {
            delivery:
              deliveryOptions.deliveryMode === "direct_publish"
                ? "direct_publish"
                : "creator_draft",
            creatorActionRequired:
              deliveryOptions.deliveryMode === "provider_draft" &&
              status !== "PUBLISH_COMPLETE",
            publishId,
            init: initialized,
            creatorInfo: creatorInfoResponse,
            status: lastStatus,
          },
        };
      }
      if (status === "FAILED") {
        return providerError(
          "tiktok_processing_failed",
          lastStatus.data?.fail_reason
            ? `TikTok could not prepare the draft: ${lastStatus.data.fail_reason}.`
            : "TikTok could not prepare the draft.",
          { publishId, status: lastStatus },
          "rejected",
        );
      }
    }

    return providerError(
      "tiktok_processing_pending",
      "TikTok is still processing the video. ME3 will check this draft again automatically.",
      { publishId, init: initialized, status: lastStatus },
      "retryable",
    );
  },
};

type YouTubeApiBody = {
  id?: string;
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
  items?: Array<{
    id?: string;
    status?: {
      uploadStatus?: string;
      privacyStatus?: string;
      failureReason?: string;
      rejectionReason?: string;
    };
    processingDetails?: {
      processingStatus?: string;
      processingFailureReason?: string;
      processingProgress?: {
        partsProcessed?: string;
        partsTotal?: string;
        timeLeftMs?: string;
      };
    };
  }>;
};

function youtubeErrorMessage(body: YouTubeApiBody, fallback: string): string {
  return body.error?.errors?.[0]?.message || body.error?.message || fallback;
}

function youtubeFailureClass(
  status: number,
  body: YouTubeApiBody,
): SocialPublishFailureClass {
  const reason = body.error?.errors?.[0]?.reason || "";
  if (
    status === 401 ||
    reason === "authError" ||
    reason === "insufficientPermissions" ||
    reason === "youtubeSignupRequired"
  ) {
    return "reconnect_required";
  }
  if (status === 429 || status >= 500) return "retryable";
  return "rejected";
}

function youtubeResumeOffset(response: Response): number {
  const range = response.headers.get("range");
  const match = range?.match(/bytes=0-(\d+)$/i);
  return match ? Number(match[1]) + 1 : 0;
}

type YouTubeUploadStatus =
  | { kind: "resume"; offset: number; providerResponse: unknown }
  | { kind: "complete"; videoId: string; providerResponse: unknown }
  | { kind: "failed"; result: SocialPublishAdapterResult };

async function checkYouTubeUploadStatus(
  input: Parameters<SocialPublishAdapter["publish"]>[0],
  uploadUrl: string,
  byteLength: number,
): Promise<YouTubeUploadStatus> {
  let response: Response;
  try {
    response = await input.fetcher(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Length": "0",
        "Content-Range": `bytes */${byteLength}`,
      },
    });
  } catch (error) {
    return {
      kind: "failed",
      result: providerError(
        "youtube_upload_outcome_unknown",
        "YouTube did not confirm whether the video upload completed. Check YouTube Studio before trying again.",
        describeFetchError(error),
        "outcome_unknown",
      ),
    };
  }
  const body = await readJson<YouTubeApiBody>(response);
  if (response.status === 308) {
    return {
      kind: "resume",
      offset: youtubeResumeOffset(response),
      providerResponse: body,
    };
  }
  if (response.ok) {
    if (body.id) {
      return { kind: "complete", videoId: body.id, providerResponse: body };
    }
    return {
      kind: "failed",
      result: providerError(
        "youtube_upload_outcome_unknown",
        "YouTube completed the upload request without returning a video id. Check YouTube Studio before trying again.",
        body,
        "outcome_unknown",
      ),
    };
  }
  return {
    kind: "failed",
    result: providerError(
      "youtube_upload_status",
      youtubeErrorMessage(body, `YouTube could not resume the upload (${response.status}).`),
      body,
      response.status === 404
        ? "retryable"
        : youtubeFailureClass(response.status, body),
    ),
  };
}

function validateYouTubeDraft(input: {
  title?: string;
  bodyText: string;
  assets: SocialMediaAsset[];
}): { ok: true } | { ok: false; error: string } {
  const title = input.title?.trim() || "";
  if (!title) return { ok: false, error: "YouTube needs a video title." };
  if (characterLength(title) > YOUTUBE_TITLE_MAX_CHARS) {
    return {
      ok: false,
      error: `The YouTube title is too long (max ${YOUTUBE_TITLE_MAX_CHARS} characters).`,
    };
  }
  if (characterLength(input.bodyText.trim()) > YOUTUBE_DESCRIPTION_MAX_CHARS) {
    return {
      ok: false,
      error: `The YouTube description is too long (max ${YOUTUBE_DESCRIPTION_MAX_CHARS} characters).`,
    };
  }
  if (input.assets.length !== 1 || input.assets[0]?.kind !== "video") {
    return { ok: false, error: "YouTube upload requires exactly one video." };
  }
  const asset = input.assets[0];
  if (!asset.url?.trim()) {
    return { ok: false, error: "The YouTube video needs a delivery URL." };
  }
  const mimeType = normalizeMimeType(asset.mimeType);
  if (!mimeType || (mimeType !== "application/octet-stream" && !mimeType.startsWith("video/"))) {
    return { ok: false, error: "YouTube requires a video file." };
  }
  if (!Number.isSafeInteger(asset.byteLength) || (asset.byteLength ?? 0) <= 0) {
    return { ok: false, error: "YouTube needs the video file size before it can upload." };
  }
  if (asset.byteLength! > YOUTUBE_VIDEO_MAX_BYTES) {
    return { ok: false, error: "The YouTube video is larger than 256 GB." };
  }
  return { ok: true };
}

const youtubeAdapter: SocialPublishAdapter = {
  validateDraft: validateYouTubeDraft,

  async publish(input) {
    const validation = validateYouTubeDraft(input);
    if (!validation.ok) {
      return providerError(
        "youtube_validation_failed",
        validation.error,
        undefined,
        "rejected",
      );
    }

    const asset = input.assets[0]!;
    const byteLength = asset.byteLength!;
    const mimeType = normalizeMimeType(asset.mimeType)!;
    const publishingSettings = normalizeYouTubePublishingSettings(
      input.providerOptions,
    );
    if (!publishingSettings.privacyStatus) {
      return providerError(
        "youtube_privacy_required",
        "Choose who can view this YouTube video before uploading.",
        undefined,
        "rejected",
      );
    }
    if (publishingSettings.madeForKids === null) {
      return providerError(
        "youtube_audience_required",
        "Choose whether this YouTube video is made for kids before uploading.",
        undefined,
        "rejected",
      );
    }
    const metadata = {
      snippet: {
        title: input.title!.trim(),
        description: input.bodyText.trim(),
        categoryId: "22",
      },
      status: {
        privacyStatus: publishingSettings.privacyStatus,
        selfDeclaredMadeForKids: publishingSettings.madeForKids,
        containsSyntheticMedia: publishingSettings.containsSyntheticMedia,
      },
    };
    const metadataBody = JSON.stringify(metadata);
    const uploadInitUrl = new URL(
      "https://www.googleapis.com/upload/youtube/v3/videos",
    );
    uploadInitUrl.searchParams.set("uploadType", "resumable");
    uploadInitUrl.searchParams.set("part", "snippet,status");
    uploadInitUrl.searchParams.set("notifySubscribers", "false");

    let initResponse: Response;
    try {
      initResponse = await input.fetcher(uploadInitUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "Content-Length": String(new TextEncoder().encode(metadataBody).byteLength),
          "X-Upload-Content-Length": String(byteLength),
          "X-Upload-Content-Type": mimeType,
        },
        body: metadataBody,
      });
    } catch (error) {
      return providerError(
        "youtube_upload_initialize",
        "YouTube did not finish preparing the upload. ME3 can safely try again.",
        describeFetchError(error),
        "retryable",
      );
    }
    const initialized = await readJson<YouTubeApiBody>(initResponse);
    if (!initResponse.ok) {
      return providerError(
        "youtube_upload_initialize",
        youtubeErrorMessage(
          initialized,
          `YouTube could not prepare the upload (${initResponse.status}).`,
        ),
        initialized,
        youtubeFailureClass(initResponse.status, initialized),
      );
    }
    const uploadUrl = initResponse.headers.get("location")?.trim();
    if (!uploadUrl) {
      return providerError(
        "youtube_upload_location",
        "YouTube did not return a resumable upload URL. ME3 can safely try again.",
        initialized,
        "retryable",
      );
    }

    await input.markProviderWriteStarted?.();
    const providerResponses: unknown[] = [initialized];
    let offset = 0;
    let videoId: string | null = null;
    while (offset < byteLength) {
      const end = Math.min(
        byteLength - 1,
        offset + YOUTUBE_UPLOAD_CHUNK_BYTES - 1,
      );
      const expectedBytes = end - offset + 1;
      let sourceResponse: Response;
      try {
        sourceResponse = await input.fetcher(asset.url, {
          headers: { Range: `bytes=${offset}-${end}` },
        });
      } catch (error) {
        return providerError(
          "youtube_video_fetch",
          "Could not load the YouTube video from Files. ME3 can safely try again.",
          describeFetchError(error),
          "retryable",
        );
      }
      if (
        !sourceResponse.ok ||
        (byteLength > YOUTUBE_UPLOAD_CHUNK_BYTES && sourceResponse.status !== 206)
      ) {
        return providerError(
          "youtube_video_fetch",
          `Could not load the YouTube video (${sourceResponse.status}).`,
          await sourceResponse.text().catch(() => ""),
          failureClassForStatus(sourceResponse.status),
        );
      }

      let bytes: Uint8Array | null;
      try {
        bytes = await readBoundedBytes(sourceResponse, expectedBytes);
      } catch (error) {
        return providerError(
          "youtube_video_fetch",
          "Could not finish loading the YouTube video from Files.",
          describeFetchError(error),
          "retryable",
        );
      }
      if (!bytes || bytes.byteLength !== expectedBytes) {
        return providerError(
          "youtube_video_range",
          "The YouTube video segment did not contain the expected bytes.",
          { expectedBytes, receivedBytes: bytes?.byteLength ?? null, offset },
          "retryable",
        );
      }

      let uploadResponse: Response;
      try {
        uploadResponse = await input.fetcher(uploadUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Length": String(bytes.byteLength),
            "Content-Type": mimeType,
            "Content-Range": `bytes ${offset}-${end}/${byteLength}`,
          },
          body: copyBytesToArrayBuffer(bytes),
        });
      } catch {
        const status = await checkYouTubeUploadStatus(input, uploadUrl, byteLength);
        if (status.kind === "failed") return status.result;
        providerResponses.push(status.providerResponse);
        if (status.kind === "complete") {
          videoId = status.videoId;
          break;
        }
        offset = status.offset;
        continue;
      }
      const uploaded = await readJson<YouTubeApiBody>(uploadResponse);
      providerResponses.push(uploaded);
      if (uploadResponse.status === 308) {
        const resumedOffset = youtubeResumeOffset(uploadResponse);
        offset = resumedOffset > offset ? resumedOffset : end + 1;
        continue;
      }
      if (uploadResponse.ok) {
        if (!uploaded.id) {
          return providerError(
            "youtube_upload_outcome_unknown",
            "YouTube accepted the video without returning its id. Check YouTube Studio before trying again.",
            uploaded,
            "outcome_unknown",
          );
        }
        videoId = uploaded.id;
        break;
      }
      if (uploadResponse.status >= 500) {
        const status = await checkYouTubeUploadStatus(input, uploadUrl, byteLength);
        if (status.kind === "failed") return status.result;
        providerResponses.push(status.providerResponse);
        if (status.kind === "complete") {
          videoId = status.videoId;
          break;
        }
        offset = status.offset;
        continue;
      }
      return providerError(
        "youtube_upload",
        youtubeErrorMessage(
          uploaded,
          `YouTube could not upload the video (${uploadResponse.status}).`,
        ),
        uploaded,
        youtubeFailureClass(uploadResponse.status, uploaded),
      );
    }

    if (!videoId) {
      return providerError(
        "youtube_upload_outcome_unknown",
        "YouTube did not confirm the video's id. Check YouTube Studio before trying again.",
        providerResponses,
        "outcome_unknown",
      );
    }

    let processing: YouTubeApiBody | null = null;
    try {
      const statusUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      statusUrl.searchParams.set("part", "status,processingDetails");
      statusUrl.searchParams.set("id", videoId);
      const statusResponse = await input.fetcher(statusUrl, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });
      processing = await readJson<YouTubeApiBody>(statusResponse);
    } catch {
      processing = null;
    }

    return {
      ok: true,
      platformPostId: videoId,
      platformPostUrl: `https://studio.youtube.com/video/${videoId}/edit`,
      providerResponse: {
        privacyStatus: publishingSettings.privacyStatus,
        madeForKids: publishingSettings.madeForKids,
        containsSyntheticMedia: publishingSettings.containsSyntheticMedia,
        upload: providerResponses,
        processing,
      },
    };
  },
};

function createInstagramAdapter(platform: "instagram" | "instagram_business"): SocialPublishAdapter {
  return {
    validateDraft: validateInstagramDraft,
    publish: (input) => publishInstagram(platform, input),
  };
}

function validateInstagramDraft(input: {
  bodyText: string;
  assets: SocialMediaAsset[];
}): { ok: true } | { ok: false; error: string } {
  const body = input.bodyText.trim();
  const videos = input.assets.filter((asset) => asset.kind === "video");
  const images = input.assets.filter((asset) => asset.kind !== "video");
  if (!body) return { ok: false, error: "This Instagram draft is empty." };
  if (body.length > INSTAGRAM_MAX_CHARS) {
    return {
      ok: false,
      error: `This Instagram draft is too long (max ${INSTAGRAM_MAX_CHARS} characters).`,
    };
  }
  if (input.assets.length === 0) {
    return { ok: false, error: "Instagram publishing needs an image or video." };
  }
  if (input.assets.some((asset) => !asset.url?.trim())) {
    return { ok: false, error: "Every Instagram media item needs a delivery URL." };
  }
  if (videos.length > 0 && (videos.length !== 1 || images.length > 0)) {
    return { ok: false, error: "An Instagram Reel must contain one video and no images." };
  }
  if (videos.length === 1) {
    const mimeType = normalizeMimeType(videos[0]?.mimeType);
    if (!mimeType || !INSTAGRAM_VIDEO_MIME_TYPES.has(mimeType)) {
      return { ok: false, error: "Instagram Reels support MP4 and QuickTime video uploads." };
    }
    if ((videos[0]?.byteLength || 0) > INSTAGRAM_VIDEO_MAX_BYTES) {
      return { ok: false, error: "The Instagram Reel is larger than 1 GB." };
    }
  }
  if (images.length > INSTAGRAM_CAROUSEL_MAX_ITEMS) {
    return {
      ok: false,
      error: `Instagram carousels support up to ${INSTAGRAM_CAROUSEL_MAX_ITEMS} images.`,
    };
  }
  return { ok: true };
}

async function publishInstagram(
  platform: "instagram" | "instagram_business",
  input: Parameters<SocialPublishAdapter["publish"]>[0],
): Promise<SocialPublishAdapterResult> {
  const origin = platform === "instagram"
    ? `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}`
    : `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}`;
  const videos = input.assets.filter((asset) => asset.kind === "video");
  const images = input.assets.filter((asset) => asset.kind !== "video");
  const created: unknown[] = [];
  let creationId: string;

  if (videos.length === 1) {
    const reel = await createInstagramMediaContainer(origin, input, {
      media_type: "REELS",
      video_url: videos[0]!.url,
      caption: input.bodyText,
      share_to_feed: "true",
    });
    if (!reel.ok) return reel.result;
    creationId = reel.id;
    created.push(reel.response);
    const ready = await waitForInstagramContainer(origin, input, creationId);
    if (!ready.ok) return ready.result;
  } else if (images.length > 1) {
    const children: string[] = [];
    for (const image of images) {
      const child = await createInstagramMediaContainer(origin, input, {
        image_url: image.url,
        is_carousel_item: "true",
      });
      if (!child.ok) return child.result;
      children.push(child.id);
      created.push(child.response);
      const childReady = await waitForInstagramContainer(origin, input, child.id);
      if (!childReady.ok) return childReady.result;
    }
    const carousel = await createInstagramMediaContainer(origin, input, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: input.bodyText,
    });
    if (!carousel.ok) return carousel.result;
    creationId = carousel.id;
    created.push(carousel.response);
    const ready = await waitForInstagramContainer(origin, input, creationId);
    if (!ready.ok) return ready.result;
  } else {
    const image = images[0];
    if (!image) return providerError("instagram_missing_media", "Instagram publishing needs media.");
    const single = await createInstagramMediaContainer(origin, input, {
      image_url: image.url,
      caption: input.bodyText,
    });
    if (!single.ok) return single.result;
    creationId = single.id;
    created.push(single.response);
    const ready = await waitForInstagramContainer(origin, input, creationId);
    if (!ready.ok) return ready.result;
  }

  let publishResponse: Response;
  await input.markProviderWriteStarted?.();
  try {
    publishResponse = await input.fetcher(
      `${origin}/${encodeURIComponent(input.accountId)}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: creationId,
          access_token: input.accessToken,
        }),
      },
    );
  } catch (error) {
    return providerError(
      "instagram_outcome_unknown",
      "Instagram did not confirm whether the post was published. Check Instagram before trying again.",
      { message: error instanceof Error ? error.message : String(error), created },
      "outcome_unknown",
    );
  }
  const publishJson = await readJson<{ id?: string; error?: { message?: string } }>(publishResponse);
  if (!publishResponse.ok) {
    return providerError(
      "instagram_media_publish",
      publishJson.error?.message || `Instagram publish failed (${publishResponse.status}).`,
      { created, publish: publishJson },
      failureClassForStatus(publishResponse.status),
    );
  }
  if (!publishJson.id) {
    return providerError(
      "instagram_missing_post_id",
      "Instagram accepted the publish request but did not return a post id. Check Instagram before trying again.",
      { created, publish: publishJson },
      "outcome_unknown",
    );
  }
  return {
    ok: true,
    platformPostId: publishJson.id,
    providerResponse: { created, publish: publishJson },
  };
}

async function createInstagramMediaContainer(
  origin: string,
  input: Parameters<SocialPublishAdapter["publish"]>[0],
  parameters: Record<string, string>,
): Promise<
  | { ok: true; id: string; response: unknown }
  | { ok: false; result: SocialPublishAdapterResult }
> {
  let response: Response;
  try {
    response = await input.fetcher(
      `${origin}/${encodeURIComponent(input.accountId)}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...parameters, access_token: input.accessToken }),
      },
    );
  } catch (error) {
    return {
      ok: false,
      result: providerError(
        "instagram_media_create",
        "Instagram did not finish preparing the media. ME3 can safely try again.",
        { message: error instanceof Error ? error.message : String(error) },
        "retryable",
      ),
    };
  }
  const json = await readJson<{ id?: string; error?: { message?: string } }>(response);
  if (!response.ok || !json.id) {
    return {
      ok: false,
      result: providerError(
        "instagram_media_create",
        json.error?.message || `Instagram media creation failed (${response.status}).`,
        json,
        failureClassForStatus(response.status),
      ),
    };
  }
  return { ok: true, id: json.id, response: json };
}

async function waitForInstagramContainer(
  origin: string,
  input: Parameters<SocialPublishAdapter["publish"]>[0],
  containerId: string,
): Promise<{ ok: true } | { ok: false; result: SocialPublishAdapterResult }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
    let response: Response;
    try {
      response = await input.fetcher(
        `${origin}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(input.accessToken)}`,
      );
    } catch (error) {
      return {
        ok: false,
        result: providerError(
          "instagram_media_status",
          "Instagram media processing could not be checked. ME3 can safely try again.",
          { message: error instanceof Error ? error.message : String(error) },
          "retryable",
        ),
      };
    }
    const json = await readJson<{
      status_code?: string;
      status?: string;
      error?: { message?: string };
    }>(response);
    if (!response.ok) {
      return {
        ok: false,
        result: providerError(
          "instagram_media_status",
          json.error?.message || `Instagram media status failed (${response.status}).`,
          json,
          failureClassForStatus(response.status),
        ),
      };
    }
    if (json.status_code === "FINISHED" || json.status_code === "PUBLISHED") return { ok: true };
    if (json.status_code === "ERROR" || json.status_code === "EXPIRED") {
      return {
        ok: false,
        result: providerError(
          "instagram_media_processing",
          json.status || "Instagram could not process the attached media.",
          json,
          "rejected",
        ),
      };
    }
  }
  return {
    ok: false,
    result: providerError(
      "instagram_media_processing_timeout",
      "Instagram is still processing the media. ME3 can safely try again.",
      undefined,
      "retryable",
    ),
  };
}

const facebookAdapter: SocialPublishAdapter = {
  validateDraft: validateFacebookDraft,
  publish: publishFacebookPage,
};

function validateFacebookDraft(input: {
  bodyText: string;
  assets: SocialMediaAsset[];
}): { ok: true } | { ok: false; error: string } {
  const body = input.bodyText.trim();
  if (!body && input.assets.length === 0) return { ok: false, error: "This Facebook post is empty." };
  if (characterLength(body) > FACEBOOK_MAX_CHARS) {
    return { ok: false, error: `This Facebook post is too long (max ${FACEBOOK_MAX_CHARS} characters).` };
  }
  if (input.assets.some((asset) => asset.kind === "video")) {
    return { ok: false, error: "Facebook posts from ME3 support images, not video." };
  }
  if (input.assets.length > FACEBOOK_IMAGE_COUNT_LIMIT) {
    return { ok: false, error: `Facebook posts from ME3 support up to ${FACEBOOK_IMAGE_COUNT_LIMIT} images.` };
  }
  if (input.assets.some((asset) => !asset.url?.trim())) {
    return { ok: false, error: "Every Facebook image needs a delivery URL." };
  }
  for (const asset of input.assets) {
    const mimeType = normalizeMimeType(asset.mimeType);
    if (mimeType && !FACEBOOK_IMAGE_MIME_TYPES.has(mimeType)) {
      return { ok: false, error: "Facebook images must be JPEG, PNG, GIF or WebP." };
    }
  }
  return { ok: true };
}

type FacebookGraphBody = { id?: string; post_id?: string; error?: { message?: string; code?: number } };

function facebookFailureClass(status: number, body: FacebookGraphBody): SocialPublishFailureClass {
  // 190: token expired or revoked; 200-299: a permission was removed.
  const code = body.error?.code;
  if (code === 190 || (typeof code === "number" && code >= 200 && code < 300)) return "reconnect_required";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "retryable";
  return failureClassForStatus(status);
}

function facebookPostUrl(postId: string): string {
  return `https://www.facebook.com/${encodeURIComponent(postId)}`;
}

function firstLink(body: string): string | null {
  const match = body.match(/https?:\/\/[^\s<>"]+/i);
  return match ? match[0].replace(/[.,;:!?)\]]+$/, "") : null;
}

async function facebookGraphPost(
  input: Parameters<SocialPublishAdapter["publish"]>[0],
  path: string,
  parameters: Record<string, string>,
): Promise<{ ok: true; body: FacebookGraphBody } | { ok: false; status: number; body: FacebookGraphBody; error: unknown }> {
  try {
    const response = await input.fetcher(
      `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...parameters, access_token: input.accessToken }),
      },
    );
    const body = await readJson<FacebookGraphBody>(response);
    return response.ok ? { ok: true, body } : { ok: false, status: response.status, body, error: null };
  } catch (error) {
    return { ok: false, status: 0, body: {}, error };
  }
}

async function publishFacebookPage(
  input: Parameters<SocialPublishAdapter["publish"]>[0],
): Promise<SocialPublishAdapterResult> {
  const pageId = encodeURIComponent(input.accountId);
  const images = input.assets.filter((asset) => asset.kind !== "video");
  const message = input.bodyText.trim();

  if (images.length === 1) {
    const image = images[0]!;
    await input.markProviderWriteStarted?.();
    const photo = await facebookGraphPost(input, `${pageId}/photos`, {
      url: image.url,
      ...(message ? { caption: message } : {}),
      ...(image.altText?.trim() ? { alt_text_custom: image.altText.trim() } : {}),
    });
    if (!photo.ok) {
      if (photo.status === 0) {
        return providerError(
          "facebook_outcome_unknown",
          "Facebook did not confirm whether the post was published. Check your Page before trying again.",
          { message: describeFetchError(photo.error).message },
          "outcome_unknown",
        );
      }
      return providerError(
        "facebook_photo",
        photo.body.error?.message || `Facebook photo post failed (${photo.status}).`,
        photo.body,
        facebookFailureClass(photo.status, photo.body),
      );
    }
    const postId = photo.body.post_id || photo.body.id;
    if (!postId) {
      return providerError(
        "facebook_missing_post_id",
        "Facebook accepted the post but did not return its id. Check your Page before trying again.",
        photo.body,
        "outcome_unknown",
      );
    }
    return { ok: true, platformPostId: postId, platformPostUrl: facebookPostUrl(postId), providerResponse: photo.body };
  }

  // Several images upload unpublished first, then publish together as one Page post.
  const attached: string[] = [];
  const uploads: unknown[] = [];
  for (const image of images) {
    const upload = await facebookGraphPost(input, `${pageId}/photos`, {
      url: image.url,
      published: "false",
      ...(image.altText?.trim() ? { alt_text_custom: image.altText.trim() } : {}),
    });
    if (!upload.ok || !upload.body.id) {
      const status = upload.ok ? 502 : upload.status;
      return providerError(
        "facebook_photo_upload",
        upload.body.error?.message || "Facebook could not prepare an image. ME3 can safely try again.",
        { uploads, failed: upload.body },
        status === 0 ? "retryable" : facebookFailureClass(status, upload.body),
      );
    }
    attached.push(upload.body.id);
    uploads.push(upload.body);
  }

  const link = attached.length === 0 ? firstLink(message) : null;
  const feedParameters: Record<string, string> = {
    ...(message ? { message } : {}),
    ...(link ? { link } : {}),
  };
  attached.forEach((id, index) => {
    feedParameters[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
  });
  await input.markProviderWriteStarted?.();
  const feed = await facebookGraphPost(input, `${pageId}/feed`, feedParameters);
  if (!feed.ok) {
    if (feed.status === 0) {
      return providerError(
        "facebook_outcome_unknown",
        "Facebook did not confirm whether the post was published. Check your Page before trying again.",
        { message: describeFetchError(feed.error).message, uploads },
        "outcome_unknown",
      );
    }
    return providerError(
      "facebook_feed",
      feed.body.error?.message || `Facebook post failed (${feed.status}).`,
      { uploads, feed: feed.body },
      facebookFailureClass(feed.status, feed.body),
    );
  }
  if (!feed.body.id) {
    return providerError(
      "facebook_missing_post_id",
      "Facebook accepted the post but did not return its id. Check your Page before trying again.",
      { uploads, feed: feed.body },
      "outcome_unknown",
    );
  }
  return {
    ok: true,
    platformPostId: feed.body.id,
    platformPostUrl: facebookPostUrl(feed.body.id),
    providerResponse: { uploads, feed: feed.body },
  };
}
