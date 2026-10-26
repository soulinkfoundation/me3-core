<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AppDialog from "../../components/AppDialog.vue";
import AppPageBar from "../../components/AppPageBar.vue";
import Button from "../../components/Button.vue";
import PageLoading from "../../components/PageLoading.vue";
import UiIcon from "../../components/UiIcon.vue";
import FilesMediaPicker from "../../components/files/FilesMediaPicker.vue";
import SocialAccountAvatar from "../../components/social/SocialAccountAvatar.vue";
import SocialAccountsSheet from "../../components/social/SocialAccountsSheet.vue";
import SocialMarks from "../../components/social/SocialMarks.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useSocialData } from "../../composables/useSocialData";
import { API_BASE } from "../../api";
import type { DriveFile, SocialMediaAsset, SocialPlatform, SocialSuggestion } from "../../stores/social";
import { uploadDriveFiles } from "../../utils/drive-upload";
import {
  SOCIAL_NETWORKS,
  SOCIAL_TABS,
  accountState,
  activeAccount,
  attentionItems,
  formatWhen,
  ideaSourceLabel,
  ideaTitle,
  lastPostedAt,
  networkLabel,
  youtubeTitleFrom,
  nextScheduledAt,
  postRowDetail,
  postTab,
  postTitle,
  visibleVersions,
  type SocialNetwork,
  type SocialTab,
} from "../../utils/social-posts";

definePage({
  meta: {
    requiresAuth: true,
    title: "Social | ME3",
    description: "Post to X, LinkedIn, Instagram and Facebook in your own words.",
    robots: "noindex,follow",
  },
});

const route = useRoute();
const router = useRouter();
const { toastError, toastSuccess, toastFromUnknown } = useAppToast();
const data = useSocialData();
const { social, accounts, posts, capabilities, siteId, hostedPlatforms } = data;
const ideas = ref<SocialSuggestion[]>([]);
const tab = ref<SocialTab>(tabFromQuery(route.query.tab));
const accountsOpen = ref(false);
const composerOpen = ref(false);
const composerText = ref("");
const composerNetworks = ref<SocialNetwork[]>([]);
const composerBusy = ref(false);
/** Media for the new post: a device upload (`file`) or something already in Files (`driveFile`). */
type ComposerMedia = { kind: "image" | "video"; name: string; preview: string; file?: File; driveFile?: DriveFile };
const composerMedia = ref<ComposerMedia[]>([]);
const composerPickerOpen = ref(false);
const composerMediaInput = ref<HTMLInputElement | null>(null);
const ideaBusy = ref<string | null>(null);
const composerTitleId = `social-new-post-${useId()}`;

function tabFromQuery(value: unknown): SocialTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return SOCIAL_TABS.some((item) => item.id === raw) ? (raw as SocialTab) : "scheduled";
}

const openIdeas = computed(() => ideas.value.filter((idea) => idea.status === "suggested" || idea.status === "choosing"));
const rowsByTab = computed(() => {
  const groups: Record<Exclude<SocialTab, "ideas">, typeof posts.value> = { drafts: [], scheduled: [], posted: [] };
  for (const detail of posts.value) {
    if (visibleVersions(detail).length === 0) continue;
    groups[postTab(detail)].push(detail);
  }
  groups.scheduled.sort((a, b) => (nextScheduledAt(a) || "9").localeCompare(nextScheduledAt(b) || "9"));
  groups.posted.sort((a, b) => (lastPostedAt(b) || "").localeCompare(lastPostedAt(a) || ""));
  groups.drafts.sort((a, b) => b.post.updatedAt.localeCompare(a.post.updatedAt));
  return groups;
});
const counts = computed<Record<SocialTab, number>>(() => ({
  ideas: openIdeas.value.length,
  drafts: rowsByTab.value.drafts.length,
  scheduled: rowsByTab.value.scheduled.length,
  posted: rowsByTab.value.posted.length,
}));
const attention = computed(() => attentionItems(posts.value, accounts.value));
const connectedNetworks = computed(() =>
  SOCIAL_NETWORKS.filter((network) => accountState(network.id, accounts.value) !== "not_connected").map((network) => network.id),
);
const emptyText = computed(() => {
  if (tab.value === "ideas") return "No ideas yet";
  if (tab.value === "drafts") return "No drafts";
  if (tab.value === "scheduled") return "Nothing scheduled";
  return "Nothing posted yet";
});

