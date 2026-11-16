<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";
import {
  composerRows,
  type ComposerAction,
  type ComposerMediaKind,
  type ComposerPostType,
  type ComposerRow,
  type ComposerVideoInfo,
} from "@me3-core/plugin-social-publishing/composer";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import FilesMediaPicker from "../files/FilesMediaPicker.vue";
import SocialAccountAvatar from "./SocialAccountAvatar.vue";
import SocialMarks from "./SocialMarks.vue";
import { API_BASE } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import type {
  DriveFile,
  SocialAccountRow,
  SocialMediaAsset,
  SocialPlatform,
  SocialPlatformCapabilities,
} from "../../stores/social";
import { useSocialStore } from "../../stores/social";
import { uploadDriveFiles } from "../../utils/drive-upload";
import { readVideoInfo } from "../../utils/video-info";
import {
  accountName,
  accountState,
  connectableNetworks,
  networkLabel,
  newPostAccounts,
  newPostCaptionNote,
  socialNetwork,
  visibleVersions,
  youtubeTitleFrom,
} from "../../utils/social-posts";

/**
 * New post (me3-hzsw): ask what's being posted, then pick the connected accounts it goes to from
 * one row of pictures: grey until chosen, full colour when chosen, faded and crossed out when the
 * account can't take this post. Nothing is chosen for the owner. What each account gets comes from
 * the shared rules in packages/social-publishing, so web and iPhone say the same thing; on the row
 * it shows as a tooltip. The words and media are always the owner's own.
 */
const props = defineProps<{
  open: boolean;
  accounts: SocialAccountRow[];
  capabilities: SocialPlatformCapabilities[];
  siteId: string;
}>();

const emit = defineEmits<{ close: []; connect: [] }>();

const router = useRouter();
const social = useSocialStore();
const { toast, toastFromUnknown } = useAppToast();
const uid = useId();
const titleId = `social-new-post-${uid}`;
const MAX_IMAGES = 20;

/** Media for the new post: a device upload (`file`) or something already in Files (`driveFile`). */
type PickedMedia = {
  key: string;
  kind: ComposerMediaKind;
  name: string;
  preview: string;
  file?: File;
  driveFile?: DriveFile;
  video?: ComposerVideoInfo | null;
};

const step = ref<"ask" | "compose">("ask");
const type = ref<ComposerPostType>("text");
const text = ref("");
const media = ref<PickedMedia[]>([]);
/** Previews still referenced by an Undo toast; released when the dialog closes. */
const parked: PickedMedia[] = [];
/** The accounts the owner chose, kept across type switches where the account can still take the post. */
const handTicks = ref<Record<string, boolean>>({});
const swapped = ref<string[]>([]);
const busy = ref(false);
const pickerOpen = ref(false);
const reorderHelp = ref("");
const heading = ref<HTMLHeadingElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
const imagesInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);
const mediaList = ref<HTMLUListElement | null>(null);
const cutInput = ref<HTMLInputElement | null>(null);
/** A shorter cut of the video for one account's version only (me3-ic0c). Everyone else keeps the original. */
const cuts = ref<Record<string, PickedMedia>>({});
let cutFor: string | null = null;
/** TikTok creator_info max_video_post_duration_sec per account, once loaded. */
const tiktokMax = ref<Record<string, number>>({});
let keySeed = 0;

const listed = computed(() => newPostAccounts(props.accounts));

function rowsFor(postType: ComposerPostType, items: PickedMedia[], only?: string): ComposerRow[] {
  return composerRows({
    type: postType,
    media: {
      items: items.map((item) => item.kind),
      video: items.find((item) => item.kind === "video")?.video ?? null,
      // The switch says which kind leads on X and LinkedIn.
      firstKind: postType === "video" ? "video" : postType === "images" ? "image" : null,
    },
    accounts: listed.value
      .filter(({ account }) => !only || account.id === only)
      .map(({ account, network }) => ({
        id: account.id,
        network,
        tiktokMaxVideoSeconds: tiktokMax.value[account.id] ?? null,
        youtubeLongUploads: account.youtubeLongUploads ?? null,
      })),
    swapped: swapped.value,
  });
}

