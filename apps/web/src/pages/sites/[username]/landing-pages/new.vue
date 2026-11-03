<script setup lang="ts">
import { computed, onMounted } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute, useRouter } from "vue-router";

definePage({
  meta: {
    requiresAuth: true,
    requiresPlugin: "me3.landing-pages",
    title: "Create Landing Page | ME3",
    description: "Create a landing page with your ME3 assistant.",
    robots: "noindex,follow",
  },
});

const route = useRoute();
const router = useRouter();
const profileUsername = computed(() => String(route.params.username || "").trim());

onMounted(() => {
  void router.replace({
    path: "/assistant",
    query: {
      mode: "site-builder",
      prompt: `Help me create a page for @${profileUsername.value}. Ask what the page is for, show me the available starter designs, and then build a draft with me.`,
    },
  });
});
</script>

<template>
  <main class="redirect-state" role="status" aria-live="polite">
    Opening your ME3 assistant…
  </main>
</template>

<style scoped>
.redirect-state {
  min-height: 60vh;
  display: grid;
  place-items: center;
  padding: 24px;
  color: var(--ui-text-muted, var(--color-text-muted));
}
</style>
