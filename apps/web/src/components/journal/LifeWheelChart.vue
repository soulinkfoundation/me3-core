<script setup lang="ts">
import { computed, ref } from "vue";
import UiIcon from "../UiIcon.vue";
import { isUiIconName, type UiIconName } from "../../utils/icons";

type LifeWheelChartSegment = {
  id: string;
  label: string;
  helper: string;
  color: string;
  emoji?: string;
  value: number | null;
};

const OUTER_RADIUS = 116;
const VIEWBOX_MIN = -154;
const VIEWBOX_SIZE = 308;
const WHEEL_CENTER = VIEWBOX_MIN + VIEWBOX_SIZE / 2;
const compactViewBox = "-136 -136 272 272";

const props = withDefaults(
  defineProps<{
    segments: LifeWheelChartSegment[];
    interactive?: boolean;
    compact?: boolean;
    ariaLabel?: string;
  }>(),
  {
    interactive: true,
    compact: false,
    ariaLabel: "Wheel of Life score selector",
  },
);

const emit = defineEmits<{
  (event: "update:segment-value", segmentId: string, value: number): void;
}>();

const wheelSvg = ref<SVGSVGElement | null>(null);
const hoverSegmentId = ref("");
const hoverRating = ref<number | null>(null);

const rings = computed(() =>
  Array.from({ length: 10 }, (_, index) => ({
    id: `ring-${index + 1}`,
    radius: ((index + 1) / 10) * OUTER_RADIUS,
    strong: index === 9,
  })),
);

const wheelSegments = computed(() => {
  const total = Math.max(props.segments.length, 1);
  return props.segments.map((segment, index) => {
    const startAngle = (index / total) * 360;
    const endAngle = ((index + 1) / total) * 360;
    const midAngle = (startAngle + endAngle) / 2;
    const score = typeof segment.value === "number" ? segment.value : 0;
    const valueRadius = (score / 10) * OUTER_RADIUS;
    const isHovered = hoverSegmentId.value === segment.id;
    const activeRating = isHovered ? hoverRating.value : null;
    const hoverRadius = ((activeRating || 0) / 10) * OUTER_RADIUS;

    return {
      ...segment,
      index,
      startAngle,
      endAngle,
      midAngle,
      divider: polarPoint(startAngle, OUTER_RADIUS),
      hitPath: sectorPath(OUTER_RADIUS, startAngle, endAngle),
      valuePath: valueRadius > 0 ? sectorPath(valueRadius, startAngle, endAngle) : "",
      hoverPath:
        isHovered && hoverRadius > 0
          ? sectorPath(hoverRadius, startAngle, endAngle)
          : "",
      hoverLabelPoint: polarPoint(
        midAngle,
        Math.max(14, ((activeRating || 1) - 0.5) * (OUTER_RADIUS / 10)),
      ),
      labelStyle: labelPositionStyle(midAngle),
    };
  });
});

