<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { newsTint } from "../../utils/news";

// A story's picture: the publisher's own image, loaded without a referrer and never stored. When
// there is none, or it fails to load, a halftone paper tint stands in.
const props = defineProps<{ id: string; src?: string | null; height?: number }>();
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
const show = computed(() => Boolean(props.src) && !failed.value);
</script>

<template>
  <span class="news-photo" :style="{ '--news-tint': newsTint(id), ...(height ? { height: `${height}px` } : {}) }" aria-hidden="true">
    <img v-if="show" :src="src!" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed = true" />
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
.news-photo { position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 6px;
  background: radial-gradient(circle, var(--news-dots) 1.1px, transparent 1.5px) 0 0 / 5px 5px, color-mix(in srgb, var(--news-tint, #E4E1DA) var(--news-tint-mix), #15181F); }
.news-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style>
