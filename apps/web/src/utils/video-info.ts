import type { ComposerVideoInfo } from "@me3-core/plugin-social-publishing/composer";

const UNKNOWN: ComposerVideoInfo = { durationSeconds: null, width: null, height: null };

/**
 * A video's length and shape, read from its metadata in the browser (me3-ic0c).
 * Anything the browser can't read (an unsupported codec, a slow file) comes back as
 * nulls, so New post makes no length claims and blocks nothing.
 */
export function readVideoInfo(src: string, timeoutMs = 10_000): Promise<ComposerVideoInfo> {
  if (typeof document === "undefined") return Promise.resolve(UNKNOWN);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (info: ComposerVideoInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(info);
    };
    const timer = setTimeout(() => finish(UNKNOWN), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.addEventListener("loadedmetadata", () => {
      const duration = Number(video.duration);
      finish({
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    });
    video.addEventListener("error", () => finish(UNKNOWN));
    video.src = src;
  });
}
