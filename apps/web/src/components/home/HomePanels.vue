<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, ApiError, API_BASE } from "../../api";
import { useAuthStore } from "../../stores/auth";
import draggable from "vuedraggable";
import HomeWheelChart, { type HomeWheelArea } from "./HomeWheelChart.vue";
import GratitudeCard from "./GratitudeCard.vue";
import GoalsDialog from "../tasks/GoalsDialog.vue";
import AppDialog from "../AppDialog.vue";
import AssistantApprovalDialog from "../AssistantApprovalDialog.vue";
import { useAppToast } from "../../composables/useAppToast";
import UiIcon from "../UiIcon.vue";
import PersonAvatar from "../people/PersonAvatar.vue";
import PersonSheet from "../people/PersonSheet.vue";
import { useContactsStore } from "../../stores/contacts";
import { firstName, formatSinceShort, rankHomePeople } from "../../utils/people";
import { HOME_CARDS, HOME_INSIDE_TODAY, emptyHomeLayout, homeDateLabel, homeGoalTasks, homeOpenTasks, homeTodayTasks, journalPreview, localDateKey, visibleHomeCards, type HomeCard, type HomeLayout, type HomeTask, type HomeGoal } from "../../utils/homeSummary";
import { useTodayPlan } from "../../composables/useTodayPlan";
import TodayFocusLine from "../today/TodayFocusLine.vue";
import TodaySection from "../today/TodaySection.vue";
import TodayTasks from "../today/TodayTasks.vue";
const emit = defineEmits<{ suggest: [text: string]; approvalResolved: [] }>();
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const auth = useAuthStore();
const contactsStore = useContactsStore();
const storageKey = computed(() => `me3.home.${location.origin}.${API_BASE}.${auth.user?.id || "owner"}`);
const layout = ref<HomeLayout>(emptyHomeLayout());
// Today's tasks and goals come from the shared plan so the daily page and Mission stay in step.
const plan = useTodayPlan();
const { tasks, goals } = plan;
const journal = ref<{ id: string; date: string; title?: string | null; body?: string; preview?: string }[]>([]);
const articles = ref<{ id: string; title?: string | null; body: string }[]>([]);
const mail = ref<{ id: string; subject: string; fromName?: string; fromAddress?: string; preview?: string; agentSummary?: string }[]>([]);
const soulink = ref<{ id: string; textBody?: string; outcome?: string }[]>([]);
const approvals = ref<{ id: string; pluginId?: string; title: string; summary?: string | null; payload?: Record<string, unknown> }[]>([]);
const reviewApproval = ref<(typeof approvals.value)[number] | null>(null);
const approvalError = ref("");
const { toastFromUnknown, toastSuccess } = useAppToast();
const events = ref<{ id: string; title: string; start: string; allDay?: boolean }[]>([]);
const defaultAreas: HomeWheelArea[] = [
  { id: "health", label: "Health", color: "#ff3b30", emoji: "❤️", value: null },
  { id: "spirituality", label: "Spirituality", color: "#34c759", emoji: "🌿", value: null },
  { id: "work", label: "Work", color: "#ff9500", emoji: "💼", value: null },
  { id: "finances", label: "Finances", color: "#ffcc00", emoji: "💰", value: null },
  { id: "home", label: "Home", color: "#007aff", emoji: "🏡", value: null },
  { id: "joy", label: "Joy", color: "#af52de", emoji: "🤗", value: null },
];
const wheel = ref<HomeWheelArea[]>(defaultAreas.map(area => ({ ...area })));
const wheelDate = ref("");
const pickedGoal = ref("");
const pickedArea = ref("");
const checkingIn = ref(false);
const wheelSaving = ref(false);
const wheelDraft = ref<HomeWheelArea[]>([]);
const dialogAreas = computed(() => checkingIn.value ? wheelDraft.value : wheel.value);
const goalEditor = ref(false);
const goalArea = ref<string | null>(null);
const mission = ref("");
const agentAddress = ref("");
const calendarConnected = ref(false);
const accountsEnabled = ref(false);
const accountSummary = ref<{ income: string; expense: string } | null>(null);
// Resources load per card; tasks and wheel feed Today and Mission rather than cards of their own.
type HomeResource = HomeCard | "tasks" | "wheel";
const errors = ref<Partial<Record<HomeResource, string>>>({});
const loading = ref(true);
const busy = ref<string[]>([]);
const dialog = ref<"add" | "wheel" | null>(null);
const panels = ref<HTMLElement | null>(null);
const unavailable = ref<HomeResource[]>([]);
const offline = ref(!navigator.onLine);
const lastRefresh = ref("");
const orderAnnouncement = ref("");
const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const reducedMotion = ref(motionPreference?.matches ?? false);
function updateMotionPreference() { reducedMotion.value = motionPreference?.matches ?? false; }
defineExpose({ openAddDialog: () => { dialog.value = "add"; }, refreshToday: loadToday });
const menu = ref<HomeCard | null>(null);
const day = ref(localDateKey(new Date()));
const cards: Record<HomeCard, { title: string; href: string; emoji: string }> = {
  today: { title: "Today", href: "/journal", emoji: "🗓️" },
  people: { title: "People", href: "/people", emoji: "🫶" },
  gratitude: { title: "Gratitude", href: "/journal", emoji: "🌅" },
  inbox: { title: "Inbox", href: "/email", emoji: "📧" },
  mission: { title: "Mission", href: "/tasks?goals=1", emoji: "🚀" },
  journal: { title: "Writing", href: "/journal", emoji: "✍️" },
  accounts: { title: "Accounts", href: "/accounts", emoji: "💰" },
};
// People appears once someone is Close (People v1).
const peopleCard = computed(() => rankHomePeople(contactsStore.contacts, contact => contact.reminderAt));
const openPersonId = ref<string | null>(null);
const openPerson = computed(() => contactsStore.contacts.find(contact => contact.id === openPersonId.value) || null);
const available = computed(() => HOME_CARDS.filter(id => !unavailable.value.includes(id) && (id !== "accounts" || accountsEnabled.value) && (id !== "people" || peopleCard.value.state !== "hidden")));
const visible = computed(() => visibleHomeCards(layout.value).filter(id => available.value.includes(id)));
const addCards = computed(() => available.value.filter(id => !HOME_INSIDE_TODAY.includes(id)).sort((a, b) => Number(visible.value.includes(b)) - Number(visible.value.includes(a))));
const todayTasks = computed(() => homeTodayTasks(tasks.value));
const focus = computed(() => plan.focus.value);
// Server setting (gratitude_settings.in_today), so it follows the owner across web and the apps.
const gratitudeOn = ref(false);
const showGratitude = computed(() => gratitudeOn.value && !unavailable.value.includes("gratitude"));
const backlogCount = computed(() => homeOpenTasks(tasks.value).length - todayTasks.value.length);
// Upcoming events only; an event drops off an hour after it starts.
const upcomingEvents = computed(() => { const cutoff = Date.now() - 3_600_000; return events.value.filter(event => event.allDay || new Date(event.start).getTime() >= cutoff).slice(0, 3); });
const todayPage = computed(() => journal.value[0]?.date?.slice(0, 10) === day.value ? journal.value[0] : null);
const todayLabel = computed(() => new Date(`${day.value}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }));
async function toggleGratitude() {
  const next = !gratitudeOn.value;
  gratitudeOn.value = next;
  try { await api.patch("/gratitude/settings", { inToday: next }); }
  catch (error) { gratitudeOn.value = !next; toastFromUnknown(error, "Couldn't change Gratitude"); }
}
async function addTask(title: string, done: () => void) {
  try { await plan.addTask(title); delete errors.value.tasks; }
  catch (error) { toastFromUnknown(error, "Couldn't add task"); }
  finally { done(); }
}
const activeGoals = computed(() => goals.value.filter(goal => goal.status !== "completed"));
const selectedGoal = computed(() => activeGoals.value.find(goal => goal.id === pickedGoal.value) || activeGoals.value[0]);
const goalTasks = computed(() => selectedGoal.value ? homeGoalTasks(tasks.value, selectedGoal.value) : []);
const lowestArea = computed(() => [...wheel.value].filter(area => area.value !== null).sort((a, b) => a.value! - b.value!)[0]);
const selectedArea = computed(() => wheel.value.find(area => area.id === pickedArea.value) || lowestArea.value || wheel.value[0]);
const areaGoals = (id: string) => activeGoals.value.filter(goal => goal.areaId === id);
const areaFor = (id?: string | null) => wheel.value.find(area => area.id === id);
const cardElements = new Map<HomeCard, HTMLElement>();
function setCardElement(card: HomeCard, element: unknown) { if (element instanceof HTMLElement) cardElements.set(card, element); else cardElements.delete(card); }
let disposed = false;
let todayGeneration = 0;
let pressTimer: ReturnType<typeof setTimeout> | undefined;
let pressOrigin: { x: number; y: number } | null = null;
// The layout lives on the install so web and the mobile apps show the same cards.
// This browser keeps a copy only to paint Home before the install answers.
let layoutGeneration = 0;
function readLayout(value: unknown): HomeLayout {
  const next = emptyHomeLayout();
  const saved = value && typeof value === "object" ? value as Record<string, unknown> : {};
  for (const key of ["order", "hidden", "pinned", "earned"] as const) {
    // Keep ids this client doesn't know, so it never drops cards another app added.
    const list = saved[key];
    if (Array.isArray(list)) next[key] = list.filter((v): v is string => typeof v === "string");
  }
  return next;
}
function cache() { try { localStorage.setItem(storageKey.value, JSON.stringify(layout.value)); } catch { /* Layout remains usable when browser storage is unavailable. */ } }
function save() {
  layoutGeneration++; cache();
  api.put("/home/layout", layout.value).catch(error => toastFromUnknown(error, "Couldn't save your Home layout"));
}
async function loadLayout() {
  const generation = ++layoutGeneration;
  try {
    const result = await api.get<{ layout: HomeLayout | null }>("/home/layout");
    if (disposed || generation !== layoutGeneration) return;
    // First visit after the update: carry this browser's saved layout over once.
    if (!result.layout) { if (Object.values(layout.value).some(list => list.length)) save(); return; }
    layout.value = readLayout(result.layout); cache();
  } catch { /* Keep the cached layout; the next refresh tries again. */ }
}
watch(storageKey, () => {
  try { layout.value = readLayout(JSON.parse(localStorage.getItem(storageKey.value) || "null")); }
  catch { layout.value = emptyHomeLayout(); }
}, { immediate: true });
function earn(card: HomeCard, hasData: boolean) { if (hasData && !layout.value.earned.includes(card)) { layout.value.earned.push(card); save(); } }
function add(card: HomeCard) { layout.value.hidden = layout.value.hidden.filter(id => id !== card); if (!layout.value.pinned.includes(card)) layout.value.pinned.push(card); save(); toastSuccess(`${cards[card].title} added to Home`); }
function remove(card: HomeCard) { if (!layout.value.hidden.includes(card)) layout.value.hidden.push(card); layout.value.pinned = layout.value.pinned.filter(id => id !== card); save(); menu.value = null; }
function setOrder(order: HomeCard[]) {
  layout.value.order = [...order, ...layout.value.order.filter(id => !order.includes(id as HomeCard))];
  save();
  orderAnnouncement.value = `Home order: ${order.map(id => cards[id].title).join(", ")}`;
}
function move(card: HomeCard, offset: number) {
  const order = [...visible.value]; const i = order.indexOf(card); const target = i + offset;
  if (target < 0 || target >= order.length) return;
  [order[i], order[target]] = [order[target], order[i]]; setOrder(order); closeMenu(card);
}
function closeMenu(card = menu.value) {
  menu.value = null;
  void nextTick(() => cardElements.get(card!)?.querySelector<HTMLButtonElement>(".home-card__more")?.focus());
}
function openMenu(card: HomeCard) {
  menu.value = card;
  void nextTick(() => cardElements.get(card)?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus());
}
function menuKeys(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
function dismissMenu(event: PointerEvent) { if (!(event.target as HTMLElement).closest(".home-card__menu,.home-card__more")) menu.value = null; }
function startCheckIn() { wheelDraft.value = wheel.value.map(area => ({ ...area })); checkingIn.value = true; }
async function saveCheckIn() {
  if (wheelSaving.value || wheelDraft.value.some(area => area.value === null)) return;
  wheelSaving.value = true;
  try {
    const result = await api.post<{ snapshot: { createdAt: string; segments: HomeWheelArea[] } }>("/journal/wheel/snapshots", { segments: wheelDraft.value, notes: {} });
    wheel.value = result.snapshot.segments; wheelDate.value = result.snapshot.createdAt;
    checkingIn.value = false; dialog.value = null; toastSuccess("Check-in saved");
  } catch (error) { toastFromUnknown(error, "Couldn't save your check-in"); }
  finally { wheelSaving.value = false; }
}
function openWheel() { pickedArea.value = lowestArea.value?.id || wheel.value[0]?.id || ""; checkingIn.value = false; dialog.value = "wheel"; }
function addGoal(areaId: string | null = null) { dialog.value = null; goalArea.value = areaId; goalEditor.value = true; }
function reconnect() { offline.value = !navigator.onLine; if (!offline.value) void refresh(); }
function cancelPress() { clearTimeout(pressTimer); pressOrigin = null; }
function beginPress(event: PointerEvent, card: HomeCard) {
  if (event.pointerType === "mouse" || (event.target as HTMLElement).closest("a,button,input")) return;
  pressOrigin = { x: event.clientX, y: event.clientY };
  pressTimer = setTimeout(() => { openMenu(card); }, 600);
}
function trackPress(event: PointerEvent) { if (pressOrigin && Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > 10) cancelPress(); }
async function resource(card: HomeResource, load: () => Promise<void>) {
  try { await load(); if (!disposed) { delete errors.value[card]; unavailable.value = unavailable.value.filter(id => id !== card); } }
  catch (error) {
    if (disposed) return;
    if (error instanceof ApiError && [403, 404].includes(error.status) && !["today", "inbox"].includes(card)) { unavailable.value.push(card); delete errors.value[card]; }
    else errors.value[card] = error instanceof Error ? error.message : "Couldn't refresh";
  }
}
async function loadToday() {
  const generation = ++todayGeneration;
  await resource("today", async () => {
    const start = new Date(`${day.value}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1);
    type Event = { id: string; title?: string; contextType?: string; startsAt?: string; endsAt?: string; remindAt?: string; dueAt?: string; scheduledFor?: string; allDay?: boolean; status?: string; archivedAt?: string; starts_at?: string; ends_at?: string; guest_name?: string };
    const [feedResult, pendingResult, sitesResult] = await Promise.allSettled([
      api.get<{ events?: Event[]; importedEvents?: Event[]; bookings?: Event[]; reminders?: Event[]; tasks?: Event[]; sources?: unknown[] }>(`/calendar/feed?${new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })}`),
      api.get<{ approvals: typeof approvals.value }>("/mission-control/approvals?status=pending"),
      api.get<{ sites: { username: string; bookings_enabled?: boolean; bookingsEnabled?: boolean }[] }>("/sites"),
    ]);
    if (disposed || generation !== todayGeneration) return;
    if (pendingResult.status === "fulfilled") approvals.value = pendingResult.value.approvals;
    if (feedResult.status === "rejected") throw feedResult.reason;
    if (sitesResult.status === "rejected") throw sitesResult.reason;
    const feed = feedResult.value; const sites = sitesResult.value;
    const bookingSites = sites.sites.filter(s => s.bookings_enabled || s.bookingsEnabled).map(s => s.username);
    events.value = [...(feed.events || []), ...(feed.importedEvents || []), ...(feed.reminders || []).filter(r => r.contextType !== "card"), ...(feed.tasks || []).filter(t => !t.archivedAt && !["done", "cancelled"].includes(t.status || "")), ...(feed.bookings || []).filter(b => bookingSites.includes((b as Event & { username: string }).username))]
      .flatMap(e => {
        const raw = e.startsAt || e.starts_at || e.remindAt || e.dueAt || e.scheduledFor;
        if (!raw) return [];
        const time = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
        const finish = e.endsAt || e.ends_at;
        if (time >= end || (finish ? new Date(finish) <= start : time < start)) return [];
        return [{ id: e.id, title: e.title || `Meeting with ${e.guest_name || "a guest"}`, start: time.toISOString(), allDay: e.allDay }];
      }).sort((a, b) => a.start.localeCompare(b.start));
    calendarConnected.value = Boolean(feed.sources?.length);
    if (pendingResult.status === "rejected") throw pendingResult.reason;
  });
}
function money(stats: { thisMonthTotals?: { currency: string; amountCents: number }[]; thisMonthCents?: number; defaultCurrency?: string }): string {
  const totals = stats.thisMonthTotals?.length ? stats.thisMonthTotals : [{ currency: stats.defaultCurrency || "EUR", amountCents: stats.thisMonthCents || 0 }];
  return totals.map(t => new Intl.NumberFormat(undefined, { style: "currency", currency: t.currency }).format(t.amountCents / 100)).join(" + ");
}
async function refresh() {
  loading.value = true;
  await Promise.all([
    loadLayout(),
    loadToday(),
    resource("inbox", async () => {
      const [status, inbox] = await Promise.all([api.get<{ mailbox?: { aliasAddress?: string }; sources?: { address: string; inboundEnabled?: boolean }[] }>("/mailbox"), api.get<{ messages: typeof mail.value }>("/mailbox/messages?direction=inbound&limit=8")]);
      if (disposed) return;
      agentAddress.value = status.mailbox?.aliasAddress || status.sources?.find(s => s.inboundEnabled)?.address || ""; mail.value = inbox.messages;
      try {
        const result = await api.get<{ recentEvents?: { id: string; direction: string; textBody?: string; providerEventId?: string }[] }>("/soulink/status");
        if (disposed) return;
        soulink.value = (result.recentEvents || []).filter(e => e.direction === "inbound").map(e => ({ ...e, outcome: result.recentEvents?.find(reply => e.providerEventId && reply.direction === "outbound" && reply.providerEventId === `${e.providerEventId}:reply`)?.textBody }));
      } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    }),
    resource("gratitude", async () => { const state = await api.get<{ settings?: { inToday?: boolean } }>("/gratitude"); if (!disposed) gratitudeOn.value = Boolean(state.settings?.inToday); }),
    resource("people", async () => { await contactsStore.fetchContacts(); if (contactsStore.error) throw new Error(contactsStore.error); }),
    resource("tasks", plan.loadTasks),
    resource("journal", async () => {
      const [data, drafts] = await Promise.all([api.get<{ entries: typeof journal.value }>("/journal/archive?limit=1"), api.get<{ articles: typeof articles.value }>("/journal/articles")]);
      if (!disposed) { journal.value = data.entries || []; articles.value = drafts.articles || []; }
    }),
    resource("mission", async () => {
      const [data, result] = await Promise.all([api.get<{ missionStatement?: string }>("/mission-control/dashboard"), api.get<{ goals: HomeGoal[] }>("/tasks/goals")]);
      if (!disposed) { mission.value = data.missionStatement || ""; goals.value = result.goals || []; }
    }),
    resource("wheel", async () => {
      const data = await api.get<{ snapshots: { createdAt: string; segments: HomeWheelArea[] }[]; settings: { segments: HomeWheelArea[] } }>("/journal/wheel");
      if (disposed) return;
      wheelDate.value = data.snapshots?.[0]?.createdAt || "";
      const areas = data.snapshots?.[0]?.segments || data.settings?.segments || [];
      wheel.value = (areas.length ? areas : defaultAreas).map(area => ({ ...area, emoji: area.emoji && !/^[a-z]/i.test(area.emoji) ? area.emoji : defaultAreas.find(a => a.id === area.id)?.emoji || "🙂" }));
    }),
    resource("accounts", async () => {
      const data = await api.get<{ plugins: { id: string; enabled: boolean }[] }>("/plugins");
      if (disposed) return; accountsEnabled.value = data.plugins.some(p => p.id === "me3.accounts" && p.enabled);
      if (!accountsEnabled.value) return;
      const [income, expense, incomeEntries, expenseEntries] = await Promise.all([api.get<{ stats: Parameters<typeof money>[0] }>("/accounts/stats?entryType=income"), api.get<{ stats: Parameters<typeof money>[0] }>("/accounts/stats?entryType=expense"), api.get<{ total: number }>("/accounts/entries?entryType=income&limit=1"), api.get<{ total: number }>("/accounts/entries?entryType=expense&limit=1")]);
      if (!disposed) { accountSummary.value = { income: money(income.stats), expense: money(expense.stats) }; earn("accounts", incomeEntries.total + expenseEntries.total > 0); }
    }),
  ]);
  if (!disposed) { loading.value = false; if (!Object.keys(errors.value).length) lastRefresh.value = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
}
async function complete(task: HomeTask) {
  if (busy.value.includes(task.id)) return; busy.value.push(task.id);
  try { const result = await api.patch<{ task: HomeTask }>(`/mission-control/tasks/${encodeURIComponent(task.id)}`, { status: "done" }); tasks.value = tasks.value.map(t => t.id === task.id ? { ...task, ...result.task } : t); delete errors.value.tasks; }
  catch (error) { toastFromUnknown(error, "Couldn't complete task"); }
  finally { busy.value = busy.value.filter(id => id !== task.id); }
}
async function confirm(id: string) {
  if (busy.value.includes(id)) return; busy.value.push(id);
  try { await api.post(`/mission-control/approvals/${encodeURIComponent(id)}`, { decision: "approved" }); approvals.value = approvals.value.filter(a => a.id !== id); delete errors.value.today; }
  catch (error) { toastFromUnknown(error, "Couldn't confirm"); }
  finally { busy.value = busy.value.filter(item => item !== id); }
}
async function decideCoreApproval(decision: "approved" | "declined") {
  const approval = reviewApproval.value;
  if (!approval || busy.value.includes(approval.id)) return;
  busy.value.push(approval.id); approvalError.value = "";
  try {
    await api.post(`/assistant/approvals/${encodeURIComponent(approval.id)}`, { decision });
    approvals.value = approvals.value.filter(item => item.id !== approval.id); reviewApproval.value = null;
    emit("approvalResolved");
    await loadToday();
  } catch (error) { approvalError.value = error instanceof Error ? error.message : "Couldn't save this decision. Try again."; toastFromUnknown(error, "Couldn't save approval"); }
  finally { busy.value = busy.value.filter(id => id !== approval.id); }
}
watch(day, loadToday);
watch(() => props.active, active => {
  if (!active) return;
  const today = localDateKey(new Date());
  void loadLayout();
  if (day.value !== today) day.value = today; else void loadToday();
});
onMounted(() => {
  motionPreference?.addEventListener("change", updateMotionPreference);
  window.addEventListener("online", reconnect); window.addEventListener("offline", reconnect);
  document.addEventListener("pointerdown", dismissMenu);
  void refresh();
});
onBeforeUnmount(() => {
  disposed = true; cancelPress();
  motionPreference?.removeEventListener("change", updateMotionPreference);
  window.removeEventListener("online", reconnect); window.removeEventListener("offline", reconnect);
  document.removeEventListener("pointerdown", dismissMenu);
});
</script>

<template>
  <div ref="panels" class="home-panels" aria-label="Home panels" :aria-busy="loading">
    <p class="sr-only" role="status">{{ orderAnnouncement }}</p>
    <p v-if="offline || Object.keys(errors).length" class="home-offline" role="status"><UiIcon name="WifiOff" :size="16" /><span>{{ offline ? 'You’re offline.' : 'Home couldn’t fully refresh.' }} {{ lastRefresh ? `Showing the last available data · ${lastRefresh}.` : 'Connect to refresh Home.' }}</span><button type="button" :disabled="loading" @click="refresh">Try again</button></p>
    <p v-else-if="loading" class="home-status" role="status">Refreshing Home…</p>
    <draggable :model-value="visible" :item-key="(card: HomeCard) => card" class="home-grid" handle=".home-card__drag" :animation="reducedMotion ? 0 : 160" :delay="250" :delay-on-touch-only="true" :touch-start-threshold="8" ghost-class="home-card--dragging" @update:model-value="setOrder" @start="menu = null">
      <template #item="{ element: card }: { element: HomeCard }">
        <article :ref="el => setCardElement(card, el)" class="home-card" :aria-label="cards[card].title" @contextmenu.prevent="openMenu(card)" @pointerdown="beginPress($event, card)" @pointermove="trackPress" @pointerup="cancelPress" @pointercancel="cancelPress">
          <header class="home-card__header">
            <RouterLink :to="cards[card].href" class="home-card__title"><span class="home-emoji" aria-hidden="true">{{ cards[card].emoji }}</span><span>{{ cards[card].title }}</span></RouterLink>
            <span v-if="card === 'today'" class="home-card__detail">{{ todayLabel }}</span>
            <span v-else-if="card === 'journal' && journal[0]" class="home-card__detail">{{ homeDateLabel(journal[0].date) }}</span>
            <div class="home-card__controls">
              <button type="button" class="home-card__drag" :aria-label="`Drag ${cards[card].title} to reorder`" title="Drag to reorder, or use the options menu"><UiIcon name="GripVertical" :size="16" /></button>
              <button type="button" class="home-card__more" :aria-label="`${cards[card].title} options`" aria-haspopup="menu" :aria-expanded="menu === card" @click="menu === card ? closeMenu(card) : openMenu(card)"><UiIcon name="Ellipsis" :size="20" /></button>
            </div>
          </header>
          <!-- Today's menu holds only the Gratitude switch; reorder by dragging. -->
          <div v-if="menu === card && card === 'today'" class="home-card__menu" role="menu" aria-label="Today options" @keydown.esc.stop.prevent="closeMenu(card)" @keydown="menuKeys">
            <button type="button" role="menuitemcheckbox" :aria-checked="showGratitude" @click="toggleGratitude"><span class="home-emoji home-emoji--menu" aria-hidden="true">🌅</span>Gratitude<span class="home-switch" :class="{ 'is-on': showGratitude }" aria-hidden="true" /></button>
          </div>
          <div v-else-if="menu === card" class="home-card__menu" role="menu" :aria-label="`${cards[card].title} options`" @keydown.esc.stop.prevent="closeMenu(card)" @keydown="menuKeys">
            <button type="button" role="menuitem" :disabled="visible.indexOf(card) === 0" @click="move(card, -1)"><UiIcon name="ArrowUp" :size="16" />Move up</button>
            <button type="button" role="menuitem" :disabled="visible.indexOf(card) === visible.length - 1" @click="move(card, 1)"><UiIcon name="ArrowDown" :size="16" />Move down</button>
            <button type="button" role="menuitem" class="home-danger" @click="remove(card)"><UiIcon name="X" :size="16" />Remove from Home</button>
          </div>
          <div class="home-card__body">
            <template v-if="card === 'today'">
              <div v-for="approval in approvals.slice(0, 3)" :key="approval.id" class="home-approval"><strong>{{ approval.title }}</strong><p v-if="approval.summary" class="home-muted">{{ journalPreview(approval.summary) }}</p><div class="home-actions"><template v-if="approval.pluginId === 'me3.core'"><button type="button" :disabled="busy.includes(approval.id)" @click="reviewApproval = approval; approvalError = ''">Review</button></template><template v-else><button type="button" :disabled="busy.includes(approval.id)" @click="confirm(approval.id)">Confirm</button><button type="button" @click="emit('suggest', `Help me find another time for: ${approval.title}`)">Another time</button></template></div></div>
              <TodayFocusLine :goal="focus" :has-goals="activeGoals.length > 0" />
              <TodaySection title="Calendar" to="/calendar" label="Open Calendar">
                <RouterLink v-for="event in upcomingEvents" :key="event.id" to="/calendar" class="home-line home-event"><span class="home-muted home-time">{{ event.allDay ? 'All day' : new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}</span><span>{{ event.title }}</span></RouterLink>
                <!-- Empty: one quiet line; without a connected calendar, only the way to connect one. -->
                <RouterLink v-if="!calendarConnected && !events.length" to="/calendar" class="home-quiet"><UiIcon name="Plus" :size="16" />Connect a calendar</RouterLink>
                <p v-else-if="!upcomingEvents.length" class="home-muted">{{ events.length ? 'Nothing else today.' : 'Nothing scheduled today.' }}</p>
              </TodaySection>
              <GratitudeCard v-if="showGratitude" section :active="active" @unavailable="unavailable.push('gratitude')" />
              <TodayTasks :tasks="todayTasks" :focus-goal-id="focus?.id" :busy="busy" :limit="4" :backlog-count="backlogCount" @complete="complete" @add="addTask" />
              <TodaySection title="Notes" to="/journal" label="Open today's page">
                <RouterLink v-if="todayPage" to="/journal" class="home-writing home-muted">{{ journalPreview(todayPage.body || todayPage.preview || '') }}</RouterLink>
                <RouterLink to="/journal" class="home-quiet">{{ todayPage ? 'Keep writing' : 'Write on today’s page' }}</RouterLink>
              </TodaySection>
            </template>
            <template v-else-if="card === 'inbox'">
              <RouterLink v-for="event in soulink.slice(0, 3)" :key="event.id" to="/email" class="home-entry"><strong>{{ journalPreview(event.textBody || 'New request') }}</strong><span v-if="event.outcome" class="home-muted">{{ journalPreview(event.outcome) }}</span></RouterLink>
              <RouterLink v-for="message in mail.slice(0, 3)" :key="message.id" to="/email" class="home-entry"><strong>{{ message.fromName || message.subject || 'New message' }}</strong><span class="home-muted">{{ journalPreview(message.agentSummary || message.preview || message.subject || '') }}</span></RouterLink>
              <template v-if="!mail.length && !soulink.length"><p class="home-muted">{{ agentAddress ? 'ME3 will keep incoming requests and replies here.' : 'Give ME3 its own email. CC it on anything. It never sees your inbox.' }}</p><RouterLink v-if="!agentAddress" to="/settings?section=mailbox" class="home-quiet"><UiIcon name="Plus" :size="16" />Set up agent email</RouterLink></template>
            </template>
            <template v-else-if="card === 'mission'">
              <p v-if="mission" class="home-mission">{{ mission }}</p><p v-else class="home-muted">What do you want your life built around? Start there, then add goals.</p>
              <p v-if="activeGoals.length > 1" class="home-muted home-goal-hint">{{ activeGoals.length }} goals · swipe to explore</p>
              <div v-if="activeGoals.length" class="home-goal-line" aria-label="Goals">
                <button v-for="goal in activeGoals" :key="goal.id" type="button" :aria-pressed="selectedGoal?.id === goal.id" @click="pickedGoal = goal.id"><span><span aria-hidden="true">{{ areaFor(goal.areaId)?.emoji || '🎯' }}</span> {{ goal.title }}</span><span class="home-progress" aria-hidden="true"><i :style="{ width: `${goal.progress || 0}%` }" /></span></button>
              </div>
              <div v-if="selectedGoal" class="home-goal-tasks">
                <p class="home-muted home-goal-meta">{{ selectedGoal.progress || 0 }}% there · {{ goalTasks.length }} {{ goalTasks.length === 1 ? 'task' : 'tasks' }}<span v-if="areaFor(selectedGoal.areaId)"> · <span aria-hidden="true">{{ areaFor(selectedGoal.areaId)?.emoji }}</span> {{ areaFor(selectedGoal.areaId)?.label }}</span></p>
                <div v-for="task in goalTasks.slice(0, 3)" :key="task.id" class="home-line"><button type="button" class="home-task-check" :aria-label="`Complete ${task.title}`" :disabled="busy.includes(task.id)" @click="complete(task)"><UiIcon name="Circle" :size="20" /></button><RouterLink :to="`/tasks?task=${encodeURIComponent(task.id)}`">{{ task.title }}</RouterLink></div>
                <div class="home-actions"><RouterLink v-if="goalTasks.length > 3" to="/tasks" class="home-quiet">{{ goalTasks.length - 3 }} more</RouterLink><button type="button" class="home-quiet" @click="emit('suggest', `Add a task to my goal “${selectedGoal.title}” (goal ${selectedGoal.id}).`)"><UiIcon name="Plus" :size="16" />Add a task</button></div>
              </div>
              <div v-else class="home-actions"><button v-if="!mission" type="button" class="home-quiet" @click="emit('suggest', 'Help me write my mission.')"><UiIcon name="Plus" :size="16" />Write your mission</button><button type="button" class="home-quiet" @click="addGoal()"><UiIcon name="Plus" :size="16" />Add a goal</button></div>
              <!-- The Wheel of Life lives in Mission now; the Mission redesign (me3-l59x.4) gives it a page of its own. -->
              <button type="button" class="home-quiet" @click="openWheel"><span aria-hidden="true">🛞</span>Wheel of life</button>
            </template>
            <template v-else-if="card === 'journal'">
              <RouterLink v-if="journal[0]" :to="`/journal?date=${journal[0].date}`" class="home-writing"><strong v-if="journal[0].title">{{ journal[0].title }}.</strong> <span class="home-muted">{{ journalPreview(journal[0].body || journal[0].preview || '') }}</span></RouterLink>
              <RouterLink v-for="article in articles.slice(0, 2)" :key="article.id" :to="`/journal?article=${encodeURIComponent(article.id)}`" class="home-entry"><UiIcon name="FileText" :size="15" /><strong>{{ article.title || 'Untitled article' }}</strong><span class="home-muted">Draft</span></RouterLink>
              <template v-if="!journal.length && !articles.length"><p class="home-muted">Write about your day, or start an article.</p><RouterLink to="/journal" class="home-quiet"><UiIcon name="Plus" :size="16" />Start writing</RouterLink></template>
            </template>
            <template v-else-if="card === 'accounts'"><div v-if="accountSummary" class="home-stats"><div><span class="home-muted">Income this month</span><strong>{{ accountSummary.income }}</strong></div><div><span class="home-muted">Expenses this month</span><strong>{{ accountSummary.expense }}</strong></div></div><RouterLink v-else to="/accounts" class="home-quiet">Open Accounts<UiIcon name="ArrowRight" :size="16" /></RouterLink></template>
            <template v-else-if="card === 'people'"><template v-if="peopleCard.state === 'people'"><button v-for="person in peopleCard.people" :key="person.id" type="button" class="home-person" @click="openPersonId = person.id"><PersonAvatar :contact="person" :size="40" /><strong>{{ firstName(person.name) }}</strong><span class="home-muted home-person__since">{{ formatSinceShort(person.lastInTouchAt) || 'Not yet' }}</span></button></template><p v-else class="home-muted">All caught up.</p></template>
          </div>
        </article>
      </template>
    </draggable>
    <button type="button" class="home-add" @click="dialog = 'add'"><UiIcon name="Plus" :size="26" /><span>Add to Home</span></button>
    <AppDialog :open="dialog !== null" :aria-label="dialog === 'wheel' ? 'Wheel of Life' : 'Add to Home'" :close-on-backdrop="!wheelSaving" @close="!wheelSaving && (dialog = null)">
      <section class="home-dialog" :class="{ 'home-dialog--wheel': dialog === 'wheel' }"><header><h2>{{ dialog === 'wheel' ? '🛞 Wheel of Life' : 'Add to Home' }}</h2><button type="button" aria-label="Close Home editor" :disabled="wheelSaving" @click="dialog = null"><UiIcon name="X" :size="20" /></button></header>
        <div v-if="dialog === 'add'" class="home-add-grid"><button v-for="card in addCards" :key="card" type="button" :aria-label="cards[card].title" :aria-pressed="visible.includes(card)" class="home-add-tile" @click="visible.includes(card) ? remove(card) : add(card)"><span class="home-emoji" aria-hidden="true">{{ cards[card].emoji }}</span><span>{{ cards[card].title }}</span><UiIcon v-if="visible.includes(card)" name="CircleCheck" :size="17" class="home-add-tile__check" /></button></div>
        <p v-if="dialog === 'add'" class="home-muted">Drag a card, or use its options menu to move or remove it.</p>
        <template v-if="dialog === 'wheel'"><div class="home-wheel-dialog"><HomeWheelChart :areas="dialogAreas" :selected="selectedArea?.id" interactive @select="pickedArea = $event" /><div class="home-wheel-rows"><template v-for="area in dialogAreas" :key="area.id"><button type="button" :aria-label="`Select ${area.label}`" :aria-pressed="selectedArea?.id === area.id" @click="pickedArea = area.id"><span class="home-emoji" aria-hidden="true">{{ area.emoji }}</span><span>{{ area.label }}</span><strong>{{ area.value ?? '—' }}</strong></button><label v-if="checkingIn" class="home-wheel-range"><span class="sr-only">{{ area.label }} score</span><input type="range" min="1" max="10" :value="area.value ?? 5" :disabled="wheelSaving" :aria-label="`${area.label} score`" @input="area.value = Number(($event.target as HTMLInputElement).value)" /><output>{{ area.value === null ? 'Not scored' : `${area.value}/10` }}</output></label></template></div></div>
          <div v-if="selectedArea && !checkingIn" class="home-wheel-goals"><h3>{{ selectedArea.emoji }} {{ selectedArea.label }}</h3><RouterLink v-for="goal in areaGoals(selectedArea.id)" :key="goal.id" to="/tasks?goals=1">{{ goal.title }} · {{ goal.progress || 0 }}%</RouterLink><button v-if="!areaGoals(selectedArea.id).length" type="button" class="home-quiet" @click="addGoal(selectedArea.id)"><UiIcon name="Plus" :size="16" />Add a goal</button></div>
          <footer><button v-if="checkingIn" type="button" class="home-primary" :disabled="wheelSaving || wheelDraft.some(area => area.value === null)" @click="saveCheckIn">{{ wheelSaving ? 'Saving…' : 'Save check-in' }}</button><button v-else type="button" class="home-primary" @click="startCheckIn">Check in</button><span class="home-muted">{{ wheelDate ? `Last check-in ${new Date(wheelDate).toLocaleDateString([], { day: 'numeric', month: 'short' })}.` : 'A private check-in with the areas of your life.' }}</span></footer>
        </template>
      </section>
    </AppDialog>
    <GoalsDialog v-if="goalEditor" :initial-area-id="goalArea" @close="goalEditor = false; refresh()" />
    <PersonSheet :contact="openPerson" @close="openPersonId = null" />
    <AssistantApprovalDialog :approval="reviewApproval" :busy="Boolean(reviewApproval && busy.includes(reviewApproval.id))" :error="approvalError" @close="reviewApproval = null" @decide="decideCoreApproval" />
  </div>
</template>

<style scoped>
.home-panels { padding: 18px 10px 120px; }
.home-grid { display: grid; grid-template-columns: minmax(0, 1fr); row-gap: 16px; width: min(620px, 100%); margin: 0 auto; align-items: start; }
.home-status, .home-offline { width: min(1120px, 100%); margin: 0 auto 12px; font-size: 14px; color: var(--ui-text-muted); }
.home-offline { display: flex; align-items: center; gap: 8px; }
.home-offline span { flex: 1; }
.home-offline button { color: var(--ui-accent-strong); white-space: nowrap; }
.home-card { position: relative; min-width: 0; background: var(--ui-surface); border: 0; border-radius: 24px; box-shadow: var(--ui-shadow-sm); }
.home-card--dragging { opacity: .4; }
.home-card__header { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0 18px; }
.home-card__title { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 40px; color: var(--ui-text); font-size: 15px; font-weight: 600; text-decoration: none; padding: 0; white-space: nowrap; }
.home-card__title:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
.home-emoji { font-size: 20px; line-height: 1; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
.home-card__detail { color: var(--ui-text-muted); font-size: 12px; white-space: nowrap; }
.home-card__controls { display: flex; margin-left: auto; }
button { cursor: pointer; font: inherit; color: var(--ui-text); background: transparent; border: 0; min-width: 44px; min-height: 44px; border-radius: 12px; }
button:hover { background: var(--ui-surface-muted); }
button:disabled { opacity: .35; cursor: default; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.home-card__controls > button { display: grid; place-items: center; width: 36px; min-width: 36px; }
.home-card__drag { cursor: grab; touch-action: none; }
.home-card__drag:active { cursor: grabbing; }
@media (hover: hover) and (pointer: fine) {
  .home-card__controls { opacity: 0; }
  .home-card:hover .home-card__controls, .home-card:focus-within .home-card__controls { opacity: 1; }
}
.home-card__body { padding: 0 18px 16px; font-size: 15px; line-height: 1.45; }
p { margin: 4px 0; }
.home-muted { color: var(--ui-text-muted); font-size: 14px; }
.home-entry { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 6px 0; text-decoration: none; color: var(--ui-text); }
.home-entry strong { flex: 0 1 auto; font-size: 14px; font-weight: 600; }
.home-entry span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-entry svg { flex-shrink: 0; align-self: center; }
.home-person { display: flex; gap: 12px; align-items: center; width: 100%; min-height: 52px; padding: 0; border: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 16px; text-align: left; cursor: pointer; }
.home-person__since { margin-left: auto; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.home-line { display: flex; gap: 8px; align-items: center; min-height: 40px; color: var(--ui-text); text-decoration: none; }
.home-line > a { color: inherit; text-decoration: none; flex: 1; min-width: 0; }
.home-event { min-height: 32px; }
.home-event > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-time { min-width: 50px; font-variant-numeric: tabular-nums; }
.home-task-check { display: grid; place-items: center; min-width: 36px; width: 36px; margin-left: -8px; flex-shrink: 0; color: var(--ui-text-muted); }
.home-approval { padding: 10px 12px; margin-bottom: 8px; background: var(--ui-accent-soft); border-radius: 16px; }
.home-approval strong { font-size: 14px; font-weight: 600; }
.home-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.home-actions button { padding: 0 4px; }
.home-actions button:first-child:not(.home-quiet) { color: var(--ui-primary-contrast); background: var(--ui-primary); padding: 0 16px; border-radius: 24px; }
.home-quiet { display: inline-flex; align-items: center; gap: 5px; color: var(--ui-text-muted); font-size: 14px; font-weight: 500; min-height: 44px; text-decoration: none; padding: 0; text-align: left; }
.home-quiet:hover { color: var(--ui-text); background: transparent; }
.home-card__menu { position: absolute; right: 10px; top: 52px; z-index: 60; display: grid; width: 210px; padding: 6px; background: var(--ui-surface); border-radius: 16px; box-shadow: var(--ui-shadow-md); }
.home-card__menu button { display: flex; gap: 10px; align-items: center; text-align: left; padding: 0 12px; font-size: 14px; }
.home-danger { color: var(--ui-danger, #dc2626); }
.home-emoji--menu { font-size: 16px; }
.home-switch { position: relative; width: 40px; height: 24px; margin-left: auto; border-radius: 999px; background: var(--ui-surface-muted); box-shadow: inset 0 0 0 1px var(--ui-border); flex-shrink: 0; }
.home-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 25%); transition: left .15s; }
.home-switch.is-on { background: var(--ui-accent); box-shadow: none; }
.home-switch.is-on::after { left: 18px; }
.home-mission { margin: 8px 0 20px; font-family: var(--font-serif, Georgia, serif); font-size: 22px; font-weight: 500; line-height: 1.4; text-align: center; }
.home-goal-hint { margin: 0 0 6px; font-size: 12px; }
.home-goal-line { display: flex; gap: 12px; overflow-x: auto; scrollbar-width: thin; }
.home-goal-line button > span:first-child { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-goal-line button { flex-shrink: 0; display: grid; gap: 6px; min-width: 0; padding: 4px 0 0; min-height: 42px; border-radius: 0; color: var(--ui-text-muted); font-size: 15px; font-weight: 600; text-align: left; background: transparent; }
.home-goal-line button[aria-pressed="true"] { color: var(--ui-text); }
.home-progress { display: block; height: 3px; border-radius: 3px; background: var(--ui-surface-muted); opacity: 0; }
.home-progress i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); }
.home-goal-line button[aria-pressed="true"] .home-progress { opacity: 1; }
.home-goal-tasks { margin: 8px 0 0 10px; padding-left: 16px; box-shadow: inset 2px 0 var(--ui-accent-soft); }
.home-goal-meta { font-size: 12px; }
.home-writing { display: block; margin: 2px 0 6px; color: var(--ui-text); text-decoration: none; }
.home-writing strong { font-weight: 600; }
.home-wheel { display: flex; align-items: center; gap: 18px; padding: 6px 0; }
.home-wheel-open { padding: 0; border-radius: 50%; flex: 0 0 auto; }
.home-wheel-summary { display: grid; gap: 4px; min-width: 0; }
.home-wheel-summary strong { font-weight: 600; }
.home-wheel-score { font-size: 30px; line-height: 1.15; font-weight: 600; }
.home-wheel-score small { margin-left: 4px; color: var(--ui-text-muted); font-size: 14px; font-weight: 400; }
.home-area-goal { font-size: 14px; font-weight: 600; text-decoration: none; }
.home-stats { display: flex; gap: 8px; }
.home-stats > div { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 16px; background: var(--ui-surface-muted); display: grid; }
.home-stats strong { font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
.home-add { display: flex; flex-direction: column; align-items: center; justify-self: center; gap: 4px; margin: 36px auto 0; padding: 8px 16px; font-size: 12px; }
.home-add span { color: var(--ui-text-muted); }
.home-dialog { width: min(520px, 100%); max-height: 88dvh; overflow: auto; padding: 20px; border-radius: 28px; background: var(--ui-surface); box-sizing: border-box; box-shadow: var(--ui-shadow-md); }
.home-dialog--wheel { width: min(760px, 100%); }
.home-dialog header, .home-dialog footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.home-dialog h2 { margin: 0; font-size: 20px; font-weight: 600; }
.home-dialog h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
.home-dialog footer { position: sticky; bottom: 0; justify-content: flex-start; margin-top: 16px; padding-top: 8px; background: var(--ui-surface); }
.home-primary { padding: 0 22px; background: var(--ui-primary); color: var(--ui-primary-contrast); border-radius: 24px; font-weight: 600; }
.home-primary:hover { background: var(--ui-primary-strong); }
.home-add-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
.home-add-tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 100px; padding: 12px 4px; box-shadow: var(--ui-shadow-sm); border-radius: 18px; font-size: 14px; font-weight: 600; }
.home-add-tile .home-emoji { font-size: 32px; }
.home-add-tile[aria-pressed="true"] { background: var(--ui-accent-soft); }
.home-add-tile__check { position: absolute; top: 8px; right: 8px; color: var(--ui-accent-strong); }
.home-wheel-dialog { display: flex; gap: 24px; align-items: center; margin: 12px 0; }
.home-wheel-dialog > :deep(svg) { width: 260px; height: 260px; }
.home-wheel-rows { flex: 1; min-width: 0; }
.home-wheel-rows > button { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; }
.home-wheel-rows > button[aria-pressed="true"] { background: var(--ui-surface-muted); font-weight: 600; }
.home-wheel-rows > button strong { margin-left: auto; font-variant-numeric: tabular-nums; }
.home-wheel-range { display: flex; align-items: center; gap: 10px; padding: 0 10px; }
.home-wheel-range input { flex: 1; min-width: 0; accent-color: var(--ui-accent); }
.home-wheel-range output { width: 66px; font-size: 12px; color: var(--ui-text-muted); }
.home-wheel-goals > a { display: block; min-height: 36px; text-decoration: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 640px) {
  .home-panels { padding-inline: 2px; }
  .home-card__controls > button { min-width: 44px; width: 44px; }
  .home-card__header { flex-wrap: wrap; gap: 0 6px; }
  .home-wheel { gap: 10px; }
  .home-wheel-open :deep(svg) { width: 135px; height: 135px; }
  .home-dialog { width: 100%; border-radius: 28px 28px 0 0; padding: 16px; }
  .home-wheel-dialog { flex-direction: column; }
  .home-wheel-rows { width: 100%; }
  .home-dialog footer { flex-wrap: wrap; }
}
</style>
