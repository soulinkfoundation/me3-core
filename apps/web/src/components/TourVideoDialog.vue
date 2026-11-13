<script setup lang="ts">
import { computed } from "vue";
import AppDialog from "./AppDialog.vue";
import UiIcon from "./UiIcon.vue";
import { TOUR_VIDEO, TOUR_WATCHED_KEY, TOUR_WATCHED_SHARE, tourVideoUrl } from "../utils/tourVideo";

/** The ME3 walkthrough video. Marks itself watched once most of it has played. */
defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; watched: [] }>();

const src = computed(() => tourVideoUrl(typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches));
let reported = false;

function onProgress(event: Event) {
  const video = event.target as HTMLVideoElement;
  if (reported || !video.duration || video.currentTime / video.duration < TOUR_WATCHED_SHARE) return;
  reported = true;
  try { window.localStorage.setItem(TOUR_WATCHED_KEY, "1"); } catch { /* ticks again next time */ }
  emit("watched");
}
</script>

<template>
  <AppDialog :open="open" aria-label="ME3 tour" close-on-backdrop @close="emit('close')">
    <div class="tour-video" data-testid="tour-video">
      <div class="tour-video__head">
        <strong>ME3 in {{ TOUR_VIDEO.minutes }} minutes</strong>
        <button type="button" class="tour-video__x" aria-label="Close tour" @click="emit('close')"><UiIcon name="X" :size="16" /></button>
      </div>
      <video v-if="open" :src="src" controls autoplay playsinline preload="metadata" @timeupdate="onProgress" />
    </div>
  </AppDialog>
</template>

<style scoped>
.tour-video { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: min(960px, 100%); padding: 14px; border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-lg, var(--ui-shadow-sm)); }
.tour-video__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 15px; }
.tour-video__x { display: grid; place-items: center; min-width: 36px; min-height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.tour-video video { display: block; width: 100%; max-height: 75vh; border-radius: 12px; background: #000; }
@media (max-width: 640px) { .tour-video { border-radius: 20px 20px 0 0; } }
</style>
