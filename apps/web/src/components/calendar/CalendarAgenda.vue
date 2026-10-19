<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
  CalendarAgendaEvent,
  CalendarRangeMode,
} from "./calendarAgenda";
import UiIcon from "../UiIcon.vue";
import type { UiIconName } from "../../utils/icons";

const props = withDefaults(
  defineProps<{
    events?: CalendarAgendaEvent[];
    loading?: boolean;
    error?: string | null;
    title?: string;
    description?: string;
    rangeLabel?: string;
    timeZoneLabel?: string;
    rangeMode?: CalendarRangeMode;
    startDayKey?: string | null;
    endDayKey?: string | null;
    focusDayKey?: string | null;
    todayDayKey?: string | null;
    preferSelectEventId?: string | null;
    highlightedEventId?: string | null;
    cancellingBookingId?: string | null;
    canLoadMore?: boolean;
    loadingMore?: boolean;
    /** On compact layouts, the page can present the selected event in a modal. */
    showInlineDetail?: boolean;
    /** Sidebar-style layout: detail panel only (feed hidden). */
    variant?: "default" | "detail-only";
  }>(),
  {
    events: () => [],
    loading: false,
    error: null,
    title: "Upcoming bookings",
    description: "Upcoming confirmed bookings, grouped by day in your local timezone.",
    rangeLabel: "Month",
    rangeMode: "month",
    startDayKey: null,
    endDayKey: null,
    focusDayKey: null,
    todayDayKey: null,
    preferSelectEventId: null,
    highlightedEventId: null,
    cancellingBookingId: null,
    canLoadMore: false,
    loadingMore: false,
    showInlineDetail: true,
    variant: "default",
  },
);
const emit = defineEmits<{
  (e: "event-action", event: CalendarAgendaEvent): void;
  (e: "event-danger-action", event: CalendarAgendaEvent): void;
  (e: "range-change", mode: CalendarRangeMode): void;
  (e: "clear-focus"): void;
  (e: "consumed-prefer-select"): void;
  (e: "cancel-booking", event: CalendarAgendaEvent): void;
  (e: "select-event", event: CalendarAgendaEvent): void;
  (e: "load-more"): void;
}>();

type CalendarDayGroup = {
  key: string;
  dayNumber: number;
  weekdayLabel: string;
  label: string;
  items: CalendarAgendaEvent[];
};

const CALENDAR_KIND_ICONS: Record<string, UiIconName> = {
  Booking: "UserStar",
  Birthday: "Gift",
  Event: "CalendarClock",
  Reminder: "AlarmClock",
  "Social Publication": "Send",
  Task: "CircleCheck",
};

const selectedEventId = ref("");
const surfaceEl = ref<HTMLElement | null>(null);
const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timeZoneOptions = resolvedTimeZone ? { timeZone: resolvedTimeZone } : {};
let autoScrolledToToday = false;

const sortedEvents = computed(() =>
  [...props.events].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  ),
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

const focusFilteredEvents = computed(() => {
  if (!props.focusDayKey) return sortedEvents.value;
  return sortedEvents.value.filter((event) => {
    const key = dayKeyFormatter.value.format(new Date(event.startsAt));
    return key === props.focusDayKey;
  });
});

const focusDayLabel = computed(() => {
  if (!props.focusDayKey) return "";
  const [y, m, d] = props.focusDayKey.split("-").map(Number);
  if (!y || !m || !d) return props.focusDayKey;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...timeZoneOptions,
  }).format(new Date(y, m - 1, d));
});

const dayGroups = computed<CalendarDayGroup[]>(() => {
  const eventGroups = new Map<string, CalendarAgendaEvent[]>();
  for (const event of focusFilteredEvents.value) {
    const date = new Date(event.startsAt);
    const key = dayKeyFormatter.value.format(date);
    eventGroups.set(key, [...(eventGroups.get(key) || []), event]);
  }

  if (props.focusDayKey) {
    return [
      buildDayGroup(props.focusDayKey, eventGroups.get(props.focusDayKey) || []),
    ];
  }

  const groups = Array.from(eventGroups.entries()).map(([key, items]) =>
    buildDayGroup(key, items),
  );
  if (
    props.rangeMode === "schedule" &&
    props.todayDayKey &&
    props.startDayKey &&
    props.endDayKey &&
    props.todayDayKey >= props.startDayKey &&
    props.todayDayKey < props.endDayKey &&
    !eventGroups.has(props.todayDayKey)
  ) {
    groups.push(buildDayGroup(props.todayDayKey, []));
    groups.sort((a, b) => a.key.localeCompare(b.key));
  }
  return groups;
});

