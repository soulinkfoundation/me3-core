<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, ApiError, API_BASE } from "../../api";
import { useAuthStore } from "../../stores/auth";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import { HOME_CARDS, emptyHomeLayout, homeDateLabel, homeDoneToday, homeOpenTasks, journalPreview, localDateKey, visibleHomeCards, type HomeCard, type HomeLayout, type HomeTask } from "../../utils/homeSummary";
const emit = defineEmits<{ suggest: [text: string] }>();
const auth = useAuthStore();
const storageKey = computed(() => `me3.home.${location.origin}.${API_BASE}.${auth.user?.id || "owner"}`);
const layout = ref<HomeLayout>(emptyHomeLayout());
const tasks = ref<HomeTask[]>([]);
const journal = ref<{ id: string; date: string; body?: string; preview?: string }[]>([]);
const mail = ref<{ id: string; subject: string; fromName?: string; fromAddress?: string; preview?: string; agentSummary?: string }[]>([]);
const soulink = ref<{ id: string; textBody?: string; outcome?: string }[]>([]);
const approvals = ref<{ id: string; title: string; summary?: string }[]>([]);
const events = ref<{ id: string; title: string; start: string; allDay?: boolean }[]>([]);
const goals = ref<{ id: string; title: string; status: string }[]>([]);
const wheel = ref<{ id: string; label?: string; name?: string; value?: number | null }[]>([]);
const mission = ref("");
const agentAddress = ref("");
const calendarConnected = ref(false);
const accountsEnabled = ref(false);
const accountSummary = ref<{ income: string; expense: string } | null>(null);
const errors = ref<Partial<Record<HomeCard, string>>>({});
const loading = ref(true);
const busy = ref<string[]>([]);
const dialog = ref<"add" | "reorder" | null>(null);
const menu = ref<HomeCard | null>(null);
const day = ref(localDateKey(new Date()));
const cards: Record<HomeCard, { title: string; href: string; icon: string }> = {
  today: { title: "Today", href: "/calendar", icon: "CalendarDays" },
  inbox: { title: "ME3’s inbox", href: "/email", icon: "Inbox" },
  tasks: { title: "Tasks", href: "/tasks", icon: "ListChecks" },
  accounts: { title: "Accounts", href: "/accounts", icon: "Wallet" },
  journal: { title: "Journal", href: "/journal", icon: "NotebookPen" },
  goals: { title: "Goals", href: "/tasks?view=goals", icon: "Target" },
  wheel: { title: "Wheel of Life", href: "/wheel-of-life", icon: "Circle" },
  mission: { title: "Mission", href: "/tasks", icon: "Compass" },
  files: { title: "Files", href: "/files", icon: "Files" },
};
const visible = computed(() => visibleHomeCards(layout.value).filter(id => id !== "accounts" || accountsEnabled.value));
const available = computed(() => HOME_CARDS.filter(id => !visible.value.includes(id) && (id !== "accounts" || accountsEnabled.value)));
const openTasks = computed(() => homeOpenTasks(tasks.value).slice(0, 6));
const doneToday = computed(() => homeDoneToday(tasks.value));
const scoredWheel = computed(() => wheel.value.filter(s => s.value != null).sort((a, b) => a.value! - b.value!).slice(0, 3));
let disposed = false;
let todayGeneration = 0;
let pressTimer: ReturnType<typeof setTimeout> | undefined;
let pressOrigin: { x: number; y: number } | null = null;
function save() { try { localStorage.setItem(storageKey.value, JSON.stringify(layout.value)); } catch { /* Layout remains usable when browser storage is unavailable. */ } }
watch(storageKey, () => {
  layout.value = emptyHomeLayout();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey.value) || "null");
    for (const key of ["order", "hidden", "pinned", "earned"] as const) {
      if (Array.isArray(saved?.[key])) layout.value[key] = saved[key].filter((v: unknown) => typeof v === "string" && HOME_CARDS.includes(v as HomeCard));
    }
  } catch { /* Ignore malformed layout preferences. */ }
}, { immediate: true });
function earn(card: HomeCard, hasData: boolean) { if (hasData && !layout.value.earned.includes(card)) { layout.value.earned.push(card); save(); } }
function add(card: HomeCard) { layout.value.hidden = layout.value.hidden.filter(id => id !== card); layout.value.pinned.push(card); save(); dialog.value = null; }
function remove(card: HomeCard) { layout.value.hidden.push(card); layout.value.pinned = layout.value.pinned.filter(id => id !== card); save(); menu.value = null; }
function move(card: HomeCard, offset: number) {
  const order = [...visible.value]; const i = order.indexOf(card); const target = i + offset;
  if (target < 0 || target >= order.length) return;
  [order[i], order[target]] = [order[target], order[i]]; layout.value.order = order; save();
}
function cancelPress() { clearTimeout(pressTimer); pressOrigin = null; }
function beginPress(event: PointerEvent, card: HomeCard) {
  if (event.pointerType === "mouse" || (event.target as HTMLElement).closest("a,button,input")) return;
  pressOrigin = { x: event.clientX, y: event.clientY };
  pressTimer = setTimeout(() => { menu.value = card; }, 600);
}
function trackPress(event: PointerEvent) { if (pressOrigin && Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > 10) cancelPress(); }
async function resource(card: HomeCard, load: () => Promise<void>) {
  try { await load(); if (!disposed) delete errors.value[card]; }
  catch (error) { if (!disposed) errors.value[card] = error instanceof Error ? error.message : "Couldn't refresh"; }
}
async function loadToday() {
  const generation = ++todayGeneration;
  await resource("today", async () => {
    const start = new Date(`${day.value}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1);
    type Event = { id: string; title?: string; startsAt?: string; endsAt?: string; remindAt?: string; dueAt?: string; scheduledFor?: string; allDay?: boolean; status?: string; archivedAt?: string; starts_at?: string; ends_at?: string; guest_name?: string };
    const [feed, pending, sites] = await Promise.all([
      api.get<{ events?: Event[]; importedEvents?: Event[]; bookings?: Event[]; reminders?: Event[]; tasks?: Event[]; sources?: unknown[] }>(`/calendar/feed?${new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })}`),
      api.get<{ approvals: typeof approvals.value }>("/mission-control/approvals?status=pending"),
      api.get<{ sites: { username: string; bookings_enabled?: boolean; bookingsEnabled?: boolean }[] }>("/sites"),
    ]);
    if (disposed || generation !== todayGeneration) return;
    const bookingSites = sites.sites.filter(s => s.bookings_enabled || s.bookingsEnabled).map(s => s.username);
    events.value = [...(feed.events || []), ...(feed.importedEvents || []), ...(feed.reminders || []), ...(feed.tasks || []).filter(t => !t.archivedAt && !["done", "cancelled"].includes(t.status || "")), ...(feed.bookings || []).filter(b => bookingSites.includes((b as Event & { username: string }).username))]
      .flatMap(e => {
        const raw = e.startsAt || e.starts_at || e.remindAt || e.dueAt || e.scheduledFor;
        if (!raw) return [];
        const time = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
        const finish = e.endsAt || e.ends_at;
        if (time >= end || (finish ? new Date(finish) <= start : time < start)) return [];
        return [{ id: e.id, title: e.title || `Meeting with ${e.guest_name || "a guest"}`, start: time.toISOString(), allDay: e.allDay }];
      }).sort((a, b) => a.start.localeCompare(b.start));
    calendarConnected.value = Boolean(feed.sources?.length);
    approvals.value = pending.approvals;
  });
}
function money(stats: { thisMonthTotals?: { currency: string; amountCents: number }[]; thisMonthCents?: number; defaultCurrency?: string }): string {
  const totals = stats.thisMonthTotals?.length ? stats.thisMonthTotals : [{ currency: stats.defaultCurrency || "EUR", amountCents: stats.thisMonthCents || 0 }];
  return totals.map(t => new Intl.NumberFormat(undefined, { style: "currency", currency: t.currency }).format(t.amountCents / 100)).join(" + ");
}
async function refresh() {
  loading.value = true;
  await Promise.all([
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
    resource("tasks", async () => {
      const all: HomeTask[] = []; const seen = new Set<string>(); let cursor: string | undefined;
      do {
        const page = await api.get<{ tasks: HomeTask[]; nextCursor?: string }>(`/mission-control/tasks?${new URLSearchParams({ active: "1", limit: "100", ...(cursor ? { cursor } : {}) })}`);
        all.push(...page.tasks); cursor = page.nextCursor || undefined;
        if (cursor && seen.has(cursor)) throw new Error("Couldn't finish loading tasks. Try again.");
        if (cursor) seen.add(cursor);
      } while (cursor && !disposed);
      if (!disposed) { tasks.value = all; earn("tasks", all.length > 0); }
    }),
    resource("journal", async () => { const data = await api.get<{ entries: typeof journal.value }>("/journal/archive?limit=3"); if (!disposed) { journal.value = data.entries; earn("journal", data.entries.length > 0); } }),
    resource("goals", async () => {
      const data = await api.get<{ missionStatement?: string; settings?: { goals?: typeof goals.value; mainGoal?: string } }>("/mission-control/dashboard");
      if (disposed) return; mission.value = data.missionStatement || ""; goals.value = data.settings?.goals || [];
      if (!goals.value.length && data.settings?.mainGoal) goals.value = [{ id: "main", title: data.settings.mainGoal, status: "active" }]; earn("goals", goals.value.length > 0);
    }),
    resource("wheel", async () => { const data = await api.get<{ snapshots: { segments: typeof wheel.value }[]; settings: { segments: typeof wheel.value } }>("/mission-control/wheel"); if (!disposed) { wheel.value = data.snapshots[0]?.segments || data.settings.segments; earn("wheel", wheel.value.some(s => s.value != null)); } }),
    resource("accounts", async () => {
      const data = await api.get<{ plugins: { id: string; enabled: boolean }[] }>("/plugins");
      if (disposed) return; accountsEnabled.value = data.plugins.some(p => p.id === "me3.accounts" && p.enabled);
      if (!accountsEnabled.value) return;
      const [income, expense, incomeEntries, expenseEntries] = await Promise.all([api.get<{ stats: Parameters<typeof money>[0] }>("/accounts/stats?entryType=income"), api.get<{ stats: Parameters<typeof money>[0] }>("/accounts/stats?entryType=expense"), api.get<{ total: number }>("/accounts/entries?entryType=income&limit=1"), api.get<{ total: number }>("/accounts/entries?entryType=expense&limit=1")]);
      if (!disposed) { accountSummary.value = { income: money(income.stats), expense: money(expense.stats) }; earn("accounts", incomeEntries.total + expenseEntries.total > 0); }
    }),
  ]);
  if (!disposed) loading.value = false;
}
async function complete(task: HomeTask) {
  if (busy.value.includes(task.id)) return; busy.value.push(task.id);
  try { const result = await api.patch<{ task: HomeTask }>(`/mission-control/tasks/${encodeURIComponent(task.id)}`, { status: "done" }); tasks.value = tasks.value.map(t => t.id === task.id ? result.task : t); delete errors.value.tasks; }
  catch (error) { errors.value.tasks = error instanceof Error ? error.message : "Couldn't complete task"; }
  finally { busy.value = busy.value.filter(id => id !== task.id); }
}
async function confirm(id: string) {
  if (busy.value.includes(id)) return; busy.value.push(id);
  try { await api.post(`/mission-control/approvals/${encodeURIComponent(id)}`, { decision: "approved" }); approvals.value = approvals.value.filter(a => a.id !== id); delete errors.value.today; }
  catch (error) { errors.value.today = error instanceof Error ? error.message : "Couldn't confirm"; }
  finally { busy.value = busy.value.filter(item => item !== id); }
}
watch(day, loadToday);
onMounted(refresh);
onBeforeUnmount(() => { disposed = true; cancelPress(); });
</script>

<template>
  <div class="home-panels" aria-label="Home panels">
    <p v-if="loading" class="home-status" role="status">Refreshing Home…</p>
    <article v-for="card in visible" :key="card" class="home-card" :aria-label="cards[card].title" @contextmenu.prevent="menu = card" @pointerdown="beginPress($event, card)" @pointermove="trackPress" @pointerup="cancelPress" @pointercancel="cancelPress">
      <header class="home-card__header">
        <RouterLink :to="cards[card].href" class="home-card__title"><span>{{ cards[card].title }}</span><UiIcon name="ChevronRight" :size="15" aria-hidden="true" /></RouterLink>
        <div class="home-card__controls">
          <label v-if="card === 'today'" class="home-day"><UiIcon name="CalendarDays" :size="18" aria-hidden="true" /><input v-model="day" type="date" aria-label="Choose Home calendar day" /></label>
          <button type="button" :aria-label="`${cards[card].title} options`" :aria-expanded="menu === card" @click="menu = menu === card ? null : card"><UiIcon name="Ellipsis" :size="20" /></button>
          <div v-if="menu === card" class="home-card__menu" @keydown.esc="menu = null">
            <button type="button" @click="dialog = 'reorder'; menu = null">Reorder cards</button>
            <button type="button" @click="remove(card)">Remove from Home</button>
            <button type="button" @click="menu = null">Close</button>
          </div>
        </div>
      </header>
      <div class="home-card__body">
        <template v-if="card === 'today'">
          <p v-if="day !== localDateKey(new Date())" class="home-muted">{{ homeDateLabel(day) }}</p>
          <RouterLink v-for="event in events.slice(0, 5)" :key="event.id" to="/calendar" class="home-line"><span class="home-muted home-time">{{ event.allDay ? 'All day' : new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}</span><span>{{ event.title }}</span></RouterLink>
          <div v-for="approval in approvals.slice(0, 3)" :key="approval.id" class="home-approval"><strong>{{ approval.title }}</strong><p v-if="approval.summary" class="home-muted">{{ journalPreview(approval.summary) }}</p><div class="home-actions"><button type="button" :disabled="busy.includes(approval.id)" @click="confirm(approval.id)">Confirm</button><button type="button" @click="emit('suggest', `Help me find another time for: ${approval.title}`)">Another time</button></div></div>
          <p v-if="!events.length && !approvals.length" class="home-muted">Your day is clear.</p>
          <RouterLink v-if="!calendarConnected && !events.length" to="/calendar" class="home-connect">Connect a calendar <UiIcon name="ArrowRight" :size="16" /></RouterLink>
        </template>
        <template v-else-if="card === 'inbox'">
          <p v-if="agentAddress" class="home-muted home-address">{{ agentAddress }}</p>
          <RouterLink v-for="event in soulink.slice(0, 3)" :key="event.id" to="/email" class="home-entry"><strong>{{ journalPreview(event.textBody || 'New request') }}</strong><span v-if="event.outcome" class="home-muted">{{ journalPreview(event.outcome) }}</span></RouterLink>
          <RouterLink v-for="message in mail.slice(0, 3)" :key="message.id" to="/email" class="home-entry"><strong>{{ message.subject || 'New message' }}</strong><span class="home-muted">{{ journalPreview(message.agentSummary || message.preview || message.fromName || message.fromAddress || '') }}</span></RouterLink>
          <p v-if="!mail.length && !soulink.length" class="home-muted">ME3 will keep incoming requests and replies here.</p>
        </template>
        <template v-else-if="card === 'tasks'">
          <div v-for="task in openTasks" :key="task.id" class="home-line"><button type="button" class="home-task-check" :aria-label="`Complete ${task.title}`" :disabled="busy.includes(task.id)" @click="complete(task)"><UiIcon name="Circle" :size="19" /></button><RouterLink to="/tasks">{{ task.title }}</RouterLink></div>
          <p v-if="!openTasks.length" class="home-muted">No open tasks.</p><p v-if="doneToday" class="home-muted home-done">{{ doneToday }} done today</p>
        </template>
        <template v-else-if="card === 'journal'">
          <RouterLink v-for="entry in journal" :key="entry.id" :to="`/journal?date=${entry.date}`" class="home-entry"><strong>{{ homeDateLabel(entry.date) }}</strong><span class="home-muted">{{ journalPreview(entry.body || entry.preview || '') }}</span></RouterLink>
          <p v-if="!journal.length" class="home-muted">A little space to reflect on your day.</p>
        </template>
        <template v-else-if="card === 'accounts'"><p v-if="accountSummary" class="home-line"><span class="home-muted">This month</span><span>Income {{ accountSummary.income }}<br>Expenses {{ accountSummary.expense }}</span></p><p v-else class="home-muted">Your income and expenses at a glance.</p></template>
        <template v-else-if="card === 'goals'"><RouterLink v-for="goal in goals.slice(0, 3)" :key="goal.id" to="/tasks" class="home-line"><UiIcon :name="goal.status === 'completed' ? 'CircleCheck' : 'Target'" :size="18" /><span>{{ goal.title }}</span></RouterLink><p v-if="!goals.length" class="home-muted">Choose what you want to work towards.</p></template>
        <template v-else-if="card === 'wheel'"><RouterLink v-for="segment in scoredWheel" :key="segment.id" to="/wheel-of-life" class="home-line"><span>{{ segment.label || segment.name || segment.id }}</span><span class="home-muted">{{ segment.value }}/10</span></RouterLink><p v-if="!scoredWheel.length" class="home-muted">Check in with the areas of your life.</p></template>
        <p v-else-if="card === 'mission'" class="home-muted">{{ mission || 'Keep what matters to you in view.' }}</p>
        <RouterLink v-else to="/files" class="home-connect">Open your files <UiIcon name="ArrowRight" :size="16" /></RouterLink>
        <div v-if="errors[card]" class="home-error" role="alert"><span>Couldn't refresh {{ cards[card].title.toLowerCase() }}.</span><button type="button" :disabled="loading" @click="refresh">Try again</button></div>
      </div>
    </article>
    <button type="button" class="home-add" @click="dialog = 'add'"><span class="home-add__icon"><UiIcon name="Plus" :size="25" /></span><span>Add to Home</span></button>
    <AppDialog :open="dialog !== null" :aria-label="dialog === 'add' ? 'Add to Home' : 'Reorder cards'" :close-on-backdrop="true" @close="dialog = null">
      <section class="home-dialog"><header><h2>{{ dialog === 'add' ? 'Add to Home' : 'Reorder cards' }}</h2><button type="button" aria-label="Close Home editor" @click="dialog = null"><UiIcon name="X" :size="20" /></button></header>
        <template v-if="dialog === 'add'"><button v-for="card in available" :key="card" type="button" class="home-dialog__row" @click="add(card)"><span>{{ cards[card].title }}</span><UiIcon name="Plus" :size="22" /></button><p v-if="!available.length" class="home-muted">All panels are on Home.</p></template>
        <template v-else><p class="home-muted">Move cards into the order that works for you.</p><div v-for="(card, index) in visible" :key="card" class="home-dialog__row"><span>{{ cards[card].title }}</span><div><button type="button" :disabled="index === 0" :aria-label="`Move ${cards[card].title} up`" @click="move(card, -1)"><UiIcon name="ArrowUp" :size="20" /></button><button type="button" :disabled="index === visible.length - 1" :aria-label="`Move ${cards[card].title} down`" @click="move(card, 1)"><UiIcon name="ArrowDown" :size="20" /></button></div></div></template>
      </section>
    </AppDialog>
  </div>
</template>

<style scoped>
.home-panels { display: grid; gap: 16px; padding: 18px 0 12px; }
.home-status { margin: 0; font-size: 13px; color: var(--ui-text-muted); }
.home-card { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 20px; }
.home-card__header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 2px 18px; }
.home-card__title { display: flex; align-items: center; gap: 6px; min-height: 44px; color: var(--ui-text); font-weight: 600; text-decoration: none; }
.home-card__title svg { color: var(--ui-text-muted); }
.home-card__controls { display: flex; position: relative; align-items: center; }
button { cursor: pointer; font: inherit; color: var(--ui-text); background: transparent; border: 0; min-width: 44px; min-height: 44px; border-radius: 12px; }
button:hover { background: var(--ui-surface-muted); }
button:disabled { opacity: .35; cursor: default; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.home-card__controls > button, .home-task-check { display: grid; place-items: center; }
.home-card__body { padding: 0 18px 16px; font-size: 15px; line-height: 1.5; }
p { margin: 4px 0; }
.home-muted { color: var(--ui-text-muted); font-size: 14px; }
.home-entry { display: grid; gap: 3px; padding: 9px 0; text-decoration: none; color: var(--ui-text); }
.home-entry + .home-entry { border-top: 1px solid var(--ui-border); }
.home-entry strong { font-size: 14px; font-weight: 500; }
.home-entry span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.home-line { display: flex; gap: 10px; align-items: center; min-height: 44px; color: var(--ui-text); text-decoration: none; }
.home-line > a { color: inherit; text-decoration: none; flex: 1; }
.home-time { min-width: 64px; }
.home-task-check { margin-left: -10px; flex-shrink: 0; color: var(--ui-text-muted); }
.home-done { padding: 6px 0 0 34px; }
.home-address { overflow-wrap: anywhere; }
.home-approval { padding: 10px 0; }
.home-approval strong { font-size: 14px; font-weight: 500; }
.home-actions { display: flex; gap: 8px; margin-top: 6px; }
.home-actions button:first-child { color: var(--ui-accent-strong); background: var(--ui-accent-soft); padding: 0 14px; }
.home-connect { display: flex; align-items: center; gap: 8px; color: var(--ui-accent-strong); font-size: 14px; min-height: 44px; text-decoration: none; }
.home-day { position: relative; display: grid; place-items: center; width: 44px; height: 44px; }
.home-day:focus-within { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.home-day input { position: absolute; inset: 0; width: 44px; opacity: 0; cursor: pointer; }
.home-card__menu { position: absolute; right: 0; top: 44px; z-index: 60; display: grid; width: 200px; padding: 6px; border: 1px solid var(--ui-border); background: var(--ui-surface); border-radius: 14px; box-shadow: 0 8px 30px color-mix(in srgb, var(--ui-text) 10%, transparent); }
.home-card__menu button { text-align: left; padding: 0 12px; }
.home-error { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--ui-text-muted); }
.home-error button { color: var(--ui-accent-strong); }
.home-add { display: inline-flex; align-items: center; justify-self: center; gap: 10px; margin: 4px 0; padding: 6px 16px 6px 6px; border: 1px solid var(--ui-border); border-radius: 30px; background: var(--ui-surface); font-size: 14px; font-weight: 500; }
.home-add__icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--ui-accent-strong); background: var(--ui-accent-soft); }
.home-dialog { width: min(440px, 100%); padding: 20px; border: 1px solid var(--ui-border); border-radius: 20px; background: var(--ui-surface); box-sizing: border-box; }
.home-dialog header, .home-dialog__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.home-dialog h2 { margin: 0; font-size: 20px; }
.home-dialog__row { width: 100%; text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--ui-border); }
.home-dialog__row > div { display: flex; }
</style>
