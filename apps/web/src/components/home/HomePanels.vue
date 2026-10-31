<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, ApiError, API_BASE } from "../../api";
import { useAuthStore } from "../../stores/auth";
import draggable from "vuedraggable";
import HomeWheelChart, { type HomeWheelArea } from "./HomeWheelChart.vue";
import GratitudeCard from "./GratitudeCard.vue";
import AppDialog from "../AppDialog.vue";
import AssistantApprovalDialog from "../AssistantApprovalDialog.vue";
import { useAppToast } from "../../composables/useAppToast";
import UiIcon from "../UiIcon.vue";
import PersonAvatar from "../people/PersonAvatar.vue";
import EmailSenderAvatar from "../email/EmailSenderAvatar.vue";
import PersonSheet from "../people/PersonSheet.vue";
import { useContactsStore } from "../../stores/contacts";
import { ownMissionStatement } from "../../utils/missionStatement";
import { firstName, formatSinceShort, rankHomePeople } from "../../utils/people";
import { HOME_CARDS, HOME_INSIDE_TODAY, emptyHomeLayout, homeDoneToday, homeInboxSoulink, homeMailTime, homeTasksCard, homeTodayTasks, journalPreview, localDateKey, visibleHomeCards, type HomeCard, type HomeLayout, type HomeGoal } from "../../utils/homeSummary";
import { useTodayPlan } from "../../composables/useTodayPlan";
import { useAppLoadingWhile } from "../../composables/useAppLoading";
const emit = defineEmits<{ suggest: [text: string]; approvalResolved: [] }>();
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const auth = useAuthStore();
const contactsStore = useContactsStore();
const storageKey = computed(() => `me3.home.${location.origin}.${API_BASE}.${auth.user?.id || "owner"}`);
const layout = ref<HomeLayout>(emptyHomeLayout());
// Today's tasks and goals come from the shared plan so the daily page and Mission stay in step.
const plan = useTodayPlan();
const { tasks, goals } = plan;
type HomeMail = { id: string; subject: string; fromName?: string; fromAddress?: string; preview?: string; agentSummary?: string; status?: string; unread?: boolean; receivedAt?: string; createdAt?: string; sender?: { name?: string; avatarUrl?: string | null } };
const mail = ref<HomeMail[]>([]);
type HomeBrief = { needsYou: Array<{ messageId: string; sender: { name: string; avatarUrl?: string | null }; subject: string; summary: string; receivedAt: string; unread: boolean }>; loginCodes?: Array<{ messageId: string; sender: { name: string }; code: string; receivedAt: string }>; handled: { total: number }; fyi: { inboxLeft: number; unread: number } };
const brief = ref<HomeBrief | null>(null);
const soulink = ref<{ id: string; direction: string; status?: string; createdAt?: string; textBody?: string; outcome?: string }[]>([]);
// Inbox shows what waits on the owner, nothing else: a sender, when, and the one line that says what.
type InboxRow = { key: string; name: string; avatarUrl?: string | null; soulink?: boolean; time: string; line: string; unread?: boolean; waiting?: boolean; to: string };
const inboxRows = computed<InboxRow[]>(() => {
  const requests = soulink.value.slice(0, 3).map(event => ({ key: event.id, name: "Soulink request", soulink: true, time: homeMailTime(event.createdAt), line: journalPreview(event.textBody || "Request received"), waiting: event.status === "pending_approval", to: "/email" }));
  const room = 3 - requests.length;
  const messages: InboxRow[] = brief.value
    ? brief.value.needsYou.slice(0, room).map(item => ({ key: item.messageId, name: item.sender.name, avatarUrl: item.sender.avatarUrl, time: homeMailTime(item.receivedAt), line: journalPreview(item.summary || item.subject || "(no subject)"), unread: item.unread, to: "/email" }))
    : mail.value.slice(0, room).map(message => ({ key: message.id, name: message.sender?.name || message.fromName || message.fromAddress || message.subject || "New message", avatarUrl: message.sender?.avatarUrl, time: homeMailTime(message.receivedAt || message.createdAt), line: journalPreview(message.agentSummary || message.preview || message.subject || "(no subject)"), unread: message.unread === true, waiting: message.status === "pending_approval", to: "/email?tab=inbox" }));
  return [...requests, ...messages];
});
// Beside the title: a pill when something needs the owner, a quiet note when nothing does.
const inboxStatus = computed(() => {
  if (!brief.value) return { badge: "", note: "" };
  const count = brief.value.needsYou.length + soulink.value.length;
  return count === 0 ? { badge: "", note: "All caught up" } : { badge: `${count} ${count === 1 ? "needs" : "need"} you`, note: "" };
});
async function copyAgentAddress() {
  try { await navigator.clipboard.writeText(agentAddress.value); toastSuccess("Agent email copied"); }
  catch { toastFromUnknown(null, "Couldn't copy the address"); }
}
// A sign-in code that just arrived (Core 0.1.254+), so it is one click from Home instead of three.
async function copyLoginCode(login: { code: string; sender: { name: string } }) {
  try { await navigator.clipboard.writeText(login.code); toastSuccess(`${login.sender.name} code copied`); }
  catch (error) { toastFromUnknown(error, "Couldn't copy the code"); }
}
const approvals = ref<{ id: string; pluginId?: string; title: string; summary?: string | null; payload?: Record<string, unknown> }[]>([]);
const reviewApproval = ref<(typeof approvals.value)[number] | null>(null);
const approvalError = ref("");
const { toastFromUnknown, toastSuccess, toast } = useAppToast();
const events = ref<{ id: string; title: string; start: string; end?: string | null; allDay?: boolean }[]>([]);
const defaultAreas: HomeWheelArea[] = [
  { id: "health", label: "Health", color: "#ff3b30", emoji: "❤️", value: null },
  { id: "spirituality", label: "Spirituality", color: "#34c759", emoji: "🌿", value: null },
  { id: "work", label: "Work", color: "#ff9500", emoji: "💼", value: null },
  { id: "finances", label: "Finances", color: "#ffcc00", emoji: "💰", value: null },
  { id: "home", label: "Home", color: "#007aff", emoji: "🏡", value: null },
  { id: "joy", label: "Joy", color: "#af52de", emoji: "🤗", value: null },
];
const wheel = ref<HomeWheelArea[]>(defaultAreas.map(area => ({ ...area })));
const mission = ref("");
const agentAddress = ref("");
const calendarConnected = ref(false);
const accountsEnabled = ref(false);
const accountSummary = ref<{ income: string; expense: string } | null>(null);
// Resources load per card; tasks and wheel feed Today and Mission rather than cards of their own.
type HomeResource = HomeCard | "tasks" | "wheel";
const errors = ref<Partial<Record<HomeResource, string>>>({});
const loading = ref(true);
useAppLoadingWhile(loading);
const busy = ref<string[]>([]);
const dialog = ref<"add" | null>(null);
const panels = ref<HTMLElement | null>(null);
const unavailable = ref<HomeResource[]>([]);
// Resources that have answered at least once (or failed); until then their card shows a skeleton, as on iOS.
const settled = ref<HomeResource[]>([]);
const cardResources: Partial<Record<HomeCard, HomeResource[]>> = { mission: ["mission", "wheel"] };
const cardPending = (card: HomeCard) => (cardResources[card] ?? [card]).some(id => !settled.value.includes(id));
const offline = ref(!navigator.onLine);
const lastRefresh = ref("");
const orderAnnouncement = ref("");
const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const reducedMotion = ref(motionPreference?.matches ?? false);
function updateMotionPreference() { reducedMotion.value = motionPreference?.matches ?? false; }
defineExpose({ refreshToday: loadToday });
const menu = ref<HomeCard | null>(null);
const day = ref(localDateKey(new Date()));
const cards: Record<HomeCard, { title: string; href: string; emoji: string }> = {
  today: { title: "Today", href: "/journal", emoji: "🗓️" },
  people: { title: "People", href: "/people", emoji: "🫶" },
  gratitude: { title: "Gratitude", href: "/journal", emoji: "🌅" },
  inbox: { title: "Inbox", href: "/email", emoji: "📧" },
  tasks: { title: "Tasks", href: "/tasks", emoji: "✅" },
  mission: { title: "Mission", href: "/mission", emoji: "🚀" },
  accounts: { title: "Accounts", href: "/accounts", emoji: "💰" },
};
// People appears once someone is Close (People v1).
const peopleCard = computed(() => rankHomePeople(contactsStore.contacts, contact => contact.reminderAt));
const openPersonId = ref<string | null>(null);
const openPerson = computed(() => contactsStore.contacts.find(contact => contact.id === openPersonId.value) || null);
const available = computed(() => HOME_CARDS.filter(id => !unavailable.value.includes(id) && (id !== "accounts" || accountsEnabled.value) && (id !== "people" || peopleCard.value.state !== "hidden")));
const visible = computed(() => visibleHomeCards(layout.value).filter(id => available.value.includes(id)));
// Cards already on Home sort first when the sheet opens, then the order holds still,
// so adding one never slides a different tile under the next tap.
const addOrder = ref<HomeCard[]>([]);
watch(dialog, value => {
  if (value === "add") addOrder.value = available.value.filter(id => !HOME_INSIDE_TODAY.includes(id)).sort((a, b) => Number(visible.value.includes(b)) - Number(visible.value.includes(a)));
});
const addCards = computed(() => addOrder.value.filter(id => available.value.includes(id)));
const todayTasks = computed(() => homeTodayTasks(tasks.value));
// Server setting (gratitude_settings.in_today), so it follows the owner across web and the apps.
const gratitudeOn = ref(false);
const showGratitude = computed(() => gratitudeOn.value && !unavailable.value.includes("gratitude"));
// Upcoming events only; an event drops off an hour after it starts.
// Today is the calendar at a glance: finished events fade, the current one is marked, and an
// event without an end counts as an hour long.
function eventState(event: { start: string; end?: string | null; allDay?: boolean }) {
  if (event.allDay) return "";
  const start = new Date(event.start).getTime(); const end = event.end ? new Date(event.end).getTime() : start + 3_600_000; const now = Date.now();
  return end <= now ? "is-past" : start <= now ? "is-now" : "";
}
const todayEvents = computed(() => events.value.slice(0, 6));
const dayOver = computed(() => events.value.length > 0 && events.value.every(event => eventState(event) === "is-past"));
const tomorrowKey = computed(() => { const date = new Date(`${day.value}T12:00:00`); date.setDate(date.getDate() + 1); return localDateKey(date); });
// One line into today's journal page (each day has its own), where tasks are added and ticked off.
const doneToday = computed(() => homeDoneToday(tasks.value));
const tasksLine = computed(() => {
  const open = todayTasks.value.length; const done = doneToday.value; const total = open + done;
  const count = !total ? "" : !open ? "All done" : !done ? `${open} ${open === 1 ? "task" : "tasks"}` : `${open} of ${total} left`;
  return { count, label: total ? `Open today's page. ${open} of ${total} tasks left` : "Open today's page" };
});
// Tasks shows Now, falling back to the top of the backlog; the Tasks page has the tabs and projects.
const tasksCard = computed(() => homeTasksCard(tasks.value));
const missionPage = ref(0);
const missionPages = ["Goals", "Wheel of Life", "Mission"];
// Dragging a pager with a mouse does nothing, so the chevrons take the owner to a page by name.
function goToMissionPage(page: number) {
  const pager = cardElements.get("mission")?.querySelector<HTMLElement>(".home-pager");
  if (!pager || page < 0 || page >= missionPages.length) return;
  pager.scrollTo({ left: page * pager.clientWidth, behavior: reducedMotion.value ? "auto" : "smooth" });
}
function onMissionScroll(event: Event) { const pager = event.currentTarget as HTMLElement; missionPage.value = Math.round(pager.scrollLeft / Math.max(pager.clientWidth, 1)); }
const todayLabel = computed(() => new Date(`${day.value}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }));
async function toggleGratitude() {
  const next = !gratitudeOn.value;
  gratitudeOn.value = next;
  try { await api.patch("/gratitude/settings", { inToday: next }); }
  catch (error) { gratitudeOn.value = !next; toastFromUnknown(error, "Couldn't change Gratitude"); }
}
const activeGoals = computed(() => goals.value.filter(goal => goal.status !== "completed"));
const lowestArea = computed(() => [...wheel.value].filter(area => area.value !== null).sort((a, b) => a.value! - b.value!)[0]);
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
// Dragging the ⋯ reorders with a pointer; Alt+↑ / Alt+↓ on it reorders from the keyboard.
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
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button:not(:disabled),a[role=menuitem]")];
  const index = buttons.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
function dismissMenu(event: PointerEvent) {
  if (!(event.target as HTMLElement).closest(".home-card__menu,.home-card__more")) menu.value = null;
  if (!(event.target as HTMLElement).closest(".home-goal__menu,.home-goal__more,.home-goal-row")) goalMenu.value = "";
}
function reconnect() { offline.value = !navigator.onLine; if (!offline.value) void refresh(); }
function cancelPress() { clearTimeout(pressTimer); pressOrigin = null; }
// Long-press, right-click or ⋯ on a Home goal: the updates people make most, without opening Mission.
const goalMenu = ref("");
const goalPressed = ref(false);
let goalPressTimer: ReturnType<typeof setTimeout> | undefined;
let goalPressOrigin: { x: number; y: number } | null = null;
const goalMenuStyle = ref<Record<string, string>>({});
function openGoalMenu(id: string, event?: Event) {
  const row = (event?.target as HTMLElement | undefined)?.closest(".home-goal-row")?.getBoundingClientRect();
  if (row) goalMenuStyle.value = { top: `${Math.min(row.bottom + 4, window.innerHeight - 200)}px`, left: `${Math.max(8, Math.min(row.right - 220, window.innerWidth - 228))}px` };
  window.addEventListener("scroll", () => { goalMenu.value = ""; }, { once: true, passive: true, capture: true });
  menu.value = null; goalMenu.value = id;
  void nextTick(() => document.querySelector<HTMLElement>(".home-goal__menu [role=menuitem]")?.focus({ preventScroll: true }));
}
function beginGoalPress(event: PointerEvent, id: string) {
  goalPressed.value = false;
  if (event.pointerType === "mouse") return;
  goalPressOrigin = { x: event.clientX, y: event.clientY };
  goalPressTimer = setTimeout(() => { goalPressed.value = true; openGoalMenu(id, event); }, 500);
}
function trackGoalPress(event: PointerEvent) { if (goalPressOrigin && Math.hypot(event.clientX - goalPressOrigin.x, event.clientY - goalPressOrigin.y) > 10) cancelGoalPress(); }
function cancelGoalPress() { clearTimeout(goalPressTimer); goalPressOrigin = null; }
async function updateGoal(id: string, edit: (goal: HomeGoal) => void, undoMessage?: string) {
  goalMenu.value = "";
  try {
    const undo = await plan.changeGoal(id, edit);
    if (undo && undoMessage) toast(undoMessage, { duration: 5000, action: { label: "Undo", onClick: () => { plan.restoreGoal(undo).catch(() => toastFromUnknown(null, "Couldn't undo. Try again.")); } } });
  } catch (error) { toastFromUnknown(error, "Couldn't update that goal. Try again."); void plan.loadGoals(); }
}
const completeGoal = (id: string) => updateGoal(id, goal => { goal.status = "completed"; }, "Goal completed");
const setGoalProgress = (id: string, value: number) => updateGoal(id, goal => { goal.progress = value; });
function focusGoalFromHome(id: string) { goalMenu.value = ""; plan.makeFocus(id).catch(error => toastFromUnknown(error, "Couldn't change your focus. Try again.")); }
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
  } finally {
    if (!disposed && !settled.value.includes(card)) settled.value.push(card);
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
        return [{ id: e.id, title: e.title || `Meeting with ${e.guest_name || "a guest"}`, start: time.toISOString(), end: finish ? new Date(finish).toISOString() : null, allDay: e.allDay }];
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
      // The Brief (Core 0.1.227+): Home shows the same count as the Email page's first screen.
      brief.value = await api.get<HomeBrief>("/mailbox/brief").catch(() => null);
      if (disposed) return;
      agentAddress.value = status.mailbox?.aliasAddress || status.sources?.find(s => s.inboundEnabled)?.address || ""; mail.value = inbox.messages;
      try {
        const result = await api.get<{ recentEvents?: { id: string; direction: string; status?: string; createdAt?: string; textBody?: string; providerEventId?: string }[] }>("/soulink/status");
        if (disposed) return;
        soulink.value = homeInboxSoulink(result.recentEvents || []).map(e => ({ ...e, outcome: result.recentEvents?.find(reply => e.providerEventId && reply.direction === "outbound" && reply.providerEventId === `${e.providerEventId}:reply`)?.textBody }));
      } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    }),
    resource("gratitude", async () => { const state = await api.get<{ settings?: { inToday?: boolean } }>("/gratitude"); if (!disposed) gratitudeOn.value = Boolean(state.settings?.inToday); }),
    resource("people", async () => { await contactsStore.fetchContacts(); if (contactsStore.error) throw new Error(contactsStore.error); }),
    resource("tasks", plan.loadTasks),
    resource("mission", async () => {
      const [data] = await Promise.all([api.get<{ missionStatement?: string }>("/mission-control/dashboard"), plan.loadGoals()]);
      if (!disposed) mission.value = ownMissionStatement(data.missionStatement);
    }),
    resource("wheel", async () => {
      const data = await api.get<{ snapshots: { createdAt: string; segments: HomeWheelArea[] }[]; settings: { segments: HomeWheelArea[] } }>("/journal/wheel");
      if (disposed) return;
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
async function confirm(id: string) {
  if (busy.value.includes(id)) return; busy.value.push(id);
  try { await api.post(`/mission-control/approvals/${encodeURIComponent(id)}`, { decision: "approved" }); approvals.value = approvals.value.filter(a => a.id !== id); delete errors.value.today; }
  catch (error) { toastFromUnknown(error, "Couldn't confirm"); }
  finally { busy.value = busy.value.filter(item => item !== id); }
}
// Dismiss declines it: saved email drafts are assistant proposals, the rest Mission Control approvals.
async function dismiss(approval: (typeof approvals.value)[number]) {
  if (busy.value.includes(approval.id)) return; busy.value.push(approval.id);
  try {
    const path = approval.pluginId === "me3.core" ? `/assistant/approvals/${encodeURIComponent(approval.id)}` : `/mission-control/approvals/${encodeURIComponent(approval.id)}`;
    await api.post(path, { decision: "declined" });
    approvals.value = approvals.value.filter(item => item.id !== approval.id); delete errors.value.today;
    if (approval.pluginId === "me3.core") emit("approvalResolved");
  } catch (error) { toastFromUnknown(error, "Couldn't dismiss"); }
  finally { busy.value = busy.value.filter(id => id !== approval.id); }
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
// A payment card stays open after approval to show the hand-over; the list behind it refreshes.
function paymentResolved() {
  const approval = reviewApproval.value;
  if (approval) approvals.value = approvals.value.filter(item => item.id !== approval.id);
  emit("approvalResolved");
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
    <draggable :model-value="visible" :item-key="(card: HomeCard) => card" class="home-grid" handle=".home-card__more" :animation="reducedMotion ? 0 : 160" :delay="250" :delay-on-touch-only="true" :touch-start-threshold="8" ghost-class="home-card--dragging" @update:model-value="setOrder" @start="menu = null">
      <template #item="{ element: card }: { element: HomeCard }">
        <article :ref="el => setCardElement(card, el)" class="home-card" :aria-label="cards[card].title" @contextmenu.prevent="openMenu(card)" @pointerdown="beginPress($event, card)" @pointermove="trackPress" @pointerup="cancelPress" @pointercancel="cancelPress">
          <header class="home-card__header">
            <RouterLink :to="card === 'today' ? `/calendar?date=${day}` : card === 'tasks' ? `/tasks?view=${tasksCard.view}` : cards[card].href" class="home-card__title"><span class="home-emoji" aria-hidden="true">{{ cards[card].emoji }}</span><span>{{ cards[card].title }}</span></RouterLink>
            <span v-if="card === 'today'" class="home-card__detail">{{ todayLabel }}</span>
            <span v-else-if="card === 'tasks' && tasksCard.tasks.length" class="home-card__detail">{{ tasksCard.view === 'now' ? 'Now' : 'Backlog' }}</span>
            <span v-else-if="card === 'inbox' && inboxStatus.badge" class="home-card__badge">{{ inboxStatus.badge }}</span>
            <span v-else-if="card === 'inbox' && inboxStatus.note" class="home-card__detail">{{ inboxStatus.note }}</span>
            <div class="home-card__controls">
              <button type="button" class="home-card__more" :aria-label="`${cards[card].title} options`" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" aria-haspopup="menu" :aria-expanded="menu === card" title="Options. Drag to reorder." @click="menu === card ? closeMenu(card) : openMenu(card)" @keydown.alt.up.prevent="move(card, -1)" @keydown.alt.down.prevent="move(card, 1)"><UiIcon name="Ellipsis" :size="20" /></button>
            </div>
          </header>
          <!-- Today's menu holds only the Gratitude switch; every card reorders by dragging its ⋯. -->
          <div v-if="menu === card && card === 'today'" class="home-card__menu" role="menu" aria-label="Today options" @keydown.esc.stop.prevent="closeMenu(card)" @keydown="menuKeys">
            <button type="button" role="menuitemcheckbox" :aria-checked="showGratitude" @click="toggleGratitude"><span class="home-emoji home-emoji--menu" aria-hidden="true">🌅</span>Gratitude<span class="home-switch" :class="{ 'is-on': showGratitude }" aria-hidden="true" /></button>
          </div>
          <div v-else-if="menu === card" class="home-card__menu" role="menu" :aria-label="`${cards[card].title} options`" @keydown.esc.stop.prevent="closeMenu(card)" @keydown="menuKeys">
            <button type="button" role="menuitem" class="home-danger" @click="remove(card)"><UiIcon name="X" :size="16" />Remove from Home</button>
          </div>
          <div class="home-card__body">
            <div v-if="cardPending(card)" class="home-skeleton" role="status" aria-label="Loading content"><i /><i /><i /></div>
            <template v-else-if="card === 'today'">
              <div v-for="approval in approvals.slice(0, 3)" :key="approval.id" class="home-approval">
                <span class="home-approval__what"><strong>{{ approval.title }}</strong><span v-if="approval.summary" class="home-muted"> · {{ journalPreview(approval.summary) }}</span></span>
                <button v-if="approval.pluginId === 'me3.core'" type="button" class="home-approval__go" :disabled="busy.includes(approval.id)" @click="reviewApproval = approval; approvalError = ''">Review</button>
                <button v-else type="button" class="home-approval__go" :disabled="busy.includes(approval.id)" @click="confirm(approval.id)">Confirm</button>
                <button type="button" class="home-approval__x" :aria-label="`Dismiss ${approval.title}`" :disabled="busy.includes(approval.id)" @click="dismiss(approval)"><UiIcon name="X" :size="16" /></button>
              </div>
              <!-- The title already opens Calendar, so the empty day is one quiet line. Calendars connect from Settings. -->
              <p v-if="!events.length" class="home-empty-line">{{ calendarConnected ? 'Nothing scheduled' : "Today's events will show here" }}</p>
              <template v-else>
                <RouterLink v-for="event in todayEvents" :key="event.id" :to="`/calendar?date=${day}`" class="home-line home-event" :class="eventState(event)"><span class="home-time">{{ event.allDay ? 'All day' : new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span><i class="home-event__bar" aria-hidden="true" /><span class="home-event__title">{{ event.title }}<template v-if="eventState(event) === 'is-now'"> · now</template></span></RouterLink>
                <p v-if="dayOver" class="home-empty-line">Nothing else today · <RouterLink :to="`/calendar?date=${tomorrowKey}`" aria-label="Open tomorrow in Calendar">Tomorrow</RouterLink></p>
              </template>
              <GratitudeCard v-if="showGratitude" section :active="active" @unavailable="unavailable.push('gratitude')" />
              <RouterLink to="/journal" class="home-tasksline" :aria-label="tasksLine.label">
                <span class="home-emoji" aria-hidden="true">📝</span>
                <strong>Today's page</strong>
                <span v-if="tasksLine.count" class="home-muted">· {{ tasksLine.count }}</span>
                <UiIcon name="ChevronRight" :size="16" class="home-tasksline__go" />
              </RouterLink>
            </template>
            <template v-else-if="card === 'inbox'">
              <button v-for="login in brief?.loginCodes || []" :key="login.messageId" type="button" class="home-copy home-login-code" @click="copyLoginCode(login)">
                <span class="home-login-code__from">{{ login.sender.name }} code · {{ homeMailTime(login.receivedAt) }}</span>
                <strong class="home-login-code__code">{{ login.code }}</strong><UiIcon name="Copy" :size="16" /><span class="sr-only">Copy {{ login.sender.name }} code</span>
              </button>
              <RouterLink v-for="row in inboxRows" :key="row.key" :to="row.to" class="home-inbox-row">
                <span v-if="row.soulink" class="home-inbox-row__icon" aria-hidden="true"><UiIcon name="Sparkles" :size="18" /></span>
                <EmailSenderAvatar v-else :name="row.name" :avatar-url="row.avatarUrl" :size="36" />
                <span class="home-inbox-row__text">
                  <span class="home-inbox-row__top"><strong :class="{ 'is-unread': row.unread }">{{ row.name }}</strong><span class="home-muted home-inbox-row__time">{{ row.time }}</span><i v-if="row.unread" class="home-inbox-row__dot" aria-label="Unread" /></span>
                  <span v-if="row.waiting" class="home-inbox-row__waiting">Waiting on you</span>
                  <span v-else class="home-muted home-inbox-row__line">{{ row.line }}</span>
                </span>
              </RouterLink>
              <template v-if="!inboxRows.length && (!brief || brief.handled.total === 0)">
                <button v-if="agentAddress" type="button" class="home-copy" @click="copyAgentAddress"><span>{{ agentAddress }}</span><UiIcon name="Copy" :size="16" /><span class="sr-only">Copy agent email</span></button>
                <RouterLink v-else to="/settings?section=mailbox" class="home-quiet"><UiIcon name="Plus" :size="16" />Set up agent email</RouterLink>
                <p v-if="!brief" class="home-muted">CC me on any email. I never see your own inbox.</p>
              </template>
            </template>
            <template v-else-if="card === 'tasks'">
              <RouterLink v-for="task in tasksCard.tasks" :key="task.id" :to="`/tasks?view=${tasksCard.view}&task=${encodeURIComponent(task.id)}`" class="home-line home-task"><i class="home-task__dot" aria-hidden="true" /><span class="home-task__title">{{ task.title }}</span></RouterLink>
              <p v-if="!tasksCard.tasks.length" class="home-muted">No open tasks.</p>
            </template>
            <template v-else-if="card === 'mission'">
              <!-- A reminder: goals, then the Wheel, then the mission. Each page opens Mission at the part it shows,
                   ready to edit. Long-press, right-click or the ⋯ on a goal updates it here without leaving Home. -->
              <div class="home-pager" aria-label="Goals, Wheel of Life and mission" @scroll.passive="onMissionScroll">
                <div class="home-page" role="group" aria-label="Goals">
                  <div v-for="goal in activeGoals.slice(0, 3)" :key="goal.id" class="home-goal-row" @contextmenu.prevent.stop="openGoalMenu(goal.id, $event)" @pointerdown.stop="beginGoalPress($event, goal.id)" @pointermove="trackGoalPress" @pointerup="cancelGoalPress" @pointercancel="cancelGoalPress">
                    <RouterLink :to="{ path: '/mission', query: { goal: goal.id } }" class="home-goal" :aria-label="`${goal.title}, ${goal.progress || 0} percent. Open in Mission`" @click="goalPressed && $event.preventDefault()"><span aria-hidden="true">{{ areaFor(goal.areaId)?.emoji || '🎯' }}</span><span class="home-goal__text">{{ goal.title }}<span class="home-progress" aria-hidden="true"><i :style="{ width: `${goal.progress || 0}%` }" /></span></span><span class="home-muted home-goal__pc">{{ goal.progress || 0 }}%</span></RouterLink>
                    <button type="button" class="home-goal__more" :aria-label="`Update ${goal.title}`" aria-haspopup="menu" :aria-expanded="goalMenu === goal.id" @click="goalMenu === goal.id ? goalMenu = '' : openGoalMenu(goal.id, $event)"><UiIcon name="Ellipsis" :size="18" /></button>
                  </div>
                  <RouterLink v-if="activeGoals.length > 3" :to="{ path: '/mission', query: { focus: 'goals' } }" class="home-muted home-goal__more-link">{{ activeGoals.length - 3 }} more in Mission</RouterLink>
                  <RouterLink v-if="!activeGoals.length" :to="{ path: '/mission', query: { focus: 'goals' } }" class="home-muted home-goal__more-link">No goals yet. Add one in Mission.</RouterLink>
                </div>
                <RouterLink :to="{ path: '/mission', query: { focus: 'check-in' } }" class="home-page" aria-label="Wheel of Life. Check in">
                  <div v-if="lowestArea" class="home-wheel"><HomeWheelChart :areas="wheel" :selected="lowestArea.id" /><div class="home-wheel-summary"><strong><span aria-hidden="true">{{ lowestArea.emoji }}</span> {{ lowestArea.label }}</strong><span class="home-wheel-score">{{ lowestArea.value }}<small>/ 10</small></span><span class="home-muted">Your lowest area</span></div></div>
                  <p v-else class="home-muted">How are you doing across the areas of your life? Tap to check in.</p>
                </RouterLink>
                <RouterLink :to="{ path: '/mission', query: { focus: 'statement' } }" class="home-page home-page--mission"><p class="home-mission" :class="{ 'home-muted': !mission }">{{ mission || 'What do you want your life built around?' }}</p></RouterLink>
              </div>
              <!-- The pager clips its pages, so the goal menu sits outside it, under the goal it belongs to. -->
              <Teleport to="body">
                <template v-for="goal in activeGoals.filter(item => item.id === goalMenu)" :key="goal.id">
                  <div class="home-card__menu home-goal__menu" role="menu" :aria-label="`Update ${goal.title}`" :style="goalMenuStyle" @keydown.esc.stop.prevent="goalMenu = ''" @keydown="menuKeys">
                    <button type="button" role="menuitem" @click="completeGoal(goal.id)"><UiIcon name="CircleCheck" :size="16" />Complete</button>
                    <div class="home-goal__progress" role="group" aria-label="Set progress"><span>Progress</span><button v-for="value in [25, 50, 75]" :key="value" type="button" role="menuitem" :aria-pressed="(goal.progress || 0) === value" @click="setGoalProgress(goal.id, value)">{{ value }}%</button></div>
                    <button v-if="goal.id !== activeGoals[0]?.id" type="button" role="menuitem" @click="focusGoalFromHome(goal.id)"><UiIcon name="Star" :size="16" />Make focus</button>
                    <RouterLink role="menuitem" :to="{ path: '/mission', query: { goal: goal.id } }" class="home-goal__edit"><UiIcon name="Pencil" :size="16" />Edit…</RouterLink>
                  </div>
                </template>
              </Teleport>
              <div class="home-pager-nav">
                <button type="button" class="home-pager-nav__go" :aria-label="missionPage > 0 ? `Show ${missionPages[missionPage - 1]}` : 'Previous'" :disabled="missionPage === 0" @click="goToMissionPage(missionPage - 1)"><UiIcon name="ChevronLeft" :size="18" /></button>
                <div class="home-pager-dots" aria-hidden="true"><i v-for="index in 3" :key="index" :class="{ 'is-on': missionPage === index - 1 }" /></div>
                <button type="button" class="home-pager-nav__go" :aria-label="missionPage < missionPages.length - 1 ? `Show ${missionPages[missionPage + 1]}` : 'Next'" :disabled="missionPage === missionPages.length - 1" @click="goToMissionPage(missionPage + 1)"><UiIcon name="ChevronRight" :size="18" /></button>
              </div>
            </template>
            <template v-else-if="card === 'accounts'"><div v-if="accountSummary" class="home-stats"><div><span class="home-muted">Income this month</span><strong>{{ accountSummary.income }}</strong></div><div><span class="home-muted">Expenses this month</span><strong>{{ accountSummary.expense }}</strong></div></div><RouterLink v-else to="/accounts" class="home-quiet">Open Accounts<UiIcon name="ArrowRight" :size="16" /></RouterLink></template>
            <template v-else-if="card === 'people'"><template v-if="peopleCard.state === 'people'"><button v-for="person in peopleCard.people" :key="person.id" type="button" class="home-person" @click="openPersonId = person.id"><PersonAvatar :contact="person" :size="40" /><strong>{{ firstName(person.name) }}</strong><span class="home-muted home-person__since">{{ formatSinceShort(person.lastInTouchAt) || 'Not yet' }}</span></button></template><p v-else class="home-muted">All caught up.</p></template>
          </div>
        </article>
      </template>
    </draggable>
    <button type="button" class="home-add" @click="dialog = 'add'"><UiIcon name="Plus" :size="26" /><span>Add to Home</span></button>
    <AppDialog :open="dialog !== null" aria-label="Add to Home" @close="dialog = null">
      <section class="home-dialog"><header><h2>Add to Home</h2><button type="button" aria-label="Close Home editor" @click="dialog = null"><UiIcon name="X" :size="20" /></button></header>
        <div v-if="dialog === 'add'" class="home-add-grid"><button v-for="card in addCards" :key="card" type="button" :aria-label="cards[card].title" :aria-pressed="visible.includes(card)" class="home-add-tile" @click="visible.includes(card) ? remove(card) : add(card)"><span class="home-emoji" aria-hidden="true">{{ cards[card].emoji }}</span><span>{{ cards[card].title }}</span><UiIcon v-if="visible.includes(card)" name="CircleCheck" :size="17" class="home-add-tile__check" /></button></div>
      </section>
    </AppDialog>
    <PersonSheet :contact="openPerson" @close="openPersonId = null" />
    <AssistantApprovalDialog :approval="reviewApproval" :busy="Boolean(reviewApproval && busy.includes(reviewApproval.id))" :error="approvalError" @close="reviewApproval = null" @decide="decideCoreApproval" @resolved="paymentResolved" />
  </div>
</template>

<style scoped>
/* The 16px gutter sits inside the scroller so card shadows have room instead of being clipped at its edges. */
.home-panels { padding: 18px 16px 120px; }
.home-grid { display: grid; grid-template-columns: minmax(0, 1fr); row-gap: 16px; width: min(620px, 100%); margin: 0 auto; align-items: start; }
.home-offline { width: min(1120px, 100%); margin: 0 auto 12px; font-size: 14px; color: var(--ui-text-muted); }
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
.home-card__badge { padding: 3px 8px; border-radius: 999px; background: var(--ui-accent-soft); color: var(--ui-accent-strong); font-size: 12px; font-weight: 600; white-space: nowrap; }
.home-card__controls { display: flex; margin-left: auto; }
button { cursor: pointer; font: inherit; color: var(--ui-text); background: transparent; border: 0; min-width: 44px; min-height: 44px; border-radius: 12px; }
button:hover { background: var(--ui-surface-muted); }
button:disabled { opacity: .35; cursor: default; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.home-card__controls > button { display: grid; place-items: center; width: 36px; min-width: 36px; }
.home-card__more { cursor: grab; touch-action: none; }
.home-card__more:active { cursor: grabbing; }
@media (hover: hover) and (pointer: fine) {
  .home-card__controls { opacity: 0; }
  .home-card:hover .home-card__controls, .home-card:focus-within .home-card__controls { opacity: 1; }
}
.home-card__body { padding: 0 18px 16px; font-size: 15px; line-height: 1.45; }
.home-skeleton { display: grid; gap: 12px; padding: 4px 0 2px; }
.home-skeleton i { display: block; height: 24px; border-radius: 8px; background: color-mix(in srgb, var(--ui-text) 8%, transparent); animation: home-skeleton-pulse 1.4s ease-in-out infinite; }
.home-skeleton i:first-child { height: 42px; }
.home-skeleton i:last-child { width: 62%; }
@keyframes home-skeleton-pulse { 50% { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) { .home-skeleton i { animation: none; } }
p { margin: 4px 0; }
.home-muted { color: var(--ui-text-muted); font-size: 14px; }
.home-inbox-row { display: flex; align-items: flex-start; gap: 12px; min-width: 0; min-height: 44px; padding: 8px 0; color: var(--ui-text); text-decoration: none; }
.home-inbox-row__icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--ui-accent-soft); color: var(--ui-accent-strong); }
.home-inbox-row__text { display: grid; flex: 1; gap: 2px; min-width: 0; }
.home-inbox-row__top { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.home-inbox-row__top strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.home-inbox-row__top strong.is-unread { font-weight: 700; }
.home-inbox-row__time { flex: none; font-size: 12px; }
.home-inbox-row__dot { flex: none; align-self: center; width: 8px; height: 8px; border-radius: 50%; background: var(--ui-accent); }
.home-inbox-row__line, .home-inbox-row__waiting { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.home-inbox-row__waiting { color: var(--ui-accent-strong); font-weight: 600; }
.home-copy { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 0 12px; border-radius: 12px; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-size: 14px; }
.home-copy > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-login-code { display: flex; width: 100%; min-height: 44px; margin-bottom: 4px; }
.home-login-code__from { flex: 1; min-width: 0; text-align: left; }
.home-login-code__code { color: var(--ui-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 17px; letter-spacing: 0.08em; }
.home-person { display: flex; gap: 12px; align-items: center; width: 100%; min-height: 52px; padding: 0; border: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 16px; text-align: left; cursor: pointer; }
.home-person__since { margin-left: auto; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.home-line { display: flex; gap: 8px; align-items: center; min-height: 40px; color: var(--ui-text); text-decoration: none; }
.home-line > a { color: inherit; text-decoration: none; flex: 1; min-width: 0; }
.home-event { min-height: 32px; }
.home-event > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-time { min-width: 50px; font-variant-numeric: tabular-nums; }
.home-task-check { display: grid; place-items: center; min-width: 36px; width: 36px; margin-left: -8px; flex-shrink: 0; color: var(--ui-text-muted); }
.home-approval { display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 2px 0 12px; margin: 2px 0 6px; background: var(--ui-accent-soft); border-radius: 14px; font-size: 14px; }
.home-approval__what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-approval__go { min-width: 0; min-height: 32px; padding: 0 12px; border-radius: 999px; background: var(--ui-primary); color: var(--ui-primary-contrast); font-size: 13px; font-weight: 600; }
.home-approval__x { display: grid; place-items: center; min-width: 36px; color: var(--ui-text-muted); }
.home-event { display: grid; grid-template-columns: 48px 3px minmax(0, 1fr); gap: 10px; align-items: center; min-height: 34px; color: var(--ui-text); text-decoration: none; }
.home-event__bar { height: 18px; border-radius: 3px; background: var(--ui-accent); }
.home-event__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-event.is-past { opacity: .45; }
.home-event.is-now, .home-event.is-now .home-time { color: var(--ui-accent); font-weight: 600; }
.home-empty-line { min-height: 36px; display: flex; align-items: center; gap: 4px; margin: 0; color: var(--ui-text-muted); font-size: 14px; }
.home-empty-line a { color: var(--ui-accent); font-weight: 600; text-decoration: none; }
.home-tasksline { display: flex; align-items: center; gap: 8px; min-height: 40px; margin-top: 6px; padding: 0 12px; border-radius: 12px; background: var(--ui-surface-muted); color: var(--ui-text); font-size: 14px; text-decoration: none; }
.home-tasksline strong { font-weight: 600; }
.home-tasksline__go { margin-left: auto; color: var(--ui-text-muted); }
.home-tasksline .home-emoji { font-size: 16px; }
.home-task { min-height: 36px; }
.home-task__dot { flex: none; width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--ui-text-muted); }
.home-task__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-pager { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.home-pager::-webkit-scrollbar { display: none; }
.home-page { flex: 0 0 100%; min-height: 150px; display: flex; flex-direction: column; justify-content: center; scroll-snap-align: start; color: var(--ui-text); text-decoration: none; }
.home-page--mission { align-items: center; }
/* The pager clips overflow, so an outset focus ring would show only as a stray line at one edge. */
.home-page:focus-visible { outline-offset: -2px; border-radius: 16px; }
.home-goal-row { position: relative; display: flex; align-items: center; gap: 4px; -webkit-touch-callout: none; user-select: none; }
.home-goal { display: flex; flex: 1; align-items: flex-start; gap: 10px; min-width: 0; padding: 5px 0; color: var(--ui-text); font-size: 15px; line-height: 1.35; text-decoration: none; }
.home-goal__more { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text-muted); cursor: pointer; opacity: 0; }
.home-goal-row:hover .home-goal__more, .home-goal-row:focus-within .home-goal__more, .home-goal__more[aria-expanded="true"] { opacity: 1; }
@media (hover: none) { .home-goal__more { display: none; } }
.home-goal__menu { position: fixed; right: auto; width: 220px; }
.home-goal__menu .home-goal__edit { display: flex; gap: 10px; align-items: center; min-height: 44px; padding: 0 12px; color: var(--ui-text); font-size: 14px; text-decoration: none; }
.home-goal__progress { display: flex; align-items: center; gap: 4px; padding: 0 6px 0 12px; font-size: 14px; }
.home-goal__progress span { flex: 1; }
.home-goal__progress button { min-width: 44px; min-height: 36px; padding: 0 6px !important; justify-content: center; border-radius: 10px; }
.home-goal__progress button[aria-pressed="true"] { background: var(--ui-accent-soft); }
.home-goal__more-link { display: block; padding: 6px 0; font-size: 13px; text-decoration: none; }
.home-goal__text { flex: 1; min-width: 0; display: grid; gap: 6px; }
.home-goal__pc { font-size: 13px; font-variant-numeric: tabular-nums; }
.home-pager-nav { display: flex; align-items: center; justify-content: center; gap: 6px; padding-top: 6px; }
.home-pager-nav__go { display: grid; place-items: center; min-width: 32px; min-height: 32px; width: 32px; height: 32px; padding: 0; border-radius: 50%; color: var(--ui-text-muted); }
.home-pager-nav__go:disabled { opacity: 0; cursor: default; }
/* Touch swipes the pager; the chevrons are for a mouse. */
@media (hover: none) { .home-pager-nav__go { display: none; } }
.home-pager-dots { display: flex; justify-content: center; gap: 6px; }
.home-pager-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-surface-muted); }
.home-pager-dots i.is-on { background: var(--ui-text); }
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
.home-mission { margin: 8px 6px; font-family: var(--font-serif, Georgia, serif); font-size: 22px; font-weight: 500; line-height: 1.4; text-align: center; }
.home-progress { display: block; height: 4px; border-radius: 4px; background: var(--ui-surface-muted); }
.home-progress i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); }
.home-wheel { display: flex; align-items: center; gap: 18px; padding: 6px 0; }
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
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 640px) {
  .home-card__controls > button { min-width: 44px; width: 44px; }
  .home-card__header { flex-wrap: wrap; gap: 0 6px; }
  .home-wheel { gap: 10px; }
  .home-dialog { width: 100%; border-radius: 28px 28px 0 0; padding: 16px; }
  .home-dialog footer { flex-wrap: wrap; }
}
</style>
