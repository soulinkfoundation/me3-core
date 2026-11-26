<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { coverTourCard, currentTourScreen, currentTourTarget, onTourScreen, placeTourCard, tourArrival, tourCardWaits, tourLeftLast, tourMovesOn, tourPlaceForPath, tourScreenRoute, tourScreenToOpen, tourStepDone, tourStepIsHere, type TourPlacement, type TourScreen, type TourTarget, type TourTickMemory, type TourTrip } from "../../utils/chatTour";
import { useTourStore } from "../../stores/tour";

/**
 * Show me around (me3-q6la.5): a card over the whole app that points at what to tap next (the Home tab, then
 * + Add to Home). The owner does each step themselves and keeps their place;
 * each step ticks when it's really done. With nothing to point at, the card covers the screen's empty placeholder,
 * or sits in the middle.
 */
const tour = useTourStore();
const route = useRoute();
const router = useRouter();
const titleId = useId();
const step = computed(() => tour.step);
const screen = computed(() => currentTourScreen(route.path, route.query.view));
// Landing on Accounts or Social is the step, so it counts at once rather than after Core answers;
// otherwise the card would jump to Back for a moment while the save is on its way.
const done = computed(() => Boolean(step.value && tourStepDone(step.value, screen.value)));
const total = computed(() => tour.tour?.steps.length ?? 0);
const here = computed(() => Boolean(step.value && onTourScreen(step.value.screen, route.path, route.query.view)));
// A step explains its screen once the owner is on it; on the way there it says how to get there.
const text = computed(() => step.value && step.value.intro && !here.value && !done.value ? step.value.intro : step.value?.body ?? "");
// A step with nothing to point at (Socials, the website) has Next bring the owner to its screen,
// and a way there if they come back to it from somewhere else.
const takeThere = computed(() => Boolean(step.value?.screen && !step.value.targets.length && !here.value && !step.value.task));
const card = ref<HTMLElement | null>(null);
const target = ref<TourTarget | null>(null);
const placement = ref<TourPlacement | null>(null);
// The card steps aside while the screen the tour asked for opens, and while a dialog covers the step's screen.
const hidden = ref(false);
let trip: TourTrip | null = null;
let reachedLast = false;
let ticked: TourTickMemory | null = null;

watch([() => route.path, () => tour.open], ([path]) => { const place = tourPlaceForPath(path); if (place) tour.seen(place); }, { immediate: true });
watch(() => tour.open, open => { if (open) { trip = null; reachedLast = false; ticked = null; } });
// Home tells the tour when its cards change, so Add a card ticks straight away.
const homeChanged = () => void tour.refresh();

