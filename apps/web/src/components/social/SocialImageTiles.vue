<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import UiIcon from "../UiIcon.vue";
import type { SocialMediaAsset } from "../../stores/social";
import { moveItem } from "../../utils/social-posts";

/**
 * Ordered image tiles: drag a tile (mouse or touch) or focus it and press the arrow keys to
 * reorder. Remove sits in the top-right corner, Crop in the top-left.
 */
const props = defineProps<{ images: SocialMediaAsset[]; locked?: boolean }>();
const emit = defineEmits<{
  reorder: [images: SocialMediaAsset[]];
  remove: [index: number];
  crop: [index: number];
  alt: [index: number];
  edit: [index: number];
}>();

const order = ref<SocialMediaAsset[]>([...props.images]);
const dragging = ref<number | null>(null);
const announcement = ref("");
const list = ref<HTMLOListElement | null>(null);
let start: { x: number; y: number; index: number; pointerId: number; moved: boolean } | null = null;

watch(() => props.images, (next) => {
  if (dragging.value === null) order.value = [...next];
});

function commit() {
  const changed = order.value.some((asset, index) => asset !== props.images[index]);
  if (changed) emit("reorder", [...order.value]);
}

function onPointerDown(event: PointerEvent, index: number) {
  if (props.locked || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  start = { x: event.clientX, y: event.clientY, index, pointerId: event.pointerId, moved: false };
}

function onPointerMove(event: PointerEvent) {
  if (!start || event.pointerId !== start.pointerId) return;
  if (!start.moved) {
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
    start.moved = true;
    dragging.value = start.index;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  event.preventDefault();
  const tiles = Array.from(list.value?.querySelectorAll<HTMLElement>("[data-tile]") || []);
  const over = tiles.findIndex((tile) => {
    const box = tile.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  });
  if (over >= 0 && over !== dragging.value && dragging.value !== null) {
    order.value = moveItem(order.value, dragging.value, over);
    dragging.value = over;
  }
}

function onPointerUp() {
  if (start?.moved) commit();
  start = null;
  dragging.value = null;
}

async function onKey(event: KeyboardEvent, index: number) {
  if (props.locked) return;
  const offset = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    emit("remove", index);
    return;
  }
  const target = index + offset;
  if (!offset || target < 0 || target >= order.value.length) return;
  event.preventDefault();
  order.value = moveItem(order.value, index, target);
  commit();
  announcement.value = `Image moved to position ${target + 1} of ${order.value.length}.`;
  await nextTick();
  list.value?.querySelectorAll<HTMLElement>("[data-tile]")[target]?.focus();
}
</script>

<template>
  <div class="tiles">
    <ol
      ref="list"
      class="tiles__list"
      aria-label="Images, in order"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <li
        v-for="(asset, index) in order"
        :key="`${asset.fileId || asset.url}-${asset.assetIndex ?? index}`"
        data-tile
        class="tile"
        :class="{ 'is-dragging': dragging === index, 'is-locked': locked }"
        :tabindex="locked ? -1 : 0"
        :aria-label="`${asset.kind === 'video' ? 'Video' : 'Image'} ${index + 1} of ${order.length}${asset.altText ? `: ${asset.altText}` : ''}${locked ? '' : '. Drag or use arrow keys to move it.'}`"
        @pointerdown="onPointerDown($event, index)"
        @keydown="onKey($event, index)"
      >
        <video v-if="asset.kind === 'video'" :src="`${asset.url}#t=0.1`" muted playsinline preload="metadata" draggable="false" />
        <img v-else :src="asset.url" :alt="asset.altText || ''" loading="lazy" draggable="false">
        <span v-if="asset.kind === 'video'" class="tile__play" aria-hidden="true"><UiIcon name="Play" :size="12" /></span>
        <small class="tile__number" aria-hidden="true">{{ index + 1 }}</small>
        <template v-if="!locked && asset.kind !== 'video'">
          <button type="button" class="tile__tool tile__tool--crop" :aria-label="`Crop image ${index + 1}`" @click="emit('crop', index)">
            <UiIcon name="Crop" :size="13" />
          </button>
          <button
            type="button"
            class="tile__alt"
            :class="{ 'is-set': asset.altText?.trim() }"
            :aria-label="asset.altText?.trim() ? `Edit alt text for image ${index + 1}` : `Add alt text to image ${index + 1}`"
            @click="emit('alt', index)"
          >ALT<template v-if="asset.altText?.trim()"> ✓</template></button>
        </template>
        <button
          v-if="!locked && asset.kind === 'video'"
          type="button"
          class="tile__tool tile__tool--crop"
          :aria-label="`Edit video ${index + 1}`"
          @click="emit('edit', index)"
        >
          <UiIcon name="Pencil" :size="13" />
        </button>
        <template v-if="!locked">
          <button type="button" class="tile__tool tile__tool--remove" :aria-label="`Remove image ${index + 1}`" @click="emit('remove', index)">
            <UiIcon name="X" :size="13" />
          </button>
        </template>
      </li>
    </ol>
    <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.tiles__list { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; padding: 0; list-style: none; }
.tile {
  position: relative;
  flex: none;
  width: 84px;
  height: 84px;
  overflow: hidden;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: transform .12s ease, box-shadow .12s ease;
}
.tile.is-locked { cursor: default; touch-action: auto; }
.tile.is-dragging { z-index: 1; box-shadow: var(--ui-shadow-md); cursor: grabbing; transform: scale(1.05); }
.tile:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.tile img, .tile video { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.tile__play { position: absolute; top: 50%; left: 50%; display: grid; place-items: center; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; pointer-events: none; }
.tile__number { position: absolute; bottom: 3px; left: 5px; color: #fff; font-size: 10.5px; font-weight: 700; text-shadow: 0 1px 2px rgba(0, 0, 0, .7); }
.tile__tool {
  position: absolute;
  top: 4px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, .62);
  color: #fff;
  opacity: 0;
  cursor: pointer;
  transition: opacity .12s ease;
}
.tile__tool--remove { right: 4px; }
.tile__alt {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border: 0;
  border-radius: 4px;
  background: rgba(0, 0, 0, .62);
  color: #fff;
  font: 700 10px/1.5 var(--font-sans);
  letter-spacing: .02em;
  cursor: pointer;
}
.tile__alt:not(.is-set) { opacity: .85; }
.tile__alt:hover { background: rgba(0, 0, 0, .82); }
.tile__alt:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.tile__tool--crop { left: 4px; }
.tile__tool:hover { background: rgba(0, 0, 0, .82); }
.tile__tool:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.tile:hover .tile__tool, .tile:focus-within .tile__tool { opacity: 1; }
@media (hover: none) { .tile__tool { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .tile, .tile__tool { transition: none; } }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
