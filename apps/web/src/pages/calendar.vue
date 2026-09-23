<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRouter } from "vue-router";
import CalendarAgenda from "../components/calendar/CalendarAgenda.vue";
import DatePickerPopover from "../components/calendar/DatePickerPopover.vue";
import CalendarMiniMonth from "../components/calendar/CalendarMiniMonth.vue";
import CalendarMonthBoard from "../components/calendar/CalendarMonthBoard.vue";
import CalendarWeekBoard from "../components/calendar/CalendarWeekBoard.vue";
import CalendarEventPopover from "../components/calendar/CalendarEventPopover.vue";
import CalendarQuickEventPopover from "../components/calendar/CalendarQuickEventPopover.vue";
import { calendarEventEndOneHourAfter } from "../components/calendar/calendarEventForm";
import AppDialog from "../components/AppDialog.vue";
import Button from "../components/Button.vue";
import PageLoading from "../components/PageLoading.vue";
import UiIcon from "../components/UiIcon.vue";
import type { UiIconName } from "../utils/icons";
import BookingAvailabilityEditor, {
  type BookingAvailability,
} from "../components/booking/BookingAvailabilityEditor.vue";
import { useAppToast } from "../composables/useAppToast";
import type {
  CalendarAgendaEvent,
  CalendarRangeMode,
} from "../components/calendar/calendarAgenda";
import { calendarActivityDateKeys } from "../components/calendar/calendarAgenda";
import type {
  CalendarContextAnchor,
  CalendarWeekSlot,
} from "../components/calendar/calendarWeek";
import { ApiError, api } from "../api";
import { useSitesStore, type SiteContent } from "../stores/sites";
import {
  instantToLocalDateTimeParts,
  resolveLocalDateTimeToUtc,
} from "../utils/timezone";

definePage({
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    requiresPlugin: "me3.calendar",
    title: "Calendar | ME3",
    description:
      "View bookings, reminders, events, tasks, social Publications, and imported calendars across your ME3 workspace.",
    robots: "noindex,follow",
  },
});

interface CalendarBookingRow {
  id: string;
  meeting_url?: string | null;
  meeting_host_url?: string | null;
  site_id: string;
  username: string;
  guest_name: string;
  guest_email: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  calendar_event_id: string | null;
  status: "confirmed" | "cancelled";
  notes: string | null;
  created_at: string;
  cancelled_at: string | null;
  payment_intent_id: string | null;
  amount_paid: number | null;
  suggested_amount: number | null;
  currency:
    | "usd"
    | "gbp"
    | "eur"
    | "cad"
    | "aud"
    | "chf"
    | "sgd"
    | "inr"
    | "pkr"
    | null;
  payment_status: "pending" | "succeeded" | "failed" | "not_required" | null;
  is_free_booking: number;
  paid_at: string | null;
}

interface CalendarReminderRow {
  id: string;
  title: string;
  notes: string | null;
  remindAt: string;
  timezone: string | null;
  recurrenceRule: string | null;
  contextType: "contact" | "booking" | null;
  contextId: string | null;
  contextLabel: string | null;
  status: "pending" | "delivered" | "dismissed" | "cancelled" | "failed";
  deliveredAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

interface CalendarEventRow {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string | null;
  allDay: boolean;
  kind?: "event" | "birthday";
  recurrenceRule?: string | null;
  sourceId: string | null;
  sourceName: string;
  sourceKind: "native" | "imported";
  createdAt: string;
}

interface CalendarSourceRow {
  id: string;
  name: string;
  kind: "ics_upload" | "ics_url";
  originalFilename: string | null;
  sourceUrlHint: string | null;
  importedEventCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
}

interface CalendarTaskRow {
  id: string;
  title: string;
  description: string | null;
  status: "backlog" | "in_progress" | "done";
  priority: number;
  dueAt: string | null;
  scheduledFor: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string | null;
  allDay: boolean;
  dateSource: "scheduled_for" | "due_at";
  projectId: string | null;
  projectName: string;
  projectColor: string | null;
  projectIcon: string | null;
  sourceKind: string;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface CalendarSocialPublicationRow {
  id: string;
  siteId: string;
  postId: string;
  postTitle: string;
  versionId: string;
  versionLabel: string;
  platform: "x" | "linkedin" | "instagram" | "instagram_business";
  accountId: string | null;
  accountLabel: string;
  publicationStatus: "scheduled" | "queued" | "publishing" | "published" | "failed";
  calendarState: "planned" | "publishing" | "published" | "failed" | "needs_attention";
  sourceType: string;
  sourceRef: string | null;
  sourceLabel: string;
  displayAt: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  timezone: string | null;
  platformPostUrl: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

interface ApprovedPostVersionScheduleOption {
  versionId: string;
  postId: string;
  siteId: string;
  postTitle: string;
  versionLabel: string;
  platform: CalendarSocialPublicationRow["platform"];
  accountId: string;
  accountLabel: string;
  sourceLabel: string;
  approvedAt: string;
}

interface CalendarSocialPublishingFeed {
  ready: boolean;
  publications: CalendarSocialPublicationRow[];
}

interface CalendarSiteOption {
  value: string;
  label: string;
  source?: CalendarSourceRow;
}

interface CalendarFeedResponse {
  bookings: CalendarBookingRow[];
  reminders: CalendarReminderRow[];
  events: CalendarEventRow[];
  importedEvents: CalendarEventRow[];
  sources: CalendarSourceRow[];
  tasks: CalendarTaskRow[];
  socialPublishing?: CalendarSocialPublishingFeed;
}

type CreateMode =
  | "booking"
  | "reminder"
  | "event"
  | "birthday"
  | "social"
  | "import"
  | null;
type QuickCreateMode = Exclude<CreateMode, "import" | null>;

const PERSONAL_EVENTS_KEY = "__events__";
const BIRTHDAYS_KEY = "__birthdays__";
const REMINDERS_KEY = "__reminders__";
const PROJECT_TASKS_KEY = "__project_tasks__";
const SOCIAL_PUBLISHING_KEY = "__social_publishing__";
const CALENDAR_VISIBILITY_STORAGE_KEY = "me3:calendar:hidden-sources";
const SCHEDULE_WINDOW_INCREMENT_DAYS = 60;
const SCHEDULE_MAX_WINDOW_DAYS = 365;
const QUICK_CREATE_MODES: QuickCreateMode[] = [
  "event",
  "social",
  "birthday",
  "reminder",
  "booking",
];
const QUICK_CREATE_LABELS: Record<QuickCreateMode, string> = {
  event: "Event",
  social: "Social Publication",
  birthday: "Birthday",
  reminder: "Reminder",
  booking: "Booking",
};
const router = useRouter();
const sites = useSitesStore();
const bookings = ref<CalendarBookingRow[]>([]);
const reminders = ref<CalendarReminderRow[]>([]);
const events = ref<CalendarEventRow[]>([]);
const importedEvents = ref<CalendarEventRow[]>([]);
const sources = ref<CalendarSourceRow[]>([]);
const tasks = ref<CalendarTaskRow[]>([]);
const socialPublishingReady = ref(false);
const socialPublications = ref<CalendarSocialPublicationRow[]>([]);
const visibleQuickCreateModes = computed(() =>
  QUICK_CREATE_MODES.filter(
    (mode) => mode !== "social" || socialPublishingReady.value,
  ),
);
const loading = ref(false);
const calendarLoaded = ref(false);
const error = ref("");
const updatingReminderId = ref<string | null>(null);
const cancellingBookingId = ref<string | null>(null);
const deletingEventId = ref<string | null>(null);
const removingSourceId = ref<string | null>(null);
const removingImportedEventId = ref<string | null>(null);
const addingImportedBirthdayId = ref<string | null>(null);
const { toastSuccess, toastFromUnknown } = useAppToast();
let calendarLoadToken = 0;
let calendarLoadController: AbortController | null = null;
let calendarPickerLoadToken = 0;
let calendarPickerLoadController: AbortController | null = null;
/** Matches `.cal-shell` stacked layout at `max-width: 1100px`. */
const CALENDAR_COMPACT_MAX_WIDTH_PX = 1100;

const rangeMode = ref<CalendarRangeMode>("month");
const monthCursor = ref(new Date());
const dayCursor = ref(new Date());
const scheduleWindowDays = ref(SCHEDULE_WINDOW_INCREMENT_DAYS);
const activeCreateMode = ref<CreateMode>(null);
const compactEventCreate = ref(false);
const showCreateMenu = ref(false);
const showSettingsMenu = ref(false);
const calendarsDialogOpen = ref(false);
const calendarPickerOpen = ref(false);
const calendarPickerMonth = ref(monthKeyFromDate(new Date()));
const calendarPickerEvents = ref<CalendarAgendaEvent[]>([]);
const quickCreateDayKey = ref<string | null>(null);
const boardContextAnchor = ref<CalendarContextAnchor | null>(null);
const quickWeekSlot = ref<CalendarWeekSlot | null>(null);
const availabilityModalOpen = ref(false);
const availabilityLoading = ref(false);
const availabilitySaving = ref(false);
const availabilityError = ref("");
const availabilitySiteUsername = ref("");
const availabilitySourceProfile = ref<Record<string, unknown> | null>(null);
const availabilityDraft = ref<BookingAvailability>(defaultBookingAvailability());
const availabilityBufferTime = ref(0);
const availabilityTimezone = ref("UTC");

function startOfWeekMonday(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

function monthGridWindow(from: Date): { start: Date; end: Date } {
  const year = from.getFullYear();
  const month = from.getMonth();
  const first = new Date(year, month, 1);
  const start = startOfWeekMonday(first);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rowCount = Math.ceil((lead + daysInMonth) / 7);
  const end = new Date(start);
  end.setDate(start.getDate() + rowCount * 7);
  return { start, end };
}

function datePickerWindow(month: string): { start: Date; end: Date } | null {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return null;
  const start = startOfWeekMonday(new Date(year, monthNumber - 1, 1));
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  return { start, end };
}

const focusedDayKey = ref<string | null>(null);
const preferSelectEventId = ref<string | null>(null);
const hiddenCalendarKeys = ref<string[]>([]);
const boardHighlightId = ref("");
const transientHighlightId = ref("");
const isCompactCalendar = ref(false);
let mobileMediaQuery: MediaQueryList | null = null;
let transientHighlightTimer: ReturnType<typeof setTimeout> | null = null;
let calendarVisibilityHydrated = false;

const todayDayKey = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

const monthToolbarTitle = computed(() =>
  new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(monthCursor.value),
);

const weekStart = computed(() => startOfWeekMonday(monthCursor.value));

const weekToolbarTitle = computed(() => {
  const start = weekStart.value;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
  const dayMonth = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  });
  const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  ) {
    return `${day.format(start)}–${dayMonthYear.format(end)}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${dayMonth.format(start)}–${dayMonthYear.format(end)}`;
  }
  return `${dayMonthYear.format(start)}–${dayMonthYear.format(end)}`;
});

const dayToolbarTitle = computed(() =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dayCursor.value),
);

const miniCalendarCursor = computed(() =>
  rangeMode.value === "day"
    ? dayCursor.value
    : monthCursor.value,
);

const rangeLabel = computed(() => {
  if (rangeMode.value === "schedule") return "Schedule";
  if (rangeMode.value === "day") return "Day";
  if (rangeMode.value === "week") return "Week";
  return "Month";
});

const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const defaultFormTimeZone = resolvedTimeZone || "UTC";
const timeZoneOptions = resolvedTimeZone
  ? { timeZone: resolvedTimeZone }
  : ({} as Intl.DateTimeFormatOptions);

const newBookingSubmitting = ref(false);
const newBookingError = ref("");
const newBookingForm = ref({
  username: "",
  guestName: "",
  guestEmail: "",
  date: "",
  startTime: "09:00",
  durationMinutes: 30,
  notes: "",
});

const newReminderSubmitting = ref(false);
const newReminderError = ref("");
const newReminderForm = ref({
  title: "",
  date: "",
  time: "",
  timezone: defaultFormTimeZone,
  recurrence: "none",
  notes: "",
});
const editingReminderId = ref<string | null>(null);

const newEventSubmitting = ref(false);
const newEventError = ref("");
const newEventForm = ref({
  title: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  timezone: defaultFormTimeZone,
  allDay: false,
  recurrence: "none",
  customInterval: 1,
  customUnit: "day" as "day" | "week" | "month" | "year",
  customEnd: "never" as "never" | "on" | "after",
  customUntilDate: "",
  customCount: 30,
  location: "",
  notes: "",
});
const editingEventId = ref<string | null>(null);

const socialScheduleOptions = ref<ApprovedPostVersionScheduleOption[]>([]);
const socialScheduleLoading = ref(false);
const socialScheduleSubmitting = ref(false);
const socialScheduleCancelling = ref(false);
const socialScheduleError = ref("");
const reschedulingPublicationId = ref<string | null>(null);
const socialScheduleForm = ref({
  versionId: "",
  date: "",
  time: "",
  timezone: defaultFormTimeZone,
  expectedUpdatedAt: "",
});

const reschedulingSocialPublication = computed(() =>
  reschedulingPublicationId.value
    ? socialPublications.value.find(
        (publication) => publication.id === reschedulingPublicationId.value,
      ) || null
    : null,
);

const selectedSocialScheduleOption = computed(() =>
  socialScheduleOptions.value.find(
    (option) => option.versionId === socialScheduleForm.value.versionId,
  ) || null,
);

const newBirthdayForm = ref({
  name: "",
  date: "",
  notes: "",
});

const importSubmitting = ref(false);
const importError = ref("");
const importForm = ref({
  mode: "url" as "url" | "file",
  name: "",
  url: "",
  file: null as File | null,
});

const importSubmitLabel = computed(() => {
  if (importSubmitting.value) {
    return importForm.value.mode === "url" ? "Syncing..." : "Importing...";
  }
  return importForm.value.mode === "url" ? "Sync calendar" : "Import calendar";
});

