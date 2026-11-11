<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import {
  centeredCrop,
  cropPresets,
  croppedFilename,
  moveCrop,
  pixelCrop,
  resizeCrop,
  type CropPreset,
  type CropRect,
} from "../../utils/image-crop";

const props = defineProps<{
  open: boolean;
  src: string | null;
  filename?: string | null;
  mimeType?: string | null;
  platform: string;
  busy?: boolean;
}>();

const emit = defineEmits<{ close: []; save: [file: File] }>();

const titleId = `crop-title-${useId()}`;
const presets = computed(() => cropPresets(props.platform));
const preset = ref<CropPreset>(presets.value[0]!);
const objectUrl = ref<string | null>(null);
const natural = ref({ w: 0, h: 0 });
const rect = ref<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
const loadFailed = ref(false);
const image = ref<HTMLImageElement | null>(null);
let drag: { mode: "move" | "resize"; x: number; y: number; start: CropRect } | null = null;

const boxStyle = computed(() => {
  const { w, h } = natural.value;
  if (!w || !h) return { display: "none" };
  return {
    left: `${(rect.value.x / w) * 100}%`,
    top: `${(rect.value.y / h) * 100}%`,
    width: `${(rect.value.w / w) * 100}%`,
    height: `${(rect.value.h / h) * 100}%`,
  };
});
const sizeLabel = computed(() => {
  const crop = pixelCrop(rect.value, natural.value.w || 1, natural.value.h || 1);
  return natural.value.w ? `${crop.w} × ${crop.h}` : "";
});

function release() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = null;
}

// Loaded as a blob so the canvas can read it back.
watch(
  () => [props.open, props.src] as const,
  async ([open, src]) => {
    release();
    natural.value = { w: 0, h: 0 };
    loadFailed.value = false;
    preset.value = presets.value[0]!;
    if (!open || !src) return;
    try {
      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      if (props.open && props.src === src) objectUrl.value = URL.createObjectURL(blob);
    } catch {
      loadFailed.value = true;
    }
  },
  { immediate: true },
);

onBeforeUnmount(release);

function onLoad() {
  const element = image.value;
  if (!element) return;
  natural.value = { w: element.naturalWidth, h: element.naturalHeight };
  rect.value = centeredCrop(element.naturalWidth, element.naturalHeight, preset.value.ratio);
}

function choose(next: CropPreset) {
  preset.value = next;
  if (natural.value.w) rect.value = centeredCrop(natural.value.w, natural.value.h, next.ratio);
}

/** Screen pixels to image pixels. */
function scale(): number {
  const width = image.value?.getBoundingClientRect().width || 0;
  return width ? natural.value.w / width : 1;
}

function startDrag(event: PointerEvent, mode: "move" | "resize") {
  if (!natural.value.w) return;
  event.preventDefault();
  event.stopPropagation();
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  drag = { mode, x: event.clientX, y: event.clientY, start: { ...rect.value } };
}

function onDrag(event: PointerEvent) {
  if (!drag) return;
  const factor = scale();
  const dx = (event.clientX - drag.x) * factor;
  const dy = (event.clientY - drag.y) * factor;
  const { w, h } = natural.value;
  rect.value =
    drag.mode === "move"
      ? moveCrop(drag.start, dx, dy, w, h)
      : resizeCrop(drag.start, dx, dy, w, h, preset.value.ratio);
}

function endDrag() {
  drag = null;
}

function onKey(event: KeyboardEvent) {
  const steps: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const step = steps[event.key];
  if (!step || !natural.value.w) return;
  event.preventDefault();
  const amount = Math.max(1, Math.round(natural.value.w / 100)) * (event.altKey ? 0.25 : 1);
  const { w, h } = natural.value;
  rect.value = event.shiftKey
    ? resizeCrop(rect.value, step[0] * amount, step[1] * amount, w, h, preset.value.ratio)
    : moveCrop(rect.value, step[0] * amount, step[1] * amount, w, h);
}

