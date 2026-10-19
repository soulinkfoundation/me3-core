<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { definePage } from "unplugin-vue-router/runtime";
import { api } from "../api";
import { ownMissionStatement, saveMissionStatement } from "../utils/missionStatement";
import AppPageBar from "../components/AppPageBar.vue";
import Button from "../components/Button.vue";
import UiIcon from "../components/UiIcon.vue";
import HomeWheelChart, { type HomeWheelArea } from "../components/home/HomeWheelChart.vue";
import { useAppToast } from "../composables/useAppToast";
import { useTodayPlan } from "../composables/useTodayPlan";
import type { HomeGoal } from "../utils/homeSummary";

definePage({
  meta: {
    requiresAuth: true,
    title: "Mission | ME3",
    description: "Your goals, your Wheel of Life and your mission, edited in one place.",
    robots: "noindex,follow",
  },
});

// Direction: the things that change monthly, not daily. Goals come first because they're checked on most, the
// Wheel of Life is a now-and-again check-in, and the mission is the reminder underneath. Everything is edited
// here in place. Home links straight to a part: ?goal=<id>, ?focus=goals, ?focus=check-in or ?focus=statement.
const route = useRoute();
const { toast, toastError } = useAppToast();
const plan = useTodayPlan();
const loading = ref(true);
const loadError = ref("");

type Project = { id: string; name: string; status?: string };
const projects = ref<Project[]>([]);
const expanded = ref("");
const completedOpen = ref(false);
const activeGoals = computed(() => plan.goals.value.filter(goal => goal.status !== "completed"));
const doneGoals = computed(() => plan.goals.value.filter(goal => goal.status === "completed"));
const areas: HomeWheelArea[] = [
  { id: "health", label: "Health", color: "#ff3b30", emoji: "❤️", value: null },
  { id: "spirituality", label: "Spirituality", color: "#34c759", emoji: "🌿", value: null },
  { id: "work", label: "Work", color: "#ff9500", emoji: "💼", value: null },
  { id: "finances", label: "Finances", color: "#ffcc00", emoji: "💰", value: null },
  { id: "home", label: "Home", color: "#007aff", emoji: "🏡", value: null },
  { id: "joy", label: "Joy", color: "#af52de", emoji: "🤗", value: null },
];
const areaFor = (id?: string | null) => areas.find(area => area.id === id);

const wheel = ref<HomeWheelArea[]>([]);
const wheelDate = ref("");
const checkingIn = ref(false);
const wheelDraft = ref<HomeWheelArea[]>([]);
const savingWheel = ref(false);
const scored = computed(() => Boolean(wheelDate.value));
const lowest = computed(() => [...wheel.value].filter(area => area.value !== null).sort((a, b) => a.value! - b.value!)[0]);

const mission = ref("");
const editingMission = ref(false);
const missionDraft = ref("");
const savingMission = ref(false);
const missionField = ref<HTMLTextAreaElement | null>(null);

// Tasks inform progress without setting it: many goals aren't task-shaped, and adding a task shouldn't move you back.
function taskLine(goal: HomeGoal) {
  const linked = plan.tasks.value.filter(task => task.goalId === goal.id || goal.taskIds?.includes(task.id));
  if (!linked.length) return "";
  const done = linked.filter(task => task.status === "done").length;
  return `${done} of ${linked.length} ${linked.length === 1 ? "task" : "tasks"} done`;
}

async function load() {
  loading.value = true; loadError.value = "";
  const [dashboard, goals, wheelData, projectList] = await Promise.allSettled([
    api.get<{ missionStatement?: string }>("/mission-control/dashboard"),
    plan.loadGoals(),
    api.get<{ snapshots: { createdAt: string; segments: HomeWheelArea[] }[]; settings: { segments: HomeWheelArea[] } }>("/journal/wheel"),
    api.get<{ projects: Project[] }>("/mission-control/projects"),
    plan.loadTasks().catch(() => undefined),
  ]);
  if (dashboard.status === "fulfilled") mission.value = ownMissionStatement(dashboard.value.missionStatement);
  if (wheelData.status === "fulfilled") {
    wheelDate.value = wheelData.value.snapshots?.[0]?.createdAt || "";
    wheel.value = wheelData.value.snapshots?.[0]?.segments || wheelData.value.settings?.segments || [];
  }
  if (projectList.status === "fulfilled") projects.value = projectList.value.projects.filter(project => project.status !== "archived");
  if (goals.status === "rejected") loadError.value = "Couldn't load your goals. Try again.";
  loading.value = false;
}