const calendarWindow = computed(() => {
  if (rangeMode.value === "day") {
    const start = new Date(dayCursor.value);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  const c = monthCursor.value;
  if (rangeMode.value === "week") {
    const start = startOfWeekMonday(c);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }
  if (rangeMode.value === "schedule") {
    const start = new Date(c);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (
      start.getFullYear() === today.getFullYear() &&
      start.getMonth() === today.getMonth() &&
      start < today
    ) {
      start.setTime(today.getTime());
    }
    const end = new Date(start);
    end.setDate(end.getDate() + scheduleWindowDays.value);
    return { start, end };
  }
  return monthGridWindow(c);
});

const scheduleToolbarTitle = computed(() => {
  const { start, end } = calendarWindow.value;
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: start.getFullYear() === lastDay.getFullYear() ? undefined : "numeric",
  });
  const lastFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(start)} – ${lastFormatter.format(lastDay)}`;
});

const canLoadMoreSchedule = computed(
  () => scheduleWindowDays.value < SCHEDULE_MAX_WINDOW_DAYS,
);

const dayKeyFormatter = computed(
  () =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...timeZoneOptions,
    }),
);

const calendarWindowStartDayKey = computed(() =>
  dayKeyFormatter.value.format(calendarWindow.value.start),
);

const calendarWindowEndDayKey = computed(() =>
  dayKeyFormatter.value.format(calendarWindow.value.end),
);

const quickCreateDateLabel = computed(() => {
  if (!quickCreateDayKey.value) return "your calendar";
  const [year, month, day] = quickCreateDayKey.value.split("-").map(Number);
  if (!year || !month || !day) return "your calendar";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, day));
});

const quickCreateTitle = computed(() => `Add to ${quickCreateDateLabel.value}`);

const quickCreateHeading = computed(() => {
  const mode = activeCreateMode.value;
  if (mode === "social" && reschedulingPublicationId.value) {
    return "Reschedule Publication";
  }
  if ((editingEventId.value || editingReminderId.value) && isQuickCreateMode(mode)) {
    return `Edit ${QUICK_CREATE_LABELS[mode].toLowerCase()}`;
  }
  return quickCreateTitle.value;
});

const activeToolbarTitle = computed(() => {
  if (rangeMode.value === "schedule") return scheduleToolbarTitle.value;
  if (rangeMode.value === "day") return dayToolbarTitle.value;
  if (rangeMode.value === "week") return weekToolbarTitle.value;
  return monthToolbarTitle.value;
});

const mobileToolbarTitle = computed(() => activeToolbarTitle.value);

const calendarPickerSelectedDate = computed(() => {
  if (rangeMode.value === "day") return dayKeyFormatter.value.format(dayCursor.value);
  if (focusedDayKey.value) return focusedDayKey.value;
  if (rangeMode.value === "week") {
    return dayKeyFormatter.value.format(monthCursor.value);
  }
  return null;
});

const mobileRangeCycleLabel = computed(() => {
  const nextMode = nextCycleRangeMode();
  return `Switch to ${nextMode === "schedule" ? "Schedule" : "Month"} view`;
});

const mobileRangeIcon = computed<UiIconName>(() => {
  if (rangeMode.value === "schedule") return "List";
  return "CalendarDays";
});

const focusedAgendaDayKey = computed(() => {
  if (rangeMode.value !== "day") return focusedDayKey.value;
  return dayKeyFormatter.value.format(dayCursor.value);
});

function formatReminderRecurrence(rule: string): string {
  const normalized = rule.trim().toLowerCase();
  if (normalized === "daily") return "Daily";
  if (normalized.startsWith("weekly:")) {
    return `Weekly on ${normalized.slice("weekly:".length).replace(/,/g, ", ")}`;
  }
  if (normalized.startsWith("biweekly:")) {
    return `Every other ${normalized.slice("biweekly:".length)}`;
  }
  if (normalized.startsWith("monthly:")) {
    return `Monthly on day ${normalized.slice("monthly:".length)}`;
  }
  return rule;
}

function formatEventRecurrence(rule: string | null | undefined): string {
  if (rule === "daily") return "Daily";
  if (rule?.startsWith("weekly:")) {
    return `Weekly on ${rule.slice("weekly:".length).replace(/,/g, ", ")}`;
  }
  if (rule?.startsWith("monthly:")) {
    return `Monthly on day ${rule.slice("monthly:".length)}`;
  }
  if (rule === "yearly") return "Yearly";
  const custom = parseCustomEventRecurrence(rule);
  if (custom) {
    const unit = custom.interval === 1 ? custom.unit : `${custom.unit}s`;
    const suffix = custom.until
      ? ` until ${custom.until}`
      : custom.count
        ? ` for ${custom.count} occurrences`
        : "";
    return `Every ${custom.interval} ${unit}${suffix}`;
  }
  return rule || "";
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    ...timeZoneOptions,
  }).format(new Date(value));
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...timeZoneOptions,
  }).format(new Date(value));
}

function formatTaskStatus(task: Pick<CalendarTaskRow, "archivedAt" | "status">): string {
  if (task.archivedAt) return "Archived";
  if (task.status === "in_progress") return "Doing";
  if (task.status === "done") return "Done";
  return "Backlog";
}

function formatTaskPriority(priority: number): string {
  if (priority <= 1) return "High";
  if (priority === 2) return "Medium";
  return "Normal";
}

function formatTaskDateValue(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(year, month - 1, day));
  }
  return formatEventTimeRange({
    id: "task-date",
    sourceLabel: "Task",
    title: "Task",
    siteKey: PROJECT_TASKS_KEY,
    siteLabel: "Tasks",
    startsAt: value,
    endsAt: value,
    summary: "",
    detailLines: [],
  });
}

function formatEventTimeRange(event: CalendarAgendaEvent) {
  if (event.allDay) {
    return formatEventDate(event.startsAt);
  }
  if (event.startsAt === event.endsAt) return formatEventTime(event.startsAt);
  return `${formatEventDate(event.startsAt)}, ${formatEventTime(event.startsAt)} - ${formatEventDate(event.endsAt)}, ${formatEventTime(event.endsAt)}`;
}

function formatCurrencyAmount(amount: number | null, currency: string | null) {
  if (amount == null || !currency) return "";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function formatBookingPayment(booking: CalendarBookingRow) {
  if (booking.is_free_booking === 1) {
    return "Free booking";
  }

  if (booking.payment_status === "not_required") {
    const formatted = formatCurrencyAmount(
      booking.suggested_amount,
      booking.currency,
    );
    return formatted ? `Manual booking (${formatted})` : "Manual booking";
  }

  if (booking.payment_status === "succeeded" || booking.amount_paid != null) {
    const formatted = formatCurrencyAmount(
      booking.amount_paid ?? booking.suggested_amount,
      booking.currency,
    );
    return formatted ? `Paid ${formatted}` : "Paid";
  }

  if (booking.payment_status === "pending") {
    return "Payment pending";
  }

  return "Payment status unavailable";
}

function defaultDateInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonthsToKey(monthKeyValue: string, delta: number): string {
  const [year, month] = monthKeyValue.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return monthKeyFromDate(date);
}

function defaultTimeInput(offsetHours = 1): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function dateInputFromDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function syncEventEndFromStart() {
  const form = newEventForm.value;
  if (form.allDay) {
    form.endDate = form.startDate;
    return;
  }
  const end = calendarEventEndOneHourAfter(form.startDate, form.startTime);
  if (!end) return;
  form.endDate = end.endDate;
  form.endTime = end.endTime;
}

function dateInputFromIso(value: string, subtractDays = 0): string {
  const d = new Date(value);
  if (subtractDays) d.setDate(d.getDate() - subtractDays);
  return dayKeyFormatter.value.format(d);
}

function timeInputFromIso(value: string): string {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function recurrenceInputFromRule(rule: string | null | undefined): string {
  if (!rule) return "none";
  if (rule === "daily" || rule === "yearly") return rule;
  if (rule.startsWith("weekly:")) return "weekly";
  if (rule.startsWith("monthly:")) return "monthly";
  if (parseCustomEventRecurrence(rule)) return "custom";
  return "none";
}

function parseCustomEventRecurrence(rule: string | null | undefined) {
  if (!rule) return null;
  const parts = rule.trim().toLowerCase().split(":");
  if (parts[0] !== "custom") return null;
  const interval = Number(parts[1]);
  const unit = parts[2] as "day" | "week" | "month" | "year" | undefined;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") {
    return null;
  }
  const parsed: {
    interval: number;
    unit: "day" | "week" | "month" | "year";
    until?: string;
    count?: number;
  } = { interval, unit };
  if (parts.length === 3) return parsed;
  if (parts.length !== 5) return null;
  if (parts[3] === "until" && /^\d{4}-\d{2}-\d{2}$/.test(parts[4])) {
    parsed.until = parts[4];
    return parsed;
  }
  if (parts[3] === "count") {
    const count = Number(parts[4]);
    if (Number.isInteger(count) && count >= 1 && count <= 999) {
      parsed.count = count;
      return parsed;
    }
  }
  return null;
}

function buildEventRecurrenceRule(): string {
  const form = newEventForm.value;
  if (form.recurrence !== "custom") return form.recurrence;
  const interval = Math.max(1, Math.min(99, Math.round(Number(form.customInterval) || 1)));
  const base = `custom:${interval}:${form.customUnit}`;
  if (form.customEnd === "on" && form.customUntilDate) {
    return `${base}:until:${form.customUntilDate}`;
  }
  if (form.customEnd === "after") {
    const count = Math.max(1, Math.min(999, Math.round(Number(form.customCount) || 1)));
    return `${base}:count:${count}`;
  }
  return base;
}

function applyCustomEventRecurrence(rule: string | null | undefined) {
  const custom = parseCustomEventRecurrence(rule);
  if (!custom) return;
  newEventForm.value.customInterval = custom.interval;
  newEventForm.value.customUnit = custom.unit;
  newEventForm.value.customEnd = custom.until ? "on" : custom.count ? "after" : "never";
  newEventForm.value.customUntilDate = custom.until || "";
  newEventForm.value.customCount = custom.count || 30;
}

function preferredCreateDate(): string {
  return focusedDayKey.value || defaultDateInput();
}

function mapBookingToCalendarEvent(
  booking: CalendarBookingRow,
): CalendarAgendaEvent {
  return {
    id: booking.id,
    entryType: "booking",
    recordId: booking.id,
    sourceLabel: "Booking",
    title: booking.guest_name || "Unnamed booking",
    siteKey: booking.username,
    siteLabel: `${booking.username}.example.com`,
    color: siteDotColor(booking.username),
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    summary: booking.guest_email,
    detailLines: [
      { label: "Guest", value: booking.guest_name || "Unknown guest" },
      { label: "Email", value: booking.guest_email },
      { label: "Duration", value: `${booking.duration_minutes} minutes` },
      ...(booking.meeting_host_url || booking.meeting_url ? [{
        label: "Location",
        value: (booking.meeting_host_url || booking.meeting_url)!,
        href: calendarLocationHref((booking.meeting_host_url || booking.meeting_url)!),
      }] : []),
      { label: "Payment", value: formatBookingPayment(booking) },
    ],
    notes: booking.notes,
  };
}

function mapReminderToCalendarEvent(
  reminder: CalendarReminderRow,
): CalendarAgendaEvent {
  return {
    id: reminder.id,
    entryType: "reminder",
    recordId: reminder.id,
    sourceLabel: "Reminder",
    title: reminder.title,
    siteKey: REMINDERS_KEY,
    siteLabel: "Reminders",
    color: siteDotColor(REMINDERS_KEY),
    startsAt: reminder.remindAt,
    endsAt: reminder.remindAt,
    summary: reminder.recurrenceRule
      ? `Recurring: ${formatReminderRecurrence(reminder.recurrenceRule)}`
      : "One-time reminder",
    detailLines: [
      { label: "Status", value: reminder.status },
      ...(reminder.timezone
        ? [{ label: "Timezone", value: reminder.timezone }]
        : []),
      ...(reminder.contextLabel
        ? [{ label: "Context", value: reminder.contextLabel }]
        : []),
    ],
    notes: reminder.notes,
    actionLabel: "Edit reminder",
    dangerActionLabel: "Cancel reminder",
  };
}

function mapTaskToCalendarEvent(task: CalendarTaskRow): CalendarAgendaEvent {
  return {
    id: task.id,
    entryType: "task",
    recordId: task.id,
    sourceLabel: "Task",
    title: task.title,
    siteKey: PROJECT_TASKS_KEY,
    siteLabel: task.projectName || "Personal",
    startsAt: task.startsAt,
    endsAt: task.endsAt,
    allDay: task.allDay,
    color: siteDotColor(PROJECT_TASKS_KEY),
    summary: formatTaskStatus(task),
    detailLines: [
      { label: "Project", value: task.projectName || "Personal" },
      { label: "Status", value: formatTaskStatus(task) },
      { label: "Priority", value: formatTaskPriority(task.priority) },
      ...(task.dueAt && task.dateSource !== "due_at"
        ? [{ label: "Due", value: formatTaskDateValue(task.dueAt) }]
        : []),
    ],
    notes: task.description,
    actionLabel: "Open task",
  };
}

function mapSocialPublicationToCalendarEvent(
  publication: CalendarSocialPublicationRow,
): CalendarAgendaEvent {
  const state = formatSocialPublicationState(publication.calendarState);
  const platform = formatSocialPlatform(publication.platform);
  return {
    id: `social-publication:${publication.id}`,
    entryType: "social_publication",
    recordId: publication.id,
    sourceLabel: "Social Publication",
    title: publication.postTitle,
    siteKey: SOCIAL_PUBLISHING_KEY,
    siteLabel: "Social publishing",
    startsAt: publication.displayAt,
    endsAt: publication.displayAt,
    color: siteDotColor(SOCIAL_PUBLISHING_KEY),
    summary: `${state} · ${platform} · ${publication.accountLabel}`,
    detailLines: [
      { label: "Post", value: publication.postTitle },
      {
        label: "Version",
        value: `${publication.versionLabel} · ${publication.versionId}`,
      },
      { label: "Platform", value: platform },
      { label: "Account", value: publication.accountLabel },
      { label: "Delivery", value: state },
      {
        label: "Source",
        value: publication.sourceRef
          ? `${publication.sourceLabel} · ${publication.sourceRef}`
          : publication.sourceLabel,
      },
      ...(publication.timezone
        ? [{ label: "Timezone", value: publication.timezone }]
        : []),
    ],
    notes: publication.errorMessage,
    actionLabel:
      publication.publicationStatus === "scheduled"
        ? "Manage schedule"
        : "Open Publication",
  };
}

function formatSocialPublicationState(
  state: CalendarSocialPublicationRow["calendarState"],
): string {
  if (state === "needs_attention") return "Needs attention";
  return state[0]!.toUpperCase() + state.slice(1);
}

function formatSocialPlatform(
  platform: CalendarSocialPublicationRow["platform"],
): string {
  if (platform === "linkedin") return "LinkedIn";
  if (platform === "instagram_business") return "Instagram Business";
  if (platform === "instagram") return "Instagram";
  return "X";
}

function mapEventToCalendarEvent(event: CalendarEventRow): CalendarAgendaEvent {
  const isImported = event.sourceKind === "imported";
  const isBirthday = event.kind === "birthday";
  const importedBirthdayCandidate = isImportedBirthdayCandidate(event);
  const siteKey = isImported
    ? `import:${event.sourceId}`
    : isBirthday
      ? BIRTHDAYS_KEY
      : PERSONAL_EVENTS_KEY;
  return {
    id: event.id,
    entryType: isImported ? "imported" : isBirthday ? "birthday" : "event",
    recordId: event.id,
    sourceLabel: isImported ? "Imported" : isBirthday ? "Birthday" : "Event",
    title: event.title || "Untitled event",
    siteKey,
    siteLabel: isImported
      ? event.sourceName
      : isBirthday
        ? "Birthdays"
        : "Events",
    color: siteDotColor(siteKey),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    kind: event.kind || "event",
    recurrenceRule: event.recurrenceRule || null,
    summary:
      event.location ||
      (isBirthday ? "Birthday" : event.allDay ? "All day" : "Personal event"),
    detailLines: [
      ...(event.allDay ? [{ label: "When", value: "All day" }] : []),
      ...(event.location
        ? [{ label: "Location", value: event.location, href: calendarLocationHref(event.location) }]
        : []),
      ...(event.timezone ? [{ label: "Timezone", value: event.timezone }] : []),
      ...(event.recurrenceRule
        ? [
            {
              label: "Repeats",
              value: formatEventRecurrence(event.recurrenceRule),
            },
          ]
        : []),
      ...(isImported
        ? [{ label: "Imported from", value: event.sourceName }]
        : [
            {
              label: "Type",
              value: isBirthday ? "Birthday" : "Personal event",
            },
          ]),
    ],
    notes: event.notes,
    actionLabel: isImported
      ? importedBirthdayCandidate
        ? addingImportedBirthdayId.value === event.id
          ? "Adding..."
          : "Add to Birthdays"
        : null
      : "Edit event",
    dangerActionLabel: isImported
      ? removingImportedEventId.value === event.id
        ? "Removing..."
        : "Remove imported event"
      : "Delete event",
  };
}

function calendarLocationHref(location: string) {
  try {
    const url = new URL(location);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isImportedBirthdayCandidate(event: CalendarEventRow): boolean {
  return (
    event.sourceKind === "imported" &&
    event.allDay === true &&
    /\bbirthdays?\b/i.test(event.title)
  );
}

const siteOptions = computed<CalendarSiteOption[]>(() => {
  const bookingUsernames = new Set(
    bookings.value.map((booking) => booking.username),
  );
  const bookingSites = sites.sites.filter(
    (site) =>
      site.bookings_enabled === true || bookingUsernames.has(site.username),
  );
  const showBookingSiteName = bookingSites.length > 1;

  return [
    ...bookingSites.map((site) => ({
      value: site.username,
      label: showBookingSiteName
        ? `Site bookings · ${site.username}`
        : "Site bookings",
    })),
    { value: PERSONAL_EVENTS_KEY, label: "Events" },
    { value: BIRTHDAYS_KEY, label: "Birthdays" },
    { value: REMINDERS_KEY, label: "Reminders" },
    { value: PROJECT_TASKS_KEY, label: "Tasks" },
    ...(socialPublishingReady.value
      ? [{ value: SOCIAL_PUBLISHING_KEY, label: "Social publishing" }]
      : []),
    ...sources.value.map((source) => ({
      value: `import:${source.id}`,
      label: source.name,
      source,
    })),
  ];
});

const allCalendarsVisible = computed(
  () =>
    siteOptions.value.length > 0 &&
    siteOptions.value.every(
      (option) => !hiddenCalendarKeys.value.includes(option.value),
    ),
);

const someCalendarsVisible = computed(
  () =>
    !allCalendarsVisible.value &&
    siteOptions.value.some(
      (option) => !hiddenCalendarKeys.value.includes(option.value),
    ),
);

function isCalendarVisible(key: string): boolean {
  return !hiddenCalendarKeys.value.includes(key);
}

function setCalendarVisibility(key: string, visible: boolean) {
  const next = new Set(hiddenCalendarKeys.value);
  if (visible) next.delete(key);
  else next.add(key);
  hiddenCalendarKeys.value = [...next];
}

function onCalendarVisibilityChange(key: string, event: Event) {
  setCalendarVisibility(
    key,
    (event.currentTarget as HTMLInputElement | null)?.checked === true,
  );
}

function onAllCalendarsVisibilityChange(event: Event) {
  const visible =
    (event.currentTarget as HTMLInputElement | null)?.checked === true;
  hiddenCalendarKeys.value = visible
    ? []
    : siteOptions.value.map((option) => option.value);
}

function ensureCalendarVisible(key: string) {
  setCalendarVisibility(key, true);
}

function loadCalendarVisibility() {
  try {
    const stored = window.localStorage.getItem(CALENDAR_VISIBILITY_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    hiddenCalendarKeys.value = Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    hiddenCalendarKeys.value = [];
  }
  calendarVisibilityHydrated = true;
}

function calendarFeedAgendaEvents(
  response: CalendarFeedResponse,
): CalendarAgendaEvent[] {
  return [
    ...(response.bookings || []).map(mapBookingToCalendarEvent),
    ...(response.events || []).map(mapEventToCalendarEvent),
    ...(response.importedEvents || []).map(mapEventToCalendarEvent),
    ...(response.reminders || []).map(mapReminderToCalendarEvent),
    ...(response.tasks || []).map(mapTaskToCalendarEvent),
    ...(response.socialPublishing?.ready
      ? response.socialPublishing.publications || []
      : []
    ).map(mapSocialPublicationToCalendarEvent),
  ].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}

const mergedRangeEvents = computed(() =>
  calendarFeedAgendaEvents({
    bookings: bookings.value,
    reminders: reminders.value,
    events: events.value,
    importedEvents: importedEvents.value,
    sources: sources.value,
    tasks: tasks.value,
    socialPublishing: {
      ready: socialPublishingReady.value,
      publications: socialPublications.value,
    },
  }),
);

const visibleEvents = computed(() => {
  return mergedRangeEvents.value.filter(
    (event) => !hiddenCalendarKeys.value.includes(event.siteKey),
  );
});

const calendarPickerMarkedDates = computed(() =>
  calendarActivityDateKeys(
    calendarPickerEvents.value.filter(
      (event) => !hiddenCalendarKeys.value.includes(event.siteKey),
    ),
    resolvedTimeZone || "UTC",
  ),
);

const initialCalendarLoading = computed(
  () => loading.value && !calendarLoaded.value,
);
const calendarRefreshing = computed(
  () => loading.value && calendarLoaded.value,
);
const showCalendarUnavailable = computed(
  () => !!error.value && !calendarLoaded.value,
);

const selectedBoardEvent = computed(() => {
  if (!boardHighlightId.value) return null;
  return (
    visibleEvents.value.find((event) => event.id === boardHighlightId.value) ??
    null
  );
});

const selectedContextEvent = computed(() =>
  boardContextAnchor.value && !isCompactCalendar.value
    ? selectedBoardEvent.value
    : null,
);

const selectedModalEvent = computed(() =>
  !boardContextAnchor.value || isCompactCalendar.value
    ? selectedBoardEvent.value
    : null,
);

function closeBoardContext(restoreFocus = true) {
  const trigger = boardContextAnchor.value?.trigger;
  boardContextAnchor.value = null;
  quickWeekSlot.value = null;
  boardHighlightId.value = "";
  if (restoreFocus && trigger) {
    void nextTick(() => trigger.focus());
  }
}

async function reloadCalendar() {
  const token = ++calendarLoadToken;
  calendarLoadController?.abort();
  const controller = new AbortController();
  calendarLoadController = controller;
  loading.value = true;
  error.value = "";

  try {
    const { start, end } = calendarWindow.value;
    const qs = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
    });
    const response = await api.get<CalendarFeedResponse>(
      `/calendar/feed?${qs.toString()}`,
      { signal: controller.signal },
    );
    if (token !== calendarLoadToken) return;
    bookings.value = response.bookings || [];
    reminders.value = response.reminders || [];
    events.value = response.events || [];
    importedEvents.value = response.importedEvents || [];
    sources.value = response.sources || [];
    tasks.value = response.tasks || [];
    socialPublishingReady.value = response.socialPublishing?.ready === true;
    socialPublications.value = socialPublishingReady.value
      ? response.socialPublishing?.publications || []
      : [];
    calendarLoaded.value = true;
  } catch (err) {
    if (controller.signal.aborted) return;
    if (token !== calendarLoadToken) return;
    error.value =
      err instanceof Error ? err.message : "Failed to load calendar";
    if (!calendarLoaded.value) {
      bookings.value = [];
      reminders.value = [];
      events.value = [];
      importedEvents.value = [];
      sources.value = [];
      tasks.value = [];
      socialPublishingReady.value = false;
      socialPublications.value = [];
    } else {
      toastFromUnknown(err, "Failed to refresh calendar");
    }
  } finally {
    if (token === calendarLoadToken) {
      loading.value = false;
    }
  }
}

async function cancelReminder(reminderId: string) {
  if (updatingReminderId.value) return;
  updatingReminderId.value = reminderId;
  try {
    await api.put(`/agent/reminders/${reminderId}/cancel`);
    toastSuccess("Reminder cancelled.");
    await reloadCalendar();
  } finally {
    updatingReminderId.value = null;
  }
}

async function deleteCalendarEvent(eventId: string) {
  if (deletingEventId.value) return;
  if (!window.confirm("Delete this event from your calendar?")) {
    return;
  }
  deletingEventId.value = eventId;
  try {
    await api.delete(`/calendar/events/${eventId}`);
    toastSuccess("Event deleted.");
    await reloadCalendar();
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to delete event";
  } finally {
    deletingEventId.value = null;
  }
}

async function removeImportedCalendarEvent(event: CalendarAgendaEvent) {
  if (removingImportedEventId.value) return;
  if (
    !window.confirm(
      "Remove this imported event from your calendar? It will stay hidden if the source syncs again.",
    )
  ) {
    return;
  }

  removingImportedEventId.value = event.id;
  try {
    await api.delete(
      `/calendar/imported-events/${encodeURIComponent(event.id)}`,
    );
    toastSuccess("Imported event removed.");
    await reloadCalendar();
  } catch (err) {
    toastFromUnknown(err, "Could not remove imported event");
  } finally {
    removingImportedEventId.value = null;
  }
}

function handleEventAction(event: CalendarAgendaEvent) {
  closeBoardContext(false);
  if (event.entryType === "social_publication") {
    const publicationId = event.recordId || event.id;
    const publication = socialPublications.value.find(
      (item) => item.id === publicationId,
    );
    if (publication?.publicationStatus === "scheduled") {
      openSocialPublicationSchedule(publication);
    } else {
      openSocialPublication(publicationId);
    }
    return;
  }

  if (event.entryType === "task") {
    openTaskInMissionControl(event.id);
    return;
  }

  if (event.entryType === "reminder" || event.sourceLabel === "Reminder") {
    openEditReminder(event.id);
    return;
  }

  const importedSourceEvent = importedEvents.value.find(
    (item) => item.id === event.id,
  );
  if (importedSourceEvent && isImportedBirthdayCandidate(importedSourceEvent)) {
    void addImportedEventToBirthdays(event);
    return;
  }

  if (
    event.entryType === "event" ||
    event.entryType === "birthday" ||
    event.sourceLabel === "Event" ||
    event.sourceLabel === "Birthday"
  ) {
    openEditEvent(event.id);
  }
}

function openSocialPublication(publicationId: string) {
  const publication = socialPublications.value.find(
    (item) => item.id === publicationId,
  );
  if (!publication) return;
  void router.push({
    path: "/social",
    query: {
      siteId: publication.siteId,
      postId: publication.postId,
      versionId: publication.versionId,
      publicationId: publication.id,
    },
  });
}

function openSocialPublicationSchedule(
  publication: CalendarSocialPublicationRow,
) {
  if (
    publication.publicationStatus !== "scheduled" ||
    !publication.scheduledFor
  ) {
    socialScheduleError.value =
      "Only a planned Publication can be rescheduled from Calendar.";
    return;
  }
  const timezone = publication.timezone || defaultFormTimeZone;
  const local = instantToLocalDateTimeParts(publication.scheduledFor, timezone);
  if (!local) {
    socialScheduleError.value =
      "Calendar could not read this Publication timezone. Open Social Publishing for details.";
    return;
  }
  reschedulingPublicationId.value = publication.id;
  socialScheduleOptions.value = [];
  socialScheduleError.value = "";
  quickCreateDayKey.value = local.date;
  socialScheduleForm.value = {
    versionId: publication.versionId,
    date: local.date,
    time: local.time,
    timezone,
    expectedUpdatedAt: publication.updatedAt,
  };
  compactEventCreate.value = false;
  activeCreateMode.value = "social";
}

function handleEventDangerAction(event: CalendarAgendaEvent) {
  closeBoardContext(false);
  if (event.entryType === "reminder" || event.sourceLabel === "Reminder") {
    void cancelReminder(event.id);
    return;
  }

  if (event.entryType === "imported") {
    void removeImportedCalendarEvent(event);
    return;
  }

  if (
    event.entryType === "event" ||
    event.entryType === "birthday" ||
    event.sourceLabel === "Event" ||
    event.sourceLabel === "Birthday"
  ) {
    void deleteCalendarEvent(event.id);
  }
}

function openTaskInMissionControl(taskId: string) {
  const task = tasks.value.find((item) => item.id === taskId);
  void router.push({
    path: "/tasks",
    query: {
      ...(task?.projectId ? { project: task.projectId } : {}),
      task: taskId,
    },
  });
}

async function handleCancelBooking(event: CalendarAgendaEvent) {
  if (event.entryType !== "booking" && event.sourceLabel !== "Booking") return;
  if (
    !window.confirm(
      "Cancel this booking? The guest will receive a cancellation email.",
    )
  ) {
    return;
  }
  if (cancellingBookingId.value) return;
  cancellingBookingId.value = event.id;
  try {
    await api.delete(`/book/cancel/${event.id}`);
    toastSuccess("Booking cancelled.");
    await reloadCalendar();
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to cancel booking";
  } finally {
    cancellingBookingId.value = null;
  }
}

async function removeImportedCalendarSource(source: CalendarSourceRow) {
  if (removingSourceId.value) return;
  if (
    !window.confirm(
      `Remove ${source.name} from your calendar? Imported events from this source will be removed locally.`,
    )
  ) {
    return;
  }

  removingSourceId.value = source.id;
  try {
    await api.delete(`/calendar/sources/${encodeURIComponent(source.id)}`);
    const sourceKey = `import:${source.id}`;
    hiddenCalendarKeys.value = hiddenCalendarKeys.value.filter(
      (key) => key !== sourceKey,
    );
    const removedEventIds = new Set(
      importedEvents.value
        .filter((event) => event.sourceId === source.id)
        .map((event) => event.id),
    );
    if (boardHighlightId.value) {
      if (removedEventIds.has(boardHighlightId.value)) {
        boardHighlightId.value = "";
      }
    }
    if (removedEventIds.has(transientHighlightId.value)) {
      transientHighlightId.value = "";
    }
    sources.value = sources.value.filter((item) => item.id !== source.id);
    importedEvents.value = importedEvents.value.filter(
      (event) => event.sourceId !== source.id,
    );
    toastSuccess(`${source.name} removed.`);
  } catch (err) {
    toastFromUnknown(err, "Could not remove calendar source");
  } finally {
    removingSourceId.value = null;
  }
}

async function addImportedEventToBirthdays(event: CalendarAgendaEvent) {
  if (addingImportedBirthdayId.value) return;
  const startDate = dateInputFromIso(event.startsAt);
  if (!startDate) return;

  addingImportedBirthdayId.value = event.id;
  try {
    const response = await api.post<{ ok: boolean; event: { id: string } }>(
      "/calendar/events",
      {
        title: event.title,
        startDate,
        endDate: startDate,
        timezone: defaultFormTimeZone,
        allDay: true,
        kind: "birthday",
        recurrenceRule: "yearly",
        notes: event.notes || undefined,
      },
    );
    ensureCalendarVisible(BIRTHDAYS_KEY);
    highlightSavedCalendarItem(response.event.id);
    toastSuccess("Added to Birthdays.");
    await reloadCalendar();
  } catch (err) {
    toastFromUnknown(err, "Could not add birthday");
  } finally {
    addingImportedBirthdayId.value = null;
  }
}

const SITE_DOT_PALETTE = [
  "#7dbaf9",
  "#f28b82",
  "#fdd663",
  "#81c995",
  "#c58af9",
  "#ffad47",
  "#78d9ec",
];

function siteDotColor(key: string): string {
  if (key === REMINDERS_KEY) return "#9aa0a6";
  if (key === PERSONAL_EVENTS_KEY) return "#fdd663";
  if (key === BIRTHDAYS_KEY) return "#81c995";
  if (key === SOCIAL_PUBLISHING_KEY) return "#26806f";
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return SITE_DOT_PALETTE[Math.abs(h) % SITE_DOT_PALETTE.length];
}

const cycleRangeModes: CalendarRangeMode[] = ["schedule", "month"];

function nextCycleRangeMode(): CalendarRangeMode {
  const currentIndex = cycleRangeModes.indexOf(rangeMode.value);
  if (currentIndex < 0) return "schedule";
  return cycleRangeModes[(currentIndex + 1) % cycleRangeModes.length];
}

function cycleRangeMode() {
  onRangeChange(nextCycleRangeMode());
}

function syncCalendarPickerMonth() {
  calendarPickerMonth.value = monthKeyFromDate(miniCalendarCursor.value);
}

async function loadCalendarPickerMarkers(month: string) {
  const window = datePickerWindow(month);
  if (!window) {
    calendarPickerEvents.value = [];
    return;
  }

  const token = ++calendarPickerLoadToken;
  calendarPickerLoadController?.abort();
  const controller = new AbortController();
  calendarPickerLoadController = controller;
  calendarPickerEvents.value = [];

  try {
    const qs = new URLSearchParams({
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    });
    const response = await api.get<CalendarFeedResponse>(
      `/calendar/feed?${qs.toString()}`,
      { signal: controller.signal },
    );
    if (
      token !== calendarPickerLoadToken ||
      controller.signal.aborted ||
      !calendarPickerOpen.value ||
      month !== calendarPickerMonth.value
    ) {
      return;
    }
    calendarPickerEvents.value = calendarFeedAgendaEvents(response);
  } catch {
    if (token === calendarPickerLoadToken && !controller.signal.aborted) {
      calendarPickerEvents.value = [];
    }
  }
}

function toggleCalendarPicker() {
  if (!calendarPickerOpen.value) {
    syncCalendarPickerMonth();
    void loadCalendarPickerMarkers(calendarPickerMonth.value);
  } else {
    calendarPickerLoadController?.abort();
  }
  showCreateMenu.value = false;
  showSettingsMenu.value = false;
  calendarPickerOpen.value = !calendarPickerOpen.value;
}

function moveCalendarPickerMonth(delta: number) {
  calendarPickerMonth.value = addMonthsToKey(calendarPickerMonth.value, delta);
  void loadCalendarPickerMarkers(calendarPickerMonth.value);
}

function chooseCalendarPickerDay(dayKey: string) {
  calendarPickerOpen.value = false;
  onMiniPick(dayKey);
}

function pickCalendarToday() {
  chooseCalendarPickerDay(todayDayKey.value);
}

function toggleCreateMenu() {
  calendarPickerOpen.value = false;
  showSettingsMenu.value = false;
  showCreateMenu.value = !showCreateMenu.value;
}

function toggleSettingsMenu() {
  calendarPickerOpen.value = false;
  showCreateMenu.value = false;
  showSettingsMenu.value = !showSettingsMenu.value;
}

function defaultBookingAvailability(): BookingAvailability {
  return {
    monday: ["09:00-17:00"],
    tuesday: ["09:00-17:00"],
    wednesday: ["09:00-17:00"],
    thursday: ["09:00-17:00"],
    friday: ["09:00-17:00"],
    saturday: [],
    sunday: [],
  };
}

function normalizeBookingAvailability(input: unknown): BookingAvailability {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const fallback = defaultBookingAvailability();
  const next: BookingAvailability = {};
  for (const day of Object.keys(fallback)) {
    next[day] = Array.isArray(record[day])
      ? (record[day] as unknown[])
          .filter((window): window is string => typeof window === "string")
      : [...fallback[day]];
  }
  return next;
}

function compactAvailabilityWindows(availability: BookingAvailability) {
  const windows: Record<string, string[]> = {};
  for (const [day, dayWindows] of Object.entries(availability)) {
    if (dayWindows.length > 0) {
      windows[day] = [...dayWindows];
    }
  }
  return windows;
}

function isRealSiteUsername(value: string): boolean {
  return sites.sites.some((site) => site.username === value);
}

function preferredAvailabilitySiteUsername(): string {
  const visibleSite = sites.sites.find((site) => isCalendarVisible(site.username));
  if (visibleSite) return visibleSite.username;
  if (isRealSiteUsername(newBookingForm.value.username)) {
    return newBookingForm.value.username;
  }
  return sites.sites[0]?.username ?? "";
}

function applyAvailabilityContent(content: SiteContent | null) {
  if (!content?.ok || !content.profile) {
    availabilitySourceProfile.value = null;
    availabilityDraft.value = defaultBookingAvailability();
    availabilityBufferTime.value = 0;
    availabilityTimezone.value = defaultFormTimeZone;
    availabilityError.value = "No published site profile was found for this site.";
    return;
  }

  const profile = JSON.parse(JSON.stringify(content.profile)) as Record<
    string,
    unknown
  >;
  const intents =
    profile.intents && typeof profile.intents === "object"
      ? (profile.intents as Record<string, unknown>)
      : {};
  const book =
    intents.book && typeof intents.book === "object"
      ? (intents.book as Record<string, any>)
      : {};
  const oneToOneType = Array.isArray(book.bookingTypes)
    ? book.bookingTypes.find(
        (entry: unknown) =>
          entry &&
          typeof entry === "object" &&
          ((entry as Record<string, unknown>).type === "one_to_one" ||
            (entry as Record<string, unknown>).id === "one_to_one"),
      )
    : null;
  const oneToOneAvailability =
    oneToOneType &&
    typeof oneToOneType === "object" &&
    (oneToOneType as Record<string, any>).availability
      ? (oneToOneType as Record<string, any>).availability
      : null;
  const availability =
    oneToOneAvailability && typeof oneToOneAvailability === "object"
      ? oneToOneAvailability
      : book.availability && typeof book.availability === "object"
        ? book.availability
        : null;

  availabilitySourceProfile.value = profile;
  availabilityDraft.value = normalizeBookingAvailability(
    availability && typeof availability === "object"
      ? (availability as Record<string, unknown>).windows
      : null,
  );
  availabilityBufferTime.value =
    book.bufferTime === 0 ||
    book.bufferTime === 5 ||
    book.bufferTime === 10 ||
    book.bufferTime === 15 ||
    book.bufferTime === 30
      ? book.bufferTime
      : 0;
  availabilityTimezone.value =
    availability &&
    typeof availability === "object" &&
    typeof (availability as Record<string, unknown>).timezone === "string"
      ? ((availability as Record<string, unknown>).timezone as string)
      : defaultFormTimeZone;
}

async function loadAvailabilitySettings() {
  const username = availabilitySiteUsername.value;
  availabilityError.value = "";
  availabilitySourceProfile.value = null;
  if (!username) {
    availabilityError.value = "Create a site before editing booking availability.";
    return;
  }

  availabilityLoading.value = true;
  try {
    applyAvailabilityContent(await sites.getSiteContent(username));
  } catch (err) {
    availabilityError.value =
      err instanceof Error ? err.message : "Could not load booking availability.";
  } finally {
    availabilityLoading.value = false;
  }
}

async function openAvailabilitySettings() {
  focusCalendarHeaderTrigger("settings");
  showSettingsMenu.value = false;
  showCreateMenu.value = false;
  calendarPickerOpen.value = false;
  availabilityModalOpen.value = true;
  availabilitySiteUsername.value = preferredAvailabilitySiteUsername();
  await loadAvailabilitySettings();
}

function openCalendarsDialog() {
  focusCalendarHeaderTrigger("settings");
  closeCalendarHeaderMenus();
  calendarsDialogOpen.value = true;
}

function closeCalendarsDialog() {
  calendarsDialogOpen.value = false;
}

function closeAvailabilitySettings() {
  availabilityModalOpen.value = false;
  availabilityError.value = "";
  availabilitySourceProfile.value = null;
}

async function saveAvailabilitySettings() {
  const username = availabilitySiteUsername.value;
  if (!username || !availabilitySourceProfile.value || availabilitySaving.value) {
    return;
  }

  availabilitySaving.value = true;
  availabilityError.value = "";
  try {
    const nextProfile = JSON.parse(
      JSON.stringify(availabilitySourceProfile.value),
    ) as Record<string, any>;
    const intents =
      nextProfile.intents && typeof nextProfile.intents === "object"
        ? { ...nextProfile.intents }
        : {};
    const book =
      intents.book && typeof intents.book === "object"
        ? { ...intents.book }
        : {};
    const availability = {
      ...(book.availability && typeof book.availability === "object"
        ? book.availability
        : {}),
      timezone: availabilityTimezone.value || defaultFormTimeZone,
      windows: compactAvailabilityWindows(availabilityDraft.value),
    };

    book.enabled = book.enabled ?? true;
    book.bufferTime = availabilityBufferTime.value;
    book.availability = availability;
    if (Array.isArray(book.bookingTypes)) {
      book.bookingTypes = book.bookingTypes.map((entry: unknown) => {
        if (!entry || typeof entry !== "object") return entry;
        const bookingType = entry as Record<string, any>;
        if (bookingType.type !== "one_to_one" && bookingType.id !== "one_to_one") {
          return bookingType;
        }
        return {
          ...bookingType,
          availability: {
            ...(bookingType.availability &&
            typeof bookingType.availability === "object"
              ? bookingType.availability
              : {}),
            ...availability,
          },
        };
      });
    }

    intents.book = book;
    nextProfile.intents = intents;

    const me3File = new File(
      [JSON.stringify(nextProfile, null, 2)],
      "me.json",
      { type: "application/json" },
    );
    const saved = await sites.uploadSite(username, [me3File]);
    if (!saved) {
      throw new Error(sites.error || "Could not save booking availability.");
    }

    availabilitySourceProfile.value = nextProfile;
    toastSuccess("Booking availability updated.");
    closeAvailabilitySettings();
  } catch (err) {
    availabilityError.value =
      err instanceof Error ? err.message : "Could not save booking availability.";
  } finally {
    availabilitySaving.value = false;
  }
}

function onRangeChange(mode: CalendarRangeMode) {
  const anchor =
    rangeMode.value === "day" ? new Date(dayCursor.value) : new Date(monthCursor.value);
  if (mode === "week" && isCompactCalendar.value) mode = "day";
  closeBoardContext(false);
  rangeMode.value = mode;
  calendarPickerOpen.value = false;
  showSettingsMenu.value = false;
  if (mode === "day") {
    dayCursor.value = anchor;
    focusedDayKey.value = dayKeyFormatter.value.format(anchor);
  } else {
    monthCursor.value = anchor;
    if (mode === "schedule") {
      scheduleWindowDays.value = SCHEDULE_WINDOW_INCREMENT_DAYS;
    }
  }
  void reloadCalendar();
}

function onCalendarToday() {
  const today = new Date();
  closeBoardContext(false);
  if (rangeMode.value === "day") {
    dayCursor.value = today;
    focusedDayKey.value = todayDayKey.value;
  } else {
    monthCursor.value = today;
    focusedDayKey.value = null;
  }
  scheduleWindowDays.value = SCHEDULE_WINDOW_INCREMENT_DAYS;
  void reloadCalendar();
}

function moveScheduleWindow(days: number) {
  const next = new Date(monthCursor.value);
  next.setDate(next.getDate() + days);
  monthCursor.value = next;
  focusedDayKey.value = null;
  scheduleWindowDays.value = SCHEDULE_WINDOW_INCREMENT_DAYS;
  void reloadCalendar();
}

function loadMoreSchedule() {
  scheduleWindowDays.value = Math.min(
    scheduleWindowDays.value + SCHEDULE_WINDOW_INCREMENT_DAYS,
    SCHEDULE_MAX_WINDOW_DAYS,
  );
  void reloadCalendar();
}

function onPrevDay() {
  const d = new Date(dayCursor.value);
  d.setDate(d.getDate() - 1);
  dayCursor.value = d;
  focusedDayKey.value = dayKeyFormatter.value.format(d);
  void reloadCalendar();
}

function onNextDay() {
  const d = new Date(dayCursor.value);
  d.setDate(d.getDate() + 1);
  dayCursor.value = d;
  focusedDayKey.value = dayKeyFormatter.value.format(d);
  void reloadCalendar();
}

function moveWeek(weeks: number) {
  const next = new Date(monthCursor.value);
  next.setDate(next.getDate() + weeks * 7);
  monthCursor.value = next;
  focusedDayKey.value = null;
  closeBoardContext(false);
  void reloadCalendar();
}

function onPrevMonth() {
  const c = monthCursor.value;
  monthCursor.value = new Date(c.getFullYear(), c.getMonth() - 1, 1);
  focusedDayKey.value = null;
  void reloadCalendar();
}

function onNextMonth() {
  const c = monthCursor.value;
  monthCursor.value = new Date(c.getFullYear(), c.getMonth() + 1, 1);
  focusedDayKey.value = null;
  void reloadCalendar();
}

function onToolbarPrev() {
  closeBoardContext(false);
  if (rangeMode.value === "day") onPrevDay();
  else if (rangeMode.value === "schedule") moveScheduleWindow(-30);
  else if (rangeMode.value === "week") moveWeek(-1);
  else onPrevMonth();
}

function onToolbarNext() {
  closeBoardContext(false);
  if (rangeMode.value === "day") onNextDay();
  else if (rangeMode.value === "schedule") moveScheduleWindow(30);
  else if (rangeMode.value === "week") moveWeek(1);
  else onNextMonth();
}

watch(visibleEvents, (nextEvents) => {
  if (
    boardHighlightId.value &&
    !nextEvents.some((event) => event.id === boardHighlightId.value)
  ) {
    boardHighlightId.value = "";
    boardContextAnchor.value = null;
  }
});

watch(miniCalendarCursor, () => {
  if (calendarPickerOpen.value) {
    syncCalendarPickerMonth();
  }
});

watch(
  hiddenCalendarKeys,
  (keys) => {
    if (!calendarVisibilityHydrated) return;
    try {
      window.localStorage.setItem(
        CALENDAR_VISIBILITY_STORAGE_KEY,
        JSON.stringify(keys),
      );
    } catch {
      // Calendar filters still work for this session when storage is unavailable.
    }
  },
  { deep: true },
);

function applyInitialCalendarViewport(matches: boolean) {
  isCompactCalendar.value = matches;
  if (matches) rangeMode.value = "schedule";
}

function onMobileCalendarChange(event: MediaQueryListEvent) {
  isCompactCalendar.value = event.matches;
  closeCalendarHeaderMenus();
  if (event.matches && rangeMode.value === "week") {
    dayCursor.value = new Date(monthCursor.value);
    focusedDayKey.value = dayKeyFormatter.value.format(dayCursor.value);
    rangeMode.value = "day";
    closeBoardContext(false);
    void reloadCalendar();
  }
}

function onBoardSelectEvent(id: string, anchor: CalendarContextAnchor) {
  quickWeekSlot.value = null;
  boardContextAnchor.value = isCompactCalendar.value ? null : anchor;
  boardHighlightId.value = id;
  preferSelectEventId.value = id;
  focusedDayKey.value = null;
}

function onAgendaSelectEvent(event: CalendarAgendaEvent) {
  if (!isCompactCalendar.value) return;
  quickWeekSlot.value = null;
  boardContextAnchor.value = null;
  boardHighlightId.value = event.id;
  preferSelectEventId.value = null;
}

function onWeekSelectSlot(
  slot: CalendarWeekSlot,
  anchor: CalendarContextAnchor,
) {
  boardHighlightId.value = "";
  preferSelectEventId.value = null;
  focusedDayKey.value = slot.dayKey;
  newEventError.value = "";
  quickWeekSlot.value = slot;
  boardContextAnchor.value = anchor;
}

function focusBoardDay(dayKey: string) {
  const toggle = focusedDayKey.value === dayKey ? null : dayKey;
  focusedDayKey.value = toggle;
  if (!toggle) return;
  const keyFmt = dayKeyFormatter.value;
  const first = visibleEvents.value.find(
    (event) => keyFmt.format(new Date(event.startsAt)) === toggle,
  );
  if (first) {
    boardHighlightId.value = first.id;
    preferSelectEventId.value = first.id;
  }
}

function onBoardSelectDay(
  dayKey: string,
  anchor?: CalendarContextAnchor,
) {
  focusedDayKey.value = dayKey;
  boardHighlightId.value = "";
  preferSelectEventId.value = null;
  if (anchor && !isCompactCalendar.value) {
    onWeekSelectSlot(
      {
        dayKey,
        startMinutes: 9 * 60,
        endMinutes: 10 * 60,
      },
      anchor,
    );
    return;
  }
  openCreateMode("event", dayKey, true);
}

function onBoardShowDay(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return;
  dayCursor.value = new Date(year, month - 1, day);
  focusedDayKey.value = dayKey;
  boardHighlightId.value = "";
  preferSelectEventId.value = null;
  closeBoardContext(false);
  rangeMode.value = "day";
  closeCalendarHeaderMenus();
  void reloadCalendar();
}

function onMiniPick(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (year && month && day) {
    const picked = new Date(year, month - 1, day);
    if (rangeMode.value === "day") {
      dayCursor.value = picked;
      focusedDayKey.value = dayKey;
      void reloadCalendar();
    } else if (rangeMode.value === "month") {
      monthCursor.value = new Date(year, month - 1, 1);
      void reloadCalendar();
    } else if (rangeMode.value === "week") {
      monthCursor.value = picked;
      void reloadCalendar();
    } else if (rangeMode.value === "schedule") {
      monthCursor.value = picked;
      scheduleWindowDays.value = SCHEDULE_WINDOW_INCREMENT_DAYS;
      void reloadCalendar();
    }
  }
  focusBoardDay(dayKey);
}

function resetBookingForm() {
  const firstSite = sites.sites[0]?.username ?? "";
  newBookingError.value = "";
  newBookingForm.value = {
    username: newBookingForm.value.username || firstSite,
    guestName: "",
    guestEmail: "",
    date: preferredCreateDate(),
    startTime: "09:00",
    durationMinutes: 30,
    notes: "",
  };
}

function resetReminderForm() {
  editingReminderId.value = null;
  newReminderError.value = "";
  newReminderForm.value = {
    title: "",
    date: preferredCreateDate(),
    time: defaultTimeInput(),
    timezone: defaultFormTimeZone,
    recurrence: "none",
    notes: "",
  };
}

function resetEventForm() {
  const date = preferredCreateDate();
  editingEventId.value = null;
  newEventError.value = "";
  newEventForm.value = {
    title: "",
    startDate: date,
    startTime: defaultTimeInput(),
    endDate: date,
    endTime: defaultTimeInput(2),
    timezone: defaultFormTimeZone,
    allDay: false,
    recurrence: "none",
    customInterval: 1,
    customUnit: "day",
    customEnd: "never",
    customUntilDate: "",
    customCount: 30,
    location: "",
    notes: "",
  };
}

function resetSocialScheduleForm() {
  const date = quickCreateDayKey.value || preferredCreateDate();
  const eventTime =
    newEventForm.value.startDate === date &&
    /^\d{2}:\d{2}$/.test(newEventForm.value.startTime)
      ? newEventForm.value.startTime
      : defaultTimeInput();
  reschedulingPublicationId.value = null;
  socialScheduleError.value = "";
  socialScheduleOptions.value = [];
  socialScheduleForm.value = {
    versionId: "",
    date,
    time: eventTime,
    timezone: defaultFormTimeZone,
    expectedUpdatedAt: "",
  };
  void loadApprovedPostVersionsForScheduling();
}

async function loadApprovedPostVersionsForScheduling() {
  if (!socialPublishingReady.value || socialScheduleLoading.value) return;
  socialScheduleLoading.value = true;
  socialScheduleError.value = "";
  try {
    const response = await api.get<{
      versions: ApprovedPostVersionScheduleOption[];
    }>("/social/scheduling/approved-versions");
    socialScheduleOptions.value = response.versions || [];
    if (
      !socialScheduleOptions.value.some(
        (option) => option.versionId === socialScheduleForm.value.versionId,
      )
    ) {
      socialScheduleForm.value.versionId =
        socialScheduleOptions.value[0]?.versionId || "";
    }
  } catch (err) {
    socialScheduleError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not load approved Versions.";
  } finally {
    socialScheduleLoading.value = false;
  }
}

async function submitSocialSchedule() {
  socialScheduleError.value = "";
  const form = socialScheduleForm.value;
  const resolution = resolveLocalDateTimeToUtc(
    form.date,
    form.time,
    form.timezone,
  );
  if (!resolution.ok) {
    socialScheduleError.value = resolution.reason === "ambiguous"
      ? "This local time occurs twice because clocks move back. Choose a different time."
      : resolution.reason === "nonexistent"
        ? "This local time does not exist because clocks move forward. Choose a different time."
        : "Choose a valid date, time, and timezone.";
    return;
  }
  const scheduledFor = resolution.value;
  if (Date.parse(scheduledFor) <= Date.now()) {
    socialScheduleError.value = "Schedule time must be in the future.";
    return;
  }
  if (!reschedulingPublicationId.value && !form.versionId) {
    socialScheduleError.value = "Choose an approved Version.";
    return;
  }

  socialScheduleSubmitting.value = true;
  try {
    const requestContext = {
      surface: "calendar",
      view: rangeMode.value,
    };
    if (reschedulingPublicationId.value) {
      const publicationId = reschedulingPublicationId.value;
      const response = await api.patch<{
        publication: CalendarSocialPublicationRow;
        result: {
          action: "rescheduled";
          approvalPreserved: true;
        };
      }>(`/social/publications/${encodeURIComponent(publicationId)}`, {
        scheduledFor,
        timezone: form.timezone,
        expectedUpdatedAt: form.expectedUpdatedAt,
        requestContext,
      });
      if (response.result?.action !== "rescheduled") {
        throw new Error("Calendar did not receive a reschedule result.");
      }
      toastSuccess(
        response.result.approvalPreserved
          ? "Publication rescheduled. Exact-Version approval remains valid."
          : "Publication rescheduled.",
      );
      closeCreateMode();
      await reloadCalendar();
      highlightSavedCalendarItem(`social-publication:${publicationId}`);
      return;
    }

    const response = await api.post<{
      publication: { id: string };
      result: { action: "scheduled" };
    }>(
      `/social/versions/${encodeURIComponent(form.versionId)}/publications`,
      {
        scheduledFor,
        timezone: form.timezone,
        requestContext,
      },
    );
    if (response.result?.action !== "scheduled") {
      throw new Error("Calendar did not receive a schedule result.");
    }
    toastSuccess("Approved Version scheduled as a new Publication.");
    closeCreateMode();
    await reloadCalendar();
    highlightSavedCalendarItem(`social-publication:${response.publication.id}`);
  } catch (err) {
    socialScheduleError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not update this Publication schedule.";
  } finally {
    socialScheduleSubmitting.value = false;
  }
}

async function cancelManagedSocialPublication() {
  const publication = reschedulingSocialPublication.value;
  if (!publication || socialScheduleCancelling.value) return;
  if (!window.confirm("Cancel this planned Publication?")) return;

  socialScheduleCancelling.value = true;
  socialScheduleError.value = "";
  try {
    const response = await api.delete<{
      result: { action: "cancelled"; publicationId: string };
    }>(`/social/publications/${encodeURIComponent(publication.id)}`);
    if (response.result?.action !== "cancelled") {
      throw new Error("Calendar did not receive a cancellation result.");
    }
    toastSuccess("Publication cancelled.");
    closeCreateMode();
    await reloadCalendar();
  } catch (err) {
    socialScheduleError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not cancel this Publication.";
  } finally {
    socialScheduleCancelling.value = false;
  }
}

function openSelectedPostVersion() {
  const option = selectedSocialScheduleOption.value;
  const publication = reschedulingSocialPublication.value;
  closeCreateMode();
  void router.push({
    path: "/social",
    query: option
      ? {
          siteId: option.siteId,
          postId: option.postId,
          versionId: option.versionId,
        }
      : publication
        ? {
            siteId: publication.siteId,
            postId: publication.postId,
            versionId: publication.versionId,
            publicationId: publication.id,
          }
        : {},
  });
}

function dateTimeInputFromDayMinutes(dayKey: string, minutes: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 0, minutes, 0, 0);
  return {
    date: dateInputFromDate(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

function applyWeekSlotToEventForm(slot: CalendarWeekSlot, title = "") {
  const start = dateTimeInputFromDayMinutes(slot.dayKey, slot.startMinutes);
  const end = dateTimeInputFromDayMinutes(slot.dayKey, slot.endMinutes);
  editingEventId.value = null;
  quickCreateDayKey.value = slot.dayKey;
  newEventError.value = "";
  newEventForm.value = {
    title,
    startDate: slot.dayKey,
    startTime: slot.allDay ? "" : start.time,
    endDate: slot.allDay ? slot.dayKey : end.date,
    endTime: slot.allDay ? "" : end.time,
    timezone: defaultFormTimeZone,
    allDay: slot.allDay === true,
    recurrence: "none",
    customInterval: 1,
    customUnit: "day",
    customEnd: "never",
    customUntilDate: "",
    customCount: 30,
    location: "",
    notes: "",
  };
}

async function submitWeekQuickEvent(title: string) {
  const slot = quickWeekSlot.value;
  if (!slot) return;
  applyWeekSlotToEventForm(slot, title);
  if (await submitNewEvent()) closeBoardContext(false);
}

function openWeekSlotMoreOptions(title = "") {
  const slot = quickWeekSlot.value;
  if (!slot) return;
  applyWeekSlotToEventForm(slot, title);
  closeBoardContext(false);
  compactEventCreate.value = false;
  activeCreateMode.value = "event";
}

function resetBirthdayForm() {
  editingEventId.value = null;
  newEventError.value = "";
  newBirthdayForm.value = {
    name: "",
    date: preferredCreateDate(),
    notes: "",
  };
}

function resetImportForm() {
  importError.value = "";
  importForm.value = {
    mode: "url",
    name: "",
    url: "",
    file: null,
  };
}

function openCreateMode(
  mode: Exclude<CreateMode, null>,
  dayKey?: string,
  compact = false,
) {
  closeBoardContext(false);
  if (showCreateMenu.value) focusCalendarHeaderTrigger("create");
  else if (showSettingsMenu.value) focusCalendarHeaderTrigger("settings");
  showCreateMenu.value = false;
  showSettingsMenu.value = false;
  calendarPickerOpen.value = false;
  if (dayKey) {
    focusedDayKey.value = dayKey;
  }
  quickCreateDayKey.value =
    mode === "import" ? null : (dayKey ?? focusedDayKey.value);

  if (mode === "booking") resetBookingForm();
  if (mode === "reminder") resetReminderForm();
  if (mode === "event") resetEventForm();
  if (mode === "social") resetSocialScheduleForm();
  if (mode === "birthday") resetBirthdayForm();
  if (mode === "import") resetImportForm();

  compactEventCreate.value = mode === "event" && compact;
  activeCreateMode.value = mode;
}

function switchQuickCreateMode(mode: QuickCreateMode) {
  if (activeCreateMode.value === mode) return;
  if (mode === "booking") resetBookingForm();
  if (mode === "reminder") resetReminderForm();
  if (mode === "event") resetEventForm();
  if (mode === "social") resetSocialScheduleForm();
  if (mode === "birthday") resetBirthdayForm();
  compactEventCreate.value = false;
  activeCreateMode.value = mode;
}

function openEditReminder(reminderId: string) {
  const reminder = reminders.value.find((item) => item.id === reminderId);
  if (!reminder) return;
  showCreateMenu.value = false;
  showSettingsMenu.value = false;
  calendarPickerOpen.value = false;
  newReminderError.value = "";
  editingReminderId.value = reminder.id;
  quickCreateDayKey.value = dateInputFromIso(reminder.remindAt);
  newReminderForm.value = {
    title: reminder.title,
    date: dateInputFromIso(reminder.remindAt),
    time: timeInputFromIso(reminder.remindAt),
    timezone: reminder.timezone || defaultFormTimeZone,
    recurrence: recurrenceInputFromRule(reminder.recurrenceRule),
    notes: reminder.notes || "",
  };
  activeCreateMode.value = "reminder";
}

function openEditEvent(eventId: string) {
  const event = events.value.find((item) => item.id === eventId);
  if (!event) return;
  showCreateMenu.value = false;
  showSettingsMenu.value = false;
  calendarPickerOpen.value = false;
  newEventError.value = "";
  editingEventId.value = event.id;
  quickCreateDayKey.value = dateInputFromIso(event.startsAt);

  if (event.kind === "birthday") {
    newBirthdayForm.value = {
      name: event.title.replace(/'s birthday$/i, ""),
      date: dateInputFromIso(event.startsAt),
      notes: event.notes || "",
    };
    activeCreateMode.value = "birthday";
    return;
  }

  newEventForm.value = {
    title: event.title,
    startDate: dateInputFromIso(event.startsAt),
    startTime: event.allDay ? "" : timeInputFromIso(event.startsAt),
    endDate: dateInputFromIso(event.endsAt, event.allDay ? 1 : 0),
    endTime: event.allDay ? "" : timeInputFromIso(event.endsAt),
    timezone: event.timezone || defaultFormTimeZone,
    allDay: event.allDay,
    recurrence: recurrenceInputFromRule(event.recurrenceRule),
    customInterval: 1,
    customUnit: "day",
    customEnd: "never",
    customUntilDate: "",
    customCount: 30,
    location: event.location || "",
    notes: event.notes || "",
  };
  applyCustomEventRecurrence(event.recurrenceRule);
  activeCreateMode.value = "event";
}

function isQuickCreateMode(mode: CreateMode): mode is QuickCreateMode {
  return (
    mode === "event" ||
    mode === "social" ||
    mode === "birthday" ||
    mode === "reminder" ||
    mode === "booking"
  );
}

function closeCreateMode() {
  activeCreateMode.value = null;
  compactEventCreate.value = false;
  showCreateMenu.value = false;
  showSettingsMenu.value = false;
  calendarPickerOpen.value = false;
  quickCreateDayKey.value = null;
  editingEventId.value = null;
  editingReminderId.value = null;
  reschedulingPublicationId.value = null;
  socialScheduleOptions.value = [];
  socialScheduleError.value = "";
}

function highlightSavedCalendarItem(id: string) {
  boardHighlightId.value = "";
  preferSelectEventId.value = null;
  transientHighlightId.value = id;
  if (transientHighlightTimer) clearTimeout(transientHighlightTimer);
  transientHighlightTimer = setTimeout(() => {
    if (transientHighlightId.value === id) transientHighlightId.value = "";
    transientHighlightTimer = null;
  }, 4000);
}

async function submitNewBooking() {
  newBookingError.value = "";
  const form = newBookingForm.value;
  if (
    !form.username.trim() ||
    !form.guestName.trim() ||
    !form.guestEmail.trim()
  ) {
    newBookingError.value = "Site, guest name, and email are required.";
    return;
  }

  newBookingSubmitting.value = true;
  try {
    const response = await api.post<{ ok: boolean; booking: { id: string } }>(
      "/book/workspace",
      {
        username: form.username.trim(),
        guestName: form.guestName.trim(),
        guestEmail: form.guestEmail.trim(),
        date: form.date,
        startTime: form.startTime,
        durationMinutes: form.durationMinutes,
        notes: form.notes.trim() || undefined,
      },
    );
    highlightSavedCalendarItem(response.booking.id);
    toastSuccess("Booking created.");
    closeCreateMode();
    await reloadCalendar();
  } catch (err) {
    newBookingError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not create booking.";
  } finally {
    newBookingSubmitting.value = false;
  }
}

async function submitNewReminder() {
  newReminderError.value = "";
  const form = newReminderForm.value;
  if (!form.title.trim()) {
    newReminderError.value = "Title is required.";
    return;
  }

  newReminderSubmitting.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      date: form.date,
      time: form.time,
      timezone: form.timezone,
      recurrence: form.recurrence,
      notes: form.notes.trim() || undefined,
    };
    const response = editingReminderId.value
      ? await api.put<{ ok: boolean; reminder: { id: string } }>(
          `/agent/reminders/${editingReminderId.value}`,
          payload,
        )
      : await api.post<{ ok: boolean; reminder: { id: string } }>(
          "/agent/reminders",
          payload,
        );
    highlightSavedCalendarItem(response.reminder.id);
    toastSuccess(
      editingReminderId.value
        ? "Reminder updated."
        : "Reminder added to your calendar.",
    );
    closeCreateMode();
    await reloadCalendar();
  } catch (err) {
    newReminderError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not save reminder.";
  } finally {
    newReminderSubmitting.value = false;
  }
}

async function submitNewEvent(): Promise<boolean> {
  newEventError.value = "";
  const form = newEventForm.value;
  if (!form.title.trim()) {
    newEventError.value = "Title is required.";
    return false;
  }
  if (form.recurrence === "custom") {
    if (form.customEnd === "on" && !form.customUntilDate) {
      newEventError.value = "Choose an end date or set custom recurrence to never end.";
      return false;
    }
    if (form.customEnd === "after" && (!form.customCount || form.customCount < 1)) {
      newEventError.value = "Custom recurrence needs at least one occurrence.";
      return false;
    }
  }

  newEventSubmitting.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      startDate: form.startDate,
      startTime: form.startTime,
      endDate: form.endDate,
      endTime: form.endTime,
      timezone: form.timezone,
      allDay: form.allDay,
      recurrenceRule: buildEventRecurrenceRule(),
      location: form.location.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    const response = editingEventId.value
      ? await api.put<{ ok: boolean; event: { id: string } }>(
          `/calendar/events/${editingEventId.value}`,
          payload,
        )
      : await api.post<{ ok: boolean; event: { id: string } }>(
          "/calendar/events",
          payload,
    );
    highlightSavedCalendarItem(response.event.id);
    toastSuccess(
      editingEventId.value
        ? "Event updated."
        : "Event added to your calendar.",
    );
    closeCreateMode();
    await reloadCalendar();
    return true;
  } catch (err) {
    newEventError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not save event.";
    return false;
  } finally {
    newEventSubmitting.value = false;
  }
}

async function submitNewBirthday() {
  newEventError.value = "";
  const form = newBirthdayForm.value;
  if (!form.name.trim()) {
    newEventError.value = "Name is required.";
    return;
  }

  newEventSubmitting.value = true;
  try {
    const payload = {
      title: `${form.name.trim()}'s birthday`,
      startDate: form.date,
      endDate: form.date,
      timezone: defaultFormTimeZone,
      allDay: true,
      kind: "birthday",
      recurrenceRule: "yearly",
      notes: form.notes.trim() || undefined,
    };
    const response = editingEventId.value
      ? await api.put<{ ok: boolean; event: { id: string } }>(
          `/calendar/events/${editingEventId.value}`,
          payload,
        )
      : await api.post<{ ok: boolean; event: { id: string } }>(
          "/calendar/events",
          payload,
    );
    highlightSavedCalendarItem(response.event.id);
    toastSuccess(
      editingEventId.value
        ? "Birthday updated."
        : "Birthday added to your calendar.",
    );
    closeCreateMode();
    await reloadCalendar();
  } catch (err) {
    newEventError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not save birthday.";
  } finally {
    newEventSubmitting.value = false;
  }
}

