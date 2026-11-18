<script setup lang="ts">
import { computed, ref, useId } from "vue";
import Button from "../Button.vue";
import type { ChatTour, TourStep } from "../../utils/chatTour";

/** Show me around: one step at a time, each with something real to try (me3-q6la.5). */
const props = defineProps<{ tour: ChatTour }>();
const emit = defineEmits<{ try: [step: TourStep]; close: [] }>();
const titleId = useId();
const index = ref(0);
const finished = computed(() => index.value >= props.tour.steps.length);
const step = computed(() => props.tour.steps[Math.min(index.value, props.tour.steps.length - 1)]);
const isLast = computed(() => index.value === props.tour.steps.length - 1);
</script>

<template>
  <section class="tour" :aria-labelledby="titleId" data-testid="chat-tour">
    <template v-if="!finished">
      <div class="tour__head">
        <span class="tour__emoji" aria-hidden="true">{{ step.emoji }}</span>
        <h3 :id="titleId" class="tour__title">{{ step.title }}</h3>
      </div>
      <p class="tour__body">{{ step.body }}</p>
      <p class="tour__where">You'll find this in {{ step.where }}.</p>
      <div class="tour__actions">
        <Button v-if="step.tryIt" color="ghost" shape="soft" type="button" data-testid="tour-try" @click="emit('try', step)">{{ step.tryIt.label }}</Button>
        <span class="tour__spacer" />
        <Button v-if="index > 0" color="ghost" shape="soft" type="button" @click="index--">Back</Button>
        <Button color="primary" shape="soft" type="button" @click="index++">{{ isLast ? "Finish" : "Next" }}</Button>
      </div>
      <div class="tour__progress">
        <span class="tour__dots" aria-hidden="true"><i v-for="(_, dot) in tour.steps" :key="dot" :class="{ 'is-on': dot <= index }" /></span>
        <span class="tour__count">{{ index + 1 }} of {{ tour.steps.length }}</span>
      </div>
    </template>
    <template v-else>
      <h3 :id="titleId" class="tour__title">{{ tour.done.title }}</h3>
      <p class="tour__body">{{ tour.done.body }}</p>
      <div class="tour__actions">
        <Button color="ghost" shape="soft" type="button" @click="index = 0">Start again</Button>
        <span class="tour__spacer" />
        <Button color="primary" shape="soft" type="button" @click="emit('close')">Done</Button>
      </div>
    </template>
    <button type="button" class="tour__close" aria-label="Close the tour" @click="emit('close')">×</button>
  </section>
</template>

<style scoped>
.tour { position: relative; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: min(560px, 100%); padding: 16px 16px 14px; border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.tour__head { display: flex; align-items: center; gap: 8px; padding-right: 32px; }
.tour__emoji { font-size: 20px; line-height: 1; }
.tour__title { margin: 0; font-size: 17px; font-weight: 600; }
.tour__progress { display: flex; align-items: center; justify-content: center; gap: 8px; }
.tour__count { color: var(--ui-text-muted); font-size: 12px; white-space: nowrap; }
.tour__body { margin: 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
.tour__where { margin: 0; color: var(--ui-text-muted); font-size: 13px; }
.tour__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
.tour__actions :deep(.me3-btn) { min-height: 44px; }
.tour__spacer { flex: 1; }
.tour__dots { display: inline-flex; gap: 6px; }
.tour__dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-border); }
.tour__dots i.is-on { background: var(--ui-accent); }
.tour__close { position: absolute; top: 6px; right: 6px; width: 44px; height: 44px; border: 0; background: none; color: var(--ui-text-muted); font-size: 22px; cursor: pointer; }
.tour__close:focus-visible { outline: 2px solid var(--ui-accent); border-radius: 50%; }
</style>
