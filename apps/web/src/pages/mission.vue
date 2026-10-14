<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { api } from "../api";
import UiIcon from "../components/UiIcon.vue";
import GoalsDialog from "../components/tasks/GoalsDialog.vue";
import HomeWheelChart, { type HomeWheelArea } from "../components/home/HomeWheelChart.vue";
import { useAppToast } from "../composables/useAppToast";
import { useTodayPlan } from "../composables/useTodayPlan";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "Mission | ME3",
    description: "Your mission, your goals and the one you're focused on, and your Wheel of Life.",
    robots: "noindex,follow",
  },
});

// Direction: the things that change monthly, not daily. Today shows only the focus goal.
const { toastFromUnknown } = useAppToast();
const plan = useTodayPlan();
const mission = ref("");
const wheel = ref<HomeWheelArea[]>([]);
const wheelDate = ref("");
const loading = ref(true);
const error = ref("");
const editing = ref<false | { areaId: string | null }>(false);
const focusing = ref("");
const activeGoals = computed(() => plan.goals.value.filter(goal => goal.status !== "completed"));
const doneGoals = computed(() => plan.goals.value.filter(goal => goal.status === "completed"));
const areaFor = (id?: string | null) => wheel.value.find(area => area.id === id);
const scored = computed(() => wheel.value.some(area => area.value !== null));
const lowest = computed(() => [...wheel.value].filter(area => area.value !== null).sort((a, b) => a.value! - b.value!)[0]);

async function load() {
  loading.value = true; error.value = "";
  const [dashboard, goals, wheelData] = await Promise.allSettled([
    api.get<{ missionStatement?: string }>("/mission-control/dashboard"),
    plan.loadGoals(),
    api.get<{ snapshots: { createdAt: string; segments: HomeWheelArea[] }[]; settings: { segments: HomeWheelArea[] } }>("/journal/wheel"),
  ]);
  // The API falls back to a fill-in-the-blanks template; treat that as no mission yet.
  if (dashboard.status === "fulfilled") mission.value = /\[[^\]]+\]/.test(dashboard.value.missionStatement || "") ? "" : dashboard.value.missionStatement || "";
  if (wheelData.status === "fulfilled") {
    wheelDate.value = wheelData.value.snapshots?.[0]?.createdAt || "";
    wheel.value = wheelData.value.snapshots?.[0]?.segments || wheelData.value.settings?.segments || [];
  }
  if (goals.status === "rejected") error.value = "Couldn't load your goals. Try again.";
  loading.value = false;
}
async function makeFocus(id: string) {
  if (focusing.value) return;
  focusing.value = id;
  try { await plan.makeFocus(id); }
  catch (err) { toastFromUnknown(err, "Couldn't change your focus"); }
  finally { focusing.value = ""; }
}
function closeEditor() { editing.value = false; void load(); }
onMounted(load);
</script>