function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  importForm.value.file = input?.files?.[0] || null;
}

async function submitImport() {
  importError.value = "";
  if (importForm.value.mode === "url" && !importForm.value.url.trim()) {
    importError.value = "Paste an iCalendar subscription URL.";
    return;
  }
  if (importForm.value.mode === "file" && !importForm.value.file) {
    importError.value = "Choose an .ics file to import.";
    return;
  }

  importSubmitting.value = true;
  try {
    let response: {
      ok: boolean;
      importedCount: number;
      source: { name: string };
    };

    if (importForm.value.mode === "url") {
      response = await api.post<{
        ok: boolean;
        importedCount: number;
        source: { name: string };
      }>("/calendar/sources/ics-url", {
        name: importForm.value.name.trim(),
        url: importForm.value.url.trim(),
      });
    } else {
      const formData = new FormData();
      if (importForm.value.file) formData.set("file", importForm.value.file);
      if (importForm.value.name.trim()) {
        formData.set("name", importForm.value.name.trim());
      }
      response = await api.upload<{
        ok: boolean;
        importedCount: number;
        source: { name: string };
      }>("/calendar/import/ics", formData);
    }

    toastSuccess(
      `${importForm.value.mode === "url" ? "Synced" : "Imported"} ${response.importedCount} events from ${response.source.name}.`,
    );
    closeCreateMode();
    await reloadCalendar();
  } catch (err) {
    importError.value =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not import calendar.";
  } finally {
    importSubmitting.value = false;
  }
}

