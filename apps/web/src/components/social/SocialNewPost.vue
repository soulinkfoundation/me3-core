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
  networkLabel,
  newPostAccounts,
  newPostCaptionNote,
  socialNetwork,
  visibleVersions,
  youtubeTitleFrom,
} from "../../utils/social-posts";

/**
 * New post (me3-hzsw): ask what's being posted, then tick every connected account that can
 * take it. What each account gets comes from the shared rules in packages/social-publishing,
 * so web and iPhone say the same thing. The words and media are always the owner's own.
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
/** Ticks the owner changed by hand, kept across type switches where the account can still take the post. */
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
      .map(({ account, network }) => ({ id: account.id, network, tiktokMaxVideoSeconds: tiktokMax.value[account.id] ?? null })),
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
 * Whether a row is ticked. One post holds one version per platform, so when two accounts
 * share a platform only one can be ticked; the first starts ticked.
 */
const ticks = computed(() => {
  const result: Record<string, boolean> = {};
  const taken = new Set<string>();
  for (const row of rows.value) {
    const item = listed.value.find(({ account }) => account.id === row.accountId)!;
    const hand = handTicks.value[row.accountId];
    const ticked = row.canTake && (hand ?? row.ticked) && !taken.has(item.account.platform);
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

function toggle(event: Event, row: ComposerRow) {
  if (!row.canTake) {
    event.preventDefault();
    return;
  }
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

/** From the question: Text goes to writing; Images and Video open the picker straight away. */
function choose(postType: ComposerPostType) {
  type.value = postType;
  step.value = "compose";
  if (postType === "images") imagesInput.value?.click();
  else if (postType === "video") videoInput.value?.click();
  void nextTick(() => (postType === "text" ? textarea.value?.focus() : heading.value?.focus()));
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
  const kind: ComposerMediaKind = postType === "video" ? "video" : "image";
  if (postType !== "text" && !media.value.some((item) => item.kind === kind)) {
    (postType === "video" ? videoInput : imagesInput).value?.click();
  }
}

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

        <fieldset v-if="listed.length" class="new-post__rows">
          <legend class="visually-hidden">Post to</legend>
          <div v-for="row in rows" :key="row.accountId" class="new-post__row" :class="{ 'is-cant': !row.canTake }">
            <input
              :id="`${titleId}-${row.accountId}`"
              type="checkbox"
              :checked="ticks[row.accountId]"
              :aria-disabled="!row.canTake || undefined"
              :aria-describedby="`${titleId}-${row.accountId}-says`"
              @click="toggle($event, row)"
            >
            <label :for="`${titleId}-${row.accountId}`" class="new-post__who">
              <SocialAccountAvatar
                class="new-post__avatar"
                :network="row.network"
                :avatar-url="accountFor(row).avatarSource === 'provider' ? accountFor(row).avatarUrl : null"
                :name="accountName(accountFor(row))"
                :size="30"
              />
              <span class="visually-hidden">{{ accessibleName(row) }}</span>
              <span v-if="namedRow(row)" class="new-post__name" aria-hidden="true">{{ accountName(accountFor(row)) }}</span>
            </label>
            <span :id="`${titleId}-${row.accountId}-says`" class="new-post__says" :class="{ 'is-warn': row.tone === 'warn' && row.canTake }">
              {{ row.canTake ? row.label : row.reason }}
              <span v-if="row.hint" class="new-post__hint">{{ row.hint }}</span>
            </span>
            <span v-if="cuts[row.accountId] && type !== 'text'" class="new-post__cut">
              Its own cut: {{ cuts[row.accountId]!.name }}
              <button type="button" class="new-post__action" @click="dropCut(row.accountId)">
                Use the original<span class="visually-hidden"> for {{ accessibleName(row) }}</span>
              </button>
            </span>
            <span v-if="row.actions.length" class="new-post__actions">
              <button v-for="action in row.actions" :key="action.kind" type="button" class="new-post__action" @click="runAction(row, action)">
                {{ action.label }}<span class="visually-hidden"> for {{ accessibleName(row) }}</span>
              </button>
            </span>
          </div>
        </fieldset>
        <button type="button" class="new-post__quiet" @click="emit('connect')">
          {{ listed.length ? "Connect another account" : "Connect an account to post" }}
        </button>

        <footer class="new-post__footer">
          <div class="new-post__attachments">
            <button v-if="type === 'images'" type="button" class="new-post__attach" :disabled="busy" @click="videoInput?.click()">
              <UiIcon name="Plus" :size="16" /> {{ media.some((item) => item.kind === "video") ? "Change the video" : "Add a video" }}
            </button>
            <button v-if="type === 'video'" type="button" class="new-post__attach" :disabled="busy" @click="imagesInput?.click()">
              <UiIcon name="Plus" :size="16" /> Add images
            </button>
            <button v-if="type === 'images' && !media.some((item) => item.kind === 'image')" type="button" class="new-post__attach" :disabled="busy" @click="imagesInput?.click()">
              <UiIcon name="Plus" :size="16" /> Pick images
            </button>
            <button v-if="type !== 'text'" type="button" class="new-post__attach" :disabled="busy" @click="pickerOpen = true">
              <UiIcon name="Folder" :size="16" /> From Files
            </button>
          </div>
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
.new-post__switch { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 3px; border-radius: var(--ui-radius-md); background: var(--ui-surface-muted); }
.new-post__switch button {
  min-height: 34px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: none;
  color: var(--ui-text-muted);
  font: 550 var(--ui-font-size-sm, 13px) / 1 var(--font-sans);
  cursor: pointer;
}
.new-post__switch button[aria-pressed="true"] { background: var(--ui-primary); color: var(--ui-primary-contrast); }
.new-post__switch button:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 1px; }
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

.new-post__rows { display: grid; margin: 0; padding: 0; border: 0; min-width: 0; }
.new-post__row {
  display: grid;
  grid-template-columns: 20px auto minmax(0, 1fr);
  column-gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-top: 1px solid var(--ui-border);
}
.new-post__row:first-of-type { border-top: 0; }
.new-post__row input { width: 18px; height: 18px; margin: 0; accent-color: var(--ui-accent, #229874); cursor: pointer; }
.new-post__row input:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }
.new-post__who { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
.new-post__name { max-width: 9em; overflow: hidden; font-size: var(--ui-font-size-sm, 13px); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.new-post__says { min-width: 0; font-size: 13.5px; line-height: 1.35; }
.new-post__hint { display: block; color: var(--ui-text-muted); font-size: var(--ui-font-size-sm, 13px); }
.new-post__says.is-warn { color: var(--ui-text); font-weight: 550; }
.new-post__actions { grid-column: 3; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.new-post__cut { grid-column: 3; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; color: var(--ui-text-muted); font-size: var(--ui-font-size-sm, 13px); overflow-wrap: anywhere; }
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
/* Rows that can't take the post fade only the tick box and logo; the reason keeps full contrast. */
.new-post__row.is-cant input { opacity: .4; cursor: not-allowed; }
.new-post__row.is-cant .new-post__avatar { opacity: .45; }
.new-post__row.is-cant .new-post__who { cursor: not-allowed; }
.new-post__row.is-cant .new-post__says { color: var(--ui-text-muted); }

.new-post__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.new-post__attachments { display: flex; flex-wrap: wrap; gap: 2px; }
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
  .new-post { width: 100vw; max-height: 92dvh; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; padding-bottom: 28px; }
}
</style>