async function save() {
  const element = image.value;
  if (!element || !natural.value.w || props.busy) return;
  const crop = pixelCrop(rect.value, natural.value.w, natural.value.h);
  const canvas = document.createElement("canvas");
  canvas.width = crop.w;
  canvas.height = crop.h;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(element, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  const type = props.mimeType === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) return;
  emit("save", new File([blob], croppedFilename(props.filename, type), { type }));
}
</script>

<template>
  <AppDialog :open="open" :labelled-by="titleId" @close="emit('close')">
    <div class="cropper">
      <header class="cropper__head">
        <h2 :id="titleId">Crop image</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="18" />
        </Button>
      </header>

      <div class="cropper__shapes" role="radiogroup" aria-label="Shape">
        <button
          v-for="option in presets"
          :key="option.id"
          type="button"
          role="radio"
          :aria-checked="preset.id === option.id"
          :class="{ 'is-on': preset.id === option.id }"
          @click="choose(option)"
        >{{ option.label }}</button>
      </div>

      <div class="cropper__stage">
        <p v-if="loadFailed" class="cropper__empty">Couldn't load this image.</p>
        <p v-else-if="!objectUrl" class="cropper__empty">Loading…</p>
        <div v-else class="cropper__frame" @pointermove="onDrag" @pointerup="endDrag" @pointercancel="endDrag">
          <img ref="image" :src="objectUrl" alt="" draggable="false" @load="onLoad">
          <div
            class="cropper__box"
            :style="boxStyle"
            tabindex="0"
            role="group"
            aria-label="Crop area. Arrow keys move it, Shift and arrow keys resize it."
            @pointerdown="startDrag($event, 'move')"
            @keydown="onKey"
          >
            <span class="cropper__handle" aria-hidden="true" @pointerdown="startDrag($event, 'resize')" />
          </div>
        </div>
      </div>

      <footer class="cropper__foot">
        <span class="cropper__size">{{ sizeLabel }}</span>
        <Button color="ghost" shape="pill" size="compact" @click="emit('close')">Cancel</Button>
        <Button color="primary" shape="pill" size="compact" :disabled="!natural.w || busy" @click="save">
          {{ busy ? "Saving…" : "Use crop" }}
        </Button>
      </footer>
    </div>
  </AppDialog>
</template>

<style scoped>
.cropper {
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 10px;
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  padding: 14px 18px 16px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
  color: var(--ui-text);
}
.cropper__head { display: flex; align-items: center; justify-content: space-between; }
.cropper__head h2 { margin: 0; font-size: 17px; font-weight: 650; }
.cropper__shapes { display: inline-flex; justify-self: start; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.cropper__shapes button {
  padding: 4px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  font: 500 13px var(--font-sans);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.cropper__shapes button.is-on { background: var(--ui-primary); color: var(--ui-primary-contrast); }
.cropper__shapes button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 1px; }
.cropper__stage { display: grid; place-items: center; min-height: 200px; overflow: hidden; border-radius: var(--ui-radius-md); background: var(--ui-surface-muted); }
.cropper__empty { margin: 0; color: var(--ui-text-muted); font-size: 13px; }
.cropper__frame { position: relative; overflow: hidden; line-height: 0; touch-action: none; user-select: none; }
.cropper__frame img { display: block; max-width: 100%; max-height: min(60dvh, 520px); }
.cropper__box {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px solid #fff;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, .5);
  cursor: move;
}
.cropper__box:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.cropper__handle {
  position: absolute;
  right: -9px;
  bottom: -9px;
  width: 18px;
  height: 18px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--ui-primary);
  cursor: nwse-resize;
}
.cropper__foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.cropper__size { margin-right: auto; color: var(--ui-text-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
@media (max-width: 640px) {
  .cropper { width: 100vw; max-height: 100dvh; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; }
  .cropper__handle { right: -12px; bottom: -12px; width: 24px; height: 24px; }
}
</style>