watch(
  () => sites.sites.length,
  (nextCount) => {
    if (nextCount > 0 && !newBookingForm.value.username) {
      newBookingForm.value.username = sites.sites[0]?.username ?? "";
    }
  },
);

function closeCalendarHeaderMenus() {
  calendarPickerOpen.value = false;
  showCreateMenu.value = false;
  showSettingsMenu.value = false;
}

function focusCalendarHeaderTrigger(kind: "create" | "settings") {
  const prefix = isCompactCalendar.value ? "mobile" : "desktop";
  document.getElementById(`calendar-${prefix}-${kind}`)?.focus();
}

function isCalendarShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      Boolean(target.closest("input, textarea, select, [contenteditable='true']")))
  );
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (availabilityModalOpen.value) {
      closeAvailabilitySettings();
      return;
    }
    if (boardContextAnchor.value) {
      closeBoardContext();
      return;
    }
    closeCalendarHeaderMenus();
    return;
  }

  if (
    event.defaultPrevented ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isCalendarShortcutTarget(event.target) ||
    boardContextAnchor.value ||
    selectedModalEvent.value ||
    activeCreateMode.value ||
    availabilityModalOpen.value ||
    calendarsDialogOpen.value
  ) {
    return;
  }

  const shortcut = event.key.toLowerCase();
  if (shortcut === "t") onCalendarToday();
  else if (shortcut === "s") onRangeChange("schedule");
  else if (shortcut === "w" && !isCompactCalendar.value) onRangeChange("week");
  else if (shortcut === "m") onRangeChange("month");
  else return;
  event.preventDefault();
}

