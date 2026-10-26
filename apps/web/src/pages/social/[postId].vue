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
import SocialAccountsSheet from "../../components/social/SocialAccountsSheet.vue";
import SocialMarks from "../../components/social/SocialMarks.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useSocialData } from "../../composables/useSocialData";
import type { DriveFile, PostVersion, SocialMediaAsset, SocialPlatform, SocialPostDetail } from "../../stores/social";
import { uploadDriveFiles } from "../../utils/drive-upload";
import {
  accountName,
  activeAccount,
  formatShortWhen,
  formatWhen,
  networkLabel,
  postTitle,
  resultFor,
  SOCIAL_NETWORKS,
  socialNetwork,
  suggestedTime,
  versionChecks,
  versionTextLimit,
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
const busy = ref<"schedule" | "post" | "move" | "cancel" | "delete" | "upload" | "add" | null>(null);
const accountsOpen = ref(false);
const confirmDelete = ref(false);
const confirmCancel = ref(false);
const editor = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);
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
const schedulable = computed(() =>
  pending.value.filter((version) => capabilities.value.find((item) => item.platform === version.platform)?.schedule !== false),
);
const blockers = computed(() =>
  pending.value.filter((version) => versionChecks(withText(version), capabilities.value, accounts.value).some((check) => check.blocking)),
);
const scheduledIso = computed(() => {
  const resolved = resolveLocalDateTimeToUtc(when.value.date, when.value.time, timezone);
  return resolved.ok ? resolved.value : null;
});
const scheduleInPast = computed(() => Boolean(scheduledIso.value && Date.parse(scheduledIso.value) < Date.now() + 60_000));
const scheduleLabel = computed(() => {
  const count = schedulable.value.length;
  const at = scheduledIso.value ? ` for ${formatShortWhen(scheduledIso.value)}` : "";
  return `Schedule ${count} post${count === 1 ? "" : "s"}${at}`;
});
const postNowLabel = computed(() => {
  const count = pending.value.length;
  return count > 1 ? `Post to ${count} platforms now` : "Post now";
});
const results = computed(() =>
  versions.value
    .map((version) => ({ version, result: resultFor(version) }))
    .filter(({ result }) => result.state !== "draft"),
);
const activeChecks = computed(() => (active.value ? versionChecks(withText(active.value), capabilities.value, accounts.value) : []));
const activeImages = computed(() => (active.value?.assetManifest || []).filter((asset) => asset.kind !== "video"));
const activeVideo = computed(() => (active.value?.assetManifest || []).find((asset) => asset.kind === "video") || null);
/** Connected platforms this post doesn't go to yet, so the owner can add one. */
const addableNetworks = computed(() =>
  SOCIAL_NETWORKS.filter(
    (network) =>
      activeAccount(network.id, accounts.value) &&
      !versions.value.some((version) => socialNetwork(version.platform) === network.id),
  ),
);
const activeLimit = computed(() => (active.value ? versionTextLimit(active.value, capabilities.value) : null));
const activeLength = computed(() => (active.value ? Array.from(texts.value[active.value.id] ?? "").length : 0));
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
  const images = version.assetManifest.filter((asset) => asset.kind !== "video").length;
  if (images > 1) return `${images} images`;
  const limit = versionTextLimit(version, capabilities.value);
  const length = Array.from(texts.value[version.id] ?? version.bodyText).length;
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
  setDetail(await social.fetchSocialPost(postId.value));
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

function moveImage(index: number, offset: -1 | 1) {
  const images = [...activeImages.value];
  const target = index + offset;
  if (target < 0 || target >= images.length) return;
  [images[index], images[target]] = [images[target]!, images[index]!];
  setImages(images);
}

function removeImage(index: number) {
  setImages(activeImages.value.filter((_, position) => position !== index));
}

function describeImage(index: number, altText: string) {
  const images = activeImages.value.map((asset, position) => (position === index ? { ...asset, altText } : asset));
  setImages(images);
}