/** The media one account gets: the post's own, with that account's shorter cut in place of the video. */
function mediaFor(accountId: string): PickedMedia[] {
  if (type.value === "text") return [];
  const cut = cuts.value[accountId];
  return cut ? media.value.map((item) => (item.kind === "video" ? cut : item)) : media.value;
}

const rows = computed(() => {
  const all = rowsFor(type.value, mediaFor(""));
  return all.map((row) => (cuts.value[row.accountId] && media.value.some((item) => item.kind === "video")
    ? rowsFor(type.value, mediaFor(row.accountId), row.accountId)[0]!
    : row));
});

/** Accounts each kind of post reaches before anything is picked, for the question's logos. */
const reach = computed(() => {
  const forType = (postType: ComposerPostType) => {
    const takes = new Set(rowsFor(postType, []).filter((row) => row.canTake).map((row) => row.accountId));
    return listed.value.filter(({ account }) => takes.has(account.id)).map(({ account }) => account.platform);
  };
  return { text: forType("text"), images: forType("images"), video: forType("video") };
});

const OPTIONS: Array<{ type: ComposerPostType; label: string; icon: "FileText" | "Images" | "Video" }> = [
  { type: "text", label: "Text only", icon: "FileText" },
  { type: "images", label: "Images", icon: "Images" },
  { type: "video", label: "Video", icon: "Video" },
];

function namesFor(platforms: string[]): string {
  const names = [...new Set(platforms.map((platform) => networkLabel(platform)))];
  if (!names.length) return "none of your accounts";
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Whether an account is chosen. Nothing starts chosen; the owner picks. One post holds one
 * version per platform, so when two accounts share a platform only one can be chosen.
 */
const ticks = computed(() => {
  const result: Record<string, boolean> = {};
  const taken = new Set<string>();
  for (const row of rows.value) {
    const item = listed.value.find(({ account }) => account.id === row.accountId)!;
    const ticked = row.canTake && handTicks.value[row.accountId] === true && !taken.has(item.account.platform);
    if (ticked) taken.add(item.account.platform);
    result[row.accountId] = ticked;
  }
  return result;
});

const tickedRows = computed(() => rows.value.filter((row) => ticks.value[row.accountId]));

function accountFor(row: ComposerRow): SocialAccountRow {
  return listed.value.find(({ account }) => account.id === row.accountId)!.account;
}

function namedRow(row: ComposerRow): boolean {
  return listed.value.find(({ account }) => account.id === row.accountId)?.named ?? false;
}

function accessibleName(row: ComposerRow): string {
  const account = accountFor(row);
  const name = namedRow(row) ? accountName(account) : account.handle;
  return name ? `${networkLabel(account.platform)}, ${name}` : networkLabel(account.platform);
}

/** What an account gets, or why it can't take this post: the tooltip and the line under the row. */
function says(row: ComposerRow): string {
  const main = (row.canTake ? row.label : row.reason) ?? "";
  return row.hint ? `${main}. ${row.hint}` : main;
}


/** Rows with something to do (a swap, a shorter cut, a link) or their own cut, listed under the row. */
const noteRows = computed(() => rows.value.filter((row) => row.actions.length || (cuts.value[row.accountId] && type.value !== "text")));

/** Shown while a network the owner could connect still has no account. */
const canConnectMore = computed(() =>
  connectableNetworks(props.accounts).some((network) => accountState(network.id, props.accounts) !== "connected"),
);

function toggle(row: ComposerRow) {
  if (!row.canTake) return;
  const next = !ticks.value[row.accountId];
  const platform = accountFor(row).platform;
  const changes: Record<string, boolean> = { [row.accountId]: next };
  // Ticking one account on a platform unticks the other.
  if (next) {
    for (const { account } of listed.value) {
      if (account.id !== row.accountId && account.platform === platform) changes[account.id] = false;
    }
  }
  handTicks.value = { ...handTicks.value, ...changes };
}

const caption = computed(() =>
  newPostCaptionNote(text.value, tickedRows.value.map((row) => accountFor(row).platform as SocialPlatform), props.capabilities),
);

const reviewLabel = computed(() => {
  if (busy.value) return media.value.length ? "Uploading…" : "Saving…";
  const count = tickedRows.value.length;
  return count ? `Review ${count} post${count === 1 ? "" : "s"}` : "Review";
});

function reset() {
  step.value = "ask";
  type.value = "text";
  text.value = "";
  handTicks.value = {};
  swapped.value = [];
  cuts.value = {};
  tiktokMax.value = {};
  reorderHelp.value = "";
  clearMedia();
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      reset();
      loadTikTokLimits();
      await nextTick();
      heading.value?.focus();
    } else {
      clearMedia();
    }
  },
  { immediate: true },
);

