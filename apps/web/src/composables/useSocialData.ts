import { computed, ref } from "vue";
import { useSitesStore } from "../stores/sites";
import {
  useSocialStore,
  type SocialAccountRow,
  type SocialPlatformCapabilities,
  type SocialPostDetail,
  type SocialStatus,
} from "../stores/social";

/**
 * Loads what both Social pages need: plan access, platform rules, accounts, posts and the site posts belong to.
 * Posts still sit on a site in storage; owners never choose one, ME3 uses their profile site.
 */
export function useSocialData() {
  const social = useSocialStore();
  const sites = useSitesStore();
  const status = ref<SocialStatus | null>(null);
  const accounts = ref<SocialAccountRow[]>([]);
  const posts = ref<SocialPostDetail[]>([]);
  const loading = ref(true);
  const loadFailed = ref(false);

  const locked = computed(() => status.value?.access === "locked" || status.value?.plugin.ready === false);
  const capabilities = computed<SocialPlatformCapabilities[]>(() => status.value?.plugin.platformCapabilities || []);
  const siteId = computed(() => {
    const list = sites.sites;
    return (list.find((site) => site.site_role === "profile") || list[0])?.id || "";
  });
  const hostedPlatforms = computed(() => status.value?.hostedOAuth.platforms || []);

  async function loadStatus() {
    status.value = await social.fetchSocialStatus();
    return status.value;
  }

  async function loadAccounts() {
    accounts.value = await social.fetchSocialAccounts();
  }

  async function loadPosts() {
    posts.value = await social.fetchSocialPosts("");
  }

  async function load() {
    loading.value = true;
    loadFailed.value = false;
    try {
      const current = await loadStatus();
      if (current.access === "locked" || !current.plugin.ready) return;
      await Promise.all([loadAccounts(), loadPosts(), sites.fetchSites()]);
    } catch {
      loadFailed.value = true;
    } finally {
      loading.value = false;
    }
  }

  return {
    social,
    status,
    accounts,
    posts,
    loading,
    loadFailed,
    locked,
    capabilities,
    siteId,
    hostedPlatforms,
    load,
    loadAccounts,
    loadPosts,
  };
}
