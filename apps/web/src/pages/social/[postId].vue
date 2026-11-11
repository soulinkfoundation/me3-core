<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { API_BASE } from "../../api";
import Button from "../../components/Button.vue";
import ConfirmationDialog from "../../components/ConfirmationDialog.vue";
import PageLoading from "../../components/PageLoading.vue";
import UiIcon from "../../components/UiIcon.vue";
import AppPageBar from "../../components/AppPageBar.vue";
import FilesMediaPicker from "../../components/files/FilesMediaPicker.vue";
import SocialVideoEditor from "../../components/social/SocialVideoEditor.vue";
import SocialAltTextDialog from "../../components/social/SocialAltTextDialog.vue";
import SocialImageTiles from "../../components/social/SocialImageTiles.vue";
import SocialPostPreview from "../../components/social/SocialPostPreview.vue";
import SocialImageCropper from "../../components/social/SocialImageCropper.vue";
import SocialAccountsSheet from "../../components/social/SocialAccountsSheet.vue";
import SocialMarks from "../../components/social/SocialMarks.vue";
import SocialTextCarouselEditor from "../../components/social/SocialTextCarouselEditor.vue";
import { useSitesStore } from "../../stores/sites";
import { useAppToast } from "../../composables/useAppToast";
import { useSocialData } from "../../composables/useSocialData";
import type { DriveFile, PostVersion, SocialMediaAsset, SocialPlatform, SocialPostDetail, SocialPostOptions, TextCarousel } from "../../stores/social";
import { uploadDriveFiles } from "../../utils/drive-upload";
import { convertVideo, planVideo, prepareImage, trimVideo } from "../../utils/media-prep";
import {
  accountName,
  activeAccount,
  formatShortWhen,
  foldFor,
  foldIndex,
  formatWhen,
  networkLabel,
  postTitle,
  resultFor,
  SOCIAL_NETWORKS,
  socialNetwork,
  suggestedTime,
  versionChecks,
  documentRule,
  isImageAsset,
  mentionsIn,
  renderPostText,
  moveLinkOut,
  takesCoverFrame,
  takesFirstComment,
  isThread,
  splitIntoThread,
  THREAD_JOIN,
  threadParts,
  mixedMediaRule,
  takesImages,
  versionTextLimit,
  videoRule,
  visibleVersions,
  YOUTUBE_TITLE_LIMIT,
  youtubeTitleFrom,
  type SocialNetwork,
  type VersionResult,
} from "../../utils/social-posts";
import { resolveLocalDateTimeToUtc } from "../../utils/timezone";

definePage({
  meta: {
    requiresAuth: true,
    title: "Post | ME3",
    description: "Review a social post for each platform, then schedule or post it.",
    robots: "noindex,follow",
  },
});

const route = useRoute();
const router = useRouter();
const { toastError, toastSuccess, toastFromUnknown } = useAppToast();
const data = useSocialData();
const { social, accounts, capabilities, siteId, hostedPlatforms } = data;

const postId = computed(() => String((route.params as { postId?: string }).postId || ""));
const detail = ref<SocialPostDetail | null>(null);
const missing = ref(false);
const activeId = ref<string>("");
const texts = ref<Record<string, string>>({});
const savingIds = ref(new Set<string>());
const busy = ref<"schedule" | "post" | "move" | "cancel" | "delete" | "upload" | "add" | "remove" | "duplicate" | "shorten" | null>(null);
const accountsOpen = ref(false);
const confirmDelete = ref(false);
const confirmCancel = ref(false);
const confirmRemove = ref<PostVersion | null>(null);
const editor = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);
const documentInput = ref<HTMLInputElement | null>(null);
const filesPickerOpen = ref(false);
const slidesOpen = ref(false);
const textCarousel = ref<TextCarousel | null>(null);
const sitesStore = useSitesStore();
const cropIndex = ref<number | null>(null);
const altIndex = ref<number | null>(null);
const editingVideo = ref<SocialMediaAsset | null>(null);
const trimProgress = ref<number | null>(null);
const altAsset = computed(() => (altIndex.value === null ? null : activeTiles.value[altIndex.value] || null));
const cropAsset = computed(() => (cropIndex.value === null ? null : activeTiles.value[cropIndex.value] || null));
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const when = ref(localParts(suggestedTime()));
const saveChains = new Map<string, Promise<unknown>>();
const saveTimers = new Map<string, number>();
let postingPoll: number | undefined;

const IN_FLIGHT = new Set(["scheduled", "queued", "publishing"]);