/** Each TikTok account's own video length limit. Until it loads, or if it fails, TikTok stays tickable with no length claim. */
function loadTikTokLimits() {
  for (const { account, network } of listed.value) {
    if (network !== "tiktok") continue;
    social.getTikTokCreatorInfo(account.id)
      .then((info) => {
        const max = Number(info.maxVideoPostDurationSeconds);
        if (Number.isFinite(max) && max > 0) tiktokMax.value = { ...tiktokMax.value, [account.id]: max };
      })
      .catch(() => {});
  }
}

/** Reads a picked video's length and shape, then updates whichever list still holds it. */
function measure(item: PickedMedia) {
  if (item.kind !== "video") return;
  void readVideoInfo(item.preview).then((video) => {
    if (media.value.some((other) => other.key === item.key)) {
      media.value = media.value.map((other) => (other.key === item.key ? { ...other, video } : other));
    }
    for (const [accountId, cut] of Object.entries(cuts.value)) {
      if (cut.key === item.key) cuts.value = { ...cuts.value, [accountId]: { ...cut, video } };
    }
  });
}

function release(item: PickedMedia) {
  if (item.file) URL.revokeObjectURL(item.preview);
}

function clearMedia() {
  for (const item of [...media.value, ...parked.splice(0), ...Object.values(cuts.value)]) release(item);
  media.value = [];
  cuts.value = {};
}

/** From the question: every kind goes to writing; the media buttons sit under the words. */
function choose(postType: ComposerPostType) {
  type.value = postType;
  step.value = "compose";
  void nextTick(() => textarea.value?.focus());
}

/** The switch: the words always stay; Text only removes media with Undo. */
function switchType(postType: ComposerPostType) {
  if (postType === type.value) return;
  const previous = type.value;
  if (postType === "text" && media.value.length) {
    const removed = media.value;
    parked.push(...removed);
    media.value = [];
    type.value = "text";
    toast(`Removed ${removed.length === 1 ? "the media" : `${removed.length} items`}.`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          media.value = removed;
          type.value = previous;
        },
      },
    });
    return;
  }
  type.value = postType;
}

/** The media buttons under the words, the chosen kind first. */
const attachButtons = computed(() => {
  if (type.value === "text") return [];
  const hasVideo = media.value.some((item) => item.kind === "video");
  const hasImages = media.value.some((item) => item.kind === "image");
  const images = { key: "images", label: hasImages ? "Add more images" : "Add images", icon: "Images" as const, open: () => imagesInput.value?.click() };
  const video = { key: "video", label: hasVideo ? "Change the video" : "Add a video", icon: "Video" as const, open: () => videoInput.value?.click() };
  return type.value === "video" ? [video, images] : [images, video];
});

