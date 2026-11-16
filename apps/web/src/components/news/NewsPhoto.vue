<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { newsTint } from "../../utils/news";

// A story's picture: the publisher's own image, loaded without a referrer and never stored. It is
// shown at its own shape, as wide as its column; `height` only sizes the halftone paper tint that
// stands in while it loads, when there is none, or when it fails. A video poster passes `ratio` and
// is cut to that shape instead, so the play button sits on a steady frame.
const props = defineProps<{ id: string; src?: string | null; height?: number; ratio?: string }>();
const failed = ref(false);
const loaded = ref(false);
watch(() => props.src, () => { failed.value = false; loaded.value = false; });
const show = computed(() => Boolean(props.src) && !failed.value);
const fit = computed(() => show.value && !props.ratio && loaded.value);
const style = computed(() => ({
  "--news-tint": newsTint(props.id),
  ...(props.ratio ? { aspectRatio: props.ratio } : fit.value ? {} : props.height ? { height: `${props.height}px` } : {}),
}));
</script>

<template>
  <span class="news-photo" :class="{ 'news-photo--fit': fit }" :style="style" aria-hidden="true">
    <img v-if="show" :src="src!" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @load="loaded = true" @error="failed = true" />
    <slot />
  </span>
</template>

<style>
/* Halftone dots over a soft tint; in dark mode the tint sinks into the page. */
:root { --news-dots: rgba(13, 18, 20, .18); --news-tint-mix: 100%; --news-rule: rgba(13, 18, 20, .14); }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { --news-dots: rgba(255, 255, 255, .14); --news-tint-mix: 25%; --news-rule: rgba(255, 255, 255, .14); } }
:root[data-theme="dark"] { --news-dots: rgba(255, 255, 255, .14); --news-tint-mix: 25%; --news-rule: rgba(255, 255, 255, .14); }
</style>

<style scoped>
.news-photo { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; overflow: hidden; border-radius: 6px;
  background: radial-gradient(circle, var(--news-dots) 1.1px, transparent 1.5px) 0 0 / 5px 5px, color-mix(in srgb, var(--news-tint, #E4E1DA) var(--news-tint-mix), #15181F); }
.news-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
/* Loaded, the picture sets its own height from its width. */
.news-photo--fit { display: block; background: none; }
.news-photo--fit img { position: static; display: block; height: auto; }
</style>