const emptyMessage = computed(() => {
  if (props.focusDayKey) return `Nothing scheduled for ${focusDayLabel.value}.`;
  if (props.rangeMode === "schedule") {
    return "No upcoming items in this window. Your next events and reminders will appear here.";
  }
  return "Nothing is scheduled for this day.";
});

const selectedEvent = computed(() =>
  focusFilteredEvents.value.find((event) => event.id === selectedEventId.value) ??
  null,
);

function selectEvent(event: CalendarAgendaEvent) {
  selectedEventId.value = event.id;
  emit("select-event", event);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    ...timeZoneOptions,
  }).format(new Date(value));
}

function formatTimeRange(start: string, end: string, allDay = false) {
  if (allDay) return "All day";
  if (start === end) return formatTime(start);
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function eventAriaLabel(event: CalendarAgendaEvent): string {
  return `${event.title}, ${formatTimeRange(event.startsAt, event.endsAt, event.allDay)}, ${event.siteLabel}`;
}

function kindIcon(sourceLabel: string): UiIconName | null {
  return CALENDAR_KIND_ICONS[sourceLabel] || null;
}

function dateFromDayKey(dayKey: string): Date | null {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function buildDayGroup(
  key: string,
  items: CalendarAgendaEvent[],
): CalendarDayGroup {
  const date = dateFromDayKey(key) || new Date(`${key}T12:00:00`);
  return {
    key,
    dayNumber: Number.isNaN(date.getTime()) ? 0 : date.getDate(),
    weekdayLabel: Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          ...timeZoneOptions,
        }).format(date),
    label: Number.isNaN(date.getTime())
      ? key
      : new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          month: "short",
          day: "numeric",
          ...timeZoneOptions,
        }).format(date),
    items,
  };
}

watch(
  focusFilteredEvents,
  (events) => {
    if (events.length === 0) {
      selectedEventId.value = "";
      return;
    }

    if (!events.some((event) => event.id === selectedEventId.value)) {
      selectedEventId.value = "";
    }
  },
  { immediate: true },
);

watch(
  [focusFilteredEvents, () => props.preferSelectEventId],
  ([events, preferId]) => {
    if (!preferId) return;
    if (events.some((event) => event.id === preferId)) {
      selectedEventId.value = preferId;
      emit("consumed-prefer-select");
    }
  },
  { immediate: true },
);

watch(
  [dayGroups, () => props.loading, () => props.error, () => props.todayDayKey],
  async ([groups, loading, error, todayDayKey]) => {
    if (
      autoScrolledToToday ||
      loading ||
      error ||
      props.variant !== "default" ||
      props.focusDayKey ||
      !todayDayKey ||
      !groups.some((group) => group.key === todayDayKey)
    ) {
      return;
    }
    await nextTick();
    surfaceEl.value
      ?.querySelector<HTMLElement>(`[data-calendar-day="${todayDayKey}"]`)
      ?.scrollIntoView({ block: "start" });
    autoScrolledToToday = true;
  },
  { immediate: true, flush: "post" },
);
</script>

