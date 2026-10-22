<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { CalendarAgendaEvent } from "./calendarAgenda";
import type { CalendarContextAnchor } from "./calendarWeek";

const props = defineProps<{
  event: CalendarAgendaEvent;
  anchor: CalendarContextAnchor;
  cancellingBooking?: boolean;
  reschedulingBooking?: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "event-action", event: CalendarAgendaEvent): void;
  (e: "event-danger-action", event: CalendarAgendaEvent): void;
  (e: "cancel-booking", event: CalendarAgendaEvent): void;
  (e: "reschedule-booking", event: CalendarAgendaEvent, startsAt: string): void;
}>();

// Moving keeps the booking (and the guest's join link); only its time changes.
const moving = ref(false);
const newStart = ref("");
function localInputValue(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function startMoving() {
  newStart.value = localInputValue(props.event.startsAt);
  moving.value = true;
}
function confirmMove() {
  const date = new Date(newStart.value);
  if (Number.isNaN(date.getTime())) return;
  emit("reschedule-booking", props.event, date.toISOString());
}
watch(() => props.event.id, () => { moving.value = false; });

const closeButton = ref<HTMLButtonElement | null>(null);
const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timeZoneOptions = resolvedTimeZone
  ? { timeZone: resolvedTimeZone }
  : ({} as Intl.DateTimeFormatOptions);

const position = computed(() => {
  const width = 340;
  const height = 430;
  const gap = 10;
  const edge = 12;
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const fitsRight = props.anchor.right + gap + width <= viewportWidth - edge;
  const left = fitsRight
    ? props.anchor.right + gap
    : props.anchor.left - width - gap;
  return {
    left: `${Math.max(edge, Math.min(viewportWidth - width - edge, left))}px`,
    top: `${Math.max(edge, Math.min(viewportHeight - height - edge, props.anchor.top))}px`,
  };
});

const timeLabel = computed(() => {
  const start = new Date(props.event.startsAt);
  if (props.event.allDay) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      ...timeZoneOptions,
    }).format(start);
  }
  const end = new Date(props.event.endsAt);
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...timeZoneOptions,
  }).format(start);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...timeZoneOptions,
  });
  return `${date}, ${time.format(start)}–${time.format(end)}`;
});

watch(
  () => props.event.id,
  () => void nextTick(() => closeButton.value?.focus()),
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <aside
      class="calendar-context-popover event-popover"
      :style="position"
      role="dialog"
      aria-modal="false"
      aria-labelledby="calendar-event-popover-title"
      @click.stop
    >
      <header>
        <div>
          <p>{{ event.sourceLabel }}</p>
          <h2 id="calendar-event-popover-title">{{ event.title }}</h2>
        </div>
        <button
          ref="closeButton"
          type="button"
          class="popover-close"
          aria-label="Close event details"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="event-popover-color" aria-hidden="true">
        <span :style="{ background: event.color || 'var(--ui-accent)' }" />
      </div>
      <p class="event-popover-time">{{ timeLabel }}</p>
      <p class="event-popover-calendar">{{ event.siteLabel }}</p>
      <p v-if="event.summary" class="event-popover-summary">
        {{ event.summary }}
      </p>

      <dl v-if="event.detailLines.length" class="event-popover-details">
        <div v-for="line in event.detailLines" :key="line.label">
          <dt>{{ line.label }}</dt>
          <dd>
            <a v-if="line.href" :href="line.href" :target="line.href.startsWith('/') ? undefined : '_blank'" rel="noopener noreferrer">
              {{ line.value }}
            </a>
            <template v-else>{{ line.value }}</template>
          </dd>
        </div>
      </dl>

      <p v-if="event.notes" class="event-popover-notes">{{ event.notes }}</p>

      <footer
        v-if="
          event.actionLabel ||
          event.dangerActionLabel ||
          event.sourceLabel === 'Booking'
        "
      >
        <button
          v-if="event.actionLabel"
          type="button"
          @click="emit('event-action', event)"
        >
          {{ event.actionLabel }}
        </button>
        <button
          v-if="event.dangerActionLabel"
          type="button"
          class="is-danger"
          @click="emit('event-danger-action', event)"
        >
          {{ event.dangerActionLabel }}
        </button>
        <template v-if="event.sourceLabel === 'Booking' && moving">
          <label class="booking-move">
            <span>New start</span>
            <input v-model="newStart" type="datetime-local" required />
          </label>
          <button type="button" :disabled="reschedulingBooking || !newStart" @click="confirmMove">
            {{ reschedulingBooking ? "Moving…" : "Move and email guest" }}
          </button>
          <button type="button" :disabled="reschedulingBooking" @click="moving = false">Keep time</button>
        </template>
        <template v-else-if="event.sourceLabel === 'Booking'">
          <button type="button" :disabled="cancellingBooking" @click="startMoving">Move booking</button>
          <button
            type="button"
            class="is-danger"
            :disabled="cancellingBooking"
            @click="emit('cancel-booking', event)"
          >
            {{ cancellingBooking ? "Cancelling…" : "Cancel booking" }}
          </button>
        </template>
      </footer>
    </aside>
  </Teleport>
</template>

<style scoped>
.calendar-context-popover {
  position: fixed;
  z-index: 90;
  width: min(340px, calc(100vw - 24px));
  max-height: min(430px, calc(100dvh - 24px));
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--ui-border-strong, var(--color-border));
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  box-shadow: var(--ui-shadow-md, 0 18px 48px rgba(0, 0, 0, 0.18));
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

header p,
header h2,
.event-popover-time,
.event-popover-calendar,
.event-popover-summary,
.event-popover-notes {
  margin: 0;
}

header p {
  margin-bottom: 3px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

header h2 {
  font-size: 18px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.popover-close {
  display: inline-grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  font: inherit;
  font-size: 24px;
  cursor: pointer;
}

.popover-close:hover {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.event-popover-color {
  margin: 14px 0 10px;
}

.event-popover-color span {
  display: block;
  width: 28px;
  height: 4px;
  border-radius: 999px;
}

.event-popover-time {
  font-size: 13px;
  font-weight: 700;
}

.event-popover-calendar,
.event-popover-summary {
  margin-top: 5px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.event-popover-details {
  display: grid;
  gap: 7px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.event-popover-details div {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
}

.event-popover-details dt {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.event-popover-details dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}

.event-popover-notes {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border, var(--color-border));
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

footer button {
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.booking-move {
  display: grid;
  gap: 4px;
  flex-basis: 100%;
  font-size: 12px;
  font-weight: 700;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.booking-move input {
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
}

footer button.is-danger {
  color: #b33b2e;
}

footer button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.popover-close:focus-visible,
footer button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}
</style>