function handleWindowClick() {
  closeCalendarHeaderMenus();
  if (boardContextAnchor.value) closeBoardContext(false);
}

function handleWindowScroll(event: Event) {
  if (!boardContextAnchor.value) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.closest(".calendar-context-popover")
  ) {
    return;
  }
  closeBoardContext(false);
}

function handleWindowResize() {
  if (boardContextAnchor.value) closeBoardContext(false);
}

onMounted(async () => {
  loadCalendarVisibility();
  mobileMediaQuery = window.matchMedia(
    `(max-width: ${CALENDAR_COMPACT_MAX_WIDTH_PX}px)`,
  );
  applyInitialCalendarViewport(mobileMediaQuery.matches);
  mobileMediaQuery.addEventListener("change", onMobileCalendarChange);
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener("click", handleWindowClick);
  window.addEventListener("scroll", handleWindowScroll, true);
  window.addEventListener("resize", handleWindowResize);
  await sites.ensureSites();
  if (sites.sites[0]) {
    newBookingForm.value.username = sites.sites[0].username;
  }
  await reloadCalendar();
});

onBeforeUnmount(() => {
  calendarLoadController?.abort();
  calendarPickerLoadController?.abort();
  if (transientHighlightTimer) clearTimeout(transientHighlightTimer);
  mobileMediaQuery?.removeEventListener("change", onMobileCalendarChange);
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener("click", handleWindowClick);
  window.removeEventListener("scroll", handleWindowScroll, true);
  window.removeEventListener("resize", handleWindowResize);
});
</script>