const versions = computed(() => (detail.value ? visibleVersions(detail.value) : []));
const active = computed(() => versions.value.find((version) => version.id === activeId.value) || versions.value[0] || null);
const title = computed(() => (detail.value ? postTitle(detail.value) : "Post"));
const pending = computed(() =>
  versions.value.filter((version) => !IN_FLIGHT.has(version.publicationStatus || "") && version.publicationStatus !== "published"),
);
const scheduledVersions = computed(() => versions.value.filter((version) => version.publicationStatus === "scheduled"));
function firstBlocker(version: PostVersion): string | null {
  return versionChecks(withText(version), capabilities.value, accounts.value).find((check) => check.blocking)?.message || null;
}
/** Platforms with a problem are skipped; the rest still post or schedule. */
const blockers = computed(() =>
  pending.value.flatMap((version) => {
    const reason = firstBlocker(version);
    return reason ? [{ version, reason }] : [];
  }),
);
const ready = computed(() => pending.value.filter((version) => !blockers.value.some((item) => item.version.id === version.id)));
const schedulable = computed(() =>
  ready.value.filter((version) => capabilities.value.find((item) => item.platform === version.platform)?.schedule !== false),
);
const skippedLabel = computed(() =>
  blockers.value.map(({ version, reason }) => `${networkLabel(version.platform)} (${reason.replace(/\.$/, "")})`).join(", "),
);
const removable = computed(() =>
  Boolean(active.value && versions.value.length > 1 && !active.value.publicationStatus),
);
const scheduledIso = computed(() => {
  const resolved = resolveLocalDateTimeToUtc(when.value.date, when.value.time, timezone);
  return resolved.ok ? resolved.value : null;
});
const scheduleInPast = computed(() => Boolean(scheduledIso.value && Date.parse(scheduledIso.value) < Date.now() + 60_000));
/** When the chosen time has passed or is minutes away, posting now is the obvious step. */
const postNowFirst = computed(() =>
  !schedulable.value.length || !scheduledIso.value || Date.parse(scheduledIso.value) < Date.now() + 15 * 60_000,
);
const timezoneLabel = computed(() => {
  try {
    const date = scheduledIso.value ? new Date(scheduledIso.value) : new Date();
    return new Intl.DateTimeFormat(undefined, { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value || timezone;
  } catch {
    return timezone;
  }
});
const scheduleLabel = computed(() => {
  const count = schedulable.value.length;
  const at = scheduledIso.value ? ` for ${formatShortWhen(scheduledIso.value)}` : "";
  return `Schedule ${count} post${count === 1 ? "" : "s"}${at}`;
});
const postNowLabel = computed(() => {
  const count = ready.value.length;
  return count > 1 ? `Post to ${count} platforms now` : "Post now";
});
const results = computed(() =>
  versions.value
    .map((version) => ({ version, result: resultFor(version) }))
    .filter(({ result }) => result.state !== "draft"),
);
const activeChecks = computed(() => (active.value ? versionChecks(withText(active.value), capabilities.value, accounts.value) : []));
const activeImages = computed(() => (active.value?.assetManifest || []).filter(isImageAsset));
const activeVideo = computed(() => (active.value?.assetManifest || []).find((asset) => asset.kind === "video") || null);
const activeDocument = computed(() => (active.value?.assetManifest || []).find((asset) => asset.kind === "document") || null);
/** Instagram mixes photos and videos in one carousel; elsewhere a video stands alone. */
const activeMixed = computed(() => Boolean(active.value && mixedMediaRule(active.value.platform, capabilities.value)));
const activeDocRule = computed(() => (active.value ? documentRule(active.value.platform, capabilities.value) : null));
/** The ordered tiles: photos, plus videos where they mix. */
const activeTiles = computed(() =>
  activeMixed.value ? (active.value?.assetManifest || []).filter((asset) => asset.kind !== "document") : activeImages.value,
);
/** Connected platforms this post doesn't go to yet, so the owner can add one. */
const addableNetworks = computed(() =>
  SOCIAL_NETWORKS.filter(
    (network) =>
      activeAccount(network.id, accounts.value) &&
      !versions.value.some((version) => socialNetwork(version.platform) === network.id),
  ),
);
const activeVideoRule = computed(() => (active.value ? videoRule(active.value.platform, capabilities.value) : null));
const activeTakesImages = computed(() => Boolean(active.value && takesImages(active.value.platform, capabilities.value)));
const activeVideoLabel = computed(() => {
  if (activeMixed.value) return "Add a video";
  if (activeVideo.value) return "Replace video";
  if (activeImages.value.length) return "Use a video instead";
  return activeTakesImages.value ? "Add a video" : "Add your video";
});
const pickerKinds = computed(() => {
  const kinds: Array<"image" | "video"> = [];
  if (activeTakesImages.value) kinds.push("image");
  if (activeVideoRule.value) kinds.push("video");
  return kinds.length ? kinds : (["image"] as Array<"image" | "video">);
});
const pickerTitle = computed(() =>
  pickerKinds.value.length === 2 ? "Choose photos or a video" : pickerKinds.value[0] === "video" ? "Choose a video" : "Choose photos",
);
const activeLimit = computed(() => (active.value ? versionTextLimit(active.value, capabilities.value) : null));
const activeText = computed(() => (active.value ? texts.value[active.value.id] ?? active.value.bodyText : ""));
const activeFold = computed(() => (active.value ? foldIndex(active.value.platform, activeText.value) : null));
const activeFoldRule = computed(() => (active.value ? foldFor(active.value.platform) : null));
const activeAccountRow = computed(() => (active.value ? activeAccount(active.value.platform, accounts.value) : null));
/** Text slides are 4:5 images made for Instagram carousels. */
const activeTakesSlides = computed(() =>
  Boolean(active.value && socialNetwork(active.value.platform) === "instagram" && activeTakesImages.value && !activeDocument.value && (!activeVideo.value || activeMixed.value)),
);
const siteUsername = computed(() => sitesStore.sites.find((site) => site.id === siteId.value)?.username || "");
const slidesHandle = computed(() => activeAccountRow.value?.handle || activeAccountRow.value?.displayName || siteUsername.value);
const mirror = ref<HTMLDivElement | null>(null);
function syncMirror(event: Event) {
  if (mirror.value) mirror.value.scrollTop = (event.target as HTMLTextAreaElement).scrollTop;
}
const activeThread = computed(() => (active.value && isThread(active.value) ? threadParts(activePosted.value) : null));
const shortenUndo = ref<{ id: string; text: string } | null>(null);
const commentOpen = ref(false);
const activeFirstComment = computed(() => active.value?.publishingSettings?.post?.firstComment || "");
const firstCommentLabel = computed(() => (active.value?.platform === "x" ? "First reply" : "First comment"));
const activeLinkMove = computed(() => (activeLocked.value ? null : moveLinkOut(activeText.value)));

/** Saved on the version; posted right after the post itself. */
function setFirstComment(value: string) {
  setPostOption({ firstComment: value.trim() });
}

/** Links can cut reach in the post itself, so the link moves to the first comment. */
function moveLinkToComment() {
  const version = active.value;
  const moved = activeLinkMove.value;
  if (!version || !moved) return;
  const comment = [activeFirstComment.value, moved.link].filter(Boolean).join("\n");
  void setTextNow(version, moved.text, { publishingSettings: postOptions(version, { firstComment: comment }) });
}

function postOptions(version: PostVersion, patch: SocialPostOptions) {
  const post: SocialPostOptions = { ...version.publishingSettings?.post, ...patch };
  if (!post.thread) delete post.thread;
  if (!post.firstComment?.trim()) delete post.firstComment;
  if (!post.hashtags?.trim()) delete post.hashtags;
  if (post.mentions) {
    post.mentions = Object.fromEntries(Object.entries(post.mentions).filter(([token, handle]) => handle.trim() && handle.trim() !== token));
    if (!Object.keys(post.mentions).length) delete post.mentions;
  }
  return Object.keys(post).length ? { post } : {};
}

const tagsOpen = ref(false);
const activeMentions = computed(() => mentionsIn(activeText.value));
const activeOptions = computed(() => active.value?.publishingSettings?.post || {});
/** What this platform will post: the text with its handles and hashtags. */
const activePosted = computed(() => renderPostText(activeText.value, activeOptions.value));
const tagsSummary = computed(() => {
  const swaps = Object.keys(activeOptions.value.mentions || {}).length;
  const parts = [swaps ? `${swaps} handle${swaps === 1 ? "" : "s"} swapped` : "", activeOptions.value.hashtags || ""].filter(Boolean);
  return parts.join(" · ");
});

function setPostOption(patch: SocialPostOptions) {
  const version = active.value;
  if (!version || activeLocked.value) return;
  const settings = postOptions(version, patch);
  replaceVersion({ ...version, publishingSettings: { ...version.publishingSettings, post: settings.post } });
  void saveVersion(version, { publishingSettings: settings });
}

function setMention(token: string, handle: string) {
  setPostOption({ mentions: { ...activeOptions.value.mentions, [token]: handle.trim() } });
}

/** Replaces the text now, cancelling any typing save still waiting. */
function setTextNow(version: PostVersion, text: string, extra: Parameters<typeof social.updatePostVersion>[1] = {}) {
  const timer = saveTimers.get(version.id);
  if (timer) window.clearTimeout(timer);
  saveTimers.delete(version.id);
  texts.value[version.id] = text;
  return saveVersion(version, { bodyText: text, ...extra });
}

function turnIntoThread() {
  const version = active.value;
  if (!version) return;
  const parts = splitIntoThread(activeText.value, activeLimit.value || 280);
  void setTextNow(version, parts.join(THREAD_JOIN), { publishingSettings: postOptions(version, { thread: true }) });
}

function makeOnePost() {
  const version = active.value;
  if (!version) return;
  void setTextNow(version, threadParts(activeText.value).join("\n\n"), { publishingSettings: postOptions(version, { thread: false }) });
}

async function shortenForPlatform() {
  const version = active.value;
  if (!version || busy.value) return;
  busy.value = "shorten";
  const before = activeText.value;
  try {
    const shorter = await social.shortenText(before, activeLimit.value || 280);
    await setTextNow(version, shorter);
    shortenUndo.value = { id: version.id, text: before };
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't shorten this.");
  } finally {
    busy.value = null;
  }
}

function undoShorten() {
  const version = active.value;
  if (!version || shortenUndo.value?.id !== version.id) return;
  void setTextNow(version, shortenUndo.value.text);
  shortenUndo.value = null;
}

const activeLength = computed(() => (active.value ? Array.from(activePosted.value).length : 0));
const activeAccountLabel = computed(() => {
  if (!active.value) return "";
  const account = activeAccount(active.value.platform, accounts.value);
  return account ? accountName(account) : "";
});
const activeLocked = computed(() =>
  Boolean(active.value && (active.value.publicationStatus === "published" || active.value.publicationStatus === "queued" || active.value.publicationStatus === "publishing")),
);

function localParts(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function withText(version: PostVersion): PostVersion {
  return { ...version, bodyText: texts.value[version.id] ?? version.bodyText };
}

function tabCount(version: PostVersion): string {
  const images = version.assetManifest.filter(isImageAsset).length;
  if (images > 1) return `${images} images`;
  if (isThread(version)) return `${threadParts(renderPostText(texts.value[version.id] ?? version.bodyText, version.publishingSettings?.post)).length} posts`;
  const limit = versionTextLimit(version, capabilities.value);
  const length = Array.from(renderPostText(texts.value[version.id] ?? version.bodyText, version.publishingSettings?.post)).length;
  return limit && limit < 10_000 ? `${length}/${limit}` : "";
}

function tabHasProblem(version: PostVersion): boolean {
  return versionChecks(withText(version), capabilities.value, accounts.value).some((check) => check.blocking);
}

function setDetail(next: SocialPostDetail) {
  detail.value = next;
  for (const version of visibleVersions(next)) {
    if (!saveTimers.has(version.id)) texts.value[version.id] = version.bodyText;
  }
  if (!versions.value.some((version) => version.id === activeId.value)) {
    const requested = typeof route.query.platform === "string" ? route.query.platform : "";
    activeId.value = versions.value.find((version) => version.platform === requested)?.id || versions.value[0]?.id || "";
  }
  const scheduled = versions.value.find((version) => version.publicationStatus === "scheduled" && version.scheduledFor);
  if (scheduled?.scheduledFor) when.value = localParts(new Date(scheduled.scheduledFor));
}

function replaceVersion(version: PostVersion) {
  if (!detail.value) return;
  detail.value = {
    ...detail.value,
    versions: detail.value.versions.map((item) => (item.id === version.id ? { ...item, ...version } : item)),
  };
}

async function reload() {
  const posting = new Set(versions.value.filter((version) => version.publicationStatus === "queued" || version.publicationStatus === "publishing").map((version) => version.id));
  setDetail(await social.fetchSocialPost(postId.value));
  // Say so when a platform finishes while the owner watches; its row links to the live post.
  const done = versions.value.filter((version) => posting.has(version.id) && version.publicationStatus === "published");
  if (done.length) toastSuccess(`Posted to ${done.map((version) => networkLabel(version.platform)).join(", ")}.`);
  watchPosting();
}

/** Publishing finishes in the background; check back until every platform has an outcome. */
function watchPosting() {
  window.clearTimeout(postingPoll);
  postingPoll = undefined;
  const posting = versions.value.some((version) => version.publicationStatus === "queued" || version.publicationStatus === "publishing");
  if (!posting) return;
  postingPoll = window.setTimeout(() => {
    if (!busy.value) void reload().catch(() => watchPosting());
    else watchPosting();
  }, 3000);
}

/** Saves run one after another per platform; any edit returns that platform to a draft on the server. */
function saveVersion(version: PostVersion, patch: Parameters<typeof social.updatePostVersion>[1]) {
  const previous = saveChains.get(version.id) || Promise.resolve();
  const wasScheduled = IN_FLIGHT.has(version.publicationStatus || "");
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      savingIds.value = new Set(savingIds.value).add(version.id);
      try {
        replaceVersion(await social.updatePostVersion(version.id, patch));
        if (wasScheduled) {
          await reload();
          toastSuccess(`${networkLabel(version.platform)} moved back to Drafts. Schedule it again when it's ready.`);
        }
      } catch (caught) {
        toastFromUnknown(caught, "Couldn't save that change.");
        await reload().catch(() => undefined);
      } finally {
        const ids = new Set(savingIds.value);
        ids.delete(version.id);
        savingIds.value = ids;
      }
    });
  saveChains.set(version.id, next);
  return next;
}

function onTextInput(version: PostVersion, value: string) {
  texts.value[version.id] = value;
  const timer = saveTimers.get(version.id);
  if (timer) window.clearTimeout(timer);
  saveTimers.set(
    version.id,
    window.setTimeout(() => {
      saveTimers.delete(version.id);
      void flushText(version.id);
    }, 900),
  );
}

async function flushText(versionId: string) {
  const timer = saveTimers.get(versionId);
  if (timer) {
    window.clearTimeout(timer);
    saveTimers.delete(versionId);
  }
  const version = versions.value.find((item) => item.id === versionId);
  const text = texts.value[versionId];
  if (!version || text === undefined || text === version.bodyText) return saveChains.get(versionId);
  return saveVersion(version, { bodyText: text });
}

async function flushAll() {
  await Promise.all(versions.value.map((version) => flushText(version.id)));
  await Promise.all([...saveChains.values()].map((chain) => chain.catch(() => undefined)));
}

async function useTextEverywhere() {
  const source = active.value;
  if (!source) return;
  const text = texts.value[source.id] ?? source.bodyText;
  for (const version of pending.value) {
    if (version.id === source.id || (texts.value[version.id] ?? version.bodyText) === text) continue;
    texts.value[version.id] = text;
    void saveVersion(version, { bodyText: text });
  }
}

async function useImagesEverywhere() {
  const source = active.value;
  if (!source) return;
  for (const version of pending.value) {
    if (version.id === source.id || version.platform === "youtube") continue;
    void saveVersion(version, { assetManifest: source.assetManifest.map((asset, index) => ({ ...asset, assetIndex: index })) });
  }
}

function setImages(images: SocialMediaAsset[]) {
  const version = active.value;
  if (!version) return;
  const videos = version.assetManifest.filter((asset) => asset.kind === "video");
  const next = [...images, ...videos].map((asset, index) => ({ ...asset, assetIndex: index }));
  replaceVersion({ ...version, assetManifest: next });
  void saveVersion(version, { assetManifest: next });
}

/** Saves the tiles in order: as the whole post where media mix, otherwise as its photos. */
function setTiles(tiles: SocialMediaAsset[]) {
  const version = active.value;
  if (!version) return;
  if (!activeMixed.value) return setImages(tiles);
  const next = tiles.map((asset, index) => ({ ...asset, assetIndex: index }));
  replaceVersion({ ...version, assetManifest: next });
  void saveVersion(version, { assetManifest: next });
}

function removeImage(index: number) {
  setTiles(activeTiles.value.filter((_, position) => position !== index));
}

async function addDocument(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = Array.from(input.files || []).find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
  input.value = "";
  const version = active.value;
  if (!file || !version || busy.value) return;
  busy.value = "upload";
  try {
    const [uploaded] = await uploadDriveFiles<DriveFile>([file], { folderId: null, onConflict: "rename" });
    if (!uploaded) throw new Error("The PDF didn't upload.");
    // A document post is that one PDF.
    const document = { ...driveAsset(uploaded, "document"), mimeType: "application/pdf", assetIndex: 0 };
    replaceVersion({ ...version, assetManifest: [document] });
    await saveVersion(version, { assetManifest: [document] });
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't add that PDF.");
  } finally {
    busy.value = null;
  }
}

function removeDocument() {
  const version = active.value;
  if (!version) return;
  const next = version.assetManifest.filter((asset) => asset.kind !== "document");
  replaceVersion({ ...version, assetManifest: next });
  void saveVersion(version, { assetManifest: next });
}

function sameImage(a: SocialMediaAsset, b: SocialMediaAsset): boolean {
  return a.fileId ? a.fileId === b.fileId : a.url === b.url;
}

/** Alt text describes the image, so it follows that image onto every platform still in Drafts. */
function saveAltText(altText: string) {
  const target = altAsset.value;
  const current = active.value;
  altIndex.value = null;
  if (!target || !current) return;
  for (const version of [current, ...pending.value.filter((item) => item.id !== current.id)]) {
    if (!version.assetManifest.some((asset) => sameImage(asset, target))) continue;
    const next = version.assetManifest.map((asset) => (sameImage(asset, target) ? { ...asset, altText } : asset));
    replaceVersion({ ...version, assetManifest: next });
    void saveVersion(version, { assetManifest: next });
  }
}

function editVideoAt(video: SocialMediaAsset | null) {
  editingVideo.value = video;
}

/** A trim saves a new MP4 to Files and takes the old video's place; a cover is just saved on the video. */
async function saveVideoEdit(change: { file: File | null; range: { start: number; end: number } | null; coverTimeMs: number | null }) {
  const version = active.value;
  const original = editingVideo.value;
  if (!version || !original || busy.value) return;
  busy.value = "upload";
  try {
    let next: SocialMediaAsset = { ...original };
    if (change.file && change.range) {
      trimProgress.value = 0;
      const trimmed = await trimVideo(change.file, change.range, (fraction) => (trimProgress.value = fraction));
      const [uploaded] = await uploadDriveFiles<DriveFile>([trimmed], { folderId: null, onConflict: "rename" });
      if (!uploaded) throw new Error("The trimmed video didn't upload.");
      next = { ...driveAsset(uploaded, "video"), assetIndex: original.assetIndex };
    }
    if (change.coverTimeMs === null) delete next.coverTimeMs;
    else next.coverTimeMs = change.coverTimeMs;
    const manifest = version.assetManifest.map((asset) => (asset === original || sameImage(asset, original) && asset.kind === "video" ? next : asset));
    replaceVersion({ ...version, assetManifest: manifest });
    await saveVersion(version, { assetManifest: manifest });
    editingVideo.value = null;
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't save that video.");
  } finally {
    trimProgress.value = null;
    busy.value = null;
  }
}

/** The cropped copy is saved to Files and takes the original's place in the post. */
async function saveCrop(file: File) {
  const index = cropIndex.value;
  const original = cropAsset.value;
  if (index === null || !original || busy.value) return;
  busy.value = "upload";
  try {
    const [uploaded] = await uploadDriveFiles<DriveFile>([file], { folderId: null, onConflict: "rename" });
    if (!uploaded) throw new Error("The cropped image didn't save.");
    const tiles = [...activeTiles.value];
    tiles[index] = { ...driveAsset(uploaded, "image"), altText: original.altText || "" };
    setTiles(tiles);
    cropIndex.value = null;
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't save the crop.");
  } finally {
    busy.value = null;
  }
}

function driveAsset(file: DriveFile, kind: "image" | "video" | "document"): SocialMediaAsset {
  return {
    url: `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(file.id)}/content`,
    fileId: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    kind,
    altText: "",
    contentHash: file.sha256 ? `sha256:${file.sha256.toLowerCase()}` : undefined,
    byteLength: file.size,
    ...(kind === "video" ? { assetIndex: 0 } : {}),
  };
}

/** The slide JPEGs replace the ones last added from the editor, in place; otherwise they go at the end. */
function addSlideImages(files: DriveFile[], replaced: string[]) {
  const tiles = activeTiles.value;
  const old = new Set(replaced);
  const at = tiles.findIndex((asset) => asset.fileId && old.has(asset.fileId));
  const kept = tiles.filter((asset) => !(asset.fileId && old.has(asset.fileId)));
  const added = files.map((file) => driveAsset(file, "image"));
  const next = at === -1 ? [...kept, ...added] : [...kept.slice(0, at), ...added, ...kept.slice(at)];
  setTiles(next);
  textCarousel.value = textCarousel.value ? { ...textCarousel.value, fileIds: files.map((file) => file.id) } : null;
  slidesOpen.value = false;
  void social.fetchTextCarousel(postId.value).then((carousel) => {
    textCarousel.value = carousel;
  }).catch(() => undefined);
  toastSuccess(`Added ${files.length} slide${files.length === 1 ? "" : "s"} to the post.`);
}

/** Photos or a video the owner picked from Files; nothing re-uploads. */
async function addFromFiles(files: DriveFile[]) {
  const version = active.value;
  if (!version || !files.length) return;
  if (activeMixed.value) {
    const have = new Set(activeTiles.value.map((asset) => asset.fileId));
    const added = files.filter((file) => !have.has(file.id)).map((file) => driveAsset(file, file.mimeType?.startsWith("video/") ? "video" : "image"));
    setTiles([...activeTiles.value, ...added]);
    return;
  }
  const video = activeVideoRule.value ? files.find((file) => file.mimeType?.startsWith("video/")) : undefined;
  if (video || !activeTakesImages.value) {
    await setVideo(version, driveAsset(video || files[0]!, "video"));
    return;
  }
  const have = new Set(activeImages.value.map((asset) => asset.fileId));
  setImages([...activeImages.value, ...files.filter((file) => !have.has(file.id)).map((file) => driveAsset(file, "image"))]);
}

async function addImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []).filter((file) => file.type.startsWith("image/"));
  input.value = "";
  await uploadImages(files);
}