function addItems(items: PickedMedia[]) {
  let next = [...media.value];
  const video = items.find((item) => item.kind === "video");
  if (video) {
    // One video per post: a new one replaces the old, and any shorter cuts of it.
    for (const old of next.filter((item) => item.kind === "video")) release(old);
    for (const cut of Object.values(cuts.value)) release(cut);
    cuts.value = {};
    next = next.filter((item) => item.kind !== "video");
    next.push(video);
    measure(video);
  }
  const images = items.filter((item) => item.kind === "image");
  const room = MAX_IMAGES - next.filter((item) => item.kind === "image").length;
  next.push(...images.slice(0, Math.max(0, room)));
  for (const dropped of images.slice(Math.max(0, room))) release(dropped);
  if (images.length > room) toast(`Up to ${MAX_IMAGES} images per post. Added the first ${Math.max(0, room)}.`);
  media.value = next;
  if (type.value === "text" && next.length) type.value = next[0]!.kind === "video" ? "video" : "images";
}

function addFromDevice(event: Event) {
  const input = event.target as HTMLInputElement;
  const picked = Array.from(input.files || []).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
  input.value = "";
  addItems(picked.map((file) => ({
    key: `m${keySeed++}`,
    kind: file.type.startsWith("video/") ? "video" : "image",
    name: file.name,
    preview: URL.createObjectURL(file),
    file,
  })));
}

function addFromFiles(files: DriveFile[]) {
  addItems(files
    .filter((driveFile) => !media.value.some((item) => item.driveFile?.id === driveFile.id))
    .map((driveFile) => ({
      key: `m${keySeed++}`,
      kind: driveFile.mimeType.startsWith("video/") ? "video" : "image",
      name: driveFile.filename,
      preview: `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(driveFile.id)}/content`,
      driveFile,
    })));
}

function remove(index: number) {
  const next = [...media.value];
  const [removed] = next.splice(index, 1);
  if (removed) release(removed);
  if (removed?.kind === "video") {
    for (const cut of Object.values(cuts.value)) release(cut);
    cuts.value = {};
  }
  media.value = next;
}

/** "Pick a shorter cut": a different video for this account's version only. */
function pickCut(accountId: string) {
  cutFor = accountId;
  cutInput.value?.click();
}

function addCut(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = Array.from(input.files || []).find((item) => item.type.startsWith("video/"));
  input.value = "";
  const accountId = cutFor;
  cutFor = null;
  if (!file || !accountId) return;
  const old = cuts.value[accountId];
  if (old) release(old);
  const cut: PickedMedia = { key: `m${keySeed++}`, kind: "video", name: file.name, preview: URL.createObjectURL(file), file };
  cuts.value = { ...cuts.value, [accountId]: cut };
  measure(cut);
  // Picking a cut for an account means posting there.
  const platform = listed.value.find(({ account }) => account.id === accountId)?.account.platform;
  const others = listed.value.filter(({ account }) => account.platform === platform && account.id !== accountId);
  handTicks.value = { ...handTicks.value, ...Object.fromEntries(others.map(({ account }) => [account.id, false])), [accountId]: true };
}

function dropCut(accountId: string) {
  const { [accountId]: cut, ...rest } = cuts.value;
  if (cut) release(cut);
  cuts.value = rest;
}

function move(index: number, by: number) {
  const to = index + by;
  if (to < 0 || to >= media.value.length) return;
  const next = [...media.value];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  media.value = next;
  reorderHelp.value = `${item!.name} moved to ${to + 1} of ${next.length}.`;
  void nextTick(() => (mediaList.value?.querySelectorAll<HTMLElement>("[data-thumb]")[to])?.focus());
}

let dragFrom: number | null = null;
function drop(index: number) {
  if (dragFrom !== null && dragFrom !== index) move(dragFrom, index - dragFrom);
  dragFrom = null;
}

function runAction(row: ComposerRow, action: ComposerAction) {
  if (action.kind === "reorder") {
    reorderHelp.value = "Drag the thumbnails, or focus one and use the arrow keys, to change the order.";
    mediaList.value?.querySelector<HTMLElement>("[data-thumb]")?.focus();
  } else if (action.kind === "pick_cut") {
    pickCut(row.accountId);
  } else if (action.kind === "swap_to_video" || action.kind === "swap_to_images") {
    swapped.value = swapped.value.includes(row.accountId)
      ? swapped.value.filter((id) => id !== row.accountId)
      : [...swapped.value, row.accountId];
  }
}