async function addImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []).filter((file) => file.type.startsWith("image/"));
  input.value = "";
  if (!files.length || !active.value || busy.value) return;
  busy.value = "upload";
  try {
    const uploaded = await uploadDriveFiles<DriveFile>(files, { folderId: null, onConflict: "rename" });
    const added: SocialMediaAsset[] = uploaded.map((file) => ({
      url: `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(file.id)}/content`,
      fileId: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      kind: "image",
      altText: "",
      contentHash: file.sha256 ? `sha256:${file.sha256.toLowerCase()}` : undefined,
      byteLength: file.size,
    }));
    setImages([...activeImages.value, ...added]);
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

function setTitle(version: PostVersion, title: string) {
  replaceVersion({ ...version, title });
  void saveVersion(version, { title });
}

async function addVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = Array.from(input.files || []).find((item) => item.type.startsWith("video/"));
  input.value = "";
  const version = active.value;
  if (!file || !version || busy.value) return;
  busy.value = "upload";
  try {
    const [uploaded] = await uploadDriveFiles<DriveFile>([file], { folderId: null, onConflict: "rename" });
    if (!uploaded) throw new Error("The video didn't upload.");
    const video: SocialMediaAsset = {
      url: `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(uploaded.id)}/content`,
      fileId: uploaded.id,
      filename: uploaded.filename,
      mimeType: uploaded.mimeType,
      kind: "video",
      altText: "",
      contentHash: uploaded.sha256 ? `sha256:${uploaded.sha256.toLowerCase()}` : undefined,
      byteLength: uploaded.size,
      assetIndex: 0,
    };
    // A Short is exactly one video.
    replaceVersion({ ...version, assetManifest: [video] });
    await saveVersion(version, { assetManifest: [video] });
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't add that video.");
  } finally {
    busy.value = null;
  }
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
  if (busy.value || !scheduledIso.value || scheduleInPast.value || blockers.value.length || !schedulable.value.length) return;
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
  const targets = only ? [only] : pending.value;
  if (!targets.length || (!only && blockers.value.length)) return;
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
  }
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
          <div class="post-editor__main">
            <label class="visually-hidden" :for="`post-text-${active.id}`">{{ networkLabel(active.platform) }} text</label>
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
            />
            <div class="post-field-foot">
              <span>
                {{ networkLabel(active.platform) }} only<template v-if="activeAccountLabel"> · {{ activeAccountLabel }}</template>
                <template v-if="activeLimit && activeLimit < 10000"> · {{ activeLength }}/{{ activeLimit }}</template>
                <template v-if="savingIds.has(active.id)"> · Saving…</template>
              </span>
              <span v-if="!activeLocked && pending.length > 1" class="post-field-foot__links">
                <button type="button" @click="useTextEverywhere">Use the same text everywhere</button>
                <button v-if="activeImages.length" type="button" @click="useImagesEverywhere">Same images everywhere</button>
              </span>
            </div>

            <ul v-if="activeChecks.some((check) => check.field === 'text' || check.field === 'account')" class="post-checks">
              <li v-for="check in activeChecks.filter((item) => item.field !== 'images')" :key="check.message">
                <span class="post-checks__icon" aria-hidden="true">!</span>
                <span>{{ check.message }}</span>
                <button v-if="check.field === 'account'" type="button" @click="accountsOpen = true">Connect</button>
              </li>
            </ul>

            <div v-if="active.platform !== 'youtube'" class="post-images">
              <ol v-if="activeImages.length" class="post-images__list" aria-label="Images, in order">
                <li v-for="(asset, index) in activeImages" :key="`${asset.fileId || asset.url}-${index}`" class="post-image">
                  <span class="post-image__thumb">
                    <img :src="asset.url" :alt="asset.altText || ''" loading="lazy">
                    <small>{{ index + 1 }}</small>
                  </span>
                  <label class="visually-hidden" :for="`social-image-alt-${index}`">Description for image {{ index + 1 }}</label>
                  <input
                    :id="`social-image-alt-${index}`"
                    class="post-image__alt"
                    :value="asset.altText || ''"
                    :readonly="activeLocked"
                    placeholder="Description (optional)"
                    @change="describeImage(index, ($event.target as HTMLInputElement).value)"
                  >
                  <span v-if="!activeLocked" class="post-image__tools">
                    <Button color="ghost" shape="soft" size="small" icon-only :aria-label="`Move image ${index + 1} earlier`" :disabled="index === 0" @click="moveImage(index, -1)">
                      <UiIcon name="ChevronLeft" :size="15" />
                    </Button>
                    <Button color="ghost" shape="soft" size="small" icon-only :aria-label="`Move image ${index + 1} later`" :disabled="index === activeImages.length - 1" @click="moveImage(index, 1)">
                      <UiIcon name="ChevronRight" :size="15" />
                    </Button>
                    <Button color="ghost" shape="soft" size="small" icon-only :aria-label="`Remove image ${index + 1}`" @click="removeImage(index)">
                      <UiIcon name="X" :size="15" />
                    </Button>
                  </span>
                </li>
              </ol>
              <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" multiple @change="addImages">
              <button v-if="!activeLocked" type="button" class="post-images__add" :disabled="busy === 'upload'" @click="fileInput?.click()">
                <UiIcon name="Plus" :size="15" /> {{ busy === "upload" ? "Adding…" : activeImages.length ? "Add image" : "Add your own images" }}
              </button>
              <ul v-if="activeChecks.some((check) => check.field === 'images')" class="post-checks">
                <li v-for="check in activeChecks.filter((item) => item.field === 'images')" :key="check.message">
                  <span class="post-checks__icon" aria-hidden="true">!</span>
                  <span>{{ check.message }}</span>
                </li>
              </ul>
            </div>
            <div v-else class="post-video">
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
              <div v-if="activeVideo" class="post-video__file">
                <UiIcon name="Youtube" :size="16" />
                <span>{{ activeVideo.filename || "Video" }}</span>
                <Button v-if="!activeLocked" color="ghost" shape="soft" size="small" icon-only aria-label="Remove video" @click="removeVideo">
                  <UiIcon name="X" :size="15" />
                </Button>
              </div>
              <input ref="videoInput" class="visually-hidden" type="file" accept="video/*" @change="addVideo">
              <button v-if="!activeLocked" type="button" class="post-images__add" :disabled="busy === 'upload'" @click="videoInput?.click()">
                <UiIcon name="Plus" :size="15" /> {{ busy === "upload" ? "Adding…" : activeVideo ? "Replace video" : "Add your video" }}
              </button>
              <ul v-if="activeChecks.some((check) => check.field === 'images')" class="post-checks">
                <li v-for="check in activeChecks.filter((item) => item.field === 'images')" :key="check.message">
                  <span class="post-checks__icon" aria-hidden="true">!</span>
                  <span>{{ check.message }}</span>
                </li>
              </ul>
              <p class="post-note">Uploads as a private draft. You publish it in YouTube.</p>
            </div>
          </div>

          <aside class="post-preview" aria-label="Preview">
            <div class="post-preview__who">
              <SocialMarks :platforms="[active.platform]" />
              <b>{{ activeAccountLabel || networkLabel(active.platform) }}</b>
            </div>
            <img v-if="activeImages[0]" class="post-preview__image" :src="activeImages[0].url" :alt="activeImages[0].altText || ''">
            <p>{{ texts[active.id] ?? active.bodyText }}</p>
          </aside>
        </section>

        <footer v-if="pending.length || scheduledVersions.length" class="post-bar">
          <div class="post-bar__when">
            <label class="visually-hidden" for="post-date">Day</label>
            <input id="post-date" v-model="when.date" type="date">
            <label class="visually-hidden" for="post-time">Time</label>
            <input id="post-time" v-model="when.time" type="time">
            <span v-if="scheduleInPast" class="post-bar__hint">Pick a time in the future.</span>
            <span v-else-if="blockers.length" class="post-bar__hint">Fix the marked problems first.</span>
          </div>
          <div class="post-bar__actions">
            <template v-if="scheduledVersions.length && !pending.length">
              <Button class="post-header__quiet" color="ghost" shape="soft" size="compact" :disabled="busy !== null" @click="confirmCancel = true">Cancel schedule</Button>
              <Button color="primary" shape="pill" size="compact" :disabled="busy !== null || !scheduledIso || scheduleInPast" @click="moveSchedule">
                {{ busy === "move" ? "Moving…" : scheduledIso ? `Move to ${formatShortWhen(scheduledIso)}` : "Move" }}
              </Button>
            </template>
            <template v-else>
              <Button color="outline" shape="pill" size="compact" :disabled="busy !== null || blockers.length > 0" @click="postNow()">
                {{ busy === "post" ? "Posting…" : postNowLabel }}
              </Button>
              <Button
                v-if="schedulable.length"
                color="primary"
                shape="pill"
                size="compact"
                :disabled="busy !== null || blockers.length > 0 || !scheduledIso || scheduleInPast"
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
.post-editor__main { display: grid; align-content: start; gap: 10px; min-width: 0; }
.post-field, .post-image__alt, .post-bar__when input {
  box-sizing: border-box;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: 14px/1.5 var(--font-sans);
}
.post-field { width: 100%; padding: 10px 12px; resize: vertical; }
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
.post-checks { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12.5px; }
.post-checks li { display: flex; align-items: center; gap: 8px; }
.post-checks__icon { display: inline-grid; flex: none; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: var(--ui-danger); color: #fff; font-size: 10px; font-weight: 700; }

.post-images { display: grid; gap: 8px; }
.post-images__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.post-image { display: flex; align-items: center; gap: 8px; }
.post-image__thumb { position: relative; flex: none; width: 48px; height: 48px; overflow: hidden; border-radius: var(--ui-radius-sm); background: var(--ui-surface-muted); }
.post-image__thumb img { width: 100%; height: 100%; object-fit: cover; }
.post-image__thumb small { position: absolute; top: 2px; left: 4px; color: #fff; font-size: 10px; font-weight: 700; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
.post-image__alt { flex: 1 1 auto; min-width: 0; padding: 6px 10px; font-size: 13px; }
.post-image__tools { display: inline-flex; flex: none; }
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

.post-preview { display: grid; align-content: start; gap: 8px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); font-size: 13px; }
.post-preview__who { display: flex; align-items: center; gap: 8px; }
.post-preview__image { width: 100%; aspect-ratio: 1; border-radius: var(--ui-radius-sm); object-fit: cover; }
.post-preview p { display: -webkit-box; margin: 0; overflow: hidden; white-space: pre-wrap; -webkit-line-clamp: 8; -webkit-box-orient: vertical; }

.post-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--ui-border); }
.post-bar__when { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.post-bar__when input { padding: 6px 10px; font-size: 13px; }
.post-bar__hint { color: var(--ui-danger); font-size: 12.5px; }
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
