<script setup lang="ts">
import { definePage } from "unplugin-vue-router/runtime";
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useSitesStore } from "../../stores/sites";
import { legacySiteDestination } from "../../utils/legacySiteRoute";

definePage({
  meta: {
    requiresAuth: true,
    title: "Website | ME3",
    robots: "noindex,follow",
  },
});

// The sites list is retired: your website opens in the editor, and domains live in Settings.
const router = useRouter();
const sites = useSitesStore();

onMounted(async () => {
  await sites.ensureSites();
  await router.replace(legacySiteDestination(sites.sites.find((site) => site.site_role === "profile")));
});
</script>

<template>
  <span />
</template>