function save() {
  plan.saveGoals().catch(error => toastError(error instanceof Error ? `Couldn't save your goals. ${error.message}` : "Couldn't save your goals."));
}

function toggle(id: string) {
  const opening = expanded.value !== id;
  dropUntitled();
  expanded.value = opening ? id : "";
}

// A goal added and left without a title disappears when you move on, since it was never saved.
function dropUntitled() {
  const goal = plan.goals.value.find(item => item.id === expanded.value);
  if (goal && !goal.title.trim()) plan.goals.value = plan.goals.value.filter(item => item.id !== goal.id);
  expanded.value = "";
}

function addGoal() {
  if (plan.goals.value.length >= 20 || !plan.goalsLoaded.value) return;
  dropUntitled();
  const goal: HomeGoal = { id: `goal-${crypto.randomUUID()}`, title: "", status: "active", areaId: null, progress: 0, projectIds: [] };
  plan.goals.value = [...plan.goals.value, goal];
  expanded.value = goal.id;
  void nextTick(() => document.querySelector<HTMLInputElement>(`[data-goal-title="${goal.id}"]`)?.focus());
}

function offerUndo(message: string, undo: { goal: HomeGoal; index: number }) {
  toast(message, { duration: 5000, action: { label: "Undo", onClick: () => { plan.restoreGoal(undo).catch(() => toastError("Couldn't undo. Try again.")); } } });
}

async function complete(goal: HomeGoal) {
  if (expanded.value === goal.id) expanded.value = "";
  try {
    const undo = await plan.changeGoal(goal.id, item => { item.status = "completed"; });
    if (undo) offerUndo("Goal completed", undo);
  } catch { toastError("Couldn't complete that goal. Try again."); }
}

function reopen(goal: HomeGoal) {
  goal.status = "active";
  save();
}

function remove(goal: HomeGoal) {
  const index = plan.goals.value.findIndex(item => item.id === goal.id);
  plan.goals.value = plan.goals.value.filter(item => item.id !== goal.id);
  expanded.value = "";
  if (!goal.title.trim()) return;
  save();
  offerUndo("Goal deleted", { goal, index });
}

function makeFocus(goal: HomeGoal) {
  plan.makeFocus(goal.id).catch(() => toastError("Couldn't change your focus. Try again."));
}

function toggleProject(goal: HomeGoal, id: string, on: boolean) {
  goal.projectIds = [...(goal.projectIds || []).filter(item => item !== id), ...(on ? [id] : [])];
  save();
}

function startCheckIn() {
  wheelDraft.value = (wheel.value.length ? wheel.value : areas).map(area => ({ ...area, value: area.value ?? 5 }));
  checkingIn.value = true;
}

async function saveCheckIn() {
  savingWheel.value = true;
  try {
    const response = await api.post<{ snapshot: { createdAt: string; segments: HomeWheelArea[] } }>("/journal/wheel/snapshots", { segments: wheelDraft.value });
    wheel.value = response.snapshot.segments;
    wheelDate.value = response.snapshot.createdAt;
    checkingIn.value = false;
  } catch (error) {
    toastError(`Couldn't save your check-in. ${error instanceof Error ? error.message : ""}`.trim());
  } finally { savingWheel.value = false; }
}

function startEditingMission() {
  missionDraft.value = mission.value;
  editingMission.value = true;
  void nextTick(() => missionField.value?.focus());
}

async function saveMission() {
  const text = missionDraft.value.trim();
  if (!text) return;
  savingMission.value = true;
  try {
    await saveMissionStatement(text);
    mission.value = text;
    editingMission.value = false;
  } catch (error) {
    toastError(`Couldn't save your mission. ${error instanceof Error ? error.message : ""}`.trim());
  } finally { savingMission.value = false; }
}