<template>
  <div class="ops-page calendar-spike">
    <Teleport to="#app-side-nav-mobile-page-controls" defer>
      <div
        v-if="isCompactCalendar && !initialCalendarLoading && !showCalendarUnavailable"
        class="cal-mobile-nav-controls"
        @click.stop
      >
        <div class="cal-period-switcher cal-period-switcher--mobile" aria-label="Calendar period">
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            class="cal-arrow"
            aria-label="Previous period"
            title="Previous period"
            type="button"
            @click="onToolbarPrev"
          >
            <UiIcon name="ChevronLeft" :size="18" aria-hidden="true" />
          </Button>
          <button
            type="button"
            class="cal-period-title"
            :aria-expanded="calendarPickerOpen"
            aria-haspopup="dialog"
            aria-label="Choose calendar date"
            @click="toggleCalendarPicker"
          >
            {{ mobileToolbarTitle }}
          </button>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            class="cal-arrow"
            aria-label="Next period"
            title="Next period"
            type="button"
            @click="onToolbarNext"
          >
            <UiIcon name="ChevronRight" :size="18" aria-hidden="true" />
          </Button>
          <DatePickerPopover
            v-if="calendarPickerOpen"
            :month-key="calendarPickerMonth"
            :selected-date="calendarPickerSelectedDate"
            :today-date="todayDayKey"
            :marked-dates="calendarPickerMarkedDates"
            marked-date-label="calendar items scheduled"
            aria-label="Choose calendar date"
            @move-month="moveCalendarPickerMonth"
            @select-date="chooseCalendarPickerDay"
            @today="pickCalendarToday"
          />
        </div>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          class="cal-mobile-icon-btn"
          :aria-label="mobileRangeCycleLabel"
          :title="mobileRangeCycleLabel"
          type="button"
          @click="cycleRangeMode"
        >
          <UiIcon :name="mobileRangeIcon" :size="18" aria-hidden="true" />
        </Button>
        <div class="cal-mobile-settings-wrap">
          <Button
            id="calendar-mobile-settings"
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            class="cal-mobile-icon-btn"
            aria-label="Calendar settings"
            title="Calendar settings"
            type="button"
            :aria-expanded="showSettingsMenu"
            @click="toggleSettingsMenu"
          >
            <UiIcon name="Settings" :size="18" aria-hidden="true" />
          </Button>
          <div
            v-if="showSettingsMenu"
            class="cal-create-menu cal-settings-menu cal-settings-menu--mobile-nav"
          >
            <button
              type="button"
              class="cal-settings-menu-item"
              @click="openCalendarsDialog"
            >
              <UiIcon name="CalendarDays" :size="16" aria-hidden="true" />
              Calendars
            </button>
            <button
              type="button"
              class="cal-settings-menu-item"
              @click="openAvailabilitySettings"
            >
              <UiIcon name="CalendarClock" :size="16" aria-hidden="true" />
              Availability
            </button>
            <button
              type="button"
              class="cal-settings-menu-item"
              @click="openCreateMode('import')"
            >
              <UiIcon name="RefreshCw" :size="16" aria-hidden="true" />
              Sync calendar
            </button>
          </div>
        </div>
        <div class="cal-mobile-create-wrap">
          <Button
            id="calendar-mobile-create"
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            class="cal-mobile-icon-btn"
            aria-label="Create calendar item"
            title="Create calendar item"
            type="button"
            :aria-expanded="showCreateMenu"
            @click="toggleCreateMenu"
          >
            <UiIcon name="Plus" :size="18" aria-hidden="true" />
          </Button>
          <div
            v-if="showCreateMenu"
            class="cal-create-menu cal-create-menu--mobile-nav"
          >
            <button type="button" @click="openCreateMode('booking')">
              New booking
            </button>
            <button type="button" @click="openCreateMode('reminder')">
              New reminder
            </button>
            <button type="button" @click="openCreateMode('event')">
              New event
            </button>
            <button
              v-if="socialPublishingReady"
              type="button"
              @click="openCreateMode('social')"
            >
              New Social Publication
            </button>
            <button type="button" @click="openCreateMode('birthday')">
              New birthday
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <main class="main">
      <div
        v-if="!initialCalendarLoading && !showCalendarUnavailable"
        class="cal-toolbar"
        @click.stop
      >
        <div class="cal-toolbar-left">
          <div class="cal-view-toggle" role="group" aria-label="Calendar range">
            <button
              type="button"
              :class="{ 'is-on': rangeMode === 'schedule' }"
              :aria-pressed="rangeMode === 'schedule'"
              title="Schedule view (S)"
              @click="onRangeChange('schedule')"
            >
              Schedule
            </button>
            <button
              type="button"
              :class="{ 'is-on': rangeMode === 'week' }"
              :aria-pressed="rangeMode === 'week'"
              title="Week view (W)"
              @click="onRangeChange('week')"
            >
              Week
            </button>
            <button
              type="button"
              :class="{ 'is-on': rangeMode === 'month' }"
              :aria-pressed="rangeMode === 'month'"
              title="Month view (M)"
              @click="onRangeChange('month')"
            >
              Month
            </button>
          </div>
        </div>
        <div class="cal-period-switcher" aria-label="Calendar period">
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            class="cal-arrow"
            aria-label="Previous period"
            title="Previous period"
            type="button"
            @click="onToolbarPrev"
          >
            <UiIcon name="ChevronLeft" :size="20" aria-hidden="true" />
          </Button>
          <button
            type="button"
            class="cal-period-title"
            :aria-expanded="calendarPickerOpen"
            aria-haspopup="dialog"
            aria-label="Choose calendar date"
            @click="toggleCalendarPicker"
          >
            {{ activeToolbarTitle }}
          </button>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            class="cal-arrow"
            aria-label="Next period"
            title="Next period"
            type="button"
            @click="onToolbarNext"
          >
            <UiIcon name="ChevronRight" :size="20" aria-hidden="true" />
          </Button>
          <DatePickerPopover
            v-if="calendarPickerOpen"
            :month-key="calendarPickerMonth"
            :selected-date="calendarPickerSelectedDate"
            :today-date="todayDayKey"
            :marked-dates="calendarPickerMarkedDates"
            marked-date-label="calendar items scheduled"
            aria-label="Choose calendar date"
            @move-month="moveCalendarPickerMonth"
            @select-date="chooseCalendarPickerDay"
            @today="pickCalendarToday"
          />
        </div>
        <div class="cal-toolbar-actions">
          <div class="cal-create-wrap">
            <Button
              id="calendar-desktop-settings"
              color="ghost"
              shape="soft"
              size="compact"
              icon-only
              class="cal-toolbar-icon-btn"
              aria-label="Calendar settings"
              title="Calendar settings"
              type="button"
              :aria-expanded="showSettingsMenu"
              @click="toggleSettingsMenu"
            >
              <UiIcon name="Settings" :size="18" aria-hidden="true" />
            </Button>
            <div
              v-if="showSettingsMenu"
              class="cal-create-menu cal-settings-menu cal-settings-menu--toolbar"
            >
              <button
                type="button"
                class="cal-settings-menu-item"
                @click="openAvailabilitySettings"
              >
                <UiIcon name="CalendarClock" :size="16" aria-hidden="true" />
                Availability
              </button>
              <button
                type="button"
                class="cal-settings-menu-item"
                @click="openCreateMode('import')"
              >
                <UiIcon name="RefreshCw" :size="16" aria-hidden="true" />
                Sync calendar
              </button>
            </div>
          </div>
          <div class="cal-create-wrap">
            <Button
              id="calendar-desktop-create"
              color="ghost"
              shape="soft"
              size="compact"
              icon-only
              class="cal-toolbar-icon-btn"
              aria-label="Create calendar item"
              title="Create calendar item"
              type="button"
              :aria-expanded="showCreateMenu"
              @click="toggleCreateMenu"
            >
              <UiIcon name="Plus" :size="18" aria-hidden="true" />
            </Button>
            <div
              v-if="showCreateMenu"
              class="cal-create-menu cal-create-menu--toolbar"
            >
              <button type="button" @click="openCreateMode('booking')">
                New booking
              </button>
              <button type="button" @click="openCreateMode('reminder')">
                New reminder
              </button>
              <button type="button" @click="openCreateMode('event')">
                New event
              </button>
              <button
                v-if="socialPublishingReady"
                type="button"
                @click="openCreateMode('social')"
              >
                New Social Publication
              </button>
              <button type="button" @click="openCreateMode('birthday')">
                New birthday
              </button>
            </div>
          </div>
        </div>
      </div>

      <PageLoading v-if="initialCalendarLoading" label="Loading calendar..." />
      <div
        v-else-if="showCalendarUnavailable"
        class="cal-error-banner"
        role="alert"
      >
        {{ error }}
      </div>
      <template v-else>
        <div
          class="cal-shell"
          :class="{
            'cal-shell--board-view': rangeMode !== 'schedule',
            'cal-shell--refreshing': calendarRefreshing,
          }"
        >
            <div
              v-if="calendarRefreshing"
              class="cal-refresh-indicator"
              role="status"
              aria-live="polite"
            >
              Updating…
            </div>
            <aside class="cal-sidebar">
              <div class="cal-sidebar-calendar-tools">
                <CalendarMiniMonth
                  :year="miniCalendarCursor.getFullYear()"
                  :month="miniCalendarCursor.getMonth()"
                  :today-day-key="todayDayKey"
                  :selected-day-key="focusedDayKey"
                  @pick-day="onMiniPick"
                />
              </div>
              <section
                class="cal-filters cal-sidebar-calendar-tools"
                aria-label="Calendars"
              >
                <h3 class="cal-filters-title">Calendars</h3>
                <label class="cal-filter-row">
                  <input
                    type="checkbox"
                    class="cal-filter-input"
                    :checked="allCalendarsVisible"
                    :indeterminate="someCalendarsVisible"
                    @change="onAllCalendarsVisibilityChange"
                  />
                  <span
                    class="cal-swatch cal-swatch--neutral"
                    aria-hidden="true"
                  />
                  <span class="cal-filter-label">All calendars</span>
                </label>
                <div
                  v-for="option in siteOptions"
                  :key="option.value"
                  class="cal-filter-row cal-filter-row--with-action"
                >
                  <label class="cal-filter-choice">
                    <input
                      type="checkbox"
                      class="cal-filter-input"
                      :checked="isCalendarVisible(option.value)"
                      @change="onCalendarVisibilityChange(option.value, $event)"
                    />
                    <span
                      class="cal-swatch"
                      :style="{ background: siteDotColor(option.value) }"
                      aria-hidden="true"
                    />
                    <span class="cal-filter-label">
                      {{ option.label }}
                      <small
                        v-if="option.source?.lastSyncError"
                        class="cal-filter-meta cal-filter-meta--error"
                      >
                        Sync failed
                      </small>
                      <small
                        v-else-if="option.source?.kind === 'ics_url'"
                        class="cal-filter-meta"
                      >
                        {{ option.source.sourceUrlHint || "Subscribed" }}
                      </small>
                    </span>
                  </label>
                  <button
                    v-if="option.source"
                    type="button"
                    class="cal-filter-action"
                    :disabled="removingSourceId === option.source.id"
                    :aria-label="`Remove ${option.source.name}`"
                    :title="`Remove ${option.source.name}`"
                    @click="removeImportedCalendarSource(option.source)"
                  >
                    <UiIcon name="Trash2" :size="14" aria-hidden="true" />
                  </button>
                </div>
              </section>
            </aside>

            <div class="cal-board-wrap">
              <CalendarAgenda
                v-if="rangeMode === 'schedule'"
                :events="visibleEvents"
                :range-mode="rangeMode"
                :range-label="rangeLabel"
                :start-day-key="calendarWindowStartDayKey"
                :end-day-key="calendarWindowEndDayKey"
                :focus-day-key="focusedDayKey"
                :today-day-key="todayDayKey"
                :prefer-select-event-id="preferSelectEventId"
                :highlighted-event-id="transientHighlightId"
                :show-inline-detail="!isCompactCalendar"
                :cancelling-booking-id="cancellingBookingId"
                :can-load-more="canLoadMoreSchedule"
                :loading-more="calendarRefreshing"
                title="Schedule"
                description="Upcoming items across your visible calendars."
                @clear-focus="focusedDayKey = null"
                @consumed-prefer-select="preferSelectEventId = null"
                @select-event="onAgendaSelectEvent"
                @event-action="handleEventAction"
                @event-danger-action="handleEventDangerAction"
                @cancel-booking="handleCancelBooking"
                @load-more="loadMoreSchedule"
              />
              <CalendarAgenda
                v-else-if="rangeMode === 'day'"
                :events="visibleEvents"
                title="Daily schedule"
                description="Bookings, reminders, events, tasks, social Publications, and imported calendars."
                range-label="Day"
                range-mode="day"
                :start-day-key="calendarWindowStartDayKey"
                :end-day-key="calendarWindowEndDayKey"
                :focus-day-key="focusedAgendaDayKey"
                :today-day-key="todayDayKey"
                :prefer-select-event-id="preferSelectEventId"
                :highlighted-event-id="transientHighlightId"
                :show-inline-detail="!isCompactCalendar"
                :cancelling-booking-id="cancellingBookingId"
                @event-action="handleEventAction"
                @event-danger-action="handleEventDangerAction"
                @cancel-booking="handleCancelBooking"
                @clear-focus="focusedDayKey = null"
                @consumed-prefer-select="preferSelectEventId = null"
                @select-event="onAgendaSelectEvent"
              />
              <CalendarWeekBoard
                v-else-if="rangeMode === 'week'"
                :week-start="weekStart"
                :events="visibleEvents"
                :selected-event-id="boardHighlightId"
                :highlighted-event-id="transientHighlightId"
                :today-day-key="todayDayKey"
                @select-event="onBoardSelectEvent"
                @select-slot="onWeekSelectSlot"
                @show-day="onBoardShowDay"
              />
              <template v-else>
                <CalendarMonthBoard
                  :year="monthCursor.getFullYear()"
                  :month="monthCursor.getMonth()"
                  :events="visibleEvents"
                  :selected-event-id="boardHighlightId"
                  :highlighted-event-id="transientHighlightId"
                  :today-day-key="todayDayKey"
                  @select-event="onBoardSelectEvent"
                  @select-day="onBoardSelectDay"
                  @show-day="onBoardShowDay"
                />
              </template>
            </div>
        </div>

      </template>
    </main>

    <CalendarEventPopover
      v-if="selectedContextEvent && boardContextAnchor"
      :event="selectedContextEvent"
      :anchor="boardContextAnchor"
      :cancelling-booking="cancellingBookingId === selectedContextEvent.id"
      @close="closeBoardContext"
      @event-action="handleEventAction"
      @event-danger-action="handleEventDangerAction"
      @cancel-booking="handleCancelBooking"
    />

    <CalendarQuickEventPopover
      v-if="quickWeekSlot && boardContextAnchor && !isCompactCalendar"
      :slot="quickWeekSlot"
      :anchor="boardContextAnchor"
      :submitting="newEventSubmitting"
      :error="newEventError"
      @close="closeBoardContext"
      @submit="submitWeekQuickEvent"
      @more-options="openWeekSlotMoreOptions"
    />

    <AppDialog
      :open="Boolean(selectedModalEvent)"
      labelled-by="event-detail-title"
      @close="closeBoardContext(false)"
    >
      <aside
        v-if="selectedModalEvent"
        class="modal-card event-detail-modal"
      >
        <div class="modal-header">
          <div>
            <p class="event-detail-source">{{ selectedModalEvent.sourceLabel }}</p>
            <h2 id="event-detail-title">{{ selectedModalEvent.title }}</h2>
          </div>
          <button
            type="button"
            class="icon-close"
            aria-label="Close"
            @click="closeBoardContext(false)"
          >
            ×
          </button>
        </div>

        <p class="event-detail-summary">{{ selectedModalEvent.summary }}</p>
        <p class="event-detail-time">
          {{ formatEventTimeRange(selectedModalEvent) }}
        </p>
        <p class="event-detail-site">{{ selectedModalEvent.siteLabel }}</p>

        <dl class="event-detail-list">
          <div
            v-for="line in selectedModalEvent.detailLines"
            :key="line.label"
            class="event-detail-row"
          >
            <dt>{{ line.label }}</dt>
            <dd>
              <a v-if="line.href" :href="line.href" target="_blank" rel="noopener noreferrer">
                {{ line.value }}
              </a>
              <template v-else>{{ line.value }}</template>
            </dd>
          </div>
        </dl>

        <div v-if="selectedModalEvent.notes" class="event-detail-notes">
          <h3>Notes</h3>
          <p>{{ selectedModalEvent.notes }}</p>
        </div>

        <button
          v-if="selectedModalEvent.actionLabel"
          type="button"
          class="event-detail-action"
          @click="handleEventAction(selectedModalEvent)"
        >
          {{ selectedModalEvent.actionLabel }}
        </button>

        <button
          v-if="selectedModalEvent.dangerActionLabel"
          type="button"
          class="event-detail-action event-detail-action--danger"
          @click="handleEventDangerAction(selectedModalEvent)"
        >
          {{ selectedModalEvent.dangerActionLabel }}
        </button>

        <button
          v-if="selectedModalEvent.sourceLabel === 'Booking'"
          type="button"
          class="event-detail-action event-detail-action--danger"
          :disabled="cancellingBookingId === selectedModalEvent.id"
          @click="handleCancelBooking(selectedModalEvent)"
        >
          {{
            cancellingBookingId === selectedModalEvent.id
              ? "Cancelling…"
              : "Cancel booking"
          }}
        </button>
      </aside>
    </AppDialog>

    <AppDialog
      :open="isQuickCreateMode(activeCreateMode)"
      labelled-by="quick-create-title"
      @close="closeCreateMode"
    >
      <div
        class="modal-card quick-create-modal"
        :class="{ 'quick-create-modal--compact': compactEventCreate }"
      >
        <div class="modal-header">
          <div>
            <h2 id="quick-create-title">{{ quickCreateHeading }}</h2>
          </div>
          <button
            type="button"
            class="icon-close"
            aria-label="Close"
            @click="closeCreateMode"
          >
            ×
          </button>
        </div>

        <div
          v-if="!compactEventCreate && !reschedulingPublicationId"
          class="create-tabs"
          role="group"
          aria-label="Create type"
        >
          <button
            v-for="mode in visibleQuickCreateModes"
            :id="`quick-create-tab-${mode}`"
            :key="mode"
            type="button"
            :aria-pressed="activeCreateMode === mode"
            :class="{ active: activeCreateMode === mode }"
            @click="switchQuickCreateMode(mode)"
          >
            {{ QUICK_CREATE_LABELS[mode] }}
          </button>
        </div>

        <form
          v-if="activeCreateMode === 'event' && compactEventCreate"
          class="booking-form compact-event-form"
          @submit.prevent="submitNewEvent"
        >
          <label>
            <span>Title</span>
            <input
              v-model="newEventForm.title"
              type="text"
              placeholder="Add title"
              required
              autofocus
            />
          </label>

          <div class="field-row">
            <label>
              <span>Date</span>
              <input
                v-model="newEventForm.startDate"
                type="date"
                required
                @change="syncEventEndFromStart"
              />
            </label>
            <label>
              <span>Time</span>
              <input
                v-model="newEventForm.startTime"
                type="time"
                required
                @change="syncEventEndFromStart"
              />
            </label>
          </div>

          <p v-if="newEventError" class="form-error" role="alert">
            {{ newEventError }}
          </p>

          <div class="modal-actions">
            <Button
              size="small"
              type="button"
              color="outline"
              @click="compactEventCreate = false"
            >
              More options
            </Button>
            <Button
              v-if="socialPublishingReady"
              size="small"
              type="button"
              color="outline"
              @click="switchQuickCreateMode('social')"
            >
              Schedule social
            </Button>
            <Button
              size="small"
              type="submit"
              color="primary"
              :disabled="newEventSubmitting"
            >
              {{ newEventSubmitting ? "Creating…" : "Create event" }}
            </Button>
          </div>
        </form>

        <form
          v-else-if="activeCreateMode === 'event'"
          id="quick-create-panel-event"
          class="booking-form"
          @submit.prevent="submitNewEvent"
        >
          <p class="form-hint">
            Use events for time blocks, appointments, or anything that belongs
            on your calendar without going through the booking flow.
          </p>

          <label>
            <span>Title</span>
            <input
              v-model="newEventForm.title"
              type="text"
              required
            />
          </label>

          <label class="checkbox-row">
            <input v-model="newEventForm.allDay" type="checkbox" @change="syncEventEndFromStart" />
            <span>All day</span>
          </label>

          <div class="field-row">
            <label>
              <span>Start date</span>
              <input v-model="newEventForm.startDate" type="date" required @change="syncEventEndFromStart" />
            </label>
            <label v-if="!newEventForm.allDay">
              <span>Start time</span>
              <input v-model="newEventForm.startTime" type="time" required @change="syncEventEndFromStart" />
            </label>
          </div>

          <div class="field-row">
            <label>
              <span>End date</span>
              <input v-model="newEventForm.endDate" type="date" required />
            </label>
            <label v-if="!newEventForm.allDay">
              <span>End time</span>
              <input v-model="newEventForm.endTime" type="time" required />
            </label>
          </div>

          <div class="field-row">
            <label>
              <span>Timezone</span>
              <input v-model="newEventForm.timezone" type="text" required />
            </label>
            <label>
              <span>Location</span>
              <input v-model="newEventForm.location" type="text" />
            </label>
          </div>

          <label>
            <span>Repeat</span>
            <select v-model="newEventForm.recurrence">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <div
            v-if="newEventForm.recurrence === 'custom'"
            class="custom-recurrence"
          >
            <div class="field-row">
              <label>
                <span>Repeat every</span>
                <input
                  v-model.number="newEventForm.customInterval"
                  type="number"
                  min="1"
                  max="99"
                  required
                />
              </label>
              <label>
                <span>Unit</span>
                <select v-model="newEventForm.customUnit">
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                </select>
              </label>
            </div>

            <label>
              <span>Ends</span>
              <select v-model="newEventForm.customEnd">
                <option value="never">Never</option>
                <option value="on">On date</option>
                <option value="after">After occurrences</option>
              </select>
            </label>

            <label v-if="newEventForm.customEnd === 'on'">
              <span>End date</span>
              <input v-model="newEventForm.customUntilDate" type="date" />
            </label>

            <label v-if="newEventForm.customEnd === 'after'">
              <span>Occurrences</span>
              <input
                v-model.number="newEventForm.customCount"
                type="number"
                min="1"
                max="999"
              />
            </label>
          </div>

          <label>
            <span>Notes</span>
            <textarea
              v-model="newEventForm.notes"
              rows="3"
              maxlength="2000"
              placeholder="Optional"
            />
          </label>

          <p v-if="newEventError" class="form-error" role="alert">
            {{ newEventError }}
          </p>

          <div class="modal-actions">
            <Button
              size="small"
              type="button"
              color="outline"
              @click="closeCreateMode"
            >
              Cancel
            </Button>
            <Button
              size="small"
              type="submit"
              color="primary"
              :disabled="newEventSubmitting"
            >
              {{
                newEventSubmitting
                  ? editingEventId
                    ? "Updating…"
                    : "Creating…"
                  : editingEventId
                    ? "Update event"
                    : "Create event"
              }}
            </Button>
          </div>
        </form>

        <form
          v-else-if="activeCreateMode === 'birthday'"
          id="quick-create-panel-birthday"
          class="booking-form"
          @submit.prevent="submitNewBirthday"
        >
          <p class="form-hint">
            Birthdays are all-day events that repeat every year.
          </p>

          <label>
            <span>Name</span>
            <input
              v-model="newBirthdayForm.name"
              type="text"
              required
            />
          </label>

          <label>
            <span>Birthday</span>
            <input v-model="newBirthdayForm.date" type="date" required />
          </label>

          <label>
            <span>Notes</span>
            <textarea
              v-model="newBirthdayForm.notes"
              rows="3"
              maxlength="2000"
              placeholder="Optional"
            />
          </label>

          <p v-if="newEventError" class="form-error" role="alert">
            {{ newEventError }}
          </p>

          <div class="modal-actions">
            <Button
              size="small"
              type="button"
              color="outline"
              @click="closeCreateMode"
            >
              Cancel
            </Button>
            <Button
              size="small"
              type="submit"
              color="primary"
              :disabled="newEventSubmitting"
            >
              {{
                newEventSubmitting
                  ? editingEventId
                    ? "Updating…"
                    : "Creating…"
                  : editingEventId
                    ? "Update birthday"
                    : "Create birthday"
              }}
            </Button>
          </div>
        </form>

        <form
          v-else-if="activeCreateMode === 'reminder'"
          id="quick-create-panel-reminder"
          class="booking-form"
          @submit.prevent="submitNewReminder"
        >
          <p class="form-hint">
            Reminders use your selected timezone and stay in sync with the ME3
            agent reminder system.
          </p>

          <label>
            <span>Title</span>
            <input
              v-model="newReminderForm.title"
              type="text"
              required
            />
          </label>

          <div class="field-row">
            <label>
              <span>Date</span>
              <input v-model="newReminderForm.date" type="date" required />
            </label>
            <label>
              <span>Time</span>
              <input v-model="newReminderForm.time" type="time" required />
            </label>
          </div>

          <div class="field-row">
            <label>
              <span>Timezone</span>
              <input v-model="newReminderForm.timezone" type="text" required />
            </label>
            <label>
              <span>Repeat</span>
              <select v-model="newReminderForm.recurrence">
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>

          <label>
            <span>Notes</span>
            <textarea
              v-model="newReminderForm.notes"
              rows="3"
              maxlength="2000"
              placeholder="Optional"
            />
          </label>

          <p v-if="newReminderError" class="form-error" role="alert">
            {{ newReminderError }}
          </p>

          <div class="modal-actions">
            <Button
              size="small"
              type="button"
              color="outline"
              @click="closeCreateMode"
            >
              Cancel
            </Button>
            <Button
              size="small"
              type="submit"
              color="primary"
              :disabled="newReminderSubmitting"
            >
              {{
                newReminderSubmitting
                  ? editingReminderId
                    ? "Updating…"
                    : "Creating…"
                  : editingReminderId
                    ? "Update reminder"
                    : "Create reminder"
              }}
            </Button>
          </div>
        </form>

        <form
          v-else-if="activeCreateMode === 'social'"
          id="quick-create-panel-social"
          class="booking-form social-schedule-form"
          @submit.prevent="submitSocialSchedule"
        >
          <p class="form-hint">
            <template v-if="reschedulingPublicationId">
              Change only the planned time and timezone. The approved Version,
              account, copy, and media stay unchanged.
            </template>
            <template v-else>
              Choose an exact approved Version. Calendar creates a Publication;
              it never creates a blank Post or edits the approved content.
            </template>
          </p>

          <p v-if="socialScheduleLoading" role="status" class="form-hint">
            Loading approved Versions…
          </p>

          <template v-else>
            <label v-if="!reschedulingPublicationId && socialScheduleOptions.length">
              <span>Approved Version</span>
              <select v-model="socialScheduleForm.versionId" required autofocus>
                <option
                  v-for="option in socialScheduleOptions"
                  :key="option.versionId"
                  :value="option.versionId"
                >
                  {{ option.postTitle }} · {{ option.versionLabel }} ·
                  {{ option.accountLabel }}
                </option>
              </select>
            </label>

            <dl
              v-if="selectedSocialScheduleOption"
              class="social-schedule-summary"
            >
              <div>
                <dt>Post</dt>
                <dd>{{ selectedSocialScheduleOption.postTitle }}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{{ selectedSocialScheduleOption.versionLabel }}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{{ selectedSocialScheduleOption.accountLabel }}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{{ selectedSocialScheduleOption.sourceLabel }}</dd>
              </div>
            </dl>

            <dl
              v-else-if="reschedulingSocialPublication"
              class="social-schedule-summary"
            >
              <div>
                <dt>Post</dt>
                <dd>{{ reschedulingSocialPublication.postTitle }}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{{ reschedulingSocialPublication.versionLabel }}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{{ reschedulingSocialPublication.accountLabel }}</dd>
              </div>
            </dl>

            <div
              v-if="!reschedulingPublicationId && socialScheduleOptions.length === 0"
              class="social-schedule-empty"
            >
              <p>
                No approved, connected Version is ready to schedule. Approve a
                supported Version in Social Publishing first.
              </p>
              <Button
                size="small"
                type="button"
                color="outline"
                @click="openSelectedPostVersion"
              >
                Open Social Publishing
              </Button>
            </div>

            <template
              v-if="reschedulingPublicationId || socialScheduleOptions.length > 0"
            >
              <div class="field-row">
                <label>
                  <span>Date</span>
                  <input v-model="socialScheduleForm.date" type="date" required />
                </label>
                <label>
                  <span>Time</span>
                  <input v-model="socialScheduleForm.time" type="time" required />
                </label>
              </div>

              <label>
                <span>Timezone</span>
                <input
                  v-model="socialScheduleForm.timezone"
                  type="text"
                  autocomplete="off"
                  required
                />
              </label>
            </template>
          </template>

          <p v-if="socialScheduleError" class="form-error" role="alert">
            {{ socialScheduleError }}
          </p>

          <div class="modal-actions social-schedule-actions">
            <Button
              v-if="reschedulingPublicationId || selectedSocialScheduleOption"
              size="small"
              type="button"
              color="ghost"
              @click="openSelectedPostVersion"
            >
              Open in Social Publishing
            </Button>
            <Button
              v-if="reschedulingPublicationId"
              size="small"
              type="button"
              color="danger"
              :disabled="socialScheduleSubmitting || socialScheduleCancelling"
              @click="cancelManagedSocialPublication"
            >
              {{ socialScheduleCancelling ? "Cancelling…" : "Cancel Publication" }}
            </Button>
            <Button
              size="small"
              type="button"
              color="outline"
              @click="closeCreateMode"
            >
              Close
            </Button>
            <Button
              v-if="reschedulingPublicationId || socialScheduleOptions.length > 0"
              size="small"
              type="submit"
              color="primary"
              :disabled="
                socialScheduleLoading ||
                socialScheduleSubmitting ||
                socialScheduleCancelling
              "
            >
              {{
                socialScheduleSubmitting
                  ? reschedulingPublicationId
                    ? "Rescheduling…"
                    : "Scheduling…"
                  : reschedulingPublicationId
                    ? "Reschedule Publication"
                    : "Schedule Publication"
              }}
            </Button>
          </div>
        </form>

        <form
          v-else
          id="quick-create-panel-booking"
          class="booking-form"
          @submit.prevent="submitNewBooking"
        >
          <p class="form-hint">
            Times use your site’s booking timezone from me.json. Confirmation
            emails and reminders follow your site’s booking settings.
          </p>

          <label>
            <span>Site</span>
            <select v-model="newBookingForm.username" required>
              <option disabled value="">Select a site</option>
              <option
                v-for="s in sites.sites"
                :key="s.username"
                :value="s.username"
              >
                {{ s.username }}.example.com
              </option>
            </select>
          </label>

          <label>
            <span>Guest name</span>
            <input
              v-model="newBookingForm.guestName"
              type="text"
              autocomplete="name"
              required
            />
          </label>

          <label>
            <span>Guest email</span>
            <input
              v-model="newBookingForm.guestEmail"
              type="email"
              autocomplete="email"
              required
            />
          </label>

          <div class="field-row">
            <label>
              <span>Date</span>
              <input v-model="newBookingForm.date" type="date" required />
            </label>
            <label>
              <span>Start time</span>
              <input v-model="newBookingForm.startTime" type="time" required />
            </label>
          </div>

          <label>
            <span>Duration (minutes)</span>
            <select v-model.number="newBookingForm.durationMinutes">
              <option :value="15">15</option>
              <option :value="30">30</option>
              <option :value="45">45</option>
              <option :value="60">60</option>
              <option :value="90">90</option>
              <option :value="120">120</option>
            </select>
          </label>

          <label>
            <span>Notes</span>
            <textarea
              v-model="newBookingForm.notes"
              rows="3"
              maxlength="2000"
              placeholder="Optional"
            />
          </label>

          <p v-if="newBookingError" class="form-error" role="alert">
            {{ newBookingError }}
          </p>

          <div class="modal-actions">
            <Button
              size="small"
              type="button"
              color="outline"
              @click="closeCreateMode"
            >
              Cancel
            </Button>
            <Button
              size="small"
              type="submit"
              color="primary"
              :disabled="newBookingSubmitting"
            >
              {{ newBookingSubmitting ? "Creating…" : "Create booking" }}
            </Button>
          </div>
        </form>
      </div>
    </AppDialog>

    <AppDialog
      :open="activeCreateMode === 'import'"
      labelled-by="import-calendar-title"
      @close="closeCreateMode"
    >
      <div class="modal-card">
        <div class="modal-header">
          <h2 id="import-calendar-title">Sync calendar</h2>
          <button
            type="button"
            class="icon-close"
            aria-label="Close"
            @click="closeCreateMode"
          >
            ×
          </button>
        </div>

        <form class="booking-form" @submit.prevent="submitImport">
          <div class="create-tabs" role="group" aria-label="Calendar sync method">
            <button
              type="button"
              :aria-pressed="importForm.mode === 'url'"
              :class="{ active: importForm.mode === 'url' }"
              @click="importForm.mode = 'url'"
            >
              Subscribe
            </button>
            <button
              type="button"
              :aria-pressed="importForm.mode === 'file'"
              :class="{ active: importForm.mode === 'file' }"
              @click="importForm.mode = 'file'"
            >
              Upload
            </button>
          </div>

          <p class="form-hint">
            <template v-if="importForm.mode === 'url'">
              Paste a Google, Apple, or Outlook `.ics` subscription URL. ME3
              will keep it as a read-only source and refresh it automatically.
            </template>
            <template v-else>
              Upload an `.ics` export to bring an external calendar into ME3 as
              a read-only source.
            </template>
          </p>

          <label>
            <span>Calendar name</span>
            <input
              v-model="importForm.name"
              type="text"
              placeholder="Optional"
            />
          </label>

          <label v-if="importForm.mode === 'url'">
            <span>Subscription URL</span>
            <input
              v-model="importForm.url"
              type="url"
              inputmode="url"
              placeholder="https://calendar.google.com/calendar/ical/..."
              autocomplete="off"
            />
          </label>

          <label v-else>
            <span>.ics file</span>
            <input
              accept=".ics,text/calendar"
              type="file"
              @change="onImportFileChange"
            />
          </label>

          <p v-if="importError" class="form-error" role="alert">
            {{ importError }}
          </p>

          <div class="modal-actions">
            <Button
              size="small"
              type="button"
              color="outline"
              @click="closeCreateMode"
            >
              Cancel
            </Button>
            <Button
              size="small"
              type="submit"
              color="primary"
              :disabled="importSubmitting"
            >
              {{ importSubmitLabel }}
            </Button>
          </div>
        </form>
      </div>
    </AppDialog>

    <AppDialog
      :open="calendarsDialogOpen"
      labelled-by="calendar-visibility-title"
      @close="closeCalendarsDialog"
    >
      <section class="modal-card calendars-modal">
        <div class="modal-header">
          <div>
            <h2 id="calendar-visibility-title">Calendars</h2>
            <p class="form-hint">Choose which calendars are visible.</p>
          </div>
          <button
            type="button"
            class="icon-close"
            aria-label="Close calendars"
            @click="closeCalendarsDialog"
          >
            ×
          </button>
        </div>

        <div class="cal-mobile-filter-list">
          <label class="cal-filter-row">
            <input
              type="checkbox"
              class="cal-filter-input"
              :checked="allCalendarsVisible"
              :indeterminate="someCalendarsVisible"
              @change="onAllCalendarsVisibilityChange"
            />
            <span
              class="cal-swatch cal-swatch--neutral"
              aria-hidden="true"
            />
            <span class="cal-filter-label">All calendars</span>
          </label>
          <label
            v-for="option in siteOptions"
            :key="option.value"
            class="cal-filter-row"
          >
            <input
              type="checkbox"
              class="cal-filter-input"
              :checked="isCalendarVisible(option.value)"
              @change="onCalendarVisibilityChange(option.value, $event)"
            />
            <span
              class="cal-swatch"
              :style="{ background: siteDotColor(option.value) }"
              aria-hidden="true"
            />
            <span class="cal-filter-label">{{ option.label }}</span>
          </label>
        </div>

        <div class="modal-actions">
          <Button
            size="small"
            type="button"
            color="primary"
            @click="closeCalendarsDialog"
          >
            Done
          </Button>
        </div>
      </section>
    </AppDialog>

    <AppDialog
      :open="availabilityModalOpen"
      aria-label="Booking availability"
      @close="closeAvailabilitySettings"
    >
      <div class="modal-card availability-modal">
        <div class="modal-header modal-header--actions-only">
          <button
            type="button"
            class="icon-close"
            aria-label="Close"
            @click="closeAvailabilitySettings"
          >
            ×
          </button>
        </div>

        <form class="availability-form" @submit.prevent="saveAvailabilitySettings">
          <PageLoading
            v-if="availabilityLoading"
            compact
            label="Loading availability..."
          />
          <BookingAvailabilityEditor
            v-else
            v-model:availability="availabilityDraft"
            v-model:buffer-time="availabilityBufferTime"
            v-model:timezone="availabilityTimezone"
            description="Set or update your availability here."
          />

          <p v-if="availabilityError" class="form-error" role="alert">
            {{ availabilityError }}
          </p>

          <div class="modal-actions">
            <Button
              size="small"
              type="button"
              color="outline"
              :disabled="availabilitySaving"
              @click="closeAvailabilitySettings"
            >
              Cancel
            </Button>
            <Button
              size="small"
              type="submit"
              color="primary"
              :disabled="
                availabilityLoading ||
                availabilitySaving ||
                !availabilitySourceProfile
              "
            >
              {{ availabilitySaving ? "Saving…" : "Save availability" }}
            </Button>
          </div>
        </form>
      </div>
    </AppDialog>

  </div>