watch(tab, (next) => {
  void router.replace({ query: { ...route.query, tab: next === "scheduled" ? undefined : next } });
});

function rowWhen(detail: (typeof posts.value)[number]): string {
  if (postTab(detail) === "posted") return formatWhen(lastPostedAt(detail));
  if (postTab(detail) === "scheduled") return formatWhen(nextScheduledAt(detail));
  return "";
}

function moveTab(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const index = SOCIAL_TABS.findIndex((item) => item.id === tab.value);
  const next = SOCIAL_TABS[(index + (event.key === "ArrowRight" ? 1 : SOCIAL_TABS.length - 1)) % SOCIAL_TABS.length]!;
  tab.value = next.id;
  document.getElementById(`social-tab-${next.id}`)?.focus();
}

async function loadIdeas() {
  ideas.value = await social.fetchSocialSuggestions("").catch(() => []);
}

async function refresh() {
  await Promise.all([data.loadAccounts(), data.loadPosts(), loadIdeas()]);
}

/** Plain words for the error codes the hosted sign-in bridge sends back. */
function connectErrorMessage(code: string): string {
  const network = code.split("_")[0] || "";
  const label = ["x", "linkedin", "instagram", "facebook", "youtube"].includes(network) ? networkLabel(network) : "That account";
  if (code === "facebook_no_page") return "Facebook didn't share a Page ME3 can post to. Try again and pick a Page.";
  if (code === "config" || code.endsWith("_config")) return `${label} isn't available to connect yet. ME3 needs to finish setting it up.`;
  if (code === "access_denied" || code === "user_denied") return `${label} wasn't connected because access wasn't allowed.`;
  if (code === "state_expired") return "That took too long. Try connecting again.";
  return `${label} didn't connect. Try again.`;
}

function handleOAuthReturn() {
  const connected = typeof route.query.social_connected === "string" ? route.query.social_connected : "";
  const failed = typeof route.query.social_error === "string" ? route.query.social_error : "";
  if (!connected && !failed) return;
  if (connected) toastSuccess(`${networkLabel(connected)} connected.`);
  if (failed) {
    toastError(connectErrorMessage(failed));
  }
  const query = { ...route.query };
  delete query.social_connected;
  delete query.social_error;
  void router.replace({ query });
}

function platformFor(network: SocialNetwork): SocialPlatform {
  const account = activeAccount(network as SocialPlatform, accounts.value);
  return (account?.platform as SocialPlatform) || network;
}

/** Every network except YouTube, plus YouTube once it's connected (it needs a video, so it starts unticked). */
const composerChoices = computed(() =>
  SOCIAL_NETWORKS.filter((network) => network.id !== "youtube" || connectedNetworks.value.includes("youtube")),
);

function openComposer() {
  composerText.value = "";
  clearComposerMedia();
  composerNetworks.value = connectedNetworks.value.filter((network) => network !== "youtube");
  if (!composerNetworks.value.length) composerNetworks.value = ["x", "linkedin"];
  composerOpen.value = true;
}

function toggleComposerNetwork(network: SocialNetwork) {
  composerNetworks.value = composerNetworks.value.includes(network)
    ? composerNetworks.value.filter((item) => item !== network)
    : [...composerNetworks.value, network];
}

const composerImages = computed(() => composerMedia.value.filter((item) => item.kind === "image"));
const composerVideo = computed(() => composerMedia.value.find((item) => item.kind === "video") || null);