async function uploadImages(files: File[]) {
  if (!files.length || !active.value || busy.value) return;
  busy.value = "upload";
  try {
    // HEIC and oversized photos become JPEGs every platform takes.
    const prepared = await Promise.all(files.map(prepareImage));
    const uploaded = await uploadDriveFiles<DriveFile>(prepared, { folderId: null, onConflict: "rename" });
    setTiles([...activeTiles.value, ...uploaded.map((file) => driveAsset(file, "image"))]);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't add those images.");
  } finally {
    busy.value = null;
  }
}

async function addPlatform(network: SocialNetwork) {
  if (busy.value || !detail.value) return;
  const account = activeAccount(network, accounts.value);
  if (!account) return;
  busy.value = "add";
  try {
    await flushAll();
    const text = active.value ? texts.value[active.value.id] ?? active.value.bodyText : "";
    const next = await social.addPostVersion(detail.value.post.id, {
      platform: account.platform as SocialPlatform,
      targetAccountId: account.id,
      bodyText: text,
      ...(network === "youtube" ? { format: "short_video" as const, title: youtubeTitleFrom(text) } : {}),
    });
    setDetail(next);
    activeId.value = visibleVersions(next).find((version) => socialNetwork(version.platform) === network)?.id || activeId.value;
  } catch (caught) {
    toastFromUnknown(caught, `Couldn't add ${networkLabel(network)}.`);
  } finally {
    busy.value = null;
  }
}

