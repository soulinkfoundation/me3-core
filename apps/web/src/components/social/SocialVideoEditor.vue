<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import type { SocialMediaAsset } from "../../stores/social";
import { formatSeconds } from "../../utils/media-prep";

/**
 * Trim a video's start and end, and (where the platform uses one) pick its cover frame.
 * Trimming makes a new MP4 copy; the original file in Files stays as it was.
 */
const props = defineProps<{
  open: boolean;
  video: SocialMediaAsset | null;
  /** The platform takes a chosen cover frame (Instagram). */
  coverFrame: boolean;
  busy?: boolean;
  progress?: number | null;
}>();
const emit = defineEmits<{
  close: [];
  save: [change: { file: File | null; range: { start: number; end: number } | null; coverTimeMs: number | null }];
}>();

const titleId = `video-title-${useId()}`;
const player = ref<HTMLVideoElement | null>(null);
const source = ref<File | null>(null);
const objectUrl = ref<string | null>(null);
const loadFailed = ref(false);
const duration = ref(0);
const start = ref(0);
const end = ref(0);
const cover = ref<number | null>(null);
const trimmed = computed(() => duration.value > 0 && (start.value > 0.05 || end.value < duration.value - 0.05));
const changed = computed(() => trimmed.value || cover.value !== initialCover());

function initialCover(): number | null {
  return typeof props.video?.coverTimeMs === "number" ? props.video.coverTimeMs / 1000 : null;
}

function release() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = null;
}

watch(
  () => [props.open, props.video?.url] as const,
  async ([open, url]) => {
    release();
    source.value = null;
    loadFailed.value = false;
    duration.value = 0;
    cover.value = initialCover();
    if (!open || !url) return;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      if (!props.open || props.video?.url !== url) return;
      source.value = new File([blob], props.video?.filename || "video.mp4", { type: props.video?.mimeType || blob.type });
      objectUrl.value = URL.createObjectURL(blob);
    } catch {
      loadFailed.value = true;
    }
  },
  { immediate: true },
);

onBeforeUnmount(release);

function onLoaded() {
  const value = player.value?.duration || 0;
  duration.value = Number.isFinite(value) ? value : 0;
  start.value = 0;
  end.value = duration.value;
}

function setStart(value: number) {
  start.value = Math.min(value, end.value - 0.5);
  if (player.value) player.value.currentTime = start.value;
}

function setEnd(value: number) {
  end.value = Math.max(value, start.value + 0.5);
  if (player.value) player.value.currentTime = end.value;
}

function useThisFrame() {
  cover.value = player.value?.currentTime ?? 0;
}

function save() {
  if (!changed.value || props.busy) return;
  const range = trimmed.value ? { start: start.value, end: end.value } : null;
  // The cover is a time in the posted video, so it moves with the new start.
  const coverAfterTrim = cover.value === null ? null : Math.max(0, cover.value - (range?.start ?? 0));
  emit("save", {
    file: range ? source.value : null,
    range,
    coverTimeMs: coverAfterTrim === null ? null : Math.round(coverAfterTrim * 1000),
  });
}
</script>

<template>
  <AppDialog :open="open" :labelled-by="titleId" @close="emit('close')">
    <form class="video-edit" @submit.prevent="save">
      <header class="video-edit__head">
        <h2 :id="titleId">Edit video</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="18" />
        </Button>
      </header>

      <div class="video-edit__stage">
        <p v-if="loadFailed" class="video-edit__empty">Couldn't load this video.</p>
        <p v-else-if="!objectUrl" class="video-edit__empty">Loading…</p>
        <video v-else ref="player" :src="objectUrl" controls playsinline preload="metadata" @loadedmetadata="onLoaded" />
      </div>

      <template v-if="duration">
        <div class="video-edit__row">
          <label :for="`${titleId}-start`">Start <b>{{ formatSeconds(start) }}</b></label>
          <input :id="`${titleId}-start`" type="range" min="0" :max="duration" step="0.1" :value="start" @input="setStart(Number(($event.target as HTMLInputElement).value))">
        </div>
        <div class="video-edit__row">
          <label :for="`${titleId}-end`">End <b>{{ formatSeconds(end) }}</b></label>
          <input :id="`${titleId}-end`" type="range" min="0" :max="duration" step="0.1" :value="end" @input="setEnd(Number(($event.target as HTMLInputElement).value))">
        </div>
        <p class="video-edit__note">
          {{ trimmed ? `Posts ${formatSeconds(end - start)} of ${formatSeconds(duration)}. Saves a trimmed copy to Files.` : "Drag Start or End to trim." }}
        </p>
        <div v-if="coverFrame" class="video-edit__cover">
          <Button color="outline" shape="pill" size="compact" @click="useThisFrame">Use this frame as the cover</Button>
          <span>{{ cover === null ? "Instagram picks the cover." : `Cover at ${formatSeconds(cover)}` }}</span>
        </div>
      </template>

      <footer class="video-edit__actions">
        <Button color="ghost" shape="pill" size="compact" @click="emit('close')">Cancel</Button>
        <Button color="primary" shape="pill" size="compact" type="submit" :disabled="!changed || busy">
          {{ busy ? (progress != null ? `Trimming… ${Math.round(progress * 100)}%` : "Saving…") : "Save" }}
        </Button>
      </footer>
    </form>
  </AppDialog>
</template>

<style scoped>
.video-edit {
  box-sizing: border-box;
  display: grid;
  gap: 10px;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  padding: 14px 18px 16px;
  overflow: auto;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
  color: var(--ui-text);
}
.video-edit__head { display: flex; align-items: center; justify-content: space-between; }
.video-edit__head h2 { margin: 0; font-size: 17px; font-weight: 650; }
.video-edit__stage { display: grid; place-items: center; min-height: 160px; overflow: hidden; border-radius: var(--ui-radius-md); background: #000; }
.video-edit__stage video { display: block; width: 100%; max-height: min(50dvh, 420px); }
.video-edit__empty { margin: 0; color: #ccc; font-size: 13px; }
.video-edit__row { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: 10px; font-size: 13px; }
.video-edit__row label { color: var(--ui-text-muted); }
.video-edit__row b { color: var(--ui-text); font-variant-numeric: tabular-nums; }
.video-edit__row input { width: 100%; accent-color: var(--ui-primary); }
.video-edit__note { margin: 0; color: var(--ui-text-muted); font-size: 12.5px; }
.video-edit__cover { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--ui-text-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.video-edit__actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 640px) { .video-edit { width: 100vw; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; } }
</style>
