<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { API_BASE } from "../../api";
import AppPageBar from "../../components/AppPageBar.vue";
import Button from "../../components/Button.vue";
import PageLoading from "../../components/PageLoading.vue";
import UiIcon from "../../components/UiIcon.vue";
import SocialAccountsSheet from "../../components/social/SocialAccountsSheet.vue";
import SocialMarks from "../../components/social/SocialMarks.vue";
import SocialNewPost from "../../components/social/SocialNewPost.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useSocialData } from "../../composables/useSocialData";
import {
  SOCIAL_NETWORKS,
  SOCIAL_TABS,
  accountState,
  attentionItems,
  formatDay,
  formatWhen,
  postPostedTimes,
  lastPostedAt,
  networkLabel,
  nextScheduledAt,
  postRowDetail,
  postTab,
  postThumbnail,
  postTitle,
  postingMarks,
  visibleVersions,
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
const { toastError, toastSuccess } = useAppToast();
const data = useSocialData();
const { accounts, posts, capabilities, siteId, hostedPlatforms } = data;
const tab = ref<SocialTab>(tabFromQuery(route.query.tab));
const accountsOpen = ref(false);
const composerOpen = ref(false);

function tabFromQuery(value: unknown): SocialTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return SOCIAL_TABS.some((item) => item.id === raw) ? (raw as SocialTab) : "scheduled";
}

const rowsByTab = computed(() => {
  const groups: Record<SocialTab, typeof posts.value> = { drafts: [], scheduled: [], posted: [] };
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
  drafts: rowsByTab.value.drafts.length,
  scheduled: rowsByTab.value.scheduled.length,
  posted: rowsByTab.value.posted.length,
}));
const thumbnails = computed(() => new Map(posts.value.map((detail) => [detail.post.id, postThumbnail(detail, API_BASE)])));
const attention = computed(() => attentionItems(posts.value, accounts.value));
const connectedNetworks = computed(() =>
  SOCIAL_NETWORKS.filter((network) => accountState(network.id, accounts.value) !== "not_connected").map((network) => network.id),
);
const emptyText = computed(() => {
  if (tab.value === "drafts") return "No drafts";
  if (tab.value === "scheduled") return "Nothing scheduled";
  return "Nothing posted yet";
});

watch(tab, (next) => {
  void router.replace({ query: { ...route.query, tab: next === "scheduled" ? undefined : next } });
});

function rowWhen(detail: (typeof posts.value)[number]): string {
  if (postTab(detail) === "posted") {
    const times = postPostedTimes(detail);
    return times > 1 ? `Posted ${times} times · ${formatDay(lastPostedAt(detail))}` : formatWhen(lastPostedAt(detail));
  }
  if (postTab(detail) === "scheduled") return formatWhen(nextScheduledAt(detail));
  return "";
}

/** Under the title: what's wrong if anything, otherwise when it posts or posted. */
function rowSubtitle(detail: (typeof posts.value)[number]): { text: string; danger: boolean } {
  const info = postRowDetail(detail, capabilities.value, accounts.value);
  if (info.tone === "danger") return { text: info.text, danger: true };
  return { text: rowWhen(detail) || info.text, danger: false };
}

function moveTab(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const index = SOCIAL_TABS.findIndex((item) => item.id === tab.value);
  const next = SOCIAL_TABS[(index + (event.key === "ArrowRight" ? 1 : SOCIAL_TABS.length - 1)) % SOCIAL_TABS.length]!;
  tab.value = next.id;
  document.getElementById(`social-tab-${next.id}`)?.focus();
}

async function refresh() {
  await Promise.all([data.loadAccounts(), data.loadPosts()]);
}