<template>
  <section
    ref="surfaceEl"
    class="calendar-surface"
    :class="{ 'calendar-surface--detail-only': variant === 'detail-only' }"
  >
    <div v-if="variant === 'default' && focusDayKey" class="calendar-focus-bar">
      <span>Showing {{ focusDayLabel }}</span>
      <button type="button" class="calendar-focus-clear" @click="emit('clear-focus')">
        All days
      </button>
    </div>

    <div v-if="loading" class="calendar-state" role="status">
      Loading calendar…
    </div>

    <div
      v-else-if="error"
      class="calendar-state calendar-state--error"
      role="alert"
    >
      {{ error }}
    </div>

    <div
      v-else-if="variant === 'default' && focusFilteredEvents.length === 0"
      class="calendar-empty"
    >
      <p>{{ emptyMessage }}</p>
      <button
        v-if="canLoadMore"
        type="button"
        class="calendar-load-more"
        :disabled="loadingMore"
        @click="emit('load-more')"
      >
        {{ loadingMore ? "Loading…" : "Look further ahead" }}
      </button>
    </div>

    <div v-else-if="variant === 'detail-only' && selectedEvent" class="calendar-detail-solo-wrap">
      <aside class="calendar-detail calendar-detail--solo">
        <h4>{{ selectedEvent.title }}</h4>
        <p class="calendar-detail-summary">{{ selectedEvent.summary }}</p>
        <p class="calendar-detail-time">
          {{
            formatTimeRange(
              selectedEvent.startsAt,
              selectedEvent.endsAt,
              selectedEvent.allDay,
            )
          }}
        </p>
        <p class="calendar-detail-site">{{ selectedEvent.siteLabel }}</p>

        <dl class="calendar-detail-list">
          <div
            v-for="line in selectedEvent.detailLines"
            :key="line.label"
            class="calendar-detail-row"
          >
            <dt>{{ line.label }}</dt>
            <dd>
              <a v-if="line.href" :href="line.href" :target="line.href.startsWith('/') ? undefined : '_blank'" rel="noopener noreferrer">
                {{ line.value }}
              </a>
              <template v-else>{{ line.value }}</template>
            </dd>
          </div>
        </dl>

        <button
          v-if="selectedEvent.actionLabel"
          type="button"
          class="calendar-detail-action"
          @click="emit('event-action', selectedEvent)"
        >
          {{ selectedEvent.actionLabel }}
        </button>

        <button
          v-if="selectedEvent.dangerActionLabel"
          type="button"
          class="calendar-detail-action calendar-detail-action--danger"
          @click="emit('event-danger-action', selectedEvent)"
        >
          {{ selectedEvent.dangerActionLabel }}
        </button>

        <button
          v-if="selectedEvent.sourceLabel === 'Booking'"
          type="button"
          class="calendar-detail-action calendar-detail-action--danger"
          :disabled="cancellingBookingId === selectedEvent.id"
          @click="emit('cancel-booking', selectedEvent)"
        >
          {{
            cancellingBookingId === selectedEvent.id
              ? "Cancelling…"
              : "Cancel booking"
          }}
        </button>
      </aside>
    </div>

    <div
      v-else-if="variant === 'default'"
      class="calendar-grid"
      :class="{
        'calendar-grid--with-detail': selectedEvent && showInlineDetail,
      }"
    >
      <div class="calendar-feed">
        <div class="calendar-days">
          <section
            v-for="group in dayGroups"
            :key="group.key"
            class="calendar-day"
            :class="{
              'is-empty': group.items.length === 0,
              'is-today': group.key === todayDayKey,
            }"
            :data-calendar-day="group.key"
            :aria-labelledby="`calendar-day-${group.key}`"
          >
            <h3
              :id="`calendar-day-${group.key}`"
              class="calendar-day-head"
            >
              <span class="calendar-date-rail">
                <span v-if="group.key === todayDayKey" class="calendar-today-label">
                  Today
                </span>
                <span v-else>{{ group.weekdayLabel }}</span>
                <strong>{{ group.dayNumber }}</strong>
              </span>
            </h3>

            <div class="calendar-items">
              <button
                v-for="event in group.items"
                :key="event.id"
                type="button"
                class="calendar-item"
                :class="{
                  'is-active': selectedEventId === event.id,
                  'is-highlighted': highlightedEventId === event.id,
                }"
                :aria-pressed="selectedEventId === event.id ? 'true' : 'false'"
                :aria-label="eventAriaLabel(event)"
                @click="selectEvent(event)"
              >
                <div class="calendar-item-time">
                  {{ formatTimeRange(event.startsAt, event.endsAt, event.allDay) }}
                </div>
                <div class="calendar-item-body">
                  <div class="calendar-item-title">
                    <span>{{ event.title }}</span>
                    <span
                      v-if="kindIcon(event.sourceLabel)"
                      class="calendar-kind calendar-kind--icon"
                    >
                      <UiIcon
                        :name="kindIcon(event.sourceLabel) || 'CalendarClock'"
                        :size="14"
                        aria-hidden="true"
                      />
                    </span>
                    <span v-else class="calendar-kind">
                      {{ event.sourceLabel.toLowerCase() }}
                    </span>
                  </div>
                </div>
              </button>
              <p v-if="group.items.length === 0" class="calendar-day-empty">
                No items
              </p>
            </div>
          </section>
        </div>
        <div v-if="canLoadMore" class="calendar-load-more-wrap">
          <button
            type="button"
            class="calendar-load-more"
            :disabled="loadingMore"
            @click="emit('load-more')"
          >
            {{ loadingMore ? "Loading…" : "Load more" }}
          </button>
        </div>
      </div>

      <aside v-if="selectedEvent && showInlineDetail" class="calendar-detail">
        <template v-if="selectedEvent">
          <h4>{{ selectedEvent.title }}</h4>
          <p class="calendar-detail-summary">{{ selectedEvent.summary }}</p>
          <p class="calendar-detail-time">
            {{
              formatTimeRange(
                selectedEvent.startsAt,
                selectedEvent.endsAt,
                selectedEvent.allDay,
              )
            }}
          </p>
          <p class="calendar-detail-site">{{ selectedEvent.siteLabel }}</p>

          <dl class="calendar-detail-list">
            <div
              v-for="line in selectedEvent.detailLines"
              :key="line.label"
              class="calendar-detail-row"
            >
              <dt>{{ line.label }}</dt>
              <dd>
                <a v-if="line.href" :href="line.href" :target="line.href.startsWith('/') ? undefined : '_blank'" rel="noopener noreferrer">
                  {{ line.value }}
                </a>
                <template v-else>{{ line.value }}</template>
              </dd>
            </div>
          </dl>

          <button
            v-if="selectedEvent.actionLabel"
            type="button"
            class="calendar-detail-action"
            @click="emit('event-action', selectedEvent)"
          >
            {{ selectedEvent.actionLabel }}
          </button>

          <button
            v-if="selectedEvent.dangerActionLabel"
            type="button"
            class="calendar-detail-action calendar-detail-action--danger"
            @click="emit('event-danger-action', selectedEvent)"
          >
            {{ selectedEvent.dangerActionLabel }}
          </button>

          <button
            v-if="selectedEvent.sourceLabel === 'Booking'"
            type="button"
            class="calendar-detail-action calendar-detail-action--danger"
            :disabled="cancellingBookingId === selectedEvent.id"
            @click="emit('cancel-booking', selectedEvent)"
          >
            {{
              cancellingBookingId === selectedEvent.id
                ? "Cancelling…"
                : "Cancel booking"
            }}
          </button>
        </template>

      </aside>
    </div>
  </section>
