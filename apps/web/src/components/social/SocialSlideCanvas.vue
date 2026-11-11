<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { CarouselTemplateSettings, TextCarouselSlide } from "../../stores/social";
import { drawSlide, type SiteLook, type SlideImages } from "../../utils/text-carousel";

/** One text slide drawn by the same code that makes the JPEG, so the preview is what posts. */
const props = defineProps<{
  slide: TextCarouselSlide;
  settings: CarouselTemplateSettings;
  look: SiteLook;
  images: SlideImages;
  /** Bumps when images or fonts finish loading. */
  tick: number;
  /** Drawing width in CSS pixels. */
  width: number;
}>();
const emit = defineEmits<{ overflow: [value: boolean] }>();

const canvas = ref<HTMLCanvasElement | null>(null);

function draw() {
  const element = canvas.value;
  if (!element) return;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(props.width * scale);
  const height = Math.round(width * 1.25);
  if (element.width !== width) element.width = width;
  if (element.height !== height) element.height = height;
  const ctx = element.getContext("2d");
  if (!ctx) return;
  const { overflow } = drawSlide(ctx, props.slide, props.settings, props.look, props.images, { placeholder: true });
  emit("overflow", overflow);
}

onMounted(draw);
watch(
  () => [props.slide.main, props.slide.small, props.slide.swap, props.slide.photoFileId, props.settings, props.look, props.tick, props.width],
  draw,
  { deep: true },
);
</script>

<template>
  <canvas ref="canvas" class="slide-canvas" aria-hidden="true" />
</template>

<style scoped>
.slide-canvas { display: block; width: 100%; height: auto; aspect-ratio: 4 / 5; }
</style>