</template>

<style scoped>
:global(body) {
  background: var(--color-bg);
}

.calendar-spike {
  --cal-grid: color-mix(in oklab, var(--color-border) 88%, transparent);
  --cal-surface: var(--color-bg);
  --cal-subtle: var(--color-bg-subtle);
  --cal-muted: var(--color-text-muted);
  --cal-hover: color-mix(in oklab, var(--color-text) 6%, transparent);
  --cal-today-bg: color-mix(in oklab, var(--color-text) 5%, transparent);
  --cal-chip: color-mix(in oklab, var(--color-text) 8%, var(--color-bg));
  --cal-accent: #7dbaf9;
}

.ops-page {
  min-height: 100vh;
  color: var(--color-text);
}

.main {
  max-width: 1680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 24px 40px;
}

.cal-toolbar {
  display: none;
}

.cal-mobile-nav-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px 44px 44px;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.cal-period-switcher--mobile {
  grid-template-columns: 44px auto 44px;
  justify-self: start;
  width: max-content;
  max-width: 100%;
  min-width: 0;
}

.cal-period-switcher--mobile .cal-arrow {
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
}

.cal-period-switcher--mobile .cal-period-title {
  min-height: 44px;
  max-width: min(220px, calc(100vw - 220px));
  padding-inline: 6px;
  font-size: 14px;
}