function mediaAsset(file: DriveFile, kind: ComposerMediaKind, assetIndex: number): SocialMediaAsset {
  return {
    url: `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(file.id)}/content`,
    fileId: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    kind,
    altText: "",
    contentHash: file.sha256 ? `sha256:${file.sha256.toLowerCase()}` : undefined,
    byteLength: file.size,
    assetIndex,
  };
}

/** Files picks are already in Files; device picks upload first. */
async function driveFileFor(item: PickedMedia): Promise<DriveFile> {
  if (item.driveFile) return item.driveFile;
  const [uploaded] = await uploadDriveFiles<DriveFile>([item.file!], { folderId: null, onConflict: "rename" });
  if (!uploaded) throw new Error(`${item.name} didn't upload.`);
  return uploaded;
}

async function submit() {
  const words = text.value.trim();
  const chosen = tickedRows.value;
  if (!words || !chosen.length || busy.value) return;
  busy.value = true;
  try {
    // Upload each picked file once, whichever accounts use it.
    const used = new Map<string, PickedMedia>();
    for (const row of chosen) for (const index of row.items) used.set(mediaFor(row.accountId)[index]!.key, mediaFor(row.accountId)[index]!);
    const files = new Map<string, DriveFile>();
    await Promise.all([...used.values()].map(async (item) => files.set(item.key, await driveFileFor(item))));
    const detail = await social.createSocialPost({
      siteId: props.siteId,
      sourceType: "pasted",
      sourceSnapshot: words,
      sourceText: words,
      ideaText: words,
      versions: chosen.map((row) => ({
        platform: accountFor(row).platform as SocialPlatform,
        targetAccountId: row.accountId,
        bodyText: words,
        ...(row.network === "youtube" ? { title: youtubeTitleFrom(words) } : {}),
        ...(row.format ? { format: row.format } : {}),
      })),
    });
    // Each account gets the images, the video or both, as the rows said.
    await Promise.all(visibleVersions(detail).map((version) => {
      const row = chosen.find((item) => accountFor(item).platform === version.platform)
        ?? chosen.find((item) => item.network === socialNetwork(version.platform));
      if (!row?.items.length) return null;
      const own = mediaFor(row.accountId);
      const assetManifest = row.items.map((index, position) => mediaAsset(files.get(own[index]!.key)!, own[index]!.kind, position));
      return social.updatePostVersion(version.id, { assetManifest });
    }));
    emit("close");
    await router.push(`/social/${encodeURIComponent(detail.post.id)}`);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't save the draft. Try again.");
  } finally {
    busy.value = false;
  }
}

</script>