/** Plain words for the error codes the hosted sign-in bridge sends back. */
function connectErrorMessage(code: string): string {
  const network = code.split("_")[0] || "";
  const label = ["x", "linkedin", "instagram", "facebook", "youtube", "tiktok"].includes(network) ? networkLabel(network) : "That account";
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

function openComposer() {
  composerOpen.value = true;
}


onMounted(async () => {
  // Older links (calendar, chat) still point at /social?postId=…
  const legacyPost = typeof route.query.postId === "string" ? route.query.postId : "";
  if (legacyPost) {
    await router.replace(`/social/${encodeURIComponent(legacyPost)}`);
    return;
  }
  handleOAuthReturn();
  await data.load();
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
          <ul v-if="rowsByTab[tab].length" class="social-list">
            <li v-for="detail in rowsByTab[tab]" :key="detail.post.id">
              <RouterLink class="social-row social-row--link" :to="`/social/${encodeURIComponent(detail.post.id)}`">
                <span class="social-row__text">
                  <span class="social-row__title">{{ postTitle(detail) }}</span>
                  <span class="social-row__detail" :class="{ 'social-row__detail--danger': rowSubtitle(detail).danger }">{{ rowSubtitle(detail).text }}</span>
                  <SocialMarks
                    class="social-row__marks"
                    size="tiny"
                    :platforms="visibleVersions(detail).map((version) => version.platform)"
                    :states="postingMarks(detail)"
                  />
                </span>
                <span v-if="thumbnails.get(detail.post.id)" class="social-row__thumb" aria-hidden="true">
                  <video v-if="thumbnails.get(detail.post.id)!.video" :src="thumbnails.get(detail.post.id)!.src" preload="metadata" muted playsinline />
                  <img v-else :src="thumbnails.get(detail.post.id)!.src" alt="" loading="lazy" decoding="async">
                  <span v-if="thumbnails.get(detail.post.id)!.video" class="social-row__play"><UiIcon name="Play" :size="10" /></span>
                </span>
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

    <SocialNewPost
      :open="composerOpen"
      :accounts="accounts"
      :capabilities="capabilities"
      :site-id="siteId"
      @close="composerOpen = false"
      @connect="composerOpen = false; accountsOpen = true"
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
.social-tabs { display: grid; grid-template-columns: repeat(3, 1fr); padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
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
.social-row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 2px; }
.social-row--link { color: inherit; text-decoration: none; border-radius: var(--ui-radius-sm); }
.social-row--link:hover .social-row__title { text-decoration: underline; text-underline-offset: 3px; }
.social-row--link:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.social-row__text { display: grid; flex: 1 1 auto; min-width: 0; gap: 2px; }
.social-row__title { overflow: hidden; font-size: 14.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.social-row__detail { overflow: hidden; color: var(--ui-text-muted); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.social-row__detail--danger { color: var(--ui-danger); }
.social-row__marks { margin-top: 4px; }
.social-row__thumb { position: relative; display: grid; flex: none; place-items: center; width: 56px; height: 56px; overflow: hidden; border-radius: 8px; background: var(--ui-surface-muted); }
.social-row__thumb img, .social-row__thumb video { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.social-row__play { position: absolute; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: rgb(0 0 0 / 55%); color: #fff; }
.social-row__when { flex: none; color: var(--ui-text-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }

.social-empty { display: grid; justify-items: center; gap: 10px; margin-top: 56px; color: var(--ui-text-muted); font-size: 14px; text-align: center; }
.social-empty p { margin: 0; }
.social-empty :deep(button) { border: 1px solid var(--ui-border-strong); border-radius: 50%; }

.social-state { display: grid; justify-items: start; gap: 10px; max-width: 460px; margin-top: 40px; }
.social-state h1 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.3; }
.social-state p { margin: 0; color: var(--ui-text-muted); line-height: 1.5; }
.social-state__example { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 0; border-top: 1px solid var(--ui-border); border-bottom: 1px solid var(--ui-border); font-size: 14px; font-weight: 600; opacity: .55; }
.social-state__example > span:nth-child(2) { flex: 1 1 auto; }

/* 32px avatar + 6px padding keeps a 44px tap target. */
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 640px) {
  .social-tabs button { gap: 4px; padding: 0 6px; font-size: 13px; }
}
</style>