/** Avatar and name for each network in the New post dialog; falls back to the owner's picture from another network. */
function composerAccount(network: SocialNetwork) {
  const account = activeAccount(network as SocialPlatform, accounts.value);
  const fallback = accounts.value.find((item) => item.status === "active" && item.avatarUrl);
  return {
    avatarUrl: account?.avatarUrl || fallback?.avatarUrl || null,
    name: account?.displayName || account?.handle || fallback?.displayName || fallback?.handle || null,
    handle: account?.handle || null,
  };
}

function addComposerItem(item: ComposerMedia) {
  // One video per post: a new one replaces the old.
  if (item.kind === "video") {
    for (const old of composerMedia.value.filter((media) => media.kind === "video")) releasePreview(old);
    composerMedia.value = composerMedia.value.filter((media) => media.kind !== "video");
  }
  composerMedia.value = [...composerMedia.value, item];
}

function releasePreview(item: ComposerMedia) {
  if (item.file) URL.revokeObjectURL(item.preview);
}

function addComposerFiles(files: DriveFile[]) {
  for (const driveFile of files) {
    if (composerMedia.value.some((item) => item.driveFile?.id === driveFile.id)) continue;
    addComposerItem({
      kind: driveFile.mimeType.startsWith("video/") ? "video" : "image",
      name: driveFile.filename,
      preview: `${API_BASE.replace(/\/$/, "")}/files/${encodeURIComponent(driveFile.id)}/content`,
      driveFile,
    });
  }
}

function addComposerMedia(event: Event) {
  const input = event.target as HTMLInputElement;
  const picked = Array.from(input.files || []).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
  input.value = "";
  for (const file of picked) {
    addComposerItem({ kind: file.type.startsWith("video/") ? "video" : "image", name: file.name, preview: URL.createObjectURL(file), file });
  }
}

function removeComposerMedia(index: number) {
  const [removed] = composerMedia.value.splice(index, 1);
  if (removed) releasePreview(removed);
  composerMedia.value = [...composerMedia.value];
}

function clearComposerMedia() {
  for (const item of composerMedia.value) releasePreview(item);
  composerMedia.value = [];
}