</template>

<style scoped>
.calendar-surface {
  margin-bottom: 28px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.calendar-surface--detail-only {
  margin-bottom: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.calendar-detail-solo-wrap {
  min-height: 280px;
}

.calendar-detail--solo {
  height: 100%;
  min-height: 520px;
  border: 0;
  border-radius: 8px;
  background: var(--cal-surface, var(--color-bg));
}

.calendar-focus-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 0;
  border-radius: 0;
  background: var(--color-bg-subtle);
  font-size: 13px;
  font-weight: 600;
}

.calendar-focus-clear {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.calendar-focus-clear:hover {
  border-color: var(--color-border-strong);
}

.calendar-state,
.calendar-empty,
.calendar-detail-empty {
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
}

.calendar-state--error {
  color: #b33b2e;
}

.calendar-empty {
  display: grid;
  gap: 10px;
}

.calendar-empty p {
  margin: 0;
}

/* The agenda runs edge to edge on phones; the empty card keeps the page gutter. */
@media (max-width: 640px) {
  .calendar-empty {
    margin: 12px 16px;
    border-radius: 16px;
  }
}

.calendar-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.calendar-grid--with-detail {
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.8fr);
}

.calendar-feed,
.calendar-detail {
  border: 0;
  border-radius: 8px;
  background: var(--color-bg);
}

.calendar-feed {
  max-height: calc(100dvh - 132px);
  padding: 0 4px 0 0;
  overflow: auto;
}

.calendar-detail {
  padding: 16px;
}

.calendar-days {
  display: grid;
}

.calendar-day {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  min-height: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
  scroll-margin-top: 12px;
}

.calendar-day:has(.calendar-day-empty) {
  align-items: center;
}

.calendar-day.is-today {
  padding-inline: 8px;
  border-radius: 8px;
  background: color-mix(
    in srgb,
    var(--ui-accent-soft, var(--color-bg-subtle)) 45%,
    transparent
  );
}

.calendar-day.is-today .calendar-date-rail strong {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--ui-accent-soft, var(--color-bg-subtle));
  color: var(--ui-accent-strong, var(--color-text));
}

