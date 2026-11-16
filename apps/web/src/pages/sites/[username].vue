<script setup lang="ts">
import { definePage } from "unplugin-vue-router/runtime";
import { computed, onMounted } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { useSitesStore } from "../../stores/sites";
import { useWizardStore } from "../../stores/wizard";
import { legacySiteDestination } from "../../utils/legacySiteRoute";

definePage({
  meta: {
    requiresAuth: true,
    title: "Website | ME3",
    robots: "noindex,follow",
  },
});

// The site dashboard is retired: edit in /create, domains live in Settings. This route stays
// as the parent of the page editor and so old /sites/:username links still land somewhere useful.
const route = useRoute();
const router = useRouter();
const sites = useSitesStore();
const wizard = useWizardStore();

/** Nested children need the parent RouterView or their pages never appear. */
const isNestedSitesTool = computed(
  () => route.path.includes("/landing-pages/") || route.path.includes("/pages/"),
);

onMounted(async () => {
  if (isNestedSitesTool.value) return;
  await sites.ensureSites();
  const username = String(route.params.username || "");
  const editStep = typeof route.query.edit === "string"
    ? wizard.normalizeWizardStepId(route.query.edit)
    : null;
  await router.replace(legacySiteDestination(
    sites.sites.find((site) => site.username === username),
    editStep,
  ));
});
</script>

<template>
  <RouterView v-if="isNestedSitesTool" />
</template>
