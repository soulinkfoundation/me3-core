<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
const props = defineProps<{ prompts: string[]; animate: boolean }>();
const index = ref(0);
const opacity = ref(1);
let timer: ReturnType<typeof setTimeout> | undefined;
function stop() { clearTimeout(timer); opacity.value = 1; }
function schedule() {
  timer = setTimeout(() => {
    if (!props.animate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      index.value = (index.value + 1) % props.prompts.length; schedule(); return;
    }
    opacity.value = 0;
    timer = setTimeout(() => {
      index.value = (index.value + 1) % props.prompts.length;
      opacity.value = 1;
      schedule();
    }, 500);
  }, 6000);
}
watch(() => props.animate, active => { stop(); if (active) schedule(); }, { immediate: true });
onBeforeUnmount(stop);
</script>
<template><span class="composer-prompt" :style="{ opacity }" aria-hidden="true">{{ prompts[index] || prompts[0] }}</span></template>
<style scoped>
.composer-prompt { position: absolute; inset: 0; display: flex; align-items: center; pointer-events: none; color: var(--ui-text-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; transition: opacity .6s ease-in-out; }
.composer-prompt[style*="opacity: 0"] { transition-duration: .5s; }
@media (prefers-reduced-motion: reduce) { .composer-prompt { transition: none; } }
</style>
