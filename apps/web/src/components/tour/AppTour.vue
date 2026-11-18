<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useId, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../Button.vue";
import { useAppToast } from "../../composables/useAppToast";
import { tourPlaceForPath } from "../../utils/chatTour";
import { useTourStore } from "../../stores/tour";

/**
 * Show me around (me3-q6la.5): a card over the whole app, so the owner can go and do each step
 * (add a card to Home, open Accounts) without losing their place. Each step ticks when it's really done.
 */
const tour = useTourStore();
const route = useRoute();
const router = useRouter();
const { toastSuccess, toastFromUnknown } = useAppToast();
const titleId = useId();
const step = computed(() => tour.step);
const total = computed(() => tour.tour?.steps.length ?? 0);

watch([() => route.path, () => tour.open], ([path]) => { const place = tourPlaceForPath(path); if (place) tour.seen(place); }, { immediate: true });
// Home tells the tour when its cards change, so Add a card ticks straight away.
const homeChanged = () => void tour.refresh();
onMounted(() => window.addEventListener("me3:home-layout-changed", homeChanged));
onBeforeUnmount(() => window.removeEventListener("me3:home-layout-changed", homeChanged));

async function doTask() {
  const task = step.value?.task;
  if (!task) return;
  if (task.kind === "site_ask") {
    // The website is last: it needs the owner's input, so the tour hands over to it.
    tour.end("finished");
    await router.push({ path: "/assistant", query: { view: "chat", build: "site" } });
    return;
  }
  if (task.to === "home_add") await router.push({ path: "/assistant", query: { view: "home", add: "1" } });
  else if (task.to === "website") { tour.end("finished"); await router.push("/sites"); }
  else await router.push(task.to === "accounts" ? "/accounts" : "/social");
}
async function copy() {
  const value = step.value?.copy?.value;
  if (!value) return;
  try { await navigator.clipboard.writeText(value); toastSuccess("Copied"); }
  catch (error) { toastFromUnknown(error, "Couldn't copy that"); }
}
function next() { if (tour.isLast) tour.end("finished"); else tour.go(tour.index + 1); }
</script>

<template>
  <section v-if="tour.open && step" class="app-tour" role="dialog" aria-modal="false" :aria-labelledby="titleId" data-testid="app-tour">
    <div class="app-tour__head">
      <span class="app-tour__emoji" aria-hidden="true">{{ step.emoji }}</span>
      <h2 :id="titleId" class="app-tour__title">{{ step.title }}</h2>
      <span v-if="step.done" class="app-tour__done" data-testid="tour-done">✓ Done</span>
    </div>
    <p class="app-tour__body">{{ step.body }}</p>
    <div class="app-tour__actions">
      <Button v-if="step.task && !step.done" color="primary" shape="soft" type="button" data-testid="tour-task" @click="doTask">{{ step.task.label }}</Button>
      <Button v-if="step.copy" color="ghost" shape="soft" type="button" @click="copy">{{ step.copy.label }}</Button>
      <span class="app-tour__spacer" />
      <Button v-if="tour.index > 0" color="ghost" shape="soft" type="button" @click="tour.go(tour.index - 1)">Back</Button>
      <Button v-if="!(tour.isLast && !step.done)" :color="step.done ? 'primary' : 'ghost'" shape="soft" type="button" data-testid="tour-next" @click="next">{{ tour.isLast ? "Finish" : "Next" }}</Button>
    </div>
    <div class="app-tour__foot">
      <span class="app-tour__dots" aria-hidden="true"><i v-for="(item, dot) in tour.tour?.steps" :key="item.id" :class="{ 'is-on': dot <= tour.index }" /></span>
      <span class="app-tour__count">{{ tour.index + 1 }} of {{ total }}</span>
      <span class="app-tour__spacer" />
      <button type="button" class="app-tour__skip" @click="tour.end('skipped')">Skip tour</button>
    </div>
  </section>
</template>

<style scoped>
/* Sits above the page, clear of Chat's composer; under dialogs, so Add to Home stays usable. */
.app-tour { position: fixed; z-index: 60; right: 24px; bottom: 96px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: min(400px, calc(100vw - 32px)); padding: 16px 16px 6px; border: 1px solid var(--ui-border); border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: 0 12px 32px rgb(0 0 0 / 14%); }
@media (max-width: 640px) { .app-tour { right: 16px; left: 16px; bottom: calc(84px + env(safe-area-inset-bottom)); width: auto; } }
.app-tour__head { display: flex; align-items: center; gap: 8px; }
.app-tour__emoji { font-size: 20px; line-height: 1; }
.app-tour__title { flex: 1; margin: 0; font-size: 17px; font-weight: 600; }
.app-tour__done { padding: 2px 10px; border-radius: 999px; background: var(--ui-accent-soft); color: var(--ui-accent-strong); font-size: 13px; font-weight: 600; white-space: nowrap; }
.app-tour__body { margin: 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
.app-tour__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
.app-tour__actions :deep(.me3-btn) { min-height: 44px; }
.app-tour__spacer { flex: 1; }
.app-tour__foot { display: flex; align-items: center; gap: 8px; }
.app-tour__dots { display: inline-flex; gap: 6px; }
.app-tour__dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-border); }
.app-tour__dots i.is-on { background: var(--ui-accent); }
.app-tour__count { color: var(--ui-text-muted); font-size: 12px; white-space: nowrap; }
.app-tour__skip { min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--ui-text-muted); font-size: 13px; cursor: pointer; }
.app-tour__skip:hover { color: var(--ui-text); text-decoration: underline; }
.app-tour__skip:focus-visible { outline: 2px solid var(--ui-accent); border-radius: 6px; }
</style>
