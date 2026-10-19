<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { api, ApiError } from "../api";
import AppPageBar from "../components/AppPageBar.vue";
import AgentDog from "../components/AgentDog.vue";
import AssistantApprovalDialog from "../components/AssistantApprovalDialog.vue";
import UiIcon from "../components/UiIcon.vue";
import { useAgentChat } from "../composables/useAgentChat";
import { useAppToast } from "../composables/useAppToast";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    title: "Your agent | ME3",
    description: "Your agent's name, its email, what it remembers about how you like to work, and its recent work.",
    robots: "noindex,follow",
  },
});

type Memory = { id: string; body: string; reviewStatus: "active" | "needs_review" | "archived"; updatedAt: string };
type Approval = { id: string; pluginId: string; actionId: string; title: string; summary: string | null; requestedAt: string; payload?: Record<string, unknown> };
type Run = { id: string; title: string; promptSummary: string | null; status: string; startedAt: string | null; finishedAt: string | null; createdAt: string };
type Activity = { id: string; title: string; summary: string | null; status: string | null; relatedId: string | null; createdAt: string };
type WorkItem = { id: string; title: string; at: string; waiting: boolean; approval?: Approval };

// Memory is behavioural: how ME3 should work with the owner. Facts already live in ME3 data, which the
// agent reads fresh each turn (see "Where it learns from"). Only active memories reach the agent.
const NAME_MAX = 48;
const RECENT_COUNT = 3;
const LEARNS_FROM = [
  { icon: "Target", label: "Mission, goals and Wheel of Life", when: "Every message" },
  { icon: "Globe", label: "Your site profile", when: "Every message" },
  { icon: "ListTodo", label: "Projects and tasks", when: "Every message, details when needed" },
  { icon: "BookOpen", label: "Journal and writing", when: "When a question needs them" },
  { icon: "Calendar", label: "Calendar and bookings", when: "When a question needs them" },
  { icon: "UsersRound", label: "People", when: "When a question needs them" },
  { icon: "Mail", label: "Its own email", when: "When a question needs them" },
] as const;

const agentChat = useAgentChat();
const { toastSuccess, toastFromUnknown } = useAppToast();
const loading = ref(true);
const error = ref("");
const assistantName = ref<string | null>(null);
const displayName = ref("ME3");
const nameDraft = ref("");
const renaming = ref(false);
const savingName = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);
const agentAddress = ref("");
const memories = ref<Memory[]>([]);
const memoryDraft = ref("");
const memoryBusy = ref("");
const approvals = ref<Approval[]>([]);
const runs = ref<Run[]>([]);
const activity = ref<Activity[]>([]);
const showAllWork = ref(false);
const showSources = ref(false);
const clearing = ref(false);
const reviewing = ref<Approval | null>(null);
const approvalBusy = ref(false);
const approvalError = ref("");

