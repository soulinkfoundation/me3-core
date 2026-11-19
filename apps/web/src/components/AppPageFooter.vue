<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
defineProps<{ status?: string }>();
// The app view pads its bottom by this, so the last content clears the fixed footer.
onMounted(() => document.documentElement.style.setProperty("--app-page-footer-height", "calc(76px + env(safe-area-inset-bottom, 0px))"));
onBeforeUnmount(() => document.documentElement.style.removeProperty("--app-page-footer-height"));
</script>

<template>
  <!-- Finishing actions (Save, Send test, Review and send, Publish, Create) and save status sit here, never in the header. -->
  <footer class="app-page-footer">
    <div class="app-page-footer__inner">
      <span v-if="status || $slots.status" class="app-page-footer__status" role="status" aria-live="polite"><slot name="status">{{ status }}</slot></span>
      <div class="app-page-footer__actions"><slot /></div>
    </div>
  </footer>
</template>

<style scoped>
.app-page-footer { position: fixed; inset: auto 0 0; z-index: 60; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--ui-border); background: var(--ui-bg); }
.app-page-footer__inner { display: flex; align-items: center; gap: 8px; max-width: 960px; margin: 0 auto; }
.app-page-footer__status { min-width: 0; overflow: hidden; color: var(--ui-text-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.app-page-footer__actions { display: flex; flex: 1; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
</style>