function shown(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
}
function targetElement(id: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour-target="${id}"]`)) if (shown(element)) return element;
  return null;
}
/** A screen's empty placeholder (Chat's welcome, no Accounts entries yet), on screen now. */
function backdropElement(): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>("[data-tour-backdrop]")) {
    const box = element.getBoundingClientRect();
    if (shown(element) && box.bottom > 0 && box.top < window.innerHeight) return element;
  }
  return null;
}
function openDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>("dialog[open], [role='dialog'][aria-modal='true']");
}

// The ring sits on the element itself, so it shows even inside an open dialog the card is behind.
let ringed: HTMLElement | null = null;
function ring(element: HTMLElement | null) {
  if (ringed === element) return;
  ringed?.classList.remove("tour-target-ring");
  ringed = element;
  ringed?.classList.add("tour-target-ring");
}
// The placeholder the card covers fades out underneath it.
let covered: HTMLElement | null = null;
function cover(element: HTMLElement | null) {
  if (covered === element) return;
  covered?.classList.remove("tour-backdrop--covered");
  covered = element;
  covered?.classList.add("tour-backdrop--covered");
}

function hide(value: boolean) {
  hidden.value = value;
  if (value) { ring(null); cover(null); placement.value = null; target.value = null; }
}

function update() {
  const item = step.value;
  if (!tour.open || !item || !card.value) { hide(true); hidden.value = false; return; }
  const arrival = tourArrival(trip, screen.value, Date.now());
  trip = arrival.trip;
  if (arrival.waiting) { hide(true); return; }
  // Calendar is where the owner connects one: the card waits until they're back.
  if (tourStepIsHere(item, route.path)) { hide(true); return; }
  // Walking away from the last card without choosing anything finishes the tour.
  const last = tourLeftLast(reachedLast, { isLast: tour.isLast, screen: item.screen, current: screen.value });
  reachedLast = last.reached;
  if (last.end) { tour.end("finished"); return; }
  const visible = currentTourTarget(item.targets, id => Boolean(targetElement(id)));
  const visibleElement = visible ? targetElement(visible.id) : null;
  const dialog = openDialog();
  // Add to Home is open over Home: the owner is doing the step there, so the card waits until it closes.
  if (tourCardWaits(item, screen.value, { open: Boolean(dialog), holdsTarget: Boolean(dialog && visibleElement && dialog.contains(visibleElement)) })) { hide(true); return; }
  hide(false);
  // Done what Home asked (a card added, Inbox picked) and back with nothing open: straight on to the next step.
  const moves = tourMovesOn(ticked, { stepId: item.id, done: item.done, hasTargets: item.targets.length > 0, settled: here.value && !dialog });
  ticked = moves.memory;
  if (moves.advance) { next(); return; }
  const pointAt = done.value ? null : visible;
  target.value = pointAt;
  const element = pointAt ? targetElement(pointAt.id) : null;
  ring(element);
  const size = { width: card.value.offsetWidth, height: card.value.offsetHeight };
  const view = { width: window.innerWidth, height: window.innerHeight };
  if (!element) {
    // Nothing to point at: cover the screen's empty placeholder, or sit in the middle for a step that leads to a screen.
    const backdrop = backdropElement();
    cover(backdrop);
    const box = backdrop?.getBoundingClientRect() ?? (item.targets.length ? null : { top: 0, left: 0, right: view.width, bottom: view.height });
    placement.value = box ? coverTourCard(box, size, view, 96) : null;
    return;
  }
  cover(null);
  const menu = element.closest<HTMLElement>("[role='menu']");
  placement.value = placeTourCard(element.getBoundingClientRect(), size, view, menu?.getBoundingClientRect());
}
// Menus, Home and dialogs open and close without telling the tour, so it looks again a few times a second.
// A calendar connected (on Calendar, or through Google) doesn't tell it either, so while a step waits it asks Core every few seconds.
let timer: ReturnType<typeof setInterval> | undefined;
let ticks: ReturnType<typeof setInterval> | undefined;
watch(() => tour.open, open => {
  clearInterval(timer); clearInterval(ticks);
  if (open) {
    timer = setInterval(update, 200); void nextTick(update);
    ticks = setInterval(() => { if (step.value && !done.value && !document.hidden) void tour.refresh(); }, 5000);
  } else update();
}, { immediate: true });
watch(() => [tour.index, done.value], () => void nextTick(update));

// A new step (or a new thing to point at) starts invisible, takes its place, then fades in there: no sliding.
const cardKey = computed(() => `${tour.open}-${hidden.value}-${tour.index}-${target.value?.id ?? ""}`);
const visibleKey = ref<string | null>(null);
let fade: ReturnType<typeof setTimeout> | undefined;
watch(cardKey, key => {
  visibleKey.value = null;
  clearTimeout(fade);
  fade = setTimeout(() => { if (cardKey.value === key) visibleKey.value = key; }, 200);
}, { immediate: true });

onMounted(() => { window.addEventListener("me3:home-layout-changed", homeChanged); window.addEventListener("resize", update); });
onBeforeUnmount(() => { clearInterval(timer); clearInterval(ticks); clearTimeout(fade); ring(null); cover(null); window.removeEventListener("me3:home-layout-changed", homeChanged); window.removeEventListener("resize", update); });

const position = computed(() => placement.value ? { top: `${placement.value.top}px`, left: `${placement.value.left}px`, right: "auto", bottom: "auto", transform: "none" } : undefined);
const arrowStyle = computed(() => !placement.value ? undefined
  : placement.value.side === "left" ? { top: `${placement.value.arrow}px` } : { left: `${placement.value.arrow}px` });

/** Sends the owner to `place`; the card waits until it's there so it never shows over the screen being left. */
function travel(place: TourScreen) {
  trip = { screen: place, asked: Date.now(), arrived: null };
  hide(true);
  void router.push(tourScreenRoute(place));
}
async function doTask() {
  const task = step.value?.task;
  if (!task) return;
  // The website is last: it needs the owner's input, so the tour hands over to it.
  tour.end("finished");
  if (task.kind === "site_ask") await router.push({ path: "/assistant", query: { view: "chat", build: "site" } });
  else await router.push("/sites");
}
function goTo(index: number) {
  const from = screen.value;
  tour.go(index);
  const place = tour.step && tourScreenToOpen(tour.step, from);
  if (place) travel(place);
}
function next() { if (tour.isLast) tour.end("finished"); else goTo(tour.index + 1); }
function back() { goTo(tour.index - 1); }
function openScreen() { if (step.value?.screen) travel(step.value.screen); }
</script>

<template>
  <section v-if="tour.open && step" ref="card" class="app-tour" :class="[placement && `app-tour--${placement.side}`, { 'is-hidden': hidden, 'is-shown': visibleKey === cardKey }]" :style="position" role="dialog" aria-modal="false" :aria-labelledby="titleId" :aria-hidden="hidden || undefined" data-testid="app-tour" :data-target="target?.id">
    <span v-if="placement && placement.side !== 'over'" class="app-tour__arrow" :style="arrowStyle" aria-hidden="true" />
    <div class="app-tour__head">
      <span class="app-tour__emoji" aria-hidden="true">{{ step.emoji }}</span>
      <h2 :id="titleId" class="app-tour__title">{{ step.title }}</h2>
      <span v-if="done" class="app-tour__done" data-testid="tour-done">✓ Done</span>
      <!-- The last card's way out for an owner who isn't ready to make their website. -->
      <button v-if="step.task && tour.isLast" type="button" class="app-tour__close" aria-label="Close the tour" @click="tour.end('finished')"><UiIcon name="X" :size="18" /></button>
    </div>
    <p class="app-tour__body" data-testid="tour-body">{{ text }}</p>
    <p v-if="target" class="app-tour__sr" aria-live="polite" data-testid="tour-hint">{{ target.hint }}</p>
    <div v-if="takeThere" class="app-tour__actions">
      <Button color="primary" shape="soft" type="button" @click="openScreen">Take me there</Button>
    </div>
    <div class="app-tour__foot">
      <span class="app-tour__dots" aria-hidden="true"><i v-for="(item, dot) in tour.tour?.steps" :key="item.id" :class="{ 'is-on': dot <= tour.index }" /></span>
      <span class="app-tour__count">{{ tour.index + 1 }} of {{ total }}</span>
      <span class="app-tour__spacer" />
      <!-- Skip only on the first card: once they've started, the tour carries on to the end. -->
      <button v-if="tour.index === 0" type="button" class="app-tour__skip" @click="tour.end('skipped')">Skip</button>
      <!-- The website's button (Make my website, Open the editor) takes Back's place: it ends the tour. -->
      <Button v-if="step.task" :color="done ? 'secondary' : 'primary'" shape="soft" type="button" data-testid="tour-task" @click="doTask">{{ step.task.label }}</Button>
      <Button v-else-if="tour.index > 0" color="ghost" shape="soft" type="button" @click="back">Back</Button>
      <!-- One thing to do at a time: Next shows only once the owner has done the step. -->
      <Button v-if="done" color="primary" shape="soft" type="button" data-testid="tour-next" @click="next">{{ tour.isLast ? "Finish" : "Next" }}</Button>
      <!-- A step the owner may leave for later (connecting a calendar). -->
      <Button v-else-if="step.optional" color="ghost" shape="soft" type="button" data-testid="tour-later" @click="next">Not now</Button>
    </div>
  </section>
</template>

<style scoped>
/* Under dialogs, so Add to Home stays usable. */
/* With nothing to point at it sits centred near the bottom, clear of Chat's composer. */
.app-tour { position: fixed; z-index: 60; left: 50%; bottom: 96px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: min(344px, calc(100vw - 32px)); padding: 16px 16px 8px; border: 1px solid var(--ui-border); border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: 0 12px 32px rgb(0 0 0 / 14%); opacity: 0; pointer-events: none; }
/* A pure fade where the card sits: hidden at once, then 0 to 1 once it has its place. */
.app-tour.is-shown { opacity: 1; pointer-events: auto; transition: opacity .3s ease-out; }
.app-tour.is-hidden { visibility: hidden; }
@media (max-width: 640px) { .app-tour:not([style]) { right: 16px; left: 16px; bottom: calc(84px + env(safe-area-inset-bottom)); width: auto; transform: none; } }
.app-tour__arrow { position: absolute; width: 14px; height: 14px; background: var(--ui-surface); border: 1px solid var(--ui-border); transform: translate(-50%, -50%) rotate(45deg); }
.app-tour--below .app-tour__arrow { top: 0; border-right: 0; border-bottom: 0; }
.app-tour--above .app-tour__arrow { top: 100%; border-top: 0; border-left: 0; }
.app-tour--left .app-tour__arrow { left: 100%; border-bottom: 0; border-left: 0; }
.app-tour__head { display: flex; align-items: center; gap: 8px; }
.app-tour__emoji { flex: none; font-size: 20px; line-height: 1; }
/* One line: a long title ends in an ellipsis, and the Done pill never shrinks. */
.app-tour__title { flex: 1; min-width: 0; margin: 0; overflow: hidden; font-size: 17px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.app-tour__close { display: inline-flex; flex: none; width: 32px; height: 32px; margin-right: -6px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 999px; background: none; color: var(--ui-text-muted); cursor: pointer; }
.app-tour__close:hover { color: var(--ui-text); background: var(--ui-surface-muted); }
.app-tour__close:focus-visible { outline: 2px solid var(--ui-accent); }
.app-tour__done { flex: none; padding: 2px 10px; border-radius: 999px; background: var(--ui-accent-soft); color: var(--ui-accent-strong); font-size: 13px; font-weight: 600; white-space: nowrap; }
.app-tour__body { margin: 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
/* The ring shows what to tap; screen readers hear the hint instead. */
.app-tour__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.app-tour__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
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
/* A screen's empty placeholder fades out under the card covering it. */
[data-tour-backdrop] { transition: opacity .2s ease-out; }
.tour-backdrop--covered { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .tour-target-ring { animation: none; box-shadow: 0 0 0 3px var(--ui-accent); } }
</style>
