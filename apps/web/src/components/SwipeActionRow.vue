<script setup lang="ts">
import { ref, useId } from "vue";
import Button from "./Button.vue";
import UiIcon from "./UiIcon.vue";
defineProps<{ label: string }>();
const emit = defineEmits<{ remove: [] }>();
const open = ref(false);
const id = useId();
let origin: { x: number; y: number } | null = null;
let swiped = false;
function start(event: PointerEvent) {
  swiped = false;
  origin = (event.target as HTMLElement).closest("button,a,input,textarea") ? null : { x: event.clientX, y: event.clientY };
  if (origin && event.pointerType === "mouse") event.preventDefault();
}
function finish(event: PointerEvent) {
  if (!origin) return;
  const x = event.clientX - origin.x, y = event.clientY - origin.y;
  if (Math.abs(x) > 48 && Math.abs(x) > Math.abs(y) * 1.5) { open.value = x < 0; swiped = true; }
  origin = null;
}
function click(event: MouseEvent) {
  if (swiped) { event.preventDefault(); event.stopPropagation(); swiped = false; }
}
</script>
<template>
  <div class="swipe-row" @pointerdown="start" @pointerup="finish" @pointercancel="origin = null" @click.capture="click" @keydown.esc="open = false">
    <div class="swipe-row__content"><slot /></div>
    <Button color="ghost" size="large" icon-only :aria-label="`${label} actions`" :aria-expanded="open" :aria-controls="id" @click="open = !open"><UiIcon name="Ellipsis" :size="20" /></Button>
    <div v-if="open" :id="id" class="swipe-row__actions"><Button color="danger" size="large" :aria-label="`Remove ${label}`" @click="emit('remove')">Remove</Button></div>
  </div>
</template>
<style scoped>
.swipe-row { display: flex; align-items: center; gap: 6px; padding: 10px; border-radius: 18px; background: var(--ui-surface-muted); touch-action: pan-y; }
.swipe-row__content { flex: 1; min-width: 0; }
.swipe-row__actions { display: flex; align-self: stretch; align-items: center; padding-left: 4px; }
</style>