async function removePlatform() {
  const version = confirmRemove.value;
  if (!version || busy.value) return;
  busy.value = "remove";
  try {
    await flushText(version.id);
    await saveChains.get(version.id)?.catch(() => undefined);
    // Only draft platforms can be removed; one approved by an earlier attempt goes back to draft first.
    if (version.approvalStatus !== "draft") await social.updatePostVersion(version.id, { approvalStatus: "draft" });
    const next = await social.deletePostVersion(version.id);
    confirmRemove.value = null;
    delete texts.value[version.id];
    setDetail(next);
  } catch (caught) {
    toastFromUnknown(caught, `Couldn't remove ${networkLabel(version.platform)}.`);
  } finally {
    busy.value = null;
  }
}

function setTitle(version: PostVersion, title: string) {
  replaceVersion({ ...version, title });
  void saveVersion(version, { title });
}

async function setVideo(version: PostVersion, video: SocialMediaAsset) {
  // A video joins the carousel where media mix; elsewhere a video post is that one video.
  const mixed = mixedMediaRule(version.platform, capabilities.value) !== null;
  const next = mixed
    ? [...version.assetManifest.filter((asset) => asset.kind !== "document"), video].map((asset, index) => ({ ...asset, assetIndex: index }))
    : [video];
  replaceVersion({ ...version, assetManifest: next });
  await saveVersion(version, { assetManifest: next });
}

async function addVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = Array.from(input.files || []).find((item) => item.type.startsWith("video/"));
  input.value = "";
  if (file) await uploadVideo(file);
}

const converting = ref<number | null>(null);

/** A MOV where only MP4 works, or a video over the size limit, converts in the browser first. */
async function videoFor(file: File, version: PostVersion): Promise<File> {
  const plan = planVideo(file, videoRule(version.platform, capabilities.value));
  if (!plan.convert) return file;
  converting.value = 0;
  try {
    return await convertVideo(file, { maxBytes: plan.maxBytes, onProgress: (fraction) => (converting.value = fraction) });
  } finally {
    converting.value = null;
  }
}

async function uploadVideo(file: File) {
  const version = active.value;
  if (!file || !version || busy.value) return;
  busy.value = "upload";
  try {
    const ready = await videoFor(file, version);
    const [uploaded] = await uploadDriveFiles<DriveFile>([ready], { folderId: null, onConflict: "rename" });
    if (!uploaded) throw new Error("The video didn't upload.");
    await setVideo(version, driveAsset(uploaded, "video"));
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't add that video.");
  } finally {
    busy.value = null;
  }
}

/** Converts the video already on this platform (say a MOV shared from Instagram) and swaps it in. */
async function convertAttachedVideo() {
  const version = active.value;
  const video = activeVideo.value;
  if (!version || !video || busy.value) return;
  busy.value = "upload";
  try {
    const response = await fetch(video.url, { credentials: "include" });
    if (!response.ok) throw new Error("Couldn't load the video to convert it.");
    const blob = await response.blob();
    const file = new File([blob], video.filename || "video.mov", { type: video.mimeType || blob.type });
    const ready = await videoFor(file, version);
    const [uploaded] = await uploadDriveFiles<DriveFile>([ready], { folderId: null, onConflict: "rename" });
    if (!uploaded) throw new Error("The converted video didn't upload.");
    await setVideo(version, driveAsset(uploaded, "video"));
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't convert that video.");
  } finally {
    busy.value = null;
  }
}

/** Dropped or pasted files: a video where the platform takes one, otherwise images. */
async function attachFiles(files: File[]) {
  if (!active.value || activeLocked.value || busy.value || !files.length) return;
  const video = files.find((file) => file.type.startsWith("video/"));
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (activeMixed.value && (images.length || video)) {
    if (images.length) await uploadImages(images);
    if (video) await uploadVideo(video);
    return;
  }
  if (video && activeVideoRule.value) return uploadVideo(video);
  if (images.length && activeTakesImages.value) {
    if (activeVideo.value) removeVideo();
    return uploadImages(images);
  }
  const label = networkLabel(active.value.platform);
  toastError(video ? `${label} doesn't take video here.` : images.length ? `${label} doesn't take images.` : "Drop photos or a video.");
}

const dropping = ref(false);
let dragDepth = 0;
function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}
function onDragEnter(event: DragEvent) {
  if (!hasFiles(event) || activeLocked.value) return;
  dragDepth += 1;
  dropping.value = true;
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropping.value = false;
}
function onDrop(event: DragEvent) {
  dragDepth = 0;
  dropping.value = false;
  if (!hasFiles(event)) return;
  event.preventDefault();
  void attachFiles(Array.from(event.dataTransfer?.files || []));
}
function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => /^(image|video)\//.test(file.type));
  if (!files.length) return;
  // A screenshot on the clipboard attaches; plain text pastes as usual.
  event.preventDefault();
  void attachFiles(files);
}

function removeVideo() {
  const version = active.value;
  if (!version) return;
  replaceVersion({ ...version, assetManifest: [] });
  void saveVersion(version, { assetManifest: [] });
}

