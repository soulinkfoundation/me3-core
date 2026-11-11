<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useSitesStore } from "../../stores/sites";
import { useSocialStore, type SocialPostDetail } from "../../stores/social";
import { useAppToast } from "../../composables/useAppToast";
import { networkLabel, socialNetwork } from "../../utils/social-posts";
import Button from "../Button.vue";
import SocialMarks from "./SocialMarks.vue";

/**
 * Share a published blog post to connected social accounts. The share opens
 * in the Social composer, pre-filled with the post's title, excerpt and link.
 */
const props = defineProps<{ username: string; slug: string; live: boolean }>();

const social = useSocialStore();
const sites = useSitesStore();
const router = useRouter();
const { toastFromUnknown } = useAppToast();

const available = ref(false);
const share = ref<SocialPostDetail | null>(null);
const busy = ref(false);

const siteId = computed(() => {
  const list = sites.sites;
  return (list.find((site) => site.username === props.username) || list.find((site) => site.site_role === "profile") || list[0])?.id || "";
});

const shared = computed(() =>
  (share.value?.versions || []).filter((version) => version.publicationStatus === "published"),
);
const sharedText = computed(() => {
  if (shared.value.length) return `Shared to ${shared.value.map((version) => networkLabel(socialNetwork(version.platform)!)).join(", ")}`;
  if (share.value) return "Share in progress";
  return "";
});

async function load() {
  if (!props.live || !props.slug || !siteId.value) return;
  try {
    share.value = await social.fetchSitePostShare(siteId.value, props.slug);
  } catch {
    share.value = null;
  }
}

onMounted(async () => {
  try {
    const status = await social.fetchSocialStatus();
    available.value = status.access !== "locked" && status.plugin.ready !== false;
  } catch {
    available.value = false;
  }
  if (!available.value) return;
  if (!sites.sites.length) await sites.fetchSites().catch(() => undefined);
  await load();
});

watch(() => [props.slug, props.live], () => {
  share.value = null;
  if (available.value) void load();
});

async function open() {
  if (busy.value || !siteId.value) return;
  busy.value = true;
  try {
    const post = share.value || await social.shareSitePost(siteId.value, props.slug);
    await router.push(`/social/${encodeURIComponent(post.post.id)}`);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't start sharing this post.");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="available && live" class="site-post-share">
    <span v-if="sharedText" class="site-post-share__status">
      <SocialMarks v-if="shared.length" :platforms="shared.map((version) => version.platform)" />
      {{ sharedText }}
    </span>
    <Button color="outline" shape="pill" size="small" :disabled="busy" @click="open">
      {{ share ? "Open in Social" : busy ? "Preparing…" : "Share" }}
    </Button>
  </div>
</template>

<style scoped>
.site-post-share { display: inline-flex; align-items: center; gap: 10px; }
.site-post-share__status { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-text-muted); font-size: 13px; }
</style>