function mediaAsset(file: DriveFile, kind: "image" | "video", assetIndex: number): SocialMediaAsset {
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
async function driveFileFor(item: ComposerMedia): Promise<DriveFile> {
  if (item.driveFile) return item.driveFile;
  const [uploaded] = await uploadDriveFiles<DriveFile>([item.file!], { folderId: null, onConflict: "rename" });
  if (!uploaded) throw new Error(`${item.name} didn't upload.`);
  return uploaded;
}

async function createPost() {
  const text = composerText.value.trim();
  if (!text || !composerNetworks.value.length || composerBusy.value) return;
  composerBusy.value = true;
  try {
    const images = (await Promise.all(composerImages.value.map(driveFileFor)))
      .map((file, index) => mediaAsset(file, "image", index));
    const video = composerVideo.value ? await driveFileFor(composerVideo.value) : null;
    const detail = await social.createSocialPost({
      siteId: siteId.value,
      sourceType: "pasted",
      sourceSnapshot: text,
      sourceText: text,
      ideaText: text,
      versions: composerNetworks.value.map((network) => ({
        platform: platformFor(network),
        bodyText: text,
        // A Short needs a title and one video; the owner adds the video on the next screen.
        ...(network === "youtube" ? { format: "short_video" as const, title: youtubeTitleFrom(text) } : {}),
      })),
    });
    // Images go to every platform but YouTube; the video goes to YouTube.
    await Promise.all(visibleVersions(detail).map((version) => {
      const assetManifest = version.platform === "youtube"
        ? (video ? [mediaAsset(video, "video", 0)] : [])
        : images;
      return assetManifest.length ? social.updatePostVersion(version.id, { assetManifest }) : null;
    }));
    composerOpen.value = false;
    clearComposerMedia();
    await router.push(`/social/${encodeURIComponent(detail.post.id)}`);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't save the draft. Try again.");
  } finally {
    composerBusy.value = false;
  }
}

async function makePost(idea: SocialSuggestion) {
  if (ideaBusy.value) return;
  ideaBusy.value = idea.id;
  try {
    const networks = connectedNetworks.value.filter((network) => network !== "youtube");
    const platforms = (networks.length ? networks : ["x", "linkedin"] as SocialNetwork[]).map(platformFor);
    const result = await social.chooseSocialSuggestion(idea.id, platforms, idea.updatedAt);
    await router.push(`/social/${encodeURIComponent(result.post.post.id)}`);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't turn that idea into a draft.");
  } finally {
    ideaBusy.value = null;
  }
}

async function discardIdea(idea: SocialSuggestion) {
  if (ideaBusy.value) return;
  ideaBusy.value = idea.id;
  try {
    await social.discardSocialSuggestion(idea.id, idea.updatedAt);
    ideas.value = ideas.value.filter((item) => item.id !== idea.id);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't remove that idea.");
  } finally {
    ideaBusy.value = null;
  }
}

onBeforeUnmount(clearComposerMedia);

onMounted(async () => {
  // Older links (calendar, chat) still point at /social?postId=…
  const legacyPost = typeof route.query.postId === "string" ? route.query.postId : "";
  if (legacyPost) {
    await router.replace(`/social/${encodeURIComponent(legacyPost)}`);
    return;
  }
  handleOAuthReturn();
  await data.load();
  if (!data.locked.value && !data.loadFailed.value) await loadIdeas();
});
</script>

<template>
  <main class="social-page">
    <div class="social-column">
      <PageLoading v-if="data.loading.value" label="Loading Social…" />

      <section v-else-if="data.locked.value" class="social-state" aria-labelledby="social-locked-title">
        <h1 id="social-locked-title">Post to X, LinkedIn, Instagram and Facebook from ME3</h1>
        <p>In your own words, scheduled when you choose. Included in Business.</p>
        <div class="social-state__example" aria-hidden="true">
          <SocialMarks :platforms="['x', 'linkedin', 'instagram', 'facebook']" />
          <span>Example: Studio open day</span>
          <span class="social-row__when">Thu 12:30</span>
        </div>
        <Button color="primary" shape="pill" size="compact" href="https://me3.app/pricing" target="_blank" rel="noopener">
          See plans
        </Button>
      </section>

      <section v-else-if="data.loadFailed.value" class="social-state" aria-labelledby="social-failed-title">
        <h1 id="social-failed-title">Social didn't load</h1>
        <p>Check your connection and try again.</p>
        <Button color="ghost" shape="soft" size="compact" @click="data.load">Try again</Button>
      </section>

      <template v-else>
        <AppPageBar title="Social">
          <template #actions>
            <button type="button" class="social-accounts-button" aria-label="Social accounts" @click="accountsOpen = true">
              <SocialMarks v-if="connectedNetworks.length" :platforms="connectedNetworks" />
              <span v-else>Accounts</span>
            </button>
            <Button color="ghost" shape="soft" size="compact" icon-only aria-label="New post" title="New post" @click="openComposer">
              <UiIcon name="Plus" :size="19" />
            </Button>
          </template>
        </AppPageBar>

        <ul v-if="attention.length" class="social-attention" aria-label="Needs attention">
          <li v-for="item in attention" :key="item.kind === 'failed' ? item.postId : item.network">
            <span class="social-attention__dot" aria-hidden="true" />
            <template v-if="item.kind === 'disconnected'">
              <span class="social-attention__text"><b>{{ item.label }} disconnected.</b> {{ item.paused }} post{{ item.paused === 1 ? "" : "s" }} paused.</span>
              <Button color="outline" shape="pill" size="small" @click="accountsOpen = true">Reconnect</Button>
            </template>
            <template v-else>
              <span class="social-attention__text"><b>{{ item.title }}</b> {{ item.detail }}</span>
              <Button color="outline" shape="pill" size="small" :to="`/social/${encodeURIComponent(item.postId)}`">Fix</Button>
            </template>
          </li>
        </ul>

        <div class="social-tabs" role="tablist" aria-label="Posts" @keydown="moveTab">
          <button
            v-for="item in SOCIAL_TABS"
            :id="`social-tab-${item.id}`"
            :key="item.id"
            type="button"
            role="tab"
            :aria-selected="tab === item.id"
            :aria-controls="`social-panel-${item.id}`"
            :tabindex="tab === item.id ? 0 : -1"
            @click="tab = item.id"
          >
            <span>{{ item.label }}</span>
            <strong>{{ counts[item.id] }}</strong>
          </button>
        </div>

        <section :id="`social-panel-${tab}`" role="tabpanel" :aria-labelledby="`social-tab-${tab}`" class="social-panel">
          <ul v-if="tab === 'ideas' && openIdeas.length" class="social-list">
            <li v-for="idea in openIdeas" :key="idea.id" class="social-row">
              <div class="social-row__text">
                <span class="social-row__title">{{ ideaTitle(idea) }}</span>
                <span class="social-row__detail">{{ ideaSourceLabel(idea) }}</span>
              </div>
              <Button color="outline" shape="pill" size="small" :disabled="ideaBusy === idea.id" @click="makePost(idea)">Draft it</Button>
              <Button class="social-row__quiet" color="ghost" shape="soft" size="small" :disabled="ideaBusy === idea.id" @click="discardIdea(idea)">Remove</Button>
            </li>
          </ul>

          <ul v-else-if="tab !== 'ideas' && rowsByTab[tab].length" class="social-list">
            <li v-for="detail in rowsByTab[tab]" :key="detail.post.id">
              <RouterLink class="social-row social-row--link" :to="`/social/${encodeURIComponent(detail.post.id)}`">
                <SocialMarks :platforms="visibleVersions(detail).map((version) => version.platform)" />
                <span class="social-row__text">
                  <span class="social-row__title">{{ postTitle(detail) }}</span>
                  <span
                    class="social-row__detail"
                    :class="{ 'social-row__detail--danger': postRowDetail(detail, capabilities, accounts).tone === 'danger' }"
                  >{{ postRowDetail(detail, capabilities, accounts).text }}</span>
                </span>
                <span v-if="rowWhen(detail)" class="social-row__when">{{ rowWhen(detail) }}</span>
              </RouterLink>
            </li>
          </ul>

          <div v-else class="social-empty">
            <p>{{ emptyText }}</p>
            <Button color="ghost" shape="soft" size="compact" icon-only aria-label="New post" title="New post" @click="openComposer">
              <UiIcon name="Plus" :size="20" />
            </Button>
          </div>
        </section>
      </template>
    </div>

    <SocialAccountsSheet
      :open="accountsOpen"
      :accounts="accounts"
      :posts="posts"
      :site-id="siteId"
      :hosted-platforms="hostedPlatforms"
      :x-allowance="data.status.value?.managedXAllowance"
      @close="accountsOpen = false"
      @changed="refresh"
    />

    <AppDialog :open="composerOpen" :labelled-by="composerTitleId" close-on-backdrop @close="composerOpen = false">
      <form class="social-composer" @submit.prevent="createPost">
        <header class="social-composer__header">
          <h2 :id="composerTitleId">New post</h2>
          <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="composerOpen = false">
            <UiIcon name="X" :size="18" />
          </Button>
        </header>
        <label class="visually-hidden" for="social-composer-text">What do you want to say?</label>
        <textarea id="social-composer-text" v-model="composerText" rows="5" placeholder="What do you want to say?" />
        <ul v-if="composerMedia.length" class="social-composer__media" aria-label="Media">
          <li v-for="(item, index) in composerMedia" :key="item.preview">
            <video v-if="item.kind === 'video'" :src="item.preview" muted preload="metadata" />
            <img v-else :src="item.preview" :alt="item.name">
            <button type="button" :aria-label="`Remove ${item.name}`" @click="removeComposerMedia(index)">
              <UiIcon name="X" :size="12" />
            </button>
          </li>
        </ul>
        <input
          ref="composerMediaInput"
          class="visually-hidden"
          type="file"
          :accept="composerNetworks.includes('youtube') ? 'image/*,video/*' : 'image/*'"
          multiple
          @change="addComposerMedia"
        >
        <div class="social-composer__networks" role="group" aria-label="Post to">
          <button
            v-for="network in composerChoices"
            :key="network.id"
            type="button"
            :aria-pressed="composerNetworks.includes(network.id)"
            :aria-label="composerAccount(network.id).handle ? `${network.label}, ${composerAccount(network.id).handle}` : network.label"
            :title="network.label"
            @click="toggleComposerNetwork(network.id)"
          >
            <SocialAccountAvatar
              :network="network.id"
              :avatar-url="composerAccount(network.id).avatarUrl"
              :name="composerAccount(network.id).name || network.label"
              :selected="composerNetworks.includes(network.id)"
            />
          </button>
        </div>
        <footer class="social-composer__footer">
          <div class="social-composer__attachments">
            <button type="button" class="social-composer__attach" :disabled="composerBusy" @click="composerMediaInput?.click()">
              <UiIcon name="Image" :size="16" /> {{ composerNetworks.includes("youtube") ? "Photo or video" : "Photos" }}
            </button>
            <button type="button" class="social-composer__attach" :disabled="composerBusy" @click="composerPickerOpen = true">
              <UiIcon name="Folder" :size="16" /> From Files
            </button>
          </div>
          <Button
            type="submit"
            color="primary"
            shape="pill"
            size="compact"
            :disabled="composerBusy || !composerText.trim() || !composerNetworks.length"
          >{{ composerBusy ? (composerMedia.length ? "Uploading…" : "Saving…") : "Review" }}</Button>
        </footer>
      </form>
    </AppDialog>

    <FilesMediaPicker
      :open="composerPickerOpen"
      :kinds="composerNetworks.includes('youtube') ? ['image', 'video'] : ['image']"
      @close="composerPickerOpen = false"
      @select="addComposerFiles"
    />
  </main>
</template>

<style scoped>
.social-page { min-height: calc(100dvh - var(--app-topbar-height)); background: var(--ui-bg); color: var(--ui-text); }
.social-column { box-sizing: border-box; width: min(100%, 640px); margin: 0 auto; padding: 4px 16px 96px; }
.social-accounts-button {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  font: 500 13px var(--font-sans);
  cursor: pointer;
}
.social-accounts-button:hover, .social-accounts-button:focus-visible { background: var(--ui-surface-muted); outline: none; }
.social-accounts-button:focus-visible { box-shadow: 0 0 0 2px var(--ui-focus); }

.social-attention { display: grid; gap: 6px; margin: 0 0 12px; padding: 0; list-style: none; }
.social-attention li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 8px 12px;
  border-radius: var(--ui-radius-md);
  background: var(--ui-danger-soft, color-mix(in srgb, var(--ui-danger) 12%, transparent));
  font-size: 13px;
}
.social-attention__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ui-danger); }
.social-attention__text { flex: 1 1 auto; min-width: 0; }
.social-attention__text b { color: var(--ui-danger); font-weight: 600; }