<template>
  <AppDialog :open="open" :labelled-by="titleId" close-on-backdrop @close="emit('close')">
    <div class="new-post">
      <header class="new-post__header">
        <h2 :id="titleId" ref="heading" tabindex="-1">{{ step === "ask" ? "What do you want to post?" : "New post" }}</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="18" />
        </Button>
      </header>

      <input ref="imagesInput" class="visually-hidden" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" @change="addFromDevice">
      <input ref="videoInput" class="visually-hidden" type="file" accept="video/*" tabindex="-1" aria-hidden="true" @change="addFromDevice">
      <input ref="cutInput" class="visually-hidden" type="file" accept="video/*" tabindex="-1" aria-hidden="true" @change="addCut">

      <div v-if="step === 'ask'" class="new-post__ask">
        <button
          v-for="option in OPTIONS"
          :key="option.type"
          type="button"
          class="new-post__option"
          :aria-label="`${option.label}. Reaches ${namesFor(reach[option.type])}.`"
          @click="choose(option.type)"
        >
          <span class="new-post__option-icon" aria-hidden="true"><UiIcon :name="option.icon" :size="18" /></span>
          <span class="new-post__option-label">{{ option.label }}</span>
          <SocialMarks v-if="reach[option.type].length" :platforms="reach[option.type]" aria-hidden="true" />
        </button>
        <button v-if="!listed.length" type="button" class="new-post__quiet" @click="emit('connect')">Connect an account</button>
      </div>

      <form v-else class="new-post__form" @submit.prevent="submit">
        <div class="new-post__switch" role="group" aria-label="What you're posting">
          <button
            v-for="option in OPTIONS"
            :key="option.type"
            type="button"
            :aria-pressed="type === option.type"
            @click="switchType(option.type)"
          >{{ option.label }}</button>
        </div>

        <label class="visually-hidden" :for="`${titleId}-text`">Your words</label>
        <textarea :id="`${titleId}-text`" ref="textarea" v-model="text" rows="5" placeholder="What do you want to say?" :aria-describedby="caption ? `${titleId}-count` : undefined" />
        <p v-if="caption" :id="`${titleId}-count`" class="new-post__count" :class="{ 'is-over': caption.over }" aria-live="polite">{{ caption.text }}</p>

        <template v-if="type !== 'text' && media.length">
          <ul ref="mediaList" class="new-post__media" aria-label="Media, in the order it posts">
            <li
              v-for="(item, index) in media"
              :key="item.key"
              draggable="true"
              @dragstart="dragFrom = index"
              @dragover.prevent
              @drop.prevent="drop(index)"
            >
              <span
                class="new-post__thumb"
                data-thumb
                tabindex="0"
                :aria-label="`${item.kind === 'video' ? 'Video' : 'Image'} ${index + 1} of ${media.length}, ${item.name}. Arrow keys move it.`"
                @keydown.left.prevent="move(index, -1)"
                @keydown.right.prevent="move(index, 1)"
              >
                <video v-if="item.kind === 'video'" :src="item.preview" muted preload="metadata" aria-hidden="true" />
                <img v-else :src="item.preview" alt="">
                <UiIcon v-if="item.kind === 'video'" class="new-post__play" name="Play" :size="12" aria-hidden="true" />
              </span>
              <button type="button" class="new-post__remove" :aria-label="`Remove ${item.name}`" @click="remove(index)">
                <UiIcon name="X" :size="12" />
              </button>
            </li>
          </ul>
          <p class="visually-hidden" aria-live="polite">{{ reorderHelp }}</p>
        </template>

        <div v-if="attachButtons.length" class="new-post__attachments">
          <button v-for="button in attachButtons" :key="button.key" type="button" class="new-post__attach" :disabled="busy" @click="button.open()">
            <UiIcon :name="button.icon" :size="16" /> {{ button.label }}
          </button>
          <button type="button" class="new-post__attach" :disabled="busy" @click="pickerOpen = true">
            <UiIcon name="Folder" :size="16" /> From Files
          </button>
        </div>

        <div v-if="listed.length" class="new-post__accounts-block">
          <div class="new-post__accounts" role="group" aria-label="Post to">
            <button
              v-for="row in rows"
              :key="row.accountId"
              type="button"
              class="new-post__account"
              :class="{ 'is-on': ticks[row.accountId], 'is-cant': !row.canTake }"
              :aria-pressed="ticks[row.accountId] ? 'true' : 'false'"
              :aria-disabled="!row.canTake || undefined"
              :aria-label="accessibleName(row)"
              :aria-describedby="`${titleId}-${row.accountId}-says`"
              :data-tip="says(row)"
              @click="toggle(row)"
            >
              <SocialAccountAvatar
                :network="row.network"
                :avatar-url="accountFor(row).avatarSource === 'provider' ? accountFor(row).avatarUrl : null"
                :name="accountName(accountFor(row))"
                :selected="ticks[row.accountId]"
                :size="40"
              />
              <span v-if="namedRow(row)" class="new-post__name" aria-hidden="true">{{ accountName(accountFor(row)) }}</span>
              <span :id="`${titleId}-${row.accountId}-says`" class="visually-hidden">{{ says(row) }}</span>
            </button>
          </div>
          <ul v-if="noteRows.length" class="new-post__notes">
            <li v-for="row in noteRows" :key="row.accountId">
              <span class="new-post__note-who">{{ networkLabel(accountFor(row).platform) }}</span>
              <span :class="{ 'is-warn': row.tone === 'warn' && row.canTake }">{{ row.canTake ? row.label : row.reason }}</span>
              <span v-if="cuts[row.accountId] && type !== 'text'" class="new-post__cut">
                Its own cut: {{ cuts[row.accountId]!.name }}
                <button type="button" class="new-post__action" @click="dropCut(row.accountId)">
                  Use the original<span class="visually-hidden"> for {{ accessibleName(row) }}</span>
                </button>
              </span>
              <template v-for="action in row.actions" :key="action.kind">
                <a v-if="action.href" class="new-post__action" :href="action.href" target="_blank" rel="noopener">
                  {{ action.label }}<span class="visually-hidden"> (opens YouTube)</span>
                </a>
                <button v-else type="button" class="new-post__action" @click="runAction(row, action)">
                  {{ action.label }}<span class="visually-hidden"> for {{ accessibleName(row) }}</span>
                </button>
              </template>
            </li>
          </ul>
        </div>
        <button v-if="canConnectMore || !listed.length" type="button" class="new-post__quiet" @click="emit('connect')">
          {{ listed.length ? "Connect another account" : "Connect an account to post" }}
        </button>

        <footer class="new-post__footer">
          <Button type="submit" color="primary" shape="pill" size="compact" :disabled="busy || !text.trim() || !tickedRows.length">
            {{ reviewLabel }}
          </Button>
        </footer>
      </form>
    </div>
  </AppDialog>

  <FilesMediaPicker
    :open="pickerOpen"
    :kinds="type === 'video' ? ['video', 'image'] : ['image', 'video']"
    @close="pickerOpen = false"
    @select="addFromFiles"
  />