function polarPoint(angleDeg: number, radius: number) {
  const angle = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function sectorPath(radius: number, startAngle: number, endAngle: number) {
  const start = polarPoint(startAngle, radius);
  const end = polarPoint(endAngle, radius);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${WHEEL_CENTER} ${WHEEL_CENTER} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function labelPositionStyle(midAngle: number) {
  const angle = ((midAngle - 90) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const labelRadiusPercent = props.compact ? 30 : 48;
  const x = 50 + cos * labelRadiusPercent;
  const y = 50 + Math.sin(angle) * labelRadiusPercent;
  const mobileNudge = props.compact
    ? "0%"
    : cos > 0.7
      ? "-50%"
      : cos < -0.7
        ? "50%"
        : "0%";
  return {
    left: `${x}%`,
    top: `${y}%`,
    "--life-wheel-label-transform-x": "-50%",
    "--life-wheel-label-mobile-nudge": mobileNudge,
  };
}

function ratingFromPointer(event: PointerEvent) {
  if (!props.interactive || !wheelSvg.value) return null;
  const rect = wheelSvg.value.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * VIEWBOX_SIZE + VIEWBOX_MIN;
  const y = ((event.clientY - rect.top) / rect.height) * VIEWBOX_SIZE + VIEWBOX_MIN;
  const radius = Math.hypot(x - WHEEL_CENTER, y - WHEEL_CENTER);
  if (radius > OUTER_RADIUS + 1) return null;
  return Math.min(10, Math.max(1, Math.ceil(radius / (OUTER_RADIUS / 10))));
}

function setSegmentValue(segmentId: string, value: number) {
  if (!props.interactive) return;
  emit("update:segment-value", segmentId, Math.min(10, Math.max(1, value)));
}

function handlePointerMove(event: PointerEvent, segmentId: string) {
  if (!props.interactive) return;
  hoverSegmentId.value = segmentId;
  hoverRating.value = ratingFromPointer(event);
}

function handlePointerLeave() {
  hoverSegmentId.value = "";
  hoverRating.value = null;
}

function handleSegmentClick(event: PointerEvent, segmentId: string) {
  const rating = ratingFromPointer(event);
  if (!rating) return;
  setSegmentValue(segmentId, rating);
}

function handleSegmentKeydown(event: KeyboardEvent, segmentId: string) {
  if (!props.interactive) return;
  const segment = props.segments.find((item) => item.id === segmentId);
  if (!segment) return;

  if (event.key === "Home") {
    event.preventDefault();
    setSegmentValue(segmentId, 1);
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    setSegmentValue(segmentId, 10);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    setSegmentValue(segmentId, segment.value || 5);
    return;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    event.preventDefault();
    setSegmentValue(segmentId, (segment.value || 0) + 1);
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    event.preventDefault();
    setSegmentValue(segmentId, (segment.value || 2) - 1);
  }
}
</script>

<template>
  <div
    class="life-wheel-chart"
    :class="{ 'life-wheel-chart--compact': compact }"
  >
    <svg
      ref="wheelSvg"
      class="life-wheel-chart__svg"
      :viewBox="compact ? compactViewBox : `${VIEWBOX_MIN} ${VIEWBOX_MIN} ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`"
      :aria-label="ariaLabel"
      @pointerleave="handlePointerLeave"
    >
      <g class="life-wheel-chart__values" aria-hidden="true">
        <path
          v-for="segment in wheelSegments"
          :key="`${segment.id}-value`"
          :d="segment.valuePath"
          :fill="segment.color"
          :opacity="segment.valuePath ? 0.32 : 0"
        />
        <path
          v-for="segment in wheelSegments"
          :key="`${segment.id}-hover`"
          :d="segment.hoverPath"
          :fill="segment.color"
          :opacity="segment.hoverPath ? 0.2 : 0"
        />
      </g>

      <g class="life-wheel-chart__grid" aria-hidden="true">
        <circle
          v-for="ring in rings"
          :key="ring.id"
          :r="ring.radius"
          :class="{ 'is-outer': ring.strong }"
        />
        <line
          v-for="segment in wheelSegments"
          :key="`${segment.id}-divider`"
          :x1="WHEEL_CENTER"
          :y1="WHEEL_CENTER"
          :x2="segment.divider.x"
          :y2="segment.divider.y"
        />
        <circle r="2.6" class="life-wheel-chart__center-dot" />
      </g>

      <g>
        <path
          v-for="segment in wheelSegments"
          :key="`${segment.id}-hit`"
          class="life-wheel-chart__hit-area"
          :class="{ 'is-disabled': !interactive }"
          :d="segment.hitPath"
          fill="transparent"
          :tabindex="interactive ? 0 : undefined"
          :role="interactive ? 'button' : undefined"
          :aria-label="`${segment.label}, ${segment.value ? `${segment.value} of 10` : 'not scored'}`"
          @pointermove="handlePointerMove($event, segment.id)"
          @click="handleSegmentClick($event, segment.id)"
          @keydown="handleSegmentKeydown($event, segment.id)"
        >
          <title>{{ segment.helper }}</title>
        </path>
      </g>

      <g class="life-wheel-chart__hover-number" aria-hidden="true">
        <text
          v-for="segment in wheelSegments"
          v-show="hoverSegmentId === segment.id && hoverRating"
          :key="`${segment.id}-hover-number`"
          :x="segment.hoverLabelPoint.x"
          :y="segment.hoverLabelPoint.y"
        >
          {{ hoverRating }}
        </text>
      </g>
    </svg>

    <div class="life-wheel-chart__labels">
      <button
        v-for="segment in wheelSegments"
        :key="`${segment.id}-label`"
        type="button"
        class="life-wheel-chart__label"
        :class="{ 'is-active': hoverSegmentId === segment.id }"
        :style="segment.labelStyle"
        :aria-label="`${segment.label}${segment.value ? `, ${segment.value} of 10` : ', not scored'}. ${segment.helper}`"
        :title="segment.helper"
        :disabled="!interactive"
        @pointerenter="hoverSegmentId = segment.id"
        @pointerleave="handlePointerLeave"
        @click="setSegmentValue(segment.id, segment.value || 5)"
      >
        <span
          v-if="segment.emoji"
          class="life-wheel-chart__label-emoji"
          aria-hidden="true"
        >
          <UiIcon
            v-if="isUiIconName(segment.emoji)"
            :name="segment.emoji as UiIconName"
            :size="18"
          />
          <template v-else>{{ segment.emoji }}</template>
        </span>
        <span class="life-wheel-chart__label-name">{{ segment.label }}</span>
        <span v-if="segment.value" class="life-wheel-chart__label-score">
          {{ segment.value }}/10
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.life-wheel-chart {
  position: relative;
  display: grid;
  width: min(840px, 100%);
  aspect-ratio: 1;
  place-items: center;
  margin: 0 auto;
}

.life-wheel-chart__svg {
  display: block;
  width: 100%;
  max-width: 780px;
  aspect-ratio: 1;
  overflow: visible;
}

.life-wheel-chart__grid circle,
.life-wheel-chart__grid line {
  fill: none;
  stroke: color-mix(in oklab, var(--ui-text-muted), transparent 58%);
  stroke-width: 0.65;
  vector-effect: non-scaling-stroke;
}

.life-wheel-chart__grid circle.is-outer {
  stroke: var(--ui-text);
  stroke-width: 1.6;
}

.life-wheel-chart__center-dot {
  fill: var(--ui-text);
  stroke: none;
}

.life-wheel-chart__hit-area {
  cursor: crosshair;
  outline: none;
}

.life-wheel-chart__hit-area.is-disabled {
  cursor: default;
}

.life-wheel-chart__hit-area:focus-visible {
  stroke: var(--ui-accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.life-wheel-chart__hover-number text,
.life-wheel-chart__hover-number {
  fill: var(--ui-text);
  font-size: 9px;
  font-weight: 800;
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}

.life-wheel-chart__labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.life-wheel-chart__label {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: clamp(68px, 14%, 108px);
  max-width: 24%;
  gap: 2px;
  padding: 4px 5px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.05;
  text-align: center;
  transform: translate(
    calc(
      var(--life-wheel-label-transform-x, -50%) +
        var(--life-wheel-label-active-nudge, 0%)
    ),
    -50%
  );
  cursor: pointer;
  pointer-events: auto;
}

.life-wheel-chart__label:disabled {
  cursor: default;
}

.life-wheel-chart__label-name,
.life-wheel-chart__label-score {
  display: block;
  width: 100%;
}

.life-wheel-chart__label-name {
  overflow-wrap: anywhere;
}

.life-wheel-chart__label-score {
  white-space: nowrap;
  max-height: 0;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    max-height 160ms ease,
    opacity 160ms ease,
    transform 160ms ease;
}

.life-wheel-chart__label:hover,
.life-wheel-chart__label:focus-visible,
.life-wheel-chart__label.is-active {
  border-color: var(--ui-border);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

.life-wheel-chart__label:hover .life-wheel-chart__label-score,
.life-wheel-chart__label:focus-visible .life-wheel-chart__label-score,
.life-wheel-chart__label.is-active .life-wheel-chart__label-score,
.life-wheel-chart--compact .life-wheel-chart__label-score {
  max-height: 1.2em;
  opacity: 1;
  transform: translateY(0);
}

.life-wheel-chart__label-emoji {
  flex: 0 0 auto;
  font-size: 16px;
  line-height: 1;
}

.life-wheel-chart--compact {
  width: min(640px, 100%);
}

.life-wheel-chart--compact .life-wheel-chart__svg {
  max-width: 640px;
}

.life-wheel-chart--compact .life-wheel-chart__label {
  width: clamp(76px, 16%, 104px);
  padding: 3px 1px;
  font-size: 10px;
  font-weight: 700;
}

.life-wheel-chart--compact .life-wheel-chart__label-name {
  white-space: nowrap;
}

@media (max-width: 959px) {
  .life-wheel-chart {
    width: min(100%, 680px);
  }

  .life-wheel-chart__svg {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .life-wheel-chart {
    width: min(100%, 430px);
  }

  .life-wheel-chart__svg {
    width: 100%;
  }

  .life-wheel-chart__label {
    --life-wheel-label-active-nudge: var(--life-wheel-label-mobile-nudge, 0%);
    width: 78px;
    max-width: 28%;
    gap: 1px;
    padding: 3px 1px;
    background: var(--ui-surface);
    font-size: 9.5px;
    font-weight: 700;
  }

  .life-wheel-chart--compact .life-wheel-chart__label-name {
    white-space: nowrap;
  }

  .life-wheel-chart__label-emoji {
    font-size: 14px;
  }
}
</style>