/* Same segmented control as Tasks (Backlog · Now · Done). */
.social-tabs { display: grid; grid-template-columns: repeat(4, 1fr); padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.social-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
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
.social-tabs button strong { font-weight: 750; }
.social-tabs button:hover, .social-tabs button:focus-visible { color: var(--ui-text); outline: none; }
.social-tabs button:focus-visible { box-shadow: inset 0 0 0 2px var(--ui-focus); }
.social-tabs button[aria-selected="true"] { background: var(--ui-surface); color: var(--ui-text); font-weight: 750; box-shadow: var(--ui-shadow-sm); }

.social-panel { margin-top: 12px; }
.social-list { margin: 0; padding: 0; list-style: none; }
.social-list > li + li { border-top: 1px solid var(--ui-border); }
.social-row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 2px; }
.social-row--link { color: inherit; text-decoration: none; border-radius: var(--ui-radius-sm); }
.social-row--link:hover .social-row__title { text-decoration: underline; text-underline-offset: 3px; }
.social-row--link:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.social-row__text { display: grid; flex: 1 1 auto; min-width: 0; gap: 2px; }
.social-row__title { overflow: hidden; font-size: 14.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.social-row__detail { overflow: hidden; color: var(--ui-text-muted); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.social-row__detail--danger { color: var(--ui-danger); }
.social-row__when { flex: none; color: var(--ui-text-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.social-row :deep(.social-row__quiet) { min-height: 30px; padding-inline: 6px; color: var(--ui-text-muted); font-weight: 500; }

.social-empty { display: grid; justify-items: center; gap: 10px; margin-top: 56px; color: var(--ui-text-muted); font-size: 14px; text-align: center; }
.social-empty p { margin: 0; }
.social-empty :deep(button) { border: 1px solid var(--ui-border-strong); border-radius: 50%; }

.social-state { display: grid; justify-items: start; gap: 10px; max-width: 460px; margin-top: 40px; }
.social-state h1 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.3; }
.social-state p { margin: 0; color: var(--ui-text-muted); line-height: 1.5; }
.social-state__example { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 0; border-top: 1px solid var(--ui-border); border-bottom: 1px solid var(--ui-border); font-size: 14px; font-weight: 600; opacity: .55; }
.social-state__example > span:nth-child(2) { flex: 1 1 auto; }

.social-composer {
  box-sizing: border-box;
  display: grid;
  gap: 12px;
  width: min(520px, calc(100vw - 32px));
  padding: 16px 18px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}
.social-composer__header { display: flex; align-items: center; justify-content: space-between; }
.social-composer__header h2 { margin: 0; font-size: 17px; font-weight: 650; }
.social-composer textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: 14px/1.5 var(--font-sans);
  resize: vertical;
}
.social-composer__networks { display: flex; flex-wrap: wrap; gap: 10px; }
.social-composer__networks button { display: inline-grid; padding: 3px; border: 0; border-radius: 50%; background: none; cursor: pointer; }
.social-composer__networks button:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 1px; }
.social-composer__attachments { display: flex; flex-wrap: wrap; gap: 2px; }
.social-composer__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.social-composer__attach {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--ui-radius-md);
  background: transparent;
  color: var(--ui-text-muted);
  font: 500 13px var(--font-sans);
  cursor: pointer;
}
.social-composer__attach:hover, .social-composer__attach:focus-visible { background: var(--ui-surface-muted); color: var(--ui-text); outline: none; }
.social-composer__media { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.social-composer__media li { position: relative; width: 64px; height: 64px; overflow: hidden; border-radius: var(--ui-radius-sm); background: var(--ui-surface-muted); }
.social-composer__media img, .social-composer__media video { width: 100%; height: 100%; object-fit: cover; }
.social-composer__media button {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, .6);
  color: #fff;
  cursor: pointer;
}
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 640px) {
  .social-tabs button { gap: 4px; padding: 0 6px; font-size: 13px; }
  .social-composer { width: 100vw; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; padding-bottom: 28px; }
}
</style>