.cal-create-menu--mobile-nav,
.cal-settings-menu--mobile-nav {
  position: absolute;
  top: 0;
  right: calc(100% + 8px);
  left: auto;
  width: min(220px, calc(100vw - 32px));
}

:global(#app-side-nav-mobile-page-controls:has(.cal-mobile-nav-controls)) {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 45;
  min-height: var(--app-shell-mobile-nav-height);
  height: var(--app-shell-mobile-nav-height);
  overflow: visible;
  padding: var(--workspace-topbar-padding-block) 8px
    var(--workspace-topbar-padding-block)
    var(--app-shell-mobile-nav-leading-padding);
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-bg, var(--color-bg));
  box-sizing: border-box;
}

.cal-toolbar-left {
  display: flex;
  align-items: center;
  justify-self: start;
  min-width: 0;
  gap: 10px;
}

.cal-period-switcher {
  position: relative;
  display: grid;
  grid-template-columns: 44px minmax(148px, 260px) 44px;
  align-items: center;
  justify-self: center;
  gap: 4px;
  min-width: 0;
}

.cal-arrow {
  flex: 0 0 auto;
}

.cal-period-title {
  display: inline-flex;
  min-width: 0;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.cal-period-title:hover,
.cal-period-title[aria-expanded="true"] {
  background: var(--ui-surface-muted);
}

.cal-view-toggle {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.cal-view-toggle button {
  min-height: 44px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
}

.cal-view-toggle button:hover,
.cal-view-toggle button.is-on {
  background: var(--ui-surface-muted);
  color: var(--ui-text);
}

.cal-toolbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  justify-self: end;
  gap: 8px;
  min-width: 0;
}

.cal-error-banner {
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  font-size: 14px;
}

.cal-error-banner {
  color: #b33b2e;
}

.cal-shell {
  position: relative;
  display: grid;
  grid-template-columns: 228px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.cal-shell--refreshing .cal-board-wrap {
  opacity: 0.72;
  transition: opacity 140ms ease;
}

.cal-refresh-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text-muted);
  box-shadow: var(--ui-shadow-sm);
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
}

.cal-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cal-create-wrap {
  position: relative;
}

.cal-create-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 10;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  box-shadow: 0 18px 50px color-mix(in oklab, #000, transparent 86%);
}

.cal-create-menu--toolbar {
  right: 0;
  left: auto;
  width: 190px;
}

.cal-create-menu.cal-create-menu--mobile-nav,
.cal-create-menu.cal-settings-menu--mobile-nav {
  top: 0;
  right: calc(100% + 8px);
  left: auto;
  width: min(220px, calc(100vw - 32px));
}

.cal-settings-menu--toolbar {
  top: 0;
  right: calc(100% + 8px);
  left: auto;
  width: 180px;
}

.cal-create-menu button {
  padding: 10px 12px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
}

.cal-create-menu button:hover {
  background: var(--ui-surface-muted);
}

.cal-settings-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cal-filters-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.cal-filters {
  padding-top: 4px;
}

.cal-filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  min-height: 44px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.cal-filter-row--with-action {
  gap: 6px;
  cursor: default;
}

.cal-filter-choice {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
}

.cal-filter-action {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}

.cal-filter-action:hover:not(:disabled),
.cal-filter-action:focus-visible {
  border-color: color-mix(in oklab, #b33b2e, var(--ui-border) 50%);
  background: color-mix(in oklab, #b33b2e, transparent 90%);
  color: #b33b2e;
}

.cal-filter-action:disabled {
  cursor: wait;
  opacity: 0.5;
}

.cal-sidebar .cal-filter-row {
  gap: 8px;
  min-height: 36px;
  margin-bottom: 0;
}

.cal-sidebar .cal-filter-choice {
  align-self: stretch;
  gap: 8px;
}

.cal-sidebar .cal-filter-action {
  width: 36px;
  height: 36px;
}

.cal-filter-input {
  accent-color: var(--color-text);
  width: 18px;
  height: 18px;
}

.cal-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.cal-swatch--neutral {
  background: linear-gradient(
    135deg,
    var(--color-border-strong) 0%,
    var(--color-text-muted) 100%
  );
}

.cal-swatch--muted {
  background: #9aa0a6;
}

.cal-filter-label {
  display: grid;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-filter-meta {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
}

.cal-filter-meta--error {
  color: #b33b2e;
}

.cal-board-wrap {
  min-width: 0;
}

.cal-detail-wrap {
  min-width: 0;
  position: sticky;
  top: 12px;
}

.modal-card {
  width: min(100%, 480px);
  max-height: min(90vh, 720px);
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-bg);
  padding: 24px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.12);
}

.quick-create-modal {
  width: min(100%, 560px);
}

.quick-create-modal--compact {
  width: min(100%, 440px);
}

.event-detail-modal {
  width: min(100%, 520px);
}

.availability-modal {
  position: relative;
  width: min(100%, 760px);
}

.calendars-modal {
  width: min(100%, 440px);
}

.cal-mobile-filter-list {
  display: grid;
  max-height: min(55vh, 460px);
  overflow: auto;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.modal-header h2 {
  margin: 0;
  font-size: 20px;
}

.modal-header--actions-only {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 1;
  justify-content: flex-end;
  margin: 0;
}

.event-detail-source {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 650;
  color: var(--color-text-muted);
}

.event-detail-summary,
.event-detail-site {
  margin: 0 0 14px;
  color: var(--color-text-muted);
}

.event-detail-time {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 700;
}

.event-detail-list {
  display: grid;
  gap: 10px;
  margin: 18px 0 0;
}

.event-detail-row {
  display: grid;
  gap: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.event-detail-row dt,
.event-detail-notes h3 {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.event-detail-row dd {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.event-detail-notes {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.event-detail-notes h3 {
  margin: 0 0 8px;
}

.event-detail-notes p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.event-detail-action {
  margin-top: 18px;
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.event-detail-action--danger {
  margin-top: 10px;
}

.event-detail-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.icon-close {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  color: var(--color-text-muted);
}

.icon-close:focus-visible,
.cal-period-title:focus-visible,
.cal-view-toggle button:focus-visible,
.cal-create-menu button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.create-tabs {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 18px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg-subtle);
}

.create-tabs button {
  min-width: 84px;
  min-height: 44px;
  padding: 8px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.create-tabs button:hover {
  color: var(--color-text);
}

.create-tabs button.active {
  background: var(--color-text);
  color: var(--color-bg);
}

.booking-form {
  display: grid;
  gap: 14px;
}

.availability-form {
  display: grid;
  gap: 16px;
}

.availability-modal :deep(.booking-availability-editor) {
  padding: 0;
  border-top: 0;
}

.form-hint {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.45;
}

.booking-form label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.checkbox-row {
  display: flex !important;
  align-items: center;
  gap: 8px;
}

.checkbox-row input {
  width: 16px;
  height: 16px;
  margin: 0;
}

.booking-form input,
.booking-form select,
.booking-form textarea {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  color: var(--color-text);
  font: inherit;
}

.booking-form input:not([type="checkbox"]),
.booking-form select {
  min-height: 44px;
}

.booking-form input:focus-visible,
.booking-form select:focus-visible,
.booking-form textarea:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 1px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-error {
  margin: 0;
  font-size: 13px;
  color: #b33b2e;
}

.social-schedule-summary {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.social-schedule-summary div {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  font-size: 13px;
}

.social-schedule-summary dt {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.social-schedule-summary dd {
  min-width: 0;
  margin: 0;
  color: var(--ui-text, var(--color-text));
  overflow-wrap: anywhere;
}

.social-schedule-empty {
  display: grid;
  justify-items: start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.social-schedule-empty p {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.social-schedule-actions {
  flex-wrap: wrap;
}

.social-schedule-actions :deep(.me3-btn) {
  min-height: 44px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

@media (max-width: 1100px) {
  :global(.app-root:has(.cal-mobile-nav-controls) .calendar-spike) {
    padding-top: var(--app-shell-mobile-nav-height);
  }

  .cal-shell {
    grid-template-columns: 1fr;
  }

  .cal-detail-wrap {
    position: static;
  }

  .cal-sidebar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .cal-filters {
    grid-column: 1 / -1;
  }
}

@media (min-width: 960px) and (max-width: 1100px) {
  .cal-sidebar {
    display: none;
  }
}

.cal-mobile-nav-controls .cal-mobile-icon-btn {
  flex: 0 0 auto;
  min-width: 44px;
  width: 44px;
  height: 44px;
}

.cal-toolbar-icon-btn {
  width: 44px;
  height: 44px;
}

.cal-mobile-create-wrap,
.cal-mobile-settings-wrap {
  position: relative;
}

@media (min-width: 1101px) {
  .cal-toolbar {
    position: sticky;
    top: 0;
    z-index: 12;
    display: grid;
    grid-template-columns: minmax(260px, 1fr) auto minmax(260px, 1fr);
    align-items: center;
    gap: 16px;
    min-height: 60px;
    padding: 8px 0;
    background: var(--ui-bg, var(--color-bg));
    border-bottom: 1px solid var(--ui-border, var(--color-border));
  }

  .cal-toolbar-left {
    padding-inline-start: calc(
      var(--app-shell-mobile-nav-leading-padding) -
        var(--workspace-topbar-padding-inline) + 8px
    );
  }
}

@media (max-width: 959px) {
  .ops-page {
    padding: 0;
  }

  .main {
    padding: 0;
  }

  .cal-sidebar {
    grid-template-columns: 1fr;
  }

  .cal-sidebar {
    display: none;
  }

  .cal-shell {
    display: block;
  }

  .cal-board-wrap {
    width: 100%;
  }

  .field-row {
    grid-template-columns: 1fr;
  }

  .create-tabs {
    display: flex;
  }

  .create-tabs button {
    min-width: 0;
    flex: 1;
    padding-inline: 10px;
  }
}

@media (max-width: 640px) {
  .modal-card {
    width: 100%;
    max-height: 92dvh;
    padding: 20px;
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0;
  }

  .modal-actions {
    position: sticky;
    bottom: -20px;
    padding: 12px 0 20px;
    background: var(--ui-surface, var(--color-bg));
  }
}
</style>
