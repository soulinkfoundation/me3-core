<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { api } from "../../api";
import { useSitesStore } from "../../stores/sites";
import { useWizardStore } from "../../stores/wizard";
import { permanentPublicSiteUrl } from "../../utils/publicSiteUrl";
import { domainToConnect, WIZARD_PUBLISH_KEY } from "../../utils/wizardPublish";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import CustomDomain from "../CustomDomain.vue";
import UiIcon from "../UiIcon.vue";

/**
 * The Publish step's "Web address" sheet: connect your own domain without leaving the editor.
 * A domain can only point at a live site, so before the first publish it offers "Publish and connect".
 */
defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
function close() {
  domainToConnect.value = "";
  emit("close");
}

const wizard = useWizardStore();
const sites = useSitesStore();
const publishSite = inject(WIZARD_PUBLISH_KEY, null);
const managed = ref(false);
const domain = ref("");
const publishing = ref(false);
const publishFailed = ref("");
/** Set once "Publish and connect" has published, so CustomDomain connects the typed domain. */
const connectAfterPublish = domainToConnect;

const site = computed(() => sites.sites.find((candidate) => candidate.username === wizard.username));
const published = computed(() => Boolean(site.value?.published_at));
const title = computed(() => site.value?.custom_domain || "Your own domain");

onMounted(() => {
  void api.get<{ deploymentMode?: string }>("/config")
    .then((config) => { managed.value = config.deploymentMode === "managed"; })
    .catch(() => { managed.value = false; });
});

async function publishAndConnect() {
  if (!publishSite || publishing.value || !domain.value.trim()) return;
  publishing.value = true;
  publishFailed.value = "";
  try {
    if (!(await publishSite())) {
      publishFailed.value = "Your site didn't publish. Check the step it opened, then try again.";
      close();
      return;
    }
    await sites.fetchSites();
    connectAfterPublish.value = domain.value.trim();
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" labelled-by="wizard-domain-title" close-on-backdrop @close="close">
    <section class="domain-sheet">
      <header class="domain-sheet__head">
        <span aria-hidden="true" />
        <h2 id="wizard-domain-title">{{ title }}</h2>
        <button type="button" class="domain-sheet__close" aria-label="Close" @click="close"><UiIcon name="X" :size="20" /></button>
      </header>

      <template v-if="published && site">
        <CustomDomain
          embedded
          :managed="managed"
          :site-id="site.id"
          :username="site.username"
          site-role="profile"
          site-published
          :initial-domain="connectAfterPublish || undefined"
          :auto-connect="Boolean(connectAfterPublish)"
          :fallback-url="permanentPublicSiteUrl(site.username, 'profile')"
          @domain-status-changed="sites.fetchSites()"
        />
        <Button v-if="site.custom_domain && site.custom_domain_status !== 'active'" class="domain-sheet__later" color="ghost" shape="soft" size="medium" @click="close">I'll do it later</Button>
        <p v-if="site.custom_domain && site.custom_domain_status !== 'active'" class="domain-sheet__note">We keep checking and show it here when it's connected.</p>
      </template>

      <form v-else class="domain-sheet__form" @submit.prevent="publishAndConnect">
        <label class="domain-sheet__field">
          <span>Domain</span>
          <input v-model="domain" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="yourdomain.com" />
        </label>
        <p class="domain-sheet__note">Your site needs to be live before the domain can point at it.</p>
        <p v-if="publishFailed" class="domain-sheet__error" role="alert">{{ publishFailed }}</p>
        <Button type="submit" color="primary" shape="soft" size="medium" :disabled="publishing || !domain.trim() || !publishSite">
          {{ publishing ? "Publishing…" : "Publish and connect" }}
        </Button>
        <p class="domain-sheet__note">Don't have a domain yet? Buy one from any registrar, then come back.</p>
      </form>
    </section>
  </AppDialog>
</template>

<style scoped>
.domain-sheet { display: grid; gap: 14px; box-sizing: border-box; width: min(100%, 520px); margin: auto; padding: 12px 20px 24px; border-radius: 24px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.domain-sheet__head { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; }
.domain-sheet__head h2 { margin: 0; overflow: hidden; font-size: 17px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.domain-sheet__close { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text); cursor: pointer; }
.domain-sheet__close:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.domain-sheet__form { display: grid; gap: 12px; }
.domain-sheet__field { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ui-text-muted); }
.domain-sheet__field input { box-sizing: border-box; width: 100%; min-height: 48px; padding: 0 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm, 10px); background: var(--ui-bg); color: var(--ui-text); font: inherit; font-size: 16px; font-weight: 400; }
.domain-sheet__field input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.domain-sheet__note { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; text-align: center; }
.domain-sheet__error { margin: 0; color: var(--ui-danger, #b42318); font-size: 13px; }
.domain-sheet__later { justify-self: stretch; }
</style>