<template>
  <main class="mission-page">
    <Teleport to="#app-page-controls" defer>
      <div class="mission-bar"><span>Mission</span></div>
    </Teleport>
    <div class="mission-col" :aria-busy="loading">
      <p v-if="error" class="mission-error" role="alert">{{ error }} <button type="button" @click="load">Try again</button></p>

      <section class="mission-card" aria-labelledby="mission-title">
        <h2 id="mission-title"><span aria-hidden="true">🚀</span>Mission</h2>
        <p v-if="mission" class="mission-statement">{{ mission }}</p>
        <template v-else-if="!loading">
          <p class="mission-muted">What do you want your life built around? Start there, then add goals.</p>
          <RouterLink :to="{ path: '/assistant', query: { prompt: 'Help me write my mission.' } }" class="mission-quiet"><UiIcon name="Plus" :size="16" />Write your mission with ME3</RouterLink>
        </template>
      </section>

      <section class="mission-card" aria-labelledby="goals-title">
        <h2 id="goals-title"><span aria-hidden="true">🎯</span>Goals<span class="mission-detail">Your focus shows on Today</span></h2>
        <div v-for="(goal, index) in activeGoals" :key="goal.id" class="mission-goal">
          <span class="mission-goal__area" aria-hidden="true">{{ areaFor(goal.areaId)?.emoji || '🎯' }}</span>
          <div class="mission-goal__main">
            <strong>{{ goal.title }}</strong>
            <span class="mission-progress" aria-hidden="true"><i :style="{ width: `${goal.progress || 0}%` }" /></span>
          </div>
          <span v-if="index === 0" class="mission-focus is-on">Focus</span>
          <button v-else type="button" class="mission-focus" :disabled="Boolean(focusing)" @click="makeFocus(goal.id)">Make focus</button>
        </div>
        <p v-if="!loading && !activeGoals.length" class="mission-muted">No goals yet.</p>
        <p v-if="doneGoals.length" class="mission-muted">{{ doneGoals.length }} completed</p>
        <button type="button" class="mission-quiet" @click="editing = { areaId: null }"><UiIcon :name="activeGoals.length ? 'Pencil' : 'Plus'" :size="16" />{{ activeGoals.length ? 'Edit goals' : 'Add a goal' }}</button>
      </section>

      <section class="mission-card" aria-labelledby="wheel-title">
        <h2 id="wheel-title"><span aria-hidden="true">🛞</span>Wheel of Life<span v-if="wheelDate" class="mission-detail">Checked in {{ new Date(wheelDate).toLocaleDateString([], { day: 'numeric', month: 'short' }) }}</span></h2>
        <div v-if="scored" class="mission-wheel">
          <RouterLink to="/wheel-of-life" class="mission-wheel__chart" aria-label="Open Wheel of Life"><HomeWheelChart :areas="wheel" :selected="lowest?.id" /></RouterLink>
          <div class="mission-wheel__rows">
            <div v-for="area in wheel" :key="area.id" class="mission-area"><span aria-hidden="true">{{ area.emoji }}</span><span>{{ area.label }}</span><strong>{{ area.value ?? '—' }}</strong></div>
          </div>
        </div>
        <p v-else-if="!loading" class="mission-muted">Score the areas of your life.</p>
        <RouterLink to="/wheel-of-life" class="mission-quiet">{{ scored ? 'Check in' : 'Start a check-in' }}</RouterLink>
      </section>
    </div>
    <GoalsDialog v-if="editing" :initial-area-id="editing.areaId" @close="closeEditor" />
  </main>
</template>

<style scoped>
.mission-page { padding: 8px 16px 96px; }
.mission-bar { display: flex; justify-content: center; width: 100%; font-size: 15px; font-weight: 700; }
.mission-col { display: flex; flex-direction: column; gap: 16px; width: min(620px, 100%); margin: 0 auto; }
.mission-card { padding: 14px 18px 12px; border-radius: 24px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.mission-card h2 { display: flex; align-items: center; gap: 8px; min-height: 40px; margin: 0; font-size: 15px; font-weight: 600; }
.mission-card h2 > span[aria-hidden] { font-size: 20px; line-height: 1; }
.mission-detail { margin-left: 4px; color: var(--ui-text-muted); font-size: 12px; font-weight: 400; }
.mission-statement { margin: 6px 0 10px; font-family: var(--font-serif, Georgia, serif); font-size: 21px; line-height: 1.45; }
.mission-muted { margin: 4px 0; color: var(--ui-text-muted); font-size: 14px; }
.mission-quiet { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 14px; font-weight: 500; text-decoration: none; cursor: pointer; }
.mission-quiet:hover { color: var(--ui-text); }
.mission-goal { display: flex; align-items: center; gap: 12px; min-height: 58px; box-shadow: inset 0 -1px 0 var(--ui-border); }
.mission-goal__area { width: 26px; font-size: 20px; text-align: center; }
.mission-goal__main { display: grid; flex: 1; gap: 6px; min-width: 0; }
.mission-goal__main strong { overflow: hidden; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.mission-progress { display: block; width: min(180px, 100%); height: 4px; border-radius: 4px; background: var(--ui-surface-muted); }
.mission-progress i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); }
.mission-focus { flex-shrink: 0; min-height: 34px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 13px; font-weight: 600; line-height: 34px; cursor: pointer; }
.mission-focus.is-on { background: var(--ui-primary); color: var(--ui-primary-contrast); cursor: default; }
.mission-focus:disabled { opacity: .5; cursor: default; }
.mission-wheel { display: flex; align-items: center; gap: 20px; padding: 6px 0; }
.mission-wheel__chart { flex: 0 0 auto; border-radius: 50%; }
.mission-wheel__chart :deep(svg) { width: 170px; height: 170px; }
.mission-wheel__rows { display: grid; flex: 1; gap: 4px; min-width: 0; }
.mission-area { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.mission-area strong { margin-left: auto; font-variant-numeric: tabular-nums; }
.mission-error { color: var(--ui-danger, #dc2626); font-size: 14px; }
.mission-error button { border: 0; background: transparent; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
@media (max-width: 640px) {
  .mission-page { padding-inline: 10px; }
  .mission-wheel { flex-direction: column; align-items: stretch; }
  .mission-wheel__chart { align-self: center; }
}
</style>