const askPrompt = computed(() => missionDraft.value.trim()
  ? `Help me rewrite my mission statement. It's currently: "${missionDraft.value.trim()}"`
  : "Help me write my mission statement.");

async function applyFocus() {
  const goal = typeof route.query.goal === "string" ? route.query.goal : "";
  const focus = route.query.focus;
  if (goal && activeGoals.value.some(item => item.id === goal)) expanded.value = goal;
  if (focus === "check-in") startCheckIn();
  if (focus === "statement" && !mission.value) startEditingMission();
  const section = goal || focus === "goals" ? "goals-title" : focus === "check-in" ? "wheel-title" : focus === "statement" ? "mission-title" : "";
  await nextTick();
  if (section) document.getElementById(section)?.scrollIntoView({ block: "start" });
  if (focus === "statement" && !mission.value) missionField.value?.focus();
}

onMounted(async () => { await load(); await applyFocus(); });
</script>

<template>
  <main class="mission-page">
    <AppPageBar title="Mission" />
    <div class="mission-col" :aria-busy="loading">
      <p v-if="loadError" class="mission-error" role="alert">{{ loadError }} <button type="button" @click="load">Try again</button></p>

      <section class="mission-card" aria-labelledby="goals-title">
        <h2 id="goals-title">
          <span aria-hidden="true">🎯</span>Goals<span class="mission-detail">Your focus shows on Today</span>
          <Button v-if="plan.goalsLoaded.value && plan.goals.value.length < 20" class="mission-head-action" color="ghost" size="compact" shape="soft" icon-only aria-label="Add a goal" title="Add a goal" @click="addGoal"><UiIcon name="Plus" :size="18" /></Button>
        </h2>
        <div v-for="(goal, index) in activeGoals" :key="goal.id" class="mission-goal" :class="{ 'is-open': expanded === goal.id }">
          <div class="mission-goal__head">
            <button type="button" class="mission-tick" :disabled="!goal.title.trim()" :aria-label="`Complete ${goal.title || 'new goal'}`" @click="complete(goal)" />
            <template v-if="expanded === goal.id">
              <input v-model="goal.title" class="mission-goal__title" :data-goal-title="goal.id" maxlength="600" placeholder="What do you want to achieve?" aria-label="Goal title" @input="save" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
              <Button color="ghost" size="compact" shape="soft" icon-only :aria-label="`Close ${goal.title || 'new goal'}`" @click="toggle(goal.id)"><UiIcon name="ChevronUp" :size="18" /></Button>
            </template>
            <button v-else type="button" class="mission-goal__summary" :aria-expanded="false" :aria-label="`${goal.title}, ${goal.progress || 0} percent${index === 0 ? ', focus goal' : ''}. Update progress or edit`" @click="toggle(goal.id)">
              <span class="mission-goal__text">
                <strong>{{ goal.title }}</strong>
                <span class="mission-goal__meta"><span v-if="areaFor(goal.areaId)" aria-hidden="true">{{ areaFor(goal.areaId)!.emoji }}</span><span class="mission-progress" aria-hidden="true"><i :style="{ width: `${goal.progress || 0}%` }" /></span><span class="mission-muted">{{ goal.progress || 0 }}%</span></span>
                <span v-if="taskLine(goal)" class="mission-muted">{{ taskLine(goal) }}</span>
              </span>
              <span v-if="index === 0" class="mission-focus is-on">Focus</span>
            </button>
          </div>
          <div v-if="expanded === goal.id" class="mission-goal__details">
            <label class="mission-range"><span>Progress</span><output>{{ goal.progress || 0 }}%</output>
              <input v-model.number="goal.progress" type="range" min="0" max="100" step="5" :aria-label="`Progress for ${goal.title || 'new goal'}`" @input="save" />
            </label>
            <p v-if="taskLine(goal)" class="mission-muted">{{ taskLine(goal) }}</p>
            <div class="mission-chips">
              <label class="mission-chip"><span class="sr-only">Wheel of Life area</span>
                <select v-model="goal.areaId" @change="save"><option :value="null">No area</option><option v-for="area in areas" :key="area.id" :value="area.id">{{ area.emoji }} {{ area.label }}</option></select>
              </label>
              <details class="mission-chip mission-projects">
                <summary><UiIcon name="Folder" :size="15" />{{ projects.filter(p => goal.projectIds?.includes(p.id)).map(p => p.name).join(', ') || 'Project' }}</summary>
                <div class="mission-projects__list">
                  <p v-if="!projects.length" class="mission-muted">No projects yet</p>
                  <label v-for="project in projects" :key="project.id"><input type="checkbox" :checked="goal.projectIds?.includes(project.id)" @change="toggleProject(goal, project.id, ($event.target as HTMLInputElement).checked)" />{{ project.name }}</label>
                </div>
              </details>
            </div>
            <div class="mission-goal__actions">
              <button v-if="index > 0 && goal.title.trim()" type="button" class="mission-focus" @click="makeFocus(goal)">Make focus</button>
              <button type="button" class="mission-delete" :aria-label="goal.title.trim() ? `Delete ${goal.title}` : 'Discard new goal'" @click="remove(goal)">Delete</button>
            </div>
          </div>
        </div>
        <button v-if="plan.goalsLoaded.value && !activeGoals.length" type="button" class="mission-quiet" @click="addGoal"><UiIcon name="Plus" :size="16" />{{ doneGoals.length ? 'Add a goal' : 'Add your first goal' }}</button>
        <template v-if="doneGoals.length">
          <button type="button" class="mission-completed" :aria-expanded="completedOpen" @click="completedOpen = !completedOpen">Completed ({{ doneGoals.length }})<UiIcon :name="completedOpen ? 'ChevronUp' : 'ChevronDown'" :size="16" /></button>
          <div v-for="goal in completedOpen ? doneGoals : []" :key="goal.id" class="mission-done">
            <button type="button" class="mission-tick is-on" :aria-label="`Reopen ${goal.title}`" @click="reopen(goal)"><UiIcon name="Check" :size="15" /></button>
            <span>{{ goal.title }}</span>
          </div>
        </template>
      </section>

      <section class="mission-card" aria-labelledby="wheel-title">
        <h2 id="wheel-title"><span aria-hidden="true">🛞</span>{{ checkingIn ? 'Check in' : 'Wheel of Life' }}<span v-if="wheelDate && !checkingIn" class="mission-detail">Checked in {{ new Date(wheelDate).toLocaleDateString([], { day: 'numeric', month: 'short' }) }}</span></h2>
        <form v-if="checkingIn" class="mission-checkin" @submit.prevent="saveCheckIn">
          <div class="mission-checkin__chart"><HomeWheelChart :areas="wheelDraft" /></div>
          <label v-for="area in wheelDraft" :key="area.id" class="mission-range"><span><span aria-hidden="true">{{ area.emoji }}</span> {{ area.label }}</span><output>{{ area.value }}/10</output>
            <input v-model.number="area.value" type="range" min="1" max="10" step="1" :aria-label="area.label" />
          </label>
          <div class="mission-actions">
            <Button color="outline" shape="soft" :disabled="savingWheel" @click="checkingIn = false">Cancel</Button>
            <Button type="submit" color="primary" shape="soft" :disabled="savingWheel">{{ savingWheel ? 'Saving…' : 'Save check-in' }}</Button>
          </div>
        </form>
        <template v-else>
          <div v-if="scored" class="mission-wheel">
            <div class="mission-wheel__chart"><HomeWheelChart :areas="wheel" :selected="lowest?.id" /></div>
            <div class="mission-wheel__rows">
              <div v-for="area in wheel" :key="area.id" class="mission-area" :class="{ 'is-lowest': area.id === lowest?.id }" :aria-label="`${area.label}, ${area.value ?? 'not scored'} out of 10`">
                <span class="mission-area__label"><span aria-hidden="true">{{ area.emoji }}</span>{{ area.label }}</span>
                <span class="mission-area__score">{{ area.value ?? '—' }} / 10</span>
                <span v-for="goal in activeGoals.filter(item => item.areaId === area.id)" :key="goal.id" class="mission-area__goal">{{ goal.title }}</span>
              </div>
            </div>
          </div>
          <p v-else-if="!loading" class="mission-muted">How are you doing across the areas of your life?</p>
          <button type="button" class="mission-check-in" @click="startCheckIn">{{ scored ? 'Check in' : 'Start a check-in' }}</button>
        </template>
      </section>

      <section class="mission-card" aria-labelledby="mission-title">
        <h2 id="mission-title">
          <span aria-hidden="true">🚀</span>Mission
          <Button v-if="!editingMission && !loading" class="mission-head-action" color="ghost" size="compact" shape="soft" icon-only :aria-label="mission ? 'Edit your mission' : 'Write your mission'" @click="startEditingMission"><UiIcon :name="mission ? 'Pencil' : 'Plus'" :size="17" /></Button>
        </h2>
        <form v-if="editingMission" class="mission-editor" @submit.prevent="saveMission">
          <textarea ref="missionField" v-model="missionDraft" rows="3" aria-label="Your mission" placeholder="What do you want your life built around?" />
          <RouterLink :to="{ path: '/assistant', query: { prompt: askPrompt } }" class="mission-quiet"><UiIcon name="Sparkles" :size="16" />Ask ME3 to help rewrite it</RouterLink>
          <div class="mission-actions">
            <Button color="outline" shape="soft" :disabled="savingMission" @click="editingMission = false">Cancel</Button>
            <Button type="submit" color="primary" shape="soft" :disabled="savingMission || !missionDraft.trim()">{{ savingMission ? 'Saving…' : 'Save mission' }}</Button>
          </div>
        </form>
        <button v-else-if="mission" type="button" class="mission-statement" @click="startEditingMission">{{ mission }}</button>
        <button v-else-if="!loading" type="button" class="mission-statement is-empty" @click="startEditingMission">What do you want your life built around?</button>
      </section>
    </div>
  </main>