</template>

<style scoped>
.new-post {
  box-sizing: border-box;
  display: grid;
  gap: 14px;
  width: min(500px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
  padding: 16px 18px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  color: var(--ui-text);
  box-shadow: var(--ui-shadow-md);
}
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.new-post__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.new-post__header h2 { margin: 0; font-size: 17px; font-weight: 650; }
.new-post__header h2:focus { outline: none; }
.new-post__header h2:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; border-radius: var(--ui-radius-sm); }

.new-post__ask { display: grid; gap: 8px; }
.new-post__option {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 64px;
  padding: 12px;
  border: 0;
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.new-post__option:hover { background: color-mix(in srgb, var(--ui-surface-muted) 80%, var(--ui-text) 6%); }
.new-post__option:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }
.new-post__option-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--ui-radius-sm); background: var(--ui-surface); }
.new-post__option-label { font-size: 15px; font-weight: 600; }

.new-post__form { display: grid; gap: 12px; }
/* The same pill switch as Social's Drafts · Scheduled · Posted tabs. */
.new-post__switch { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.new-post__switch button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.new-post__switch button:hover, .new-post__switch button:focus-visible { color: var(--ui-text); outline: none; }
.new-post__switch button:focus-visible { box-shadow: inset 0 0 0 2px var(--ui-focus); }
.new-post__switch button[aria-pressed="true"] { background: var(--ui-surface); color: var(--ui-text); font-weight: 750; box-shadow: var(--ui-shadow-sm); }
.new-post textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 110px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  resize: vertical;
}
.new-post textarea:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 1px; }
.new-post__count { margin: -6px 0 0; color: var(--ui-text-muted); font-size: var(--ui-font-size-sm, 13px); text-align: right; }
.new-post__count.is-over { color: var(--ui-text); text-align: left; }