async function approve(version: PostVersion): Promise<PostVersion> {
  const account = activeAccount(version.platform, accounts.value);
  return social.updatePostVersion(version.id, {
    targetAccountId: account?.id || version.targetAccountId,
    // YouTube Shorts always upload as a private draft the owner publishes in YouTube.
    ...(version.platform === "youtube"
      ? { publishingSettings: { youtube: { privacyStatus: "private", madeForKids: false, containsSyntheticMedia: false } } }
      : {}),
    approvalStatus: "approved",
  });
}

async function schedule() {
  if (busy.value || !scheduledIso.value || scheduleInPast.value || !schedulable.value.length) return;
  busy.value = "schedule";
  try {
    await flushAll();
    const targets = schedulable.value;
    const outcome = await Promise.allSettled(targets.map(async (version) => {
      await approve(version);
      await social.createPostVersionPublication(version.id, {
        scheduledFor: scheduledIso.value,
        timezone,
        requestContext: { surface: "social-review" },
      });
    }));
    await reload();
    reportFailures(outcome, targets, "couldn't be scheduled. It's still in Drafts.");
    if (outcome.every((item) => item.status === "fulfilled")) toastSuccess(`Scheduled for ${formatWhen(scheduledIso.value)}.`);
  } finally {
    busy.value = null;
  }
}

async function postNow(only?: PostVersion) {
  if (busy.value) return;
  const targets = only ? [only] : ready.value;
  if (!targets.length) return;
  busy.value = "post";
  try {
    await flushAll();
    const outcome = await Promise.allSettled(targets.map(async (version) => {
      await approve(version);
      await social.publishPostVersion(
        version.id,
        version.platform === "youtube"
          ? { requestContext: { surface: "social-review", youtube: { privacyStatus: "private", madeForKids: false, containsSyntheticMedia: false } } }
          : { requestContext: { surface: "social-review" } },
      );
    }));
    await reload();
    reportFailures(outcome, targets, "wasn't sent.");
  } finally {
    busy.value = null;
  }
}

function reportFailures(outcome: PromiseSettledResult<unknown>[], targets: PostVersion[], fallback: string) {
  outcome.forEach((item, index) => {
    if (item.status !== "rejected" || !targets[index]) return;
    const reason = item.reason instanceof Error && item.reason.message ? item.reason.message : "";
    toastError(`${networkLabel(targets[index]!.platform)}: ${reason || fallback}`);
  });
}

async function scheduledPublication(version: PostVersion) {
  const list = await social.listPostVersionPublications(version.id);
  return list.find((publication) => publication.status === "scheduled") || null;
}

async function moveSchedule() {
  if (busy.value || !scheduledIso.value || scheduleInPast.value) return;
  busy.value = "move";
  try {
    await Promise.all(scheduledVersions.value.map(async (version) => {
      const publication = await scheduledPublication(version);
      if (publication) {
        await social.reschedulePublication(publication.id, {
          scheduledFor: scheduledIso.value!,
          timezone,
          expectedUpdatedAt: publication.updatedAt,
        });
      }
    }));
    await reload();
    toastSuccess(`Moved to ${formatWhen(scheduledIso.value)}.`);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't move the post.");
    await reload().catch(() => undefined);
  } finally {
    busy.value = null;
  }
}

async function cancelSchedule() {
  if (busy.value) return;
  busy.value = "cancel";
  try {
    await Promise.all(scheduledVersions.value.map(async (version) => {
      const publication = await scheduledPublication(version);
      if (publication) await social.cancelPublication(publication.id);
    }));
    confirmCancel.value = false;
    await reload();
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't cancel the schedule.");
  } finally {
    busy.value = null;
  }
}

/** A fresh draft with the same text and media for every platform. */
async function duplicatePost() {
  if (!detail.value || busy.value) return;
  busy.value = "duplicate";
  try {
    await flushAll();
    const source = detail.value;
    const copy = await social.createSocialPost({
      siteId: source.post.siteId,
      sourceType: "pasted",
      sourceTitle: source.post.sourceTitle || undefined,
      sourceSnapshot: source.post.sourceSnapshot || "",
      sourceText: source.post.sourceText || "",
      ideaText: source.post.ideaText || "",
      versions: visibleVersions(source).map((version) => ({
        platform: version.platform,
        targetAccountId: version.targetAccountId,
        format: version.format,
        title: version.title ?? null,
        bodyText: texts.value[version.id] ?? version.bodyText,
        assetManifest: version.assetManifest,
      })),
    });
    toastSuccess("Copy made. It's in Drafts.");
    await router.push(`/social/${encodeURIComponent(copy.post.id)}`);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't copy the post.");
  } finally {
    busy.value = null;
  }
}

async function deletePost() {
  if (!detail.value || busy.value) return;
  busy.value = "delete";
  try {
    await social.deleteSocialPost(detail.value.post.id, detail.value.post.updatedAt);
    confirmDelete.value = false;
    await router.push("/social?tab=drafts");
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't delete the post.");
  } finally {
    busy.value = null;
  }
}

async function runResult(version: PostVersion, result: VersionResult) {
  if (result.action === "reconnect") {
    accountsOpen.value = true;
    return;
  }
  if (result.action === "edit") {
    activeId.value = version.id;
    await nextTick();
    editor.value?.focus();
    return;
  }
  if (result.action === "retry") {
    await postNow(version);
    return;
  }
  if (result.action === "mark_posted") {
    try {
      const list = await social.listPostVersionPublications(version.id);
      const latest = list.find((publication) => publication.status === "failed");
      if (latest) await social.resolvePublicationOutcome(latest.id, "published");
      await reload();
    } catch (caught) {
      toastFromUnknown(caught, "Couldn't update that post.");
    }
  }
}

function resultHref(version: PostVersion, result: VersionResult): string | null {
  if (result.action === "view") return version.platformPostUrl;
  if (result.action === "open_youtube") return version.platformPostUrl || "https://studio.youtube.com";
  return null;
}

// The URL names the platform, never an internal id.
watch(activeId, (next) => {
  commentOpen.value = false;
  editingVideo.value = null;
  cropIndex.value = null;
  altIndex.value = null;
  const platform = versions.value.find((version) => version.id === next)?.platform;
  if (platform && route.query.platform !== platform) void router.replace({ query: { ...route.query, platform } });
});

onBeforeUnmount(() => window.clearTimeout(postingPoll));

onMounted(async () => {
  await data.load();
  if (data.locked.value || data.loadFailed.value) return;
  try {
    await reload();
  } catch {
    missing.value = true;
    return;
  }
  textCarousel.value = await social.fetchTextCarousel(postId.value).catch(() => null);
});
</script>

