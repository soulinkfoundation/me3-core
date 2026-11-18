<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../Button.vue";
import { useAppToast } from "../../composables/useAppToast";
import { currentTourTarget, onTourScreen, placeTourCard, tourPlaceForPath, tourScreenRoute, type TourPlacement, type TourStep, type TourTarget } from "../../utils/chatTour";
import { useTourStore } from "../../stores/tour";

/**
 * Show me around (me3-q6la.5): a card over the whole app that points at what to tap next (the Home tab, then
 * + Add to Home; the profile picture, then Accounts). The owner does each step themselves and keeps their place;
 * each step ticks when it's really done. With nothing to point at, the card docks in the corner.
 */
const tour = useTourStore();
const route = useRoute();
const router = useRouter();
const { toastSuccess, toastFromUnknown } = useAppToast();
const titleId = useId();
const step = computed(() => tour.step);
// Landing on Accounts or Social is the step, so it counts at once rather than after Core answers;
// otherwise the card would jump to Back for a moment while the save is on its way.
const done = computed(() => Boolean(step.value && (step.value.done || tourPlaceForPath(route.path) === step.value.id)));
const total = computed(() => tour.tour?.steps.length ?? 0);
const here = computed(() => Boolean(step.value && onTourScreen(step.value.screen, route.path, route.query.view)));
// A step explains its screen once the owner is on it; on the way there it says how to get there.
const text = computed(() => step.value && step.value.intro && !here.value && !done.value ? step.value.intro : step.value?.body ?? "");
// A step with nothing to point at (Socials, the website) has Next bring the owner to its screen,
// and a way there if they come back to it from somewhere else.
const leads = (item: TourStep | null) => Boolean(item && item.screen && !item.targets.length);
const takeThere = computed(() => leads(step.value) && !here.value && !step.value?.task);
const card = ref<HTMLElement | null>(null);
const target = ref<TourTarget | null>(null);
const placement = ref<TourPlacement | null>(null);

watch([() => route.path, () => tour.open], ([path]) => { const place = tourPlaceForPath(path); if (place) tour.seen(place); }, { immediate: true });
// Home tells the tour when its cards change, so Add a card ticks straight away.
const homeChanged = () => void tour.refresh();

