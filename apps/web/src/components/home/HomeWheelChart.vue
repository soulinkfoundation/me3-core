<script setup lang="ts">
import { computed } from 'vue';

export type HomeWheelArea = { id: string; label: string; color: string; emoji: string; value: number | null };
const props = defineProps<{ areas: HomeWheelArea[]; selected?: string; interactive?: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
function point(radius: number, angle: number) {
  return { x: 100 + radius * Math.cos(angle), y: 100 + radius * Math.sin(angle) };
}
function wedge(radius: number, start: number, end: number) {
  if (!radius) return '';
  const a = point(radius, start), b = point(radius, end);
  return `M100 100L${a.x} ${a.y}A${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${b.x} ${b.y}Z`;
}
const slices = computed(() => props.areas.map((area, i) => {
  const angle = 2 * Math.PI / props.areas.length;
  const start = -Math.PI / 2 + i * angle, end = start + angle, middle = (start + end) / 2;
  const selected = props.selected === area.id;
  const shift = point(selected ? 9 : 0, middle);
  return { ...area, selected, track: wedge(88, start, end), score: wedge(88 * (area.value ?? 0) / 10, start, end), emojiAt: point(54, middle), transform: `translate(${shift.x - 100} ${shift.y - 100})` };
}));
const label = computed(() => `Wheel of Life. ${props.areas.map(area => `${area.label}: ${area.value === null ? 'not scored' : `${area.value} out of 10`}`).join(', ')}.`);
</script>

<template>
  <svg class="home-wheel-chart" viewBox="0 0 200 200" :role="interactive ? 'group' : 'img'" :aria-label="label">
    <g v-for="slice in slices" :key="slice.id" :transform="slice.transform"
      :role="interactive ? 'button' : undefined" :tabindex="interactive ? 0 : undefined"
      :aria-label="interactive ? `${slice.label}, ${slice.value === null ? 'not scored' : `${slice.value} out of 10`}` : undefined"
      :aria-pressed="interactive ? slice.selected : undefined"
      @click="interactive && emit('select', slice.id)" @keydown.enter.prevent="interactive && emit('select', slice.id)" @keydown.space.prevent="interactive && emit('select', slice.id)">
      <path :d="slice.track" :fill="slice.color" :opacity="slice.selected ? .22 : .1" />
      <path :d="slice.score" :fill="slice.color" :opacity="slice.selected ? 1 : .5" />
      <path :d="slice.track" fill="none" :stroke="slice.selected ? slice.color : 'var(--ui-surface)'" :stroke-width="slice.selected ? 2.5 : 2" />
      <text :x="slice.emojiAt.x" :y="slice.emojiAt.y" :font-size="slice.selected ? 24 : 20" text-anchor="middle" dominant-baseline="central" aria-hidden="true">{{ slice.emoji }}</text>
    </g>
  </svg>
</template>

<style scoped>
.home-wheel-chart { display: block; width: 160px; height: 160px; flex: 0 0 auto; overflow: visible; }
g[role="button"] { cursor: pointer; outline: none; }
g:focus-visible path:last-of-type { stroke: var(--ui-text); stroke-width: 3; }
text { pointer-events: none; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
</style>