<template>
  <main class="post-page">
    <div class="post-column">
      <PageLoading v-if="data.loading.value" label="Loading post…" />

      <section v-else-if="data.locked.value || data.loadFailed.value || missing || !detail" class="post-state">
        <h1>{{ data.locked.value ? "Social isn't included in your plan" : "This post isn't available" }}</h1>
        <RouterLink to="/social">Back to Social</RouterLink>
      </section>

      <template v-else>
        <AppPageBar>
          <template #title>
            <RouterLink class="post-header__back" to="/social">Social</RouterLink>
            <span class="post-header__sep" aria-hidden="true">/</span>
            <span class="post-header__title">{{ title }}</span>
          </template>
          <template #actions>
            <Button class="post-header__quiet" color="ghost" shape="soft" size="small" :disabled="busy !== null" @click="duplicatePost">
              {{ busy === "duplicate" ? "Copying…" : "Duplicate" }}
            </Button>
            <Button class="post-header__quiet" color="ghost" shape="soft" size="small" @click="confirmDelete = true">Delete</Button>
          </template>
        </AppPageBar>

        <section v-if="results.length" class="post-results" aria-label="Results">
          <ul>
            <li v-for="{ version, result } in results" :key="version.id" class="result-row">
              <SocialMarks :platforms="[version.platform]" size="large" />
              <div class="result-row__text">
                <span class="result-row__name">{{ networkLabel(version.platform) }}</span>
                <span class="result-row__detail" :class="`result-row__detail--${result.state}`">{{ result.message }}</span>
              </div>
              <a
                v-if="resultHref(version, result)"
                class="result-row__link"
                :href="resultHref(version, result)!"
                target="_blank"
                rel="noopener"
              >{{ result.actionLabel }} <UiIcon name="ArrowUpRight" :size="13" /></a>
              <Button
                v-else-if="result.action"
                :color="result.action === 'mark_posted' ? 'outline' : 'primary'"
                shape="pill"
                size="small"
                :disabled="busy !== null"
                @click="runResult(version, result)"
              >{{ result.actionLabel }}</Button>
              <Button
                v-if="result.state === 'failed' && result.action !== 'retry' && result.action !== 'reconnect'"
                color="outline"
                shape="pill"
                size="small"
                :disabled="busy !== null"
                @click="postNow(version)"
              >Try again</Button>
            </li>
          </ul>
        </section>

        <div class="post-tabs" role="tablist" aria-label="Platforms">
          <button
            v-for="version in versions"
            :key="version.id"
            type="button"
            role="tab"
            :aria-selected="active?.id === version.id"
            :class="{ 'has-problem': tabHasProblem(version) }"
            @click="flushText(active?.id || ''); activeId = version.id"
          >
            <SocialMarks :platforms="[version.platform]" />
            <span>{{ networkLabel(version.platform) }}</span>
            <span v-if="tabCount(version)" class="post-tabs__count">{{ tabCount(version) }}</span>
          </button>
          <button
            v-for="network in addableNetworks"
            :key="`add-${network.id}`"
            type="button"
            class="post-tabs__add"
            :disabled="busy !== null"
            @click="addPlatform(network.id)"
          >
            <UiIcon name="Plus" :size="14" /> {{ networkLabel(network.id) }}
          </button>
        </div>

        <section v-if="active" class="post-editor" role="tabpanel">
          <div
            class="post-editor__main"
            :class="{ 'is-dropping': dropping }"
            @dragenter="onDragEnter"
            @dragleave="onDragLeave"
            @dragover.prevent
            @drop="onDrop"
          >
            <p v-if="dropping" class="post-drop" aria-hidden="true">Drop to add to {{ networkLabel(active.platform) }}</p>
            <label class="visually-hidden" :for="`post-text-${active.id}`">{{ networkLabel(active.platform) }} text</label>
            <div class="post-field-wrap">
            <div ref="mirror" class="post-field post-field__mirror" aria-hidden="true"><template v-if="activeFold !== null">{{ activeText.slice(0, activeFold) }}<span class="post-fold" /><span class="post-fold__rest">{{ activeText.slice(activeFold) }}</span></template><template v-else>{{ activeText }}</template>{{ "\n" }}</div>
            <textarea
              :id="`post-text-${active.id}`"
              ref="editor"
              class="post-field"
              :class="{ 'post-field--problem': activeChecks.some((check) => check.field === 'text') }"
              rows="7"
              :readonly="activeLocked"
              :value="texts[active.id] ?? active.bodyText"
              @input="onTextInput(active, ($event.target as HTMLTextAreaElement).value)"
              @blur="flushText(active.id)"
              @scroll="syncMirror"
              @paste="onPaste"
            />
            </div>
            <div class="post-field-foot">
              <span>
                {{ networkLabel(active.platform) }} only<template v-if="activeAccountLabel"> · {{ activeAccountLabel }}</template>
                <template v-if="activeThread"> · {{ activeThread.length }} posts</template>
                <template v-else-if="activeLimit && activeLimit < 10000"> · {{ activeLength }}/{{ activeLimit }}</template>
                <template v-if="activeFold !== null && activeFoldRule"> · Shaded text sits behind “{{ activeFoldRule.label.replace(/^…\s?/, "") }}”</template>
                <template v-if="savingIds.has(active.id)"> · Saving…</template>
              </span>
              <span v-if="!activeLocked && (pending.length > 1 || removable)" class="post-field-foot__links">
                <template v-if="pending.length > 1">
                  <button type="button" @click="useTextEverywhere">Use the same text everywhere</button>
                  <button v-if="activeImages.length" type="button" @click="useImagesEverywhere">Same images everywhere</button>
                </template>
                <button v-if="removable" type="button" class="post-remove" :disabled="busy !== null" @click="confirmRemove = active">
                  Remove {{ networkLabel(active.platform) }}
                </button>
              </span>
            </div>

            <p v-if="activeThread && !activeLocked" class="post-thread-note">
              Thread of {{ activeThread.length }} posts. Put a line with <code>---</code> between posts.
              <button type="button" @click="makeOnePost">Make it one post</button>
            </p>
            <p v-if="shortenUndo && shortenUndo.id === active.id && !activeLocked" class="post-thread-note">
              ME3 shortened this. Check it reads like you.
              <button type="button" @click="undoShorten">Undo</button>
            </p>
            <ul v-if="activeChecks.some((check) => check.field === 'text' || check.field === 'account')" class="post-checks">
              <li v-for="check in activeChecks.filter((item) => item.field !== 'images')" :key="check.message">
                <span class="post-checks__icon" aria-hidden="true">!</span>
                <span>{{ check.message }}</span>
                <button v-if="check.field === 'account'" type="button" @click="accountsOpen = true">Connect</button>
                <template v-if="check.fix === 'thread_or_shorten' && !activeLocked">
                  <button type="button" :disabled="busy !== null" @click="turnIntoThread">Turn into a thread</button>
                  <button type="button" :disabled="busy !== null" @click="shortenForPlatform">{{ busy === "shorten" ? "Shortening…" : `Shorten for ${networkLabel(active.platform)}` }}</button>
                </template>
              </li>
            </ul>

            <div v-if="takesFirstComment(active.platform) && !(activeLocked && !tagsSummary)" class="post-tags">
              <button type="button" class="post-comment__link" :aria-expanded="tagsOpen" @click="tagsOpen = !tagsOpen">
                {{ tagsOpen ? "Hide" : "Mentions and hashtags" }} on {{ networkLabel(active.platform) }}<template v-if="!tagsOpen && tagsSummary"> · {{ tagsSummary }}</template>
              </button>
              <div v-if="tagsOpen" class="post-tags__panel">
                <p class="post-tags__hint">Handles differ by platform. Write @names once; set what each becomes here.</p>
                <label v-for="token in activeMentions" :key="token" class="post-tags__row">
                  <span>{{ token }}</span>
                  <input
                    class="post-field"
                    :value="activeOptions.mentions?.[token] || ''"
                    :placeholder="token"
                    :readonly="activeLocked"
                    :aria-label="`${token} on ${networkLabel(active.platform)}`"
                    @change="setMention(token, ($event.target as HTMLInputElement).value)"
                  >
                </label>
                <p v-if="!activeMentions.length" class="post-tags__hint">No @mentions in this text.</p>
                <label class="post-tags__row">
                  <span>Hashtags</span>
                  <input
                    class="post-field"
                    :value="activeOptions.hashtags || ''"
                    placeholder="#launch #buildinpublic"
                    :readonly="activeLocked"
                    :aria-label="`Hashtags on ${networkLabel(active.platform)}`"
                    @change="setPostOption({ hashtags: ($event.target as HTMLInputElement).value })"
                  >
                </label>
              </div>
            </div>

            <div v-if="takesFirstComment(active.platform) && !(activeLocked && !activeFirstComment)" class="post-comment">
              <template v-if="commentOpen || activeFirstComment">
                <label class="post-video__label" :for="`post-comment-${active.id}`">{{ firstCommentLabel }}</label>
                <textarea
                  :id="`post-comment-${active.id}`"
                  class="post-field post-comment__field"
                  rows="2"
                  :readonly="activeLocked"
                  :value="activeFirstComment"
                  :placeholder="active.platform === 'x' ? 'Posted as a reply, right after the post. Good for the link.' : 'Posted as a comment, right after the post. Good for the link.'"
                  @change="setFirstComment(($event.target as HTMLTextAreaElement).value)"
                />
                <button v-if="!activeLocked" type="button" class="post-comment__link" @click="setFirstComment(''); commentOpen = false">Remove</button>
              </template>
              <span v-else class="post-comment__adds">
                <button v-if="activeLinkMove" type="button" class="post-comment__link" @click="moveLinkToComment">
                  Move the link to the first {{ active.platform === "x" ? "reply" : "comment" }}
                </button>
                <button type="button" class="post-comment__link" @click="commentOpen = true">
                  Add a first {{ active.platform === "x" ? "reply" : "comment" }}
                </button>
              </span>
            </div>

            <div class="post-images">
              <template v-if="active.platform === 'youtube'">
                <label class="post-video__label" :for="`post-title-${active.id}`">Title</label>
                <input
                  :id="`post-title-${active.id}`"
                  class="post-field post-video__title"
                  :class="{ 'post-field--problem': activeChecks.some((check) => check.message.includes('title')) }"
                  :value="active.title || ''"
                  :maxlength="YOUTUBE_TITLE_LIMIT + 20"
                  :readonly="activeLocked"
                  placeholder="What's this Short called?"
                  @change="setTitle(active, ($event.target as HTMLInputElement).value)"
                >
              </template>
              <SocialImageTiles
                v-if="activeTiles.length"
                :images="activeTiles"
                :locked="activeLocked"
                @reorder="setTiles"
                @remove="removeImage"
                @crop="cropIndex = $event"
                @alt="altIndex = $event"
                @edit="editVideoAt(activeTiles[$event] || null)"
              />
              <div v-if="activeDocument" class="post-video__file">
                <UiIcon name="FileText" :size="16" />
                <span>{{ activeDocument.filename || "Document" }}</span>
                <Button v-if="!activeLocked" color="ghost" shape="soft" size="small" icon-only aria-label="Remove PDF" @click="removeDocument">
                  <UiIcon name="X" :size="15" />
                </Button>
              </div>
              <div v-if="activeVideo && !activeMixed" class="post-video__file">
                <UiIcon name="Video" :size="16" />
                <span>{{ activeVideo.filename || "Video" }}</span>
                <Button v-if="!activeLocked" color="ghost" shape="soft" size="small" icon-only aria-label="Edit video" @click="editVideoAt(activeVideo)">
                  <UiIcon name="Pencil" :size="15" />
                </Button>
                <Button v-if="!activeLocked" color="ghost" shape="soft" size="small" icon-only aria-label="Remove video" @click="removeVideo">
                  <UiIcon name="X" :size="15" />
                </Button>
              </div>
              <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" multiple @change="addImages">
              <input ref="videoInput" class="visually-hidden" type="file" accept="video/*" @change="addVideo">
              <input ref="documentInput" class="visually-hidden" type="file" accept="application/pdf,.pdf" @change="addDocument">
              <div v-if="!activeLocked && (activeTakesImages || activeVideoRule)" class="post-images__adds">
                <button v-if="activeTakesImages && (!activeVideo || activeMixed) && !activeDocument" type="button" class="post-images__add" :disabled="busy === 'upload'" @click="fileInput?.click()">
                  <UiIcon name="Plus" :size="15" /> {{ busy === "upload" ? "Adding…" : activeImages.length ? "Add image" : "Add your own images" }}
                </button>
                <button v-if="activeTakesSlides" type="button" class="post-images__add" :disabled="busy === 'upload'" @click="slidesOpen = true">
                  <UiIcon name="Images" :size="15" /> {{ textCarousel?.slides.length ? "Edit slides" : "Make text slides" }}
                </button>
                <button v-if="activeVideoRule" type="button" class="post-images__add" :disabled="busy === 'upload'" @click="videoInput?.click()">
                  <UiIcon name="Plus" :size="15" /> {{ converting !== null ? `Converting… ${Math.round(converting * 100)}%` : busy === "upload" ? "Adding…" : activeVideoLabel }}
                </button>
                <button v-if="activeDocRule" type="button" class="post-images__add" :disabled="busy === 'upload'" @click="documentInput?.click()">
                  <UiIcon name="FileText" :size="15" /> {{ activeDocument ? "Replace PDF" : "Add a PDF" }}
                </button>
                <button type="button" class="post-images__add" :disabled="busy === 'upload'" @click="filesPickerOpen = true">
                  <UiIcon name="Folder" :size="15" /> From Files
                </button>
                <span class="post-images__hint">or drop files here, or paste a screenshot</span>
              </div>
              <ul v-if="activeChecks.some((check) => check.field === 'images')" class="post-checks">
                <li v-for="check in activeChecks.filter((item) => item.field === 'images')" :key="check.message">
                  <span class="post-checks__icon" aria-hidden="true">!</span>
                  <span>{{ check.message }}</span>
                  <button v-if="check.fix === 'convert_video' && !activeLocked" type="button" :disabled="busy !== null" @click="convertAttachedVideo">
                    {{ converting !== null ? `Converting… ${Math.round(converting * 100)}%` : "Convert to MP4" }}
                  </button>
                </li>
              </ul>
              <p v-if="activeDocument && activeDocRule?.guidance" class="post-note">{{ activeDocRule.guidance }}</p>
              <p v-else-if="activeMixed && activeVideo" class="post-note">{{ mixedMediaRule(active.platform, capabilities)?.guidance }}</p>
              <p v-else-if="activeVideoRule?.guidance && (activeVideo || !activeTakesImages) && active.platform !== 'youtube'" class="post-note">{{ activeVideoRule.guidance }}</p>
              <p v-if="active.platform === 'youtube'" class="post-note">Uploads as a private draft. You publish it in YouTube.</p>
            </div>
          </div>

          <aside class="post-preview">
            <SocialPostPreview
              :platform="active.platform"
              :text="activePosted"
              :media="active.assetManifest"
              :name="activeAccountRow?.displayName || activeAccountLabel || networkLabel(active.platform)"
              :handle="activeAccountRow?.handle"
              :avatar-url="activeAccountRow?.avatarUrl"
              :title="active.title"
              :thread="activeThread"
              :first-comment="activeFirstComment"
            />
          </aside>
        </section>

        <footer v-if="pending.length || scheduledVersions.length" class="post-bar">
          <div class="post-bar__when">
            <label class="visually-hidden" for="post-date">Day</label>
            <input id="post-date" v-model="when.date" type="date">
            <label class="visually-hidden" for="post-time">Time</label>
            <input id="post-time" v-model="when.time" type="time">
            <span class="post-bar__zone" :title="timezone">{{ timezoneLabel }}</span>
            <span v-if="scheduleInPast" class="post-bar__hint post-bar__hint--skip">That time has passed. Post now, or pick a later time.</span>
            <span v-else-if="blockers.length && !ready.length" class="post-bar__hint">Fix the marked problems first.</span>
            <span v-else-if="blockers.length" class="post-bar__hint post-bar__hint--skip">Skipping {{ skippedLabel }}.</span>
          </div>
          <div class="post-bar__actions">
            <template v-if="scheduledVersions.length && !pending.length">
              <Button class="post-header__quiet" color="ghost" shape="soft" size="compact" :disabled="busy !== null" @click="confirmCancel = true">Cancel schedule</Button>
              <Button color="primary" shape="pill" size="compact" :disabled="busy !== null || !scheduledIso || scheduleInPast" @click="moveSchedule">
                {{ busy === "move" ? "Moving…" : scheduledIso ? `Move to ${formatShortWhen(scheduledIso)}` : "Move" }}
              </Button>
            </template>
            <template v-else>
              <Button :color="postNowFirst ? 'primary' : 'outline'" shape="pill" size="compact" :disabled="busy !== null || !ready.length" @click="postNow()">
                {{ busy === "post" ? "Posting…" : postNowLabel }}
              </Button>
              <Button
                v-if="schedulable.length"
                :color="postNowFirst ? 'outline' : 'primary'"
                shape="pill"
                size="compact"
                :disabled="busy !== null || !scheduledIso || scheduleInPast"
                @click="schedule"
              >{{ busy === "schedule" ? "Scheduling…" : scheduleLabel }}</Button>
            </template>
          </div>
        </footer>
        <p v-if="scheduledVersions.length" class="post-note">Editing a scheduled post moves it back to Drafts.</p>
      </template>
    </div>

    <SocialAccountsSheet
      :open="accountsOpen"
      :accounts="accounts"
      :posts="detail ? [detail] : []"
      :site-id="siteId"
      :hosted-platforms="hostedPlatforms"
      :x-allowance="data.status.value?.managedXAllowance"
      :return-path="route.fullPath"
      @close="accountsOpen = false"
      @changed="data.loadAccounts"
    />
    <ConfirmationDialog
      :open="confirmDelete"
      title="Delete this post?"
      message="It's removed from ME3. Anything already posted stays on each platform."
      confirm-label="Delete"
      :busy="busy === 'delete'"
      danger
      @cancel="confirmDelete = false"
      @confirm="deletePost"
    />
    <ConfirmationDialog
      :open="confirmCancel"
      title="Cancel the schedule?"
      message="Nothing is posted. The post stays here so you can schedule it again."
      confirm-label="Cancel schedule"
      cancel-label="Keep it"
      :busy="busy === 'cancel'"
      @cancel="confirmCancel = false"
      @confirm="cancelSchedule"
    />
    <ConfirmationDialog
      :open="confirmRemove !== null"
      :title="`Remove ${confirmRemove ? networkLabel(confirmRemove.platform) : ''} from this post?`"
      message="Its text and media for that platform are removed. The other platforms stay."
      confirm-label="Remove"
      :busy="busy === 'remove'"
      danger
      @cancel="confirmRemove = null"
      @confirm="removePlatform"
    />
    <SocialVideoEditor
      :open="editingVideo !== null"
      :video="editingVideo"
      :cover-frame="active ? takesCoverFrame(active.platform) : false"
      :busy="busy === 'upload'"
      :progress="trimProgress"
      @close="editingVideo = null"
      @save="saveVideoEdit"
    />
    <SocialAltTextDialog
      :open="altAsset !== null"
      :image="altAsset"
      :draft="(image: string) => social.draftAltText(image, activeText)"
      @close="altIndex = null"
      @save="saveAltText"
    />
    <SocialImageCropper
      :open="cropAsset !== null"
      :src="cropAsset?.url || null"
      :filename="cropAsset?.filename"
      :mime-type="cropAsset?.mimeType"
      :platform="active?.platform || ''"
      :busy="busy === 'upload'"
      @close="cropIndex = null"
      @save="saveCrop"
    />
    <SocialTextCarouselEditor
      v-if="active && siteId"
      :open="slidesOpen"
      :site-id="siteId"
      :site-username="siteUsername"
      :post-id="postId"
      :handle="slidesHandle"
      :caption="activeText"
      @close="slidesOpen = false"
      @added="addSlideImages"
    />
    <FilesMediaPicker
      :open="filesPickerOpen"
      :kinds="pickerKinds"
      :title="pickerTitle"
      @close="filesPickerOpen = false"
      @select="addFromFiles"
    />
  </main>