function targetElement(id: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour-target="${id}"]`)) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden") return element;
  }
  return null;
}

// The ring sits on the element itself, so it shows even inside an open dialog the card is behind.
let ringed: HTMLElement | null = null;
function ring(element: HTMLElement | null) {
  if (ringed === element) return;
  ringed?.classList.remove("tour-target-ring");
  ringed = element;
  ringed?.classList.add("tour-target-ring");
}

function update() {
  if (!tour.open || !step.value || !card.value) { ring(null); placement.value = null; target.value = null; return; }
  const next = done.value ? null : currentTourTarget(step.value.targets, id => Boolean(targetElement(id)));
  target.value = next;
  const element = next ? targetElement(next.id) : null;
  ring(element);
  if (!element) { placement.value = null; return; }
  const menu = element.closest<HTMLElement>("[role='menu']");
  placement.value = placeTourCard(element.getBoundingClientRect(), { width: card.value.offsetWidth, height: card.value.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight }, menu?.getBoundingClientRect());
}
// Menus, Home and dialogs open and close without telling the tour, so it looks again a few times a second.
let timer: ReturnType<typeof setInterval> | undefined;
watch(() => tour.open, open => {
  clearInterval(timer);
  if (open) { timer = setInterval(update, 200); void nextTick(update); } else update();
}, { immediate: true });
watch(() => [tour.index, done.value], () => void nextTick(update));
onMounted(() => { window.addEventListener("me3:home-layout-changed", homeChanged); window.addEventListener("resize", update); });
onBeforeUnmount(() => { clearInterval(timer); ring(null); window.removeEventListener("me3:home-layout-changed", homeChanged); window.removeEventListener("resize", update); });

const position = computed(() => placement.value ? { top: `${placement.value.top}px`, left: `${placement.value.left}px`, right: "auto", bottom: "auto", transform: "none" } : undefined);
const arrowStyle = computed(() => !placement.value ? undefined
  : placement.value.side === "left" ? { top: `${placement.value.arrow}px` } : { left: `${placement.value.arrow}px` });

async function doTask() {
  const task = step.value?.task;
  if (!task) return;
  // The website is last: it needs the owner's input, so the tour hands over to it.
  tour.end("finished");
  if (task.kind === "site_ask") await router.push({ path: "/assistant", query: { view: "chat", build: "site" } });
  else await router.push("/sites");
}
async function copy() {
  const value = step.value?.copy?.value;
  if (!value) return;
  try { await navigator.clipboard.writeText(value); toastSuccess("Copied"); }
  catch (error) { toastFromUnknown(error, "Couldn't copy that"); }
}
async function goTo(index: number) {
  tour.go(index);
  const item = tour.step;
  if (item && leads(item) && !onTourScreen(item.screen, route.path, route.query.view)) await router.push(tourScreenRoute(item.screen!));
}
function next() { if (tour.isLast) tour.end("finished"); else void goTo(tour.index + 1); }
function back() { void goTo(tour.index - 1); }
async function openScreen() { if (step.value?.screen) await router.push(tourScreenRoute(step.value.screen)); }
</script>

<template>
  <section v-if="tour.open && step" ref="card" class="app-tour" :class="placement && `app-tour--${placement.side}`" :style="position" role="dialog" aria-modal="false" :aria-labelledby="titleId" data-testid="app-tour" :data-target="target?.id">
    <span v-if="placement" class="app-tour__arrow" :style="arrowStyle" aria-hidden="true" />
    <div class="app-tour__head">
      <span class="app-tour__emoji" aria-hidden="true">{{ step.emoji }}</span>
      <h2 :id="titleId" class="app-tour__title">{{ step.title }}</h2>
      <span v-if="done" class="app-tour__done" data-testid="tour-done">✓ Done</span>
    </div>
    <p class="app-tour__body" data-testid="tour-body">{{ text }}</p>
    <p v-if="target" class="app-tour__sr" aria-live="polite" data-testid="tour-hint">{{ target.hint }}</p>
    <div class="app-tour__actions">
      <Button v-if="step.task && !done" color="primary" shape="soft" type="button" data-testid="tour-task" @click="doTask">{{ step.task.label }}</Button>
      <Button v-if="takeThere" color="primary" shape="soft" type="button" @click="openScreen">Take me there</Button>
      <Button v-if="step.copy" color="ghost" shape="soft" type="button" @click="copy">{{ step.copy.label }}</Button>
    </div>
    <div class="app-tour__foot">
      <span class="app-tour__dots" aria-hidden="true"><i v-for="(item, dot) in tour.tour?.steps" :key="item.id" :class="{ 'is-on': dot <= tour.index }" /></span>
      <span class="app-tour__count">{{ tour.index + 1 }} of {{ total }}</span>
      <span class="app-tour__spacer" />
      <!-- Skip only on the first card: once they've started, the tour carries on to the end. -->
      <button v-if="tour.index === 0" type="button" class="app-tour__skip" @click="tour.end('skipped')">Skip</button>
      <Button v-if="tour.index > 0" color="ghost" shape="soft" type="button" @click="back">Back</Button>
      <!-- One thing to do at a time: Next shows only once the owner has done the step. -->
      <Button v-if="done" color="primary" shape="soft" type="button" data-testid="tour-next" @click="next">{{ tour.isLast ? "Finish" : "Next" }}</Button>
    </div>
  </section>
</template>

<style scoped>
/* Under dialogs, so Add to Home stays usable. */
/* With nothing to point at it sits centred near the bottom, clear of Chat's composer. */
.app-tour { position: fixed; z-index: 60; left: 50%; bottom: 96px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: min(344px, calc(100vw - 32px)); padding: 16px 16px 8px; border: 1px solid var(--ui-border); border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: 0 12px 32px rgb(0 0 0 / 14%); transition: top .25s ease, left .25s ease; }
@media (max-width: 640px) { .app-tour:not([style]) { right: 16px; left: 16px; bottom: calc(84px + env(safe-area-inset-bottom)); width: auto; transform: none; } }
@media (prefers-reduced-motion: reduce) { .app-tour { transition: none; } }
.app-tour__arrow { position: absolute; width: 14px; height: 14px; background: var(--ui-surface); border: 1px solid var(--ui-border); transform: translate(-50%, -50%) rotate(45deg); }
.app-tour--below .app-tour__arrow { top: 0; border-right: 0; border-bottom: 0; }
.app-tour--above .app-tour__arrow { top: 100%; border-top: 0; border-left: 0; }
.app-tour--left .app-tour__arrow { left: 100%; border-bottom: 0; border-left: 0; }
.app-tour__head { display: flex; align-items: center; gap: 8px; }
.app-tour__emoji { font-size: 20px; line-height: 1; }
.app-tour__title { flex: 1; margin: 0; font-size: 17px; font-weight: 600; }
.app-tour__done { padding: 2px 10px; border-radius: 999px; background: var(--ui-accent-soft); color: var(--ui-accent-strong); font-size: 13px; font-weight: 600; white-space: nowrap; }
.app-tour__body { margin: 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
/* The ring shows what to tap; screen readers hear the hint instead. */
.app-tour__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.app-tour__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
.app-tour__actions:empty { display: none; }
.app-tour__actions :deep(.me3-btn), .app-tour__foot :deep(.me3-btn) { min-height: 44px; }
.app-tour__spacer { flex: 1; }
.app-tour__foot { display: flex; align-items: center; gap: 4px; }
.app-tour__count { margin-left: 4px; }
.app-tour__dots { display: inline-flex; gap: 6px; }
.app-tour__dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-border); }
.app-tour__dots i.is-on { background: var(--ui-accent); }
.app-tour__count { color: var(--ui-text-muted); font-size: 12px; white-space: nowrap; }
.app-tour__skip { min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--ui-text-muted); font-size: 13px; cursor: pointer; }
.app-tour__skip:hover { color: var(--ui-text); text-decoration: underline; }
.app-tour__skip:focus-visible { outline: 2px solid var(--ui-accent); border-radius: 6px; }
</style>

<style>
/* The thing to tap next: a ring pulses out from it. */
.tour-target-ring { animation: tour-target-ring 1.8s ease-out infinite; }
@keyframes tour-target-ring {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent) 55%, transparent); }
  70% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--ui-accent) 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent) 0%, transparent); }
}
@media (prefers-reduced-motion: reduce) { .tour-target-ring { animation: none; box-shadow: 0 0 0 3px var(--ui-accent); } }
</style>