.calendar-day.is-today .calendar-day-head {
  background: transparent;
}

.calendar-day-head {
  display: block;
  position: sticky;
  top: 8px;
  z-index: 1;
  align-self: start;
  margin: 0;
  padding: 2px 0;
  background: var(--cal-surface, var(--color-bg));
}

.calendar-date-rail {
  display: grid;
  justify-items: center;
  gap: 1px;
  padding-top: 0;
}

.calendar-date-rail span {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.calendar-date-rail strong {
  color: var(--color-text);
  font-size: 18px;
  font-weight: 650;
  line-height: 1;
}

.calendar-items {
  display: grid;
  gap: 8px;
  align-content: start;
}

.calendar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: var(--color-bg-subtle);
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.calendar-item:hover {
  background: var(--color-bg);
}

.calendar-item.is-active {
  box-shadow: inset 0 0 0 1px var(--color-text);
}

.calendar-item.is-highlighted {
  box-shadow: inset 0 0 0 2px var(--ui-accent, var(--color-accent));
  background: var(--ui-accent-soft, var(--color-bg-subtle));
}

.calendar-item:focus-visible,
.calendar-focus-clear:focus-visible,
.calendar-load-more:focus-visible,
.calendar-detail-action:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 2px;
}

.calendar-load-more-wrap {
  display: flex;
  justify-content: center;
  padding: 20px 0 4px;
}

.calendar-load-more {
  min-height: 44px;
  padding: 8px 16px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.calendar-load-more:hover:not(:disabled) {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.calendar-load-more:disabled {
  cursor: wait;
  opacity: 0.55;
}

.calendar-day-empty {
  margin: 0;
  width: 100%;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.3;
  text-align: left;
}

.calendar-item-time {
  flex: 0 0 64px;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.calendar-item-body {
  min-width: 0;
  flex: 1;
}

.calendar-item-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}

.calendar-item-title > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-kind {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0;
  color: var(--color-text-muted);
}

.calendar-kind--icon {
  display: inline-flex;
  align-items: center;
}

.calendar-detail h4 {
  margin-bottom: 6px;
  font-size: 22px;
  line-height: 1.15;
}

.calendar-detail-summary {
  margin-bottom: 14px;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}

.calendar-detail-time {
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 600;
}

.calendar-detail-site {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.calendar-detail-list {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

.calendar-detail-row {
  display: grid;
  gap: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.calendar-detail-row dt {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.calendar-detail-row dd {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.calendar-notes {
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.calendar-notes h5 {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.calendar-notes p {
  color: var(--color-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.calendar-detail-action {
  margin-top: 14px;
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.calendar-detail-action--danger {
  margin-top: 10px;
}

.calendar-detail-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 960px) {
  .calendar-grid {
    grid-template-columns: 1fr;
  }

  .calendar-grid--with-detail {
    grid-template-columns: 1fr;
  }

  .calendar-feed {
    max-height: none;
    padding: 0;
    overflow: visible;
  }

  .calendar-day {
    grid-template-columns: 50px minmax(0, 1fr);
    gap: 8px;
    padding: 10px 0;
  }

  .calendar-day.is-empty {
    grid-template-columns: 44px minmax(0, 1fr);
    min-height: 42px;
    padding: 6px 0;
  }

  .calendar-day.is-today {
    padding-inline: 8px;
  }

  .calendar-date-rail span {
    font-size: 9px;
  }

  .calendar-date-rail strong {
    font-size: 16px;
  }

  .calendar-day-empty {
    font-size: 11px;
  }

  .calendar-item-time {
    flex-basis: auto;
    min-width: 44px;
  }
}
</style>