</template>

<style scoped>
.mission-page { padding: 8px 16px 96px; }
.mission-col { display: flex; flex-direction: column; gap: 16px; width: min(620px, 100%); margin: 0 auto; }
.mission-card { padding: 14px 18px 12px; border-radius: 24px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.mission-card h2 { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: 0; font-size: 15px; font-weight: 600; scroll-margin-top: 72px; }
.mission-card h2 > span[aria-hidden] { font-size: 20px; line-height: 1; }
.mission-head-action { margin-left: auto; }
.mission-detail { margin-left: 4px; color: var(--ui-text-muted); font-size: 12px; font-weight: 400; }
.mission-muted { margin: 4px 0; color: var(--ui-text-muted); font-size: 13px; }
.mission-quiet { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 14px; font-weight: 500; text-decoration: none; cursor: pointer; }
.mission-quiet:hover { color: var(--ui-text); }
.mission-goal { box-shadow: inset 0 -1px 0 var(--ui-border); }
.mission-goal:last-of-type { box-shadow: none; }
.mission-goal__head { display: flex; align-items: center; gap: 10px; min-height: 58px; }
.mission-tick { display: grid; flex: 0 0 auto; place-items: center; width: 26px; height: 26px; margin: 9px; padding: 0; border: 2px solid var(--ui-border-strong); border-radius: 50%; background: transparent; color: var(--ui-primary-contrast); cursor: pointer; }
.mission-tick:hover:not(:disabled) { border-color: var(--ui-accent); }
.mission-tick:disabled { opacity: .4; cursor: default; }
.mission-tick.is-on { border-color: var(--ui-accent); background: var(--ui-accent); }
.mission-goal__summary { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; padding: 10px 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.mission-goal__text { display: grid; flex: 1; gap: 6px; min-width: 0; }
.mission-goal__text strong { overflow: hidden; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.mission-goal__meta { display: flex; align-items: center; gap: 8px; }
.mission-goal__meta .mission-muted { margin: 0; }
.mission-goal__title { flex: 1; min-width: 0; padding: 10px 4px; border: 0; border-radius: var(--ui-radius-sm); background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; font-weight: 600; }
.mission-goal__title:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.mission-goal__details { display: grid; gap: 12px; padding: 0 0 14px 46px; }
.mission-progress { display: block; width: min(160px, 100%); height: 4px; border-radius: 4px; background: var(--ui-surface-muted); }
.mission-progress i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); }
.mission-range { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 8px; font-size: 13px; color: var(--ui-text-muted); }
.mission-range output { color: var(--ui-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.mission-range input { grid-column: 1 / -1; width: 100%; min-height: 28px; accent-color: var(--ui-accent); }
.mission-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.mission-chip select, .mission-chip summary { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.mission-projects { position: relative; }
.mission-projects summary { list-style: none; }
.mission-projects summary::-webkit-details-marker { display: none; }
.mission-projects__list { position: absolute; z-index: 5; top: calc(100% + 6px); left: 0; display: grid; gap: 4px; min-width: 200px; padding: 8px 12px; border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.mission-projects__list label { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 14px; }
.mission-goal__actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mission-focus { flex-shrink: 0; min-height: 34px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 13px; font-weight: 600; line-height: 34px; cursor: pointer; }
.mission-focus.is-on { background: var(--ui-primary); color: var(--ui-primary-contrast); cursor: default; }
.mission-delete { min-height: 44px; margin-left: auto; padding: 0 4px; border: 0; background: transparent; color: var(--ui-danger); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.mission-completed { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.mission-done { display: flex; align-items: center; gap: 10px; color: var(--ui-text-muted); text-decoration: line-through; font-size: 14px; }
.mission-wheel { display: flex; align-items: center; gap: 24px; padding: 8px 0 4px; }
.mission-wheel__chart :deep(svg), .mission-checkin__chart :deep(svg) { width: 170px; height: 170px; }
.mission-checkin__chart { display: flex; justify-content: center; }
.mission-wheel__rows { display: grid; flex: 1; gap: 10px; min-width: 0; }
.mission-area { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 8px; color: var(--ui-text-muted); }
.mission-area.is-lowest { color: var(--ui-text); }
.mission-area.is-lowest .mission-area__label { font-weight: 700; }
.mission-area__label { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 15px; font-weight: 500; }
.mission-area__label > span { font-size: 18px; line-height: 1; }
.mission-area__score { font-size: 14px; font-variant-numeric: tabular-nums; }
.mission-area__goal { grid-column: 1 / -1; padding-left: 26px; font-size: 12px; }
.mission-checkin { display: grid; gap: 10px; padding-top: 6px; }
.mission-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
.mission-check-in { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; margin: 14px 0 6px; border: 0; border-radius: 999px; background: var(--ui-primary); color: var(--ui-primary-contrast); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
.mission-check-in:hover { opacity: .9; }
.mission-check-in:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.mission-statement { display: block; width: 100%; margin: 6px 0 10px; padding: 0; border: 0; background: transparent; color: var(--ui-text); font-family: var(--font-serif, Georgia, serif); font-size: 21px; line-height: 1.45; text-align: left; cursor: text; }
.mission-statement.is-empty { color: var(--ui-text-muted); font-size: 17px; }
.mission-editor { display: grid; gap: 4px; padding-top: 4px; }
.mission-editor textarea { box-sizing: border-box; width: 100%; padding: 12px; border: 0; border-radius: var(--ui-radius-md); background: var(--ui-surface-muted); color: var(--ui-text); font-family: var(--font-serif, Georgia, serif); font-size: 19px; line-height: 1.45; resize: vertical; }
.mission-editor textarea:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.mission-error { color: var(--ui-danger, #dc2626); font-size: 14px; }
.mission-error button { border: 0; background: transparent; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 640px) {
  .mission-page { padding-inline: 10px; }
  .mission-wheel { flex-direction: column; align-items: stretch; }
  .mission-wheel__chart { align-self: center; }
  .mission-goal__details { padding-left: 0; }
}
</style>
