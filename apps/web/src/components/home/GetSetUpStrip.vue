<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../../api";
import UiIcon from "../UiIcon.vue";
import { loadProfileSite } from "../../utils/firstSite";
import { setupSteps, type SetupStepId } from "../../utils/setupSteps";

/**
 * Home's Get set up strip for a new owner (iOS MobileFirstRunFlow, me3-56rr.10): compact chips that
 * open each step and tick only from real actions. First landing turns it on; × turns it off.
 */
const props = defineProps<{ inboxCount: number; agentAddress?: string }>();
const emit = defineEmits<{ buildSite: [] }>();
const router = useRouter();
const visible = ref(false);
const siteDone = ref(false);
const soulinkDone = ref(false);
const missionOpened = ref(false);
const MISSION_OPENED_KEY = "me3.home.missionOpened";

const steps = computed(() => setupSteps({ site: siteDone.value, email: props.inboxCount > 0, mission: missionOpened.value, soulink: soulinkDone.value }));
const allDone = computed(() => steps.value.every(step => step.done));

async function load() {
  try {
    const dashboard = await api.get<{ settings?: { setupChecklistDismissed?: boolean } }>("/mission-control/dashboard");
    visible.value = dashboard.settings?.setupChecklistDismissed === false;
  } catch { visible.value = false; }
  if (!visible.value) return;
  try { missionOpened.value = window.localStorage.getItem(MISSION_OPENED_KEY) === "1"; } catch { missionOpened.value = false; }
  const [site, soulink] = await Promise.allSettled([
    loadProfileSite(api.get),
    api.get<{ connection?: { status?: string } | null }>("/soulink/status"),
  ]);
  siteDone.value = site.status === "fulfilled" && Boolean(site.value?.bio);
  soulinkDone.value = soulink.status === "fulfilled" && soulink.value.connection?.status === "active";
}

async function dismiss() {
  visible.value = false;
  await api.patch("/mission-control/dashboard", { settings: { setupChecklistDismissed: true } }).catch(() => undefined);
}

function open(id: SetupStepId) {
  if (id === "site") { emit("buildSite"); return; }
  if (id === "email") { void router.push("/email"); return; }
  if (id === "mission") {
    try { window.localStorage.setItem(MISSION_OPENED_KEY, "1"); } catch { /* ticks again next visit */ }
    void router.push("/mission");
    return;
  }
  void router.push({ path: "/account", query: { section: "soulink" } });
}

onMounted(load);
defineExpose({ load });
</script>

<template>
  <section v-if="visible" class="setup-strip" aria-label="Get set up" data-testid="get-set-up">
    <div class="setup-strip__head">
      <strong>{{ allDone ? "You're all set." : "Get set up" }}</strong>
      <button type="button" class="setup-strip__x" aria-label="Hide Get set up" @click="dismiss"><UiIcon name="X" :size="16" /></button>
    </div>
    <p v-if="!steps[1].done && agentAddress" class="setup-strip__hint">Email ME3 at <strong>{{ agentAddress }}</strong> and it acts on it.</p>
    <div class="setup-strip__chips">
      <button v-for="step in steps" :key="step.id" type="button" class="setup-strip__chip" :class="{ 'is-done': step.done }" @click="open(step.id)">
        <UiIcon :name="step.done ? 'Check' : step.icon" :size="16" />
        <span>{{ step.label }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.setup-strip { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: min(620px, 100%); margin: 0 auto 16px; padding: 12px 14px; border-radius: 20px; background: var(--ui-accent-soft); color: var(--ui-text); }
.setup-strip__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 15px; }
.setup-strip__x { display: grid; place-items: center; min-width: 36px; min-height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.setup-strip__hint { margin: 0; color: var(--ui-text-muted); font-size: 13px; overflow-wrap: anywhere; }
.setup-strip__hint strong { color: var(--ui-text); font-weight: 600; }
.setup-strip__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.setup-strip__chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 14px 0 10px; border: 0; border-radius: 999px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.setup-strip__chip :deep(svg) { color: var(--ui-accent); }
.setup-strip__chip.is-done { background: transparent; box-shadow: none; color: var(--ui-text-muted); font-weight: 500; }
</style>