</template>

<style scoped>
.post-page { min-height: calc(100dvh - var(--app-topbar-height)); background: var(--ui-bg); color: var(--ui-text); }
.post-column { box-sizing: border-box; width: min(100%, 880px); margin: 0 auto; padding: 16px 16px 96px; }
.post-header__back { color: var(--ui-text-muted); font-weight: 500; text-decoration: none; }
.post-header__back:hover { color: var(--ui-text); }
.post-tabs__add { display: inline-flex; align-items: center; gap: 4px; padding: 8px 10px; border: 0; background: none; color: var(--ui-text-muted); font: inherit; font-size: 13px; cursor: pointer; }
.post-tabs__add:hover { color: var(--ui-text); }
.post-video { display: grid; gap: 10px; }
.post-video__label { font-size: 13px; font-weight: 600; color: var(--ui-text-muted); }
.post-video__title { padding: 10px 12px; }
.post-video__file { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--ui-text); }
.post-video__file span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.post-header__sep { color: var(--ui-text-muted); font-weight: 400; }
.post-header__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
:deep(.post-header__quiet) { color: var(--ui-text-muted); font-weight: 500; }

.post-results { margin-top: 16px; padding: 4px 14px; border-radius: var(--ui-radius-lg); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.post-results ul { margin: 0; padding: 0; list-style: none; }
.result-row { display: flex; align-items: center; gap: 12px; min-height: 56px; }
.result-row + .result-row { border-top: 1px solid var(--ui-border); }
.result-row__text { display: grid; flex: 1 1 auto; min-width: 0; gap: 1px; }
.result-row__name { font-size: 14px; font-weight: 600; }
.result-row__detail { color: var(--ui-text-muted); font-size: 12.5px; }
.result-row__detail--failed, .result-row__detail--retrying { color: var(--ui-danger); }
.result-row__link { display: inline-flex; align-items: center; gap: 3px; color: var(--ui-text-muted); font-size: 13px; text-decoration: none; }
.result-row__link:hover { color: var(--ui-text); text-decoration: underline; }

.post-tabs { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 18px; border-bottom: 1px solid var(--ui-border); }
.post-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: -1px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ui-text-muted);
  font: 13.5px var(--font-sans);
  cursor: pointer;
}
.post-tabs button[aria-selected="true"] { border-color: var(--ui-text); color: var(--ui-text); font-weight: 600; }
.post-tabs button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: -2px; }
.post-tabs button.has-problem span:nth-child(2)::after { content: " •"; color: var(--ui-danger); }
.post-tabs__count { color: var(--ui-text-faint, var(--ui-text-muted)); font-size: 12px; font-variant-numeric: tabular-nums; }