.new-post__media { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.new-post__media li { position: relative; }
.new-post__thumb {
  position: relative;
  display: block;
  width: 60px;
  height: 60px;
  overflow: hidden;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
  cursor: grab;
}
.new-post__thumb:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }
.new-post__thumb img, .new-post__thumb video { width: 100%; height: 100%; object-fit: cover; }
.new-post__play { position: absolute; left: 5px; top: 5px; color: #fff; filter: drop-shadow(0 1px 1px rgb(0 0 0 / .6)); }
.new-post__remove {
  position: absolute;
  top: -6px;
  right: -6px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 2px solid var(--ui-surface);
  border-radius: 50%;
  background: var(--ui-text);
  color: var(--ui-surface);
  cursor: pointer;
}
.new-post__remove:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 1px; }

.new-post__accounts-block { display: grid; gap: 6px; min-width: 0; }
.new-post__accounts { display: flex; flex-wrap: wrap; gap: 4px; }
.new-post__account {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
  min-width: 48px;
  min-height: 48px;
  padding: 4px;
  border: 0;
  border-radius: var(--ui-radius-md);
  background: none;
  color: var(--ui-text);
  font: inherit;
  cursor: pointer;
}
.new-post__account:hover { background: var(--ui-surface-muted); }
.new-post__account:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 1px; }
/* Chosen: full colour with a ring, so it doesn't rest on colour alone. */
.new-post__account.is-on :deep(.social-avatar__face) { box-shadow: 0 0 0 2px var(--ui-surface), 0 0 0 4px var(--ui-accent, #229874); }
/* Can't take this post: fainter than unchosen, crossed out, and no pointer. */
.new-post__account.is-cant { cursor: not-allowed; }
.new-post__account.is-cant:hover { background: none; }
.new-post__account.is-cant :deep(.social-avatar) { opacity: .45; }
.new-post__account.is-cant::before {
  content: "";
  position: absolute;
  top: 24px;
  left: 50%;
  z-index: 1;
  width: 38px;
  height: 2px;
  border-radius: 1px;
  background: var(--ui-text-muted);
  transform: translateX(-50%) rotate(-45deg);
  pointer-events: none;
}
.new-post__account[data-tip]:hover::after,
.new-post__account[data-tip]:focus-visible::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  z-index: 2;
  width: max-content;
  max-width: 220px;
  padding: 6px 9px;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-text);
  color: var(--ui-surface);
  font: 500 12.5px / 1.35 var(--font-sans);
  text-align: left;
  transform: translateX(-50%);
  pointer-events: none;
}
/* Keep the tooltip inside the dialog at either end of the row. */
.new-post__account:first-child[data-tip]::after { left: 0; transform: none; }
.new-post__account:last-child[data-tip]:not(:first-child)::after { right: 0; left: auto; transform: none; }
.new-post__name { max-width: 6em; overflow: hidden; font-size: 11.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.new-post__notes { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: var(--ui-font-size-sm, 13px); line-height: 1.35; }
.new-post__notes li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.new-post__note-who { font-weight: 600; }
.new-post__notes .is-warn { font-weight: 550; }
.new-post__cut { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; color: var(--ui-text-muted); overflow-wrap: anywhere; }
.new-post__action, .new-post__quiet {
  justify-self: start;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--ui-accent-strong, var(--ui-accent));
  font: 550 var(--ui-font-size-sm, 13px) / 1.3 var(--font-sans);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.new-post__quiet { color: var(--ui-text-muted); font-weight: 500; text-decoration: none; }
.new-post__quiet:hover { color: var(--ui-text); text-decoration: underline; }
.new-post__action:focus-visible, .new-post__quiet:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }

.new-post__footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.new-post__attachments { display: flex; flex-wrap: wrap; gap: 2px; margin: -4px 0 0 -10px; }
.new-post__attach {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--ui-text-muted);
  font: 500 var(--ui-font-size-sm, 13px) / 1 var(--font-sans);
  cursor: pointer;
}
.new-post__attach:hover, .new-post__attach:focus-visible { background: var(--ui-surface-muted); color: var(--ui-text); outline: none; }

@media (max-width: 640px) {
  .new-post__switch button { padding: 0 6px; font-size: 13px; }
  .new-post { width: 100vw; max-height: 92dvh; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; padding-bottom: 28px; }
}
</style>