const activeMemories = computed(() => memories.value.filter(item => item.reviewStatus === "active"));
const work = computed<WorkItem[]>(() => {
  const runIds = new Set(runs.value.map(run => run.id));
  const done = [
    ...runs.value.map(run => ({ id: `run:${run.id}`, title: run.title || run.promptSummary || "Agent run", at: run.finishedAt || run.startedAt || run.createdAt, waiting: false })),
    ...activity.value.filter(item => !item.relatedId || !runIds.has(item.relatedId)).map(item => ({ id: `activity:${item.id}`, title: item.title, at: item.createdAt, waiting: false })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const waiting = approvals.value.map(approval => ({ id: `approval:${approval.id}`, title: approval.title, at: approval.requestedAt, waiting: true, approval }));
  return [...waiting, ...done];
});
const visibleWork = computed(() => showAllWork.value ? work.value : work.value.slice(0, RECENT_COUNT));
const nameInvalid = computed(() => nameDraft.value.trim().length > NAME_MAX);

async function load() {
  loading.value = true; error.value = "";
  const [settings, memory, mailbox, pending, runList, activityList] = await Promise.allSettled([
    api.get<{ assistantName: string | null; displayName: string }>("/assistant/settings"),
    api.get<{ memory: Memory[] }>("/mission-control/memory"),
    api.get<{ mailbox?: { aliasAddress?: string }; sources?: { address: string; inboundEnabled?: boolean }[] }>("/mailbox"),
    api.get<{ approvals: Approval[] }>("/mission-control/approvals?status=pending"),
    api.get<{ runs: Run[] }>("/mission-control/agent-runs?limit=50"),
    api.get<{ activity: Activity[] }>("/mission-control/plugin-activity?limit=50"),
  ]);
  if (settings.status === "fulfilled") applySettings(settings.value);
  if (memory.status === "fulfilled") memories.value = memory.value.memory || [];
  if (mailbox.status === "fulfilled") agentAddress.value = mailbox.value.mailbox?.aliasAddress || mailbox.value.sources?.find(source => source.inboundEnabled)?.address || "";
  approvals.value = pending.status === "fulfilled" ? pending.value.approvals || [] : [];
  runs.value = runList.status === "fulfilled" ? runList.value.runs || [] : [];
  activity.value = activityList.status === "fulfilled" ? activityList.value.activity || [] : [];
  if (settings.status === "rejected" || memory.status === "rejected") error.value = "Couldn't load your agent. Try again.";
  const failed = [pending, runList, activityList].find(result => result.status === "rejected" && !(result.reason instanceof ApiError && [403, 404].includes(result.reason.status)));
  if (failed?.status === "rejected") toastFromUnknown(failed.reason, "Some recent work couldn't load.");
  loading.value = false;
}

function applySettings(settings: { assistantName: string | null; displayName: string }) {
  assistantName.value = settings.assistantName;
  displayName.value = settings.displayName || "ME3";
  agentChat.setAssistantDisplayName(settings.displayName);
}

async function startRename() {
  nameDraft.value = assistantName.value || "";
  renaming.value = true;
  await nextTick();
  nameInput.value?.select();
}

async function saveName() {
  if (!renaming.value || savingName.value) return;
  const next = nameDraft.value.replace(/\s+/g, " ").trim();
  if (nameInvalid.value) return;
  if (next === (assistantName.value || "")) { renaming.value = false; return; }
  savingName.value = true;
  try {
    applySettings(await api.put<{ assistantName: string | null; displayName: string }>("/assistant/settings", { assistantName: next || null }));
    renaming.value = false;
    toastSuccess("Name saved");
  } catch (err) { toastFromUnknown(err, "Couldn't save the name"); }
  finally { savingName.value = false; }
}

async function copyAddress() {
  try { await navigator.clipboard.writeText(agentAddress.value); toastSuccess("Email copied"); }
  catch (err) { toastFromUnknown(err, "Couldn't copy the email"); }
}

async function addMemory() {
  const body = memoryDraft.value.trim();
  if (!body || memoryBusy.value) return;
  memoryBusy.value = "new";
  try {
    const { memory } = await api.post<{ memory: Memory }>("/mission-control/memory", { body, memoryKind: "owner_note" });
    memories.value = [memory, ...memories.value];
    memoryDraft.value = "";
    toastSuccess("Remembered");
  } catch (err) { toastFromUnknown(err, "Couldn't save that"); }
  finally { memoryBusy.value = ""; }
}

async function forgetMemory(item: Memory) {
  if (memoryBusy.value) return;
  memoryBusy.value = item.id;
  try {
    await api.delete(`/mission-control/memory/${encodeURIComponent(item.id)}`);
    memories.value = memories.value.filter(memory => memory.id !== item.id);
    toastSuccess("Forgotten");
  } catch (err) { toastFromUnknown(err, "Couldn't forget that"); }
  finally { memoryBusy.value = ""; }
}

async function decide(decision: "approved" | "declined") {
  const approval = reviewing.value;
  if (!approval || approvalBusy.value) return;
  approvalBusy.value = true; approvalError.value = "";
  try {
    await api.post(`/assistant/approvals/${encodeURIComponent(approval.id)}`, { decision });
    reviewing.value = null;
    toastSuccess(decision === "approved" ? "Approved" : "Declined");
    await load();
  } catch (err) {
    approvalError.value = err instanceof Error ? err.message : "Couldn't save this decision. Try again.";
  } finally { approvalBusy.value = false; }
}

async function clearActivity() {
  if (clearing.value || !window.confirm("Clear your agent's activity history? Approvals waiting for you are kept.")) return;
  clearing.value = true;
  try {
    await api.delete("/mission-control/activity");
    runs.value = []; activity.value = [];
    toastSuccess("Activity cleared");
  } catch (err) { toastFromUnknown(err, "Couldn't clear activity"); }
  finally { clearing.value = false; }
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) {
    const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000);
    return hours < 1 ? "Just now" : `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

onMounted(load);
</script>

<template>
  <main class="agent-page">
    <AppPageBar title="Your agent" />
    <div class="agent-col" :aria-busy="loading">
      <p v-if="error" class="agent-error" role="alert">{{ error }} <button type="button" @click="load">Try again</button></p>

      <header class="agent-hero">
        <AgentDog :size="92" />
        <form v-if="renaming" class="agent-hero__name" @submit.prevent="saveName">
          <input ref="nameInput" v-model="nameDraft" :maxlength="NAME_MAX" placeholder="ME3" aria-label="Agent name" autocomplete="off" :disabled="savingName" @blur="saveName" @keydown.esc="renaming = false">
        </form>
        <button v-else type="button" class="agent-hero__name" :aria-label="`Rename ${displayName}`" @click="startRename">
          {{ displayName }}<UiIcon name="Pencil" :size="16" class="agent-hero__pen" />
        </button>
        <p>Your own AI agent. It runs on your ME3, and everything it knows is yours.</p>
      </header>

      <section class="agent-card" aria-label="Its email">
        <div v-if="agentAddress" class="agent-row">
          <UiIcon name="Mail" :size="20" class="agent-row__icon" />
          <span class="agent-row__text"><small>Its email</small>{{ agentAddress }}</span>
          <button type="button" class="agent-icon-button" aria-label="Copy email" @click="copyAddress"><UiIcon name="Copy" :size="18" /></button>
        </div>
        <RouterLink v-else-if="!loading" to="/settings?section=mailbox" class="agent-row">
          <UiIcon name="Mail" :size="20" class="agent-row__icon" />
          <span class="agent-row__text"><small>Its email</small>Give {{ displayName }} its own email</span>
          <UiIcon name="ChevronRight" :size="18" class="agent-row__chev" />
        </RouterLink>
      </section>

      <section class="agent-card" aria-label="Payments">
        <RouterLink to="/settings/payments" class="agent-row">
          <UiIcon name="CreditCard" :size="20" class="agent-row__icon" />
          <span class="agent-row__text"><small>Payments</small>Spend limits and receipts</span>
          <UiIcon name="ChevronRight" :size="18" class="agent-row__chev" />
        </RouterLink>
      </section>

      <section class="agent-section" aria-labelledby="agent-memory-title">
        <h2 id="agent-memory-title">How {{ displayName }} works with you</h2>
        <div class="agent-card">
          <div v-for="item in activeMemories" :key="item.id" class="agent-memory">
            <span>{{ item.body }}</span>
            <button type="button" class="agent-icon-button" :aria-label="`Forget: ${item.body}`" :disabled="Boolean(memoryBusy)" @click="forgetMemory(item)"><UiIcon name="X" :size="16" /></button>
          </div>
          <form class="agent-add" @submit.prevent="addMemory">
            <UiIcon name="Plus" :size="18" class="agent-row__icon" />
            <input v-model="memoryDraft" type="text" maxlength="500" :placeholder="`Something ${displayName} should always do`" aria-label="Add something to remember">
            <button v-if="memoryDraft.trim()" type="submit" class="agent-go" aria-label="Remember this" :disabled="Boolean(memoryBusy)"><UiIcon name="ArrowUp" :size="16" /></button>
          </form>
        </div>
        <p class="agent-note">Preferences and instructions {{ displayName }} follows in every chat. It may suggest one in Chat; nothing is saved until you say yes.</p>
      </section>

      <section class="agent-card">
        <button type="button" class="agent-row" :aria-expanded="showSources" @click="showSources = !showSources">
          <UiIcon name="BookOpen" :size="20" class="agent-row__icon" />
          <span class="agent-row__text">Where it learns from</span>
          <span class="agent-row__value">{{ LEARNS_FROM.length }} sources</span>
          <UiIcon :name="showSources ? 'ChevronUp' : 'ChevronDown'" :size="18" class="agent-row__chev" />
        </button>
        <div v-if="showSources" class="agent-sources">
          <div v-for="source in LEARNS_FROM" :key="source.label" class="agent-source">
            <UiIcon :name="source.icon" :size="18" class="agent-row__icon" />
            <span class="agent-row__text">{{ source.label }}<small>{{ source.when }}</small></span>
          </div>
          <p class="agent-note">It reads these fresh from your ME3, so there's nothing to keep in sync.</p>
        </div>
      </section>

      <section class="agent-section" aria-labelledby="agent-work-title">
        <h2 id="agent-work-title">Recent work</h2>
        <div class="agent-card">
          <template v-for="item in visibleWork" :key="item.id">
            <button v-if="item.approval?.pluginId === 'me3.core'" type="button" class="agent-work" @click="reviewing = item.approval; approvalError = ''">
              <span class="agent-work__mark is-waiting"><UiIcon name="Clock" :size="15" /></span>
              <span class="agent-row__text">{{ item.title }}<small>Waiting for your OK · {{ when(item.at) }}</small></span>
              <UiIcon name="ChevronRight" :size="18" class="agent-row__chev" />
            </button>
            <div v-else class="agent-work">
              <span class="agent-work__mark" :class="{ 'is-waiting': item.waiting }"><UiIcon :name="item.waiting ? 'Clock' : 'Check'" :size="15" /></span>
              <span class="agent-row__text">{{ item.title }}<small>{{ item.waiting ? 'Waiting for your OK · ' : '' }}{{ when(item.at) }}</small></span>
            </div>
          </template>
          <p v-if="!loading && !work.length" class="agent-empty">Nothing yet. Ask {{ displayName }} for something in Chat.</p>
          <button v-if="work.length > RECENT_COUNT" type="button" class="agent-row" @click="showAllWork = !showAllWork">
            <UiIcon name="History" :size="20" class="agent-row__icon" />
            <span class="agent-row__text">{{ showAllWork ? 'Show less' : 'All activity' }}</span>
            <UiIcon :name="showAllWork ? 'ChevronUp' : 'ChevronDown'" :size="18" class="agent-row__chev" />
          </button>
        </div>
        <button v-if="showAllWork && (runs.length || activity.length)" type="button" class="agent-quiet" :disabled="clearing" @click="clearActivity">{{ clearing ? 'Clearing…' : 'Clear activity' }}</button>
      </section>

      <p class="agent-footer">To change how {{ displayName }} works, ask it in <RouterLink :to="{ path: '/assistant', query: { view: 'chat' } }">Chat</RouterLink>.</p>
    </div>
    <AssistantApprovalDialog :approval="reviewing" :busy="approvalBusy" :error="approvalError" @close="reviewing = null" @decide="decide" @resolved="load" />
  </main>
</template>

<style scoped>
.agent-page { padding: 8px 16px 96px; }
.agent-col { display: flex; flex-direction: column; gap: 16px; width: min(620px, 100%); margin: 0 auto; }
.agent-hero { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0 4px; text-align: center; }
.agent-hero p { max-width: 300px; margin: 0; color: var(--ui-text-muted); font-size: 14px; line-height: 1.45; }
.agent-hero__name { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: 4px; padding: 0 4px; border: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 24px; font-weight: 700; cursor: pointer; }
.agent-hero__name input { width: 180px; padding: 6px 10px; border: 0; border-radius: 12px; outline: none; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 22px; font-weight: 700; text-align: center; }
.agent-hero__pen { color: var(--ui-text-muted); }
.agent-section { display: flex; flex-direction: column; gap: 8px; }
.agent-section h2 { margin: 0 4px; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.agent-card { overflow: hidden; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.agent-row, .agent-work, .agent-source { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 8px 14px 8px 16px; border: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; text-align: left; text-decoration: none; }
button.agent-row, a.agent-row, button.agent-work { cursor: pointer; }
.agent-card > * + * { box-shadow: inset 0 1px 0 var(--ui-border); }
.agent-row__icon { flex: 0 0 auto; color: var(--ui-text-muted); }
.agent-row__text { display: flex; flex: 1; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.agent-row__text small { color: var(--ui-text-muted); font-size: 13px; }
.agent-row__value { color: var(--ui-text-muted); font-size: 14px; }
.agent-row__chev { flex: 0 0 auto; color: var(--ui-text-muted); }
.agent-icon-button { display: grid; flex: 0 0 auto; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.agent-icon-button:hover { color: var(--ui-text); }
.agent-icon-button:disabled { opacity: .5; cursor: default; }
.agent-memory { display: flex; align-items: flex-start; gap: 10px; padding: 12px 8px 12px 16px; font-size: 15px; line-height: 1.4; }
.agent-memory span { flex: 1; padding-top: 6px; }
.agent-add { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 8px 6px 16px; }
.agent-add input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; }
.agent-add input::placeholder { color: var(--ui-text-muted); }
.agent-go { display: grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 50%; background: var(--ui-primary); color: var(--ui-primary-contrast); cursor: pointer; }
.agent-go:disabled { opacity: .5; }
.agent-note { margin: 0 4px; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.agent-sources { padding-bottom: 12px; box-shadow: inset 0 1px 0 var(--ui-border); }
.agent-source { min-height: 52px; }
.agent-sources .agent-note { margin: 4px 16px 0; }
.agent-work__mark { display: grid; flex: 0 0 auto; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--ui-accent-soft, var(--ui-surface-muted)); color: var(--ui-accent); }
.agent-work__mark.is-waiting { background: var(--ui-warning-soft, var(--ui-surface-muted)); color: var(--ui-warning, #b45309); }
.agent-empty { margin: 0; padding: 16px; color: var(--ui-text-muted); font-size: 14px; }
.agent-quiet { align-self: flex-start; min-height: 44px; padding: 0 4px; border: 0; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.agent-quiet:hover { color: var(--ui-text); }
.agent-footer { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 14px; text-align: center; }
.agent-footer a { color: var(--ui-accent); font-weight: 600; text-decoration: none; }
.agent-error { color: var(--ui-danger, #dc2626); font-size: 14px; }
.agent-error button { border: 0; background: transparent; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
@media (max-width: 640px) { .agent-page { padding-inline: 10px; } }
</style>