.post-editor { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 18px; margin-top: 14px; }
.post-editor__main { position: relative; display: grid; align-content: start; gap: 10px; min-width: 0; }
.post-editor__main.is-dropping { outline: 2px dashed var(--ui-accent, var(--ui-primary)); outline-offset: 6px; border-radius: var(--ui-radius-md); }
.post-drop {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  margin: 0;
  border-radius: var(--ui-radius-md);
  background: color-mix(in oklab, var(--ui-surface), transparent 12%);
  color: var(--ui-text);
  font-weight: 600;
  pointer-events: none;
}
.post-field, .post-bar__when input {
  box-sizing: border-box;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: 14px/1.5 var(--font-sans);
}
.post-field { width: 100%; padding: 10px 12px; resize: vertical; }
.post-field-wrap { position: relative; display: grid; }
.post-field-wrap textarea { position: relative; background: transparent; }
.post-field__mirror {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: transparent;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  pointer-events: none;
}
.post-fold { position: relative; }
.post-fold::before { position: absolute; top: -1px; bottom: -3px; left: -1px; width: 2px; border-radius: 1px; background: var(--ui-accent, var(--ui-primary)); content: ""; }
.post-fold__rest { border-radius: 2px; background: var(--ui-surface-muted); box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.post-field--problem { border-color: var(--ui-danger); }
.post-field-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; color: var(--ui-text-muted); font-size: 12px; }
.post-field-foot__links { display: inline-flex; gap: 12px; }
.post-field-foot__links button, .post-checks button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ui-text-muted);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.post-comment { display: grid; gap: 6px; }
.post-tags { display: grid; gap: 8px; }
.post-tags > .post-comment__link { justify-self: start; text-align: left; }
.post-tags__panel { display: grid; gap: 8px; padding: 10px 12px; border-radius: var(--ui-radius-md); background: var(--ui-surface-muted); }
.post-tags__hint { margin: 0; color: var(--ui-text-muted); font-size: 12.5px; }
.post-tags__row { display: grid; grid-template-columns: minmax(80px, 140px) minmax(0, 1fr); align-items: center; gap: 8px; font-size: 13px; }
.post-tags__row span { overflow: hidden; color: var(--ui-text-muted); text-overflow: ellipsis; white-space: nowrap; }
.post-tags__row input { padding: 6px 10px; font-size: 13.5px; }
.post-comment__field { font-size: 13.5px; }
.post-comment__adds { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.post-comment__link { justify-self: start; padding: 0; border: 0; background: none; color: var(--ui-text-muted); font: 500 12.5px var(--font-sans); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.post-comment__link:hover { color: var(--ui-text); }
.post-thread-note { margin: 0; color: var(--ui-text-muted); font-size: 12.5px; }
.post-thread-note code { padding: 0 3px; border-radius: 3px; background: var(--ui-surface-muted); font-size: 12px; }
.post-thread-note button { margin-left: 6px; padding: 0; border: 0; background: none; color: var(--ui-text-muted); font: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.post-checks { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12.5px; }
.post-checks li { display: flex; align-items: center; gap: 8px; }
.post-checks__icon { display: inline-grid; flex: none; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: var(--ui-danger); color: #fff; font-size: 10px; font-weight: 700; }

.post-images { display: grid; gap: 8px; }
.post-images__adds { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; }
.post-images__hint { color: var(--ui-text-muted); font-size: 12px; }
.post-images__add {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 5px;
  padding: 6px 10px;
  border: 1.5px dashed var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  background: transparent;
  color: var(--ui-text-muted);
  font: 500 13px var(--font-sans);
  cursor: pointer;
}

.post-preview { position: sticky; top: calc(var(--app-topbar-height, 0px) + 12px); align-self: start; min-width: 0; }

.post-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--ui-border); }
.post-bar__when { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.post-bar__when input { padding: 6px 10px; font-size: 13px; }
.post-bar__hint { color: var(--ui-danger); font-size: 12.5px; }
.post-bar__zone { color: var(--ui-text-muted); font-size: 12.5px; }
.post-bar__hint--skip { color: var(--ui-text-muted); }
.post-field-foot__links .post-remove { color: var(--ui-danger); }
.post-bar__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.post-note { margin: 8px 0 0; color: var(--ui-text-muted); font-size: 12.5px; }
.post-state { display: grid; justify-items: start; gap: 8px; margin-top: 40px; }
.post-state h1 { margin: 0; font-size: 20px; font-weight: 650; }
.post-state a { color: var(--ui-text-muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 720px) {
  .post-editor { grid-template-columns: minmax(0, 1fr); }
  .post-preview { display: none; }
  .post-bar__actions { width: 100%; justify-content: flex-end; }
}
</style>
