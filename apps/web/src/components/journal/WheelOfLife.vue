<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppPageBar from "../AppPageBar.vue";
import Button from "../Button.vue";
import IconPicker from "../IconPicker.vue";
import LifeWheelChart from "./LifeWheelChart.vue";
import UiIcon from "../UiIcon.vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import { isUiIconName, type UiIconName } from "../../utils/icons";

const props = withDefaults(
  defineProps<{
    labelledBy?: string;
    embedded?: boolean;
  }>(),
  {
    labelledBy: "",
    embedded: false,
  },
);

type WheelSegment = {
  id: string;
  label: string;
  helper: string;
  color: string;
  emoji: string;
  value: number | null;
};

type SnapshotSegment = {
  id: string;
  label: string;
  helper: string;
  color: string;
  emoji: string;
  value: number | null;
  notes: string;
};

type WheelSnapshot = {
  id: string;
  createdAt: string;
  segments: SnapshotSegment[];
};

type StoredWheelState = {
  schemaVersion: 1;
  segments: WheelSegment[];
  snapshots: WheelSnapshot[];
};

type WheelResponse = {
  settings: {
    segments: WheelSegment[];
  };
  snapshots: WheelSnapshot[];
};

type WheelSnapshotResponse = {
  snapshot: WheelSnapshot;
};

const STORAGE_KEY = "me3.missionControl.wheelOfLife.v1";
const MIGRATED_STORAGE_KEY = "me3.missionControl.wheelOfLife.v1.serverMigrated";
const MIN_SEGMENTS = 6;
const MAX_SEGMENTS = 8;

const legacyDefaultEmojiById: Record<string, Record<string, string>> = {
  health: { "💙": "❤️" },
  spirituality: { "✨": "🌿" },
  work: { "🧭": "💼" },
  finances: { "◌": "💰" },
  home: { "⌂": "🏡" },
  joy: { "✦": "🤗" },
};

const defaultSegments: WheelSegment[] = [
  {
    id: "health",
    label: "Health",
    helper: "Physical, mental and emotional wellbeing",
    color: "#26806f",
    emoji: "❤️",
    value: null,
  },
  {
    id: "spirituality",
    label: "Spirituality",
    helper:
      "Meaning, purpose, felt sense of connection to something greater than yourself",
    color: "#7c3aed",
    emoji: "🌿",
    value: null,
  },
  {
    id: "work",
    label: "Work",
    helper: "What you do, how you serve others",
    color: "#2563eb",
    emoji: "💼",
    value: null,
  },
  {
    id: "finances",
    label: "Finances",
    helper: "Money",
    color: "#ca8a04",
    emoji: "💰",
    value: null,
  },
  {
    id: "home",
    label: "Home",
    helper: "Environment, living situation",
    color: "#c2410c",
    emoji: "🏡",
    value: null,
  },
  {
    id: "joy",
    label: "Joy",
    helper: "What you do for fun",
    color: "#be123c",
    emoji: "🤗",
    value: null,
  },
];

/** New areas take the first of these that the wheel isn't using. */
const AREA_PALETTE = [
  "#26806f",
  "#7c3aed",
  "#2563eb",
  "#ca8a04",
  "#c2410c",
  "#be123c",
  "#0e7490",
  "#9333ea",
];

const segments = ref<WheelSegment[]>([]);
const snapshots = ref<WheelSnapshot[]>([]);
const editModalOpen = ref(false);
const historyModalOpen = ref(false);
const view = ref<"score" | "saved">("score");
const savedSnapshotId = ref("");
const openNotes = ref<Record<string, boolean>>({});
const noteDrafts = ref<Record<string, string>>({});
const loading = ref(true);
const saving = ref(false);
const syncError = ref("");
const editButton = ref<HTMLElement | null>(null);
let settingsSyncTimer: ReturnType<typeof setTimeout> | null = null;
const noteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const { toast } = useAppToast();

const allSegmentsScored = computed(() =>
  segments.value.every((segment) => segment.value !== null),
);

const latestSnapshot = computed(() => snapshots.value[0] || null);
const historyAvailable = computed(() => snapshots.value.length > 0);

const scoreHint = computed(() => {
  const unscored = segments.value.filter((segment) => segment.value === null);
  if (!unscored.length) return { lead: "Tap a slice again to change it.", names: "" };
  if (unscored.length === segments.value.length) {
    return { lead: "Tap each slice. Near the middle is 1, the rim is 10.", names: "" };
  }
  return { lead: "", names: joinNames(unscored.map((segment) => segment.label || "Untitled")) };
});

const savedSnapshot = computed(
  () => snapshots.value.find((snapshot) => snapshot.id === savedSnapshotId.value) || null,
);

const previousSnapshot = computed(() => {
  const index = snapshots.value.findIndex((snapshot) => snapshot.id === savedSnapshotId.value);
  return index >= 0 ? snapshots.value[index + 1] || null : null;
});

const previousScores = computed(() => {
  if (!previousSnapshot.value) return null;
  return Object.fromEntries(
    previousSnapshot.value.segments.map((segment) => [segment.id, segment.value]),
  );
});

const savedRows = computed(() =>
  (savedSnapshot.value?.segments || []).map((segment) => {
    const before = previousScores.value?.[segment.id];
    const change =
      typeof before !== "number" || segment.value === null
        ? { label: "New", tone: "new" }
        : segment.value > before
          ? { label: `+${segment.value - before}`, tone: "up" }
          : segment.value < before
            ? { label: `−${before - segment.value}`, tone: "down" }
            : { label: "Same", tone: "same" };
    return { ...segment, change };
  }),
);

const savedSummary = computed(() => {
  if (!savedSnapshot.value) return { average: "", change: "" };
  const average = averageOf(savedSnapshot.value);
  const before = previousSnapshot.value ? averageOf(previousSnapshot.value) : null;
  if (average === null) return { average: "", change: "" };
  if (before === null || !previousSnapshot.value) {
    return { average: average.toFixed(1), change: "" };
  }
  const since = formatShortDate(previousSnapshot.value.createdAt);
  const delta = Math.round((average - before) * 10) / 10;
  const change =
    delta === 0
      ? `same as ${since}`
      : delta > 0
        ? `up ${delta.toFixed(1)} since ${since}`
        : `down ${Math.abs(delta).toFixed(1)} since ${since}`;
  return { average: average.toFixed(1), change };
});

function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function averageOf(snapshot: WheelSnapshot) {
  const scored = snapshot.segments.filter((segment) => segment.value !== null);
  if (!scored.length) return null;
  return scored.reduce((sum, segment) => sum + (segment.value || 0), 0) / scored.length;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneDefaultSegments() {
  return defaultSegments.map((segment) => ({ ...segment }));
}

function normalizeSegmentEmoji(segmentId: string, value: unknown, fallback: string) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const emoji = isUiIconName(raw) ? raw : raw.slice(0, 4);
  return legacyDefaultEmojiById[segmentId]?.[emoji] || emoji;
}

function sanitizeSegment(input: Partial<WheelSegment>, index: number): WheelSegment {
  const fallback = defaultSegments[index] || {
    id: createId("area"),
    label: "New area",
    helper: "Personal context",
    color: "#26806f",
    emoji: "✦",
    value: null,
  };
  const value = Number(input.value);
  return {
    id: typeof input.id === "string" && input.id ? input.id : fallback.id,
    label:
      typeof input.label === "string" && input.label.trim()
        ? input.label.trim().slice(0, 36)
        : fallback.label,
    helper:
      typeof input.helper === "string" && input.helper.trim()
        ? input.helper.trim().slice(0, 180)
        : fallback.helper,
    color:
      typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)
        ? input.color
        : fallback.color,
    emoji: normalizeSegmentEmoji(
      typeof input.id === "string" && input.id ? input.id : fallback.id,
      input.emoji,
      fallback.emoji,
    ),
    value: Number.isInteger(value) && value >= 1 && value <= 10 ? value : null,
  };
}

function sanitizeSegments(input: unknown): WheelSegment[] {
  const incoming = Array.isArray(input) ? input : [];
  const sanitized = incoming
    .slice(0, MAX_SEGMENTS)
    .map((segment, index) => sanitizeSegment(segment as Partial<WheelSegment>, index));

  const byId = new Set(sanitized.map((segment) => segment.id));
  for (const segment of defaultSegments) {
    if (sanitized.length >= MIN_SEGMENTS) break;
    if (!byId.has(segment.id)) sanitized.push({ ...segment });
  }

  return sanitized.length >= MIN_SEGMENTS ? sanitized : cloneDefaultSegments();
}

function sanitizeSnapshots(input: unknown): WheelSnapshot[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((snapshot): WheelSnapshot | null => {
      if (!snapshot || typeof snapshot !== "object") return null;
      const source = snapshot as Partial<WheelSnapshot>;
      if (typeof source.id !== "string" || typeof source.createdAt !== "string") {
        return null;
      }
      const sourceSegments = Array.isArray(source.segments) ? source.segments : [];
      return {
        id: source.id,
        createdAt: source.createdAt,
        segments: sourceSegments.map((segment, index) => {
          const clean = sanitizeSegment(segment as Partial<WheelSegment>, index);
          return {
            ...clean,
            notes:
              typeof (segment as Partial<SnapshotSegment>).notes === "string"
                ? (segment as Partial<SnapshotSegment>).notes?.slice(0, 600) || ""
                : "",
          };
        }),
      };
    })
    .filter((snapshot): snapshot is WheelSnapshot => Boolean(snapshot))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function loadStoredState(): StoredWheelState {
  if (typeof window === "undefined") {
    return {
      schemaVersion: 1,
      segments: cloneDefaultSegments(),
      snapshots: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("Missing wheel state");
    const parsed = JSON.parse(raw) as Partial<StoredWheelState>;
    return {
      schemaVersion: 1,
      segments: sanitizeSegments(parsed.segments),
      snapshots: sanitizeSnapshots(parsed.snapshots),
    };
  } catch {
    return {
      schemaVersion: 1,
      segments: cloneDefaultSegments(),
      snapshots: [],
    };
  }
}

function persistState() {
  if (typeof window === "undefined") return;
  const payload: StoredWheelState = {
    schemaVersion: 1,
    segments: segments.value,
    snapshots: snapshots.value,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

async function loadServerState() {
  const response = await api.get<WheelResponse>("/journal/wheel");
  return {
    schemaVersion: 1,
    segments: sanitizeSegments(response.settings?.segments),
    snapshots: sanitizeSnapshots(response.snapshots),
  } satisfies StoredWheelState;
}

async function migrateLocalSnapshotsIfNeeded(
  serverState: StoredWheelState,
  localState: StoredWheelState,
) {
  if (typeof window === "undefined") return serverState;
  if (serverState.snapshots.length || !localState.snapshots.length) return serverState;
  if (window.localStorage.getItem(MIGRATED_STORAGE_KEY) === "1") return serverState;

  const migratedSnapshots: WheelSnapshot[] = [];
  for (const snapshot of [...localState.snapshots].reverse()) {
    try {
      const response = await api.post<WheelSnapshotResponse>(
        "/journal/wheel/snapshots",
        {
          id: snapshot.id,
          createdAt: snapshot.createdAt,
          segments: snapshot.segments,
          notes: Object.fromEntries(
            snapshot.segments.map((segment) => [segment.id, segment.notes || ""]),
          ),
        },
      );
      migratedSnapshots.unshift(response.snapshot);
    } catch {
      break;
    }
  }

  if (migratedSnapshots.length) {
    window.localStorage.setItem(MIGRATED_STORAGE_KEY, "1");
    return {
      schemaVersion: 1,
      segments: localState.segments,
      snapshots: sanitizeSnapshots(migratedSnapshots),
    };
  }

  return serverState;
}

async function loadState() {
  const localState = loadStoredState();
  try {
    const serverState = await loadServerState();
    syncError.value = "";
    return await migrateLocalSnapshotsIfNeeded(serverState, localState);
  } catch {
    syncError.value = "Using this browser's saved Wheel until the server reconnects.";
    return localState;
  }
}

function queueSettingsSync() {
  if (loading.value) return;
  if (settingsSyncTimer) clearTimeout(settingsSyncTimer);
  settingsSyncTimer = setTimeout(async () => {
    try {
      await api.patch("/journal/wheel/settings", {
        segments: segments.value.map((segment) => ({
          ...segment,
          label: segment.label.trim() || "Untitled",
        })),
      });
      syncError.value = "";
    } catch {
      syncError.value = "Wheel changes are saved in this browser and will retry on reload.";
    }
  }, 500);
}

function setSegmentValue(segmentId: string, value: number | null) {
  const segment = segments.value.find((item) => item.id === segmentId);
  if (!segment) return;
  segment.value = value === null ? null : Math.min(10, Math.max(1, value));
}

function nextPaletteColor() {
  const used = new Set(segments.value.map((segment) => segment.color.toLowerCase()));
  return AREA_PALETTE.find((color) => !used.has(color)) || AREA_PALETTE[0];
}

function focusAreaName(segmentId: string, select = false) {
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(
      `[data-wheel-area-name="${CSS.escape(segmentId)}"]`,
    );
    input?.focus();
    if (select) input?.select();
  });
}

function addSegment() {
  if (segments.value.length >= MAX_SEGMENTS) return;
  const id = createId("area");
  segments.value.push({
    id,
    label: "New area",
    helper: "Personal context",
    color: nextPaletteColor(),
    emoji: "✨",
    value: null,
  });
  focusAreaName(id, true);
}

function removeSegment(segmentId: string) {
  if (segments.value.length <= MIN_SEGMENTS) return;
  const index = segments.value.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return;
  const [removed] = segments.value.splice(index, 1);
  const neighbour = segments.value[Math.min(index, segments.value.length - 1)];
  if (neighbour) focusAreaName(neighbour.id);
  toast(`Removed ${removed.label || "Untitled"}`, {
    duration: 6000,
    action: {
      label: "Undo",
      onClick: () => restoreSegment(removed, index),
    },
  });
}

function restoreSegment(segment: WheelSegment, index: number) {
  if (segments.value.length >= MAX_SEGMENTS) return;
  if (segments.value.some((item) => item.id === segment.id)) return;
  segments.value.splice(Math.min(index, segments.value.length), 0, segment);
}

function finishAreaName(segment: WheelSegment) {
  if (!segment.label.trim()) segment.label = "Untitled";
}

function openEditModal() {
  editModalOpen.value = true;
  nextTick(() => {
    document.querySelector<HTMLInputElement>("[data-wheel-area-name]")?.focus();
  });
}

function closeEditModal() {
  if (!editModalOpen.value) return;
  for (const segment of segments.value) finishAreaName(segment);
  editModalOpen.value = false;
  nextTick(() => {
    editButton.value?.querySelector<HTMLElement>("button")?.focus();
  });
}

async function saveSnapshot() {
  if (!allSegmentsScored.value || saving.value) return;
  const localSnapshot: WheelSnapshot = {
    id: createId("snapshot"),
    createdAt: new Date().toISOString(),
    segments: segments.value.map((segment) => ({
      id: segment.id,
      label: segment.label.trim() || "Untitled",
      helper: segment.helper,
      color: segment.color,
      emoji: segment.emoji,
      value: segment.value,
      notes: "",
    })),
  };
  saving.value = true;
  try {
    const response = await api.post<WheelSnapshotResponse>("/journal/wheel/snapshots", {
      id: localSnapshot.id,
      createdAt: localSnapshot.createdAt,
      segments: localSnapshot.segments,
    });
    snapshots.value = [response.snapshot, ...snapshots.value];
    savedSnapshotId.value = response.snapshot.id;
    syncError.value = "";
  } catch {
    snapshots.value = [localSnapshot, ...snapshots.value];
    savedSnapshotId.value = localSnapshot.id;
    syncError.value = "Snapshot saved in this browser; server save did not complete.";
  } finally {
    saving.value = false;
  }
  openNotes.value = {};
  noteDrafts.value = {};
  view.value = "saved";
  nextTick(() => {
    document.querySelector<HTMLElement>("[data-wheel-saved-heading]")?.focus();
  });
}

function toggleNote(segmentId: string) {
  const snapshot = savedSnapshot.value;
  if (!snapshot) return;
  if (openNotes.value[segmentId]) {
    if (!(noteDrafts.value[segmentId] || "").trim()) {
      openNotes.value = { ...openNotes.value, [segmentId]: false };
    }
    return;
  }
  const existing = snapshot.segments.find((segment) => segment.id === segmentId)?.notes || "";
  noteDrafts.value = { ...noteDrafts.value, [segmentId]: noteDrafts.value[segmentId] ?? existing };
  openNotes.value = { ...openNotes.value, [segmentId]: true };
  nextTick(() => {
    document
      .querySelector<HTMLInputElement>(`[data-wheel-note="${CSS.escape(segmentId)}"]`)
      ?.focus();
  });
}

function queueNoteSave(segmentId: string) {
  const timer = noteTimers.get(segmentId);
  if (timer) clearTimeout(timer);
  noteTimers.set(
    segmentId,
    setTimeout(() => void saveNote(segmentId), 800),
  );
}

async function saveNote(segmentId: string) {
  const timer = noteTimers.get(segmentId);
  if (timer) clearTimeout(timer);
  noteTimers.delete(segmentId);
  const snapshot = savedSnapshot.value;
  if (!snapshot) return;
  const text = (noteDrafts.value[segmentId] || "").trim().slice(0, 600);
  const current = snapshot.segments.find((segment) => segment.id === segmentId);
  if (!current || current.notes === text) return;
  current.notes = text;
  try {
    const response = await api.patch<WheelSnapshotResponse>(
      `/journal/wheel/snapshots/${encodeURIComponent(snapshot.id)}`,
      { notes: { [segmentId]: text } },
    );
    const updated = sanitizeSnapshots([response.snapshot])[0];
    if (updated) {
      snapshots.value = snapshots.value.map((item) => (item.id === updated.id ? updated : item));
    }
    syncError.value = "";
  } catch {
    syncError.value = "Note saved in this browser; server save did not complete.";
  }
}

function flushNotes() {
  for (const segmentId of [...noteTimers.keys()]) void saveNote(segmentId);
}

function finishSavedView() {
  flushNotes();
  view.value = "score";
  savedSnapshotId.value = "";
}

function openHistory() {
  flushNotes();
  historyModalOpen.value = true;
}

function formatSnapshotDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved snapshot";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "last time";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatLongDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function snapshotAverage(snapshot: WheelSnapshot) {
  const average = averageOf(snapshot);
  return average === null ? "No score" : `${average.toFixed(1)}/10`;
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (historyModalOpen.value) historyModalOpen.value = false;
  else closeEditModal();
}

onMounted(async () => {
  const stored = await loadState();
  segments.value = stored.segments;
  snapshots.value = stored.snapshots;
  loading.value = false;
  window.addEventListener("keydown", handleGlobalKeydown);
});

onBeforeUnmount(() => {
  if (settingsSyncTimer) clearTimeout(settingsSyncTimer);
  flushNotes();
  window.removeEventListener("keydown", handleGlobalKeydown);
});

watch(
  segments,
  () => {
    persistState();
    queueSettingsSync();
  },
  { deep: true },
);
watch(snapshots, persistState, { deep: true });
</script>

<template>
  <section
    class="life-wheel"
    :class="{ 'life-wheel--embedded': props.embedded }"
    :aria-labelledby="props.labelledBy || 'life-wheel-title'"
  >
    <AppPageBar
      :title="view === 'saved' ? 'Saved' : 'Wheel of Life'"
      :title-id="props.labelledBy ? undefined : 'life-wheel-title'"
    >
      <template v-if="view === 'score'" #leading>
        <span ref="editButton" class="life-wheel__bar-button">
          <Button color="ghost" shape="soft" size="large" icon-only type="button"
            aria-label="Edit areas"
            title="Edit areas"
            @click="openEditModal"
          >
            <UiIcon name="Pencil" :size="20" />
          </Button>
        </span>
      </template>
      <template v-if="view === 'score'" #actions>
        <Button color="ghost" shape="soft" size="large" icon-only type="button"
          :disabled="!historyAvailable"
          aria-label="History"
          title="History"
          @click="openHistory"
        >
          <UiIcon name="History" :size="20" />
        </Button>
      </template>
    </AppPageBar>

    <div class="life-wheel__workspace">
      <div v-if="view === 'score'" class="life-wheel__stage">
        <div class="life-wheel__chart">
          <LifeWheelChart
            :segments="segments"
            aria-label="Wheel of Life. Tap a slice to score it."
            @update:segment-value="setSegmentValue"
          />
        </div>

        <p class="life-wheel__hint" aria-live="polite">
          <template v-if="scoreHint.names">
            Score <strong>{{ scoreHint.names }}</strong> to save.
          </template>
          <template v-else>{{ scoreHint.lead }}</template>
        </p>

        <ul class="life-wheel__legend" aria-label="Scores">
          <li v-for="segment in segments" :key="segment.id">
            <span class="life-wheel__legend-emoji" aria-hidden="true">
              <UiIcon
                v-if="isUiIconName(segment.emoji)"
                :name="segment.emoji as UiIconName"
                :size="16"
              />
              <template v-else>{{ segment.emoji }}</template>
            </span>
            <span class="life-wheel__legend-name">{{ segment.label }}</span>
            <span
              class="life-wheel__legend-score"
              :class="{ 'is-unscored': segment.value === null }"
            >
              {{ segment.value ?? "–" }}
              <span class="life-wheel__sr-only">{{ segment.value === null ? "not scored" : "of 10" }}</span>
            </span>
          </li>
        </ul>

        <div class="life-wheel__stage-foot">
          <Button color="primary" size="medium" type="button"
            class="life-wheel__save"
            :disabled="!allSegmentsScored || saving || loading"
            @click="saveSnapshot"
          >
            {{ saving ? "Saving" : "Save" }}
          </Button>
        </div>
        <p v-if="latestSnapshot" class="life-wheel__latest">
          Last saved {{ formatShortDate(latestSnapshot.createdAt) }} ·
          <button type="button" class="life-wheel__text-button" @click="openHistory">History</button>
        </p>
        <p v-else-if="loading" class="life-wheel__latest">Loading Wheel...</p>
        <p v-if="syncError" class="life-wheel__latest" role="status">{{ syncError }}</p>
      </div>

      <div v-else-if="savedSnapshot" class="life-wheel-saved">
        <div class="life-wheel-saved__wheel">
          <p class="life-wheel-saved__date" tabindex="-1" data-wheel-saved-heading>
            {{ formatLongDate(savedSnapshot.createdAt) }}
          </p>
          <LifeWheelChart
            :segments="savedSnapshot.segments"
            :interactive="false"
            :previous="previousScores"
            aria-label="Saved Wheel of Life"
          />
          <p v-if="previousSnapshot" class="life-wheel-saved__key">
            <span class="life-wheel-saved__dash" aria-hidden="true" />
            {{ formatShortDate(previousSnapshot.createdAt) }}
          </p>
          <p class="life-wheel-saved__average">
            Average <strong>{{ savedSummary.average }}</strong>
            <template v-if="savedSummary.change"> · {{ savedSummary.change }}</template>
          </p>
        </div>

        <div class="life-wheel-saved__side">
          <ul class="life-wheel-saved__rows">
            <li v-for="segment in savedRows" :key="segment.id" class="life-wheel-saved__row">
              <button
                type="button"
                class="life-wheel-saved__head"
                :aria-expanded="Boolean(openNotes[segment.id])"
                :aria-label="`${segment.label}, ${segment.value} of 10, ${segment.change.label === 'New' ? 'new area' : segment.change.label === 'Same' ? 'same as last time' : `${segment.change.label} since last time`}. ${segment.notes ? 'Edit note' : 'Add a note'}`"
                @click="toggleNote(segment.id)"
              >
                <span class="life-wheel-saved__emoji" aria-hidden="true">
                  <UiIcon
                    v-if="isUiIconName(segment.emoji)"
                    :name="segment.emoji as UiIconName"
                    :size="18"
                  />
                  <template v-else>{{ segment.emoji }}</template>
                </span>
                <span class="life-wheel-saved__name">{{ segment.label }}</span>
                <span class="life-wheel-saved__chip" :class="`is-${segment.change.tone}`">
                  {{ segment.change.label }}
                </span>
                <span class="life-wheel-saved__score">{{ segment.value }}</span>
              </button>
              <p
                v-if="!openNotes[segment.id] && segment.notes"
                class="life-wheel-saved__note-text"
              >
                {{ segment.notes }}
              </p>
              <div v-if="openNotes[segment.id]" class="life-wheel-saved__note">
                <input
                  v-model="noteDrafts[segment.id]"
                  :data-wheel-note="segment.id"
                  :aria-label="`Note on ${segment.label}`"
                  :placeholder="`A private note on ${segment.label}`"
                  maxlength="600"
                  @input="queueNoteSave(segment.id)"
                  @blur="saveNote(segment.id)"
                  @keydown.enter.prevent="saveNote(segment.id)"
                />
              </div>
            </li>
          </ul>
          <p class="life-wheel-saved__private">
            <UiIcon name="Lock" :size="16" aria-hidden="true" />
            <span>Only you can see this. It stays on your ME3. Tap an area to add a note.</span>
          </p>
          <p v-if="syncError" class="life-wheel__latest" role="status">{{ syncError }}</p>
          <div class="life-wheel-saved__actions">
            <Button color="primary" size="medium" type="button" @click="finishSavedView">
              Done
            </Button>
            <Button color="ghost" size="medium" type="button" @click="openHistory">
              History
            </Button>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="editModalOpen"
        class="life-wheel-modal"
        role="presentation"
        @click.self="closeEditModal"
      >
        <section
          class="life-wheel-modal__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-wheel-title"
        >
          <header class="life-wheel-modal__header">
            <h2 id="edit-wheel-title">Edit areas</h2>
            <Button color="ghost" shape="soft" size="compact" icon-only type="button"
              aria-label="Close"
              @click="closeEditModal"
            >
              <UiIcon name="X" :size="18" />
            </Button>
          </header>

          <div class="life-wheel-modal__body">
            <div class="life-wheel-areas">
              <div
                v-for="segment in segments"
                :key="segment.id"
                class="life-wheel-areas__row"
              >
                <IconPicker
                  v-model="segment.emoji"
                  class="life-wheel-areas__emoji"
                  :style="{ '--area-tint': segment.color }"
                  :aria-label="`Emoji for ${segment.label || 'Untitled'}`"
                />
                <input
                  v-model="segment.label"
                  class="life-wheel-areas__name"
                  :data-wheel-area-name="segment.id"
                  aria-label="Area name"
                  maxlength="36"
                  @blur="finishAreaName(segment)"
                />
                <button
                  v-if="segments.length > MIN_SEGMENTS"
                  type="button"
                  class="life-wheel-areas__remove"
                  :aria-label="`Remove ${segment.label || 'Untitled'}`"
                  @click="removeSegment(segment.id)"
                >
                  Remove
                </button>
              </div>
              <button
                type="button"
                class="life-wheel-areas__add"
                :disabled="segments.length >= MAX_SEGMENTS"
                @click="addSegment"
              >
                <span class="life-wheel-areas__add-icon" aria-hidden="true">
                  <UiIcon name="Plus" :size="18" />
                </span>
                {{ segments.length >= MAX_SEGMENTS ? "Eight areas is the most" : "Add area" }}
              </button>
            </div>
            <p class="life-wheel-areas__foot">
              <template v-if="segments.length > MIN_SEGMENTS">
                Six to eight areas. Renaming keeps an area's scores.
              </template>
              <template v-else>A wheel needs at least six areas. Rename one to change it.</template>
              <span class="life-wheel-areas__count">{{ segments.length }} of {{ MAX_SEGMENTS }}</span>
            </p>
          </div>

          <footer class="life-wheel-modal__footer">
            <Button color="primary" size="medium" type="button" @click="closeEditModal">
              Done
            </Button>
          </footer>
        </section>
      </div>

      <div
        v-if="historyModalOpen"
        class="life-wheel-modal"
        role="presentation"
        @click.self="historyModalOpen = false"
      >
        <section
          class="life-wheel-modal__dialog life-wheel-modal__dialog--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wheel-history-title"
        >
          <header class="life-wheel-modal__header">
            <div>
              <h2 id="wheel-history-title">History</h2>
              <p>{{ snapshots.length }} saved {{ snapshots.length === 1 ? "snapshot" : "snapshots" }}</p>
            </div>
            <Button color="ghost" shape="soft" size="compact" icon-only type="button"
              aria-label="Close"
              @click="historyModalOpen = false"
            >
              <UiIcon name="X" :size="18" />
            </Button>
          </header>
          <div class="life-wheel-history">
            <article
              v-for="snapshot in snapshots"
              :key="snapshot.id"
              class="life-wheel-history__item"
            >
              <header>
                <strong>{{ formatSnapshotDate(snapshot.createdAt) }}</strong>
                <span>{{ snapshotAverage(snapshot) }}</span>
              </header>
              <div class="life-wheel-history__segments">
                <div
                  v-for="segment in snapshot.segments"
                  :key="`${snapshot.id}-${segment.id}`"
                  class="life-wheel-history__segment"
                >
                  <span
                    class="life-wheel-history__swatch"
                    :style="{ background: segment.color }"
                  />
                  <span class="life-wheel-history__segment-label">
                    <span class="life-wheel-history__inline-icon" aria-hidden="true">
                      <UiIcon
                        v-if="isUiIconName(segment.emoji)"
                        :name="segment.emoji as UiIconName"
                        :size="14"
                      />
                      <template v-else>{{ segment.emoji }}</template>
                    </span>
                    {{ segment.label }}
                  </span>
                  <strong>{{ segment.value || "Unset" }}/10</strong>
                  <small v-if="segment.notes">{{ segment.notes }}</small>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.life-wheel {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  width: min(1180px, 100%);
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  color: var(--ui-text);
}

.life-wheel--embedded,
.life-wheel--embedded .life-wheel__workspace {
  height: auto;
}

.life-wheel__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.life-wheel__bar-button {
  display: contents;
}

.life-wheel__workspace {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 8px 0 40px;
}

.life-wheel__stage {
  display: grid;
  justify-items: center;
  width: min(560px, 100%);
  margin: 0 auto;
}

.life-wheel__chart {
  width: min(100%, 520px, max(300px, calc(100vh - 420px)));
}

.life-wheel__hint {
  min-height: 20px;
  margin: 14px 16px 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.4;
  text-align: center;
}

.life-wheel__hint strong {
  color: var(--ui-text);
}

.life-wheel__legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
  width: 100%;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.life-wheel__legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  border-top: 1px solid var(--ui-border);
  font-size: 15px;
}

.life-wheel__legend li:nth-child(-n + 2) {
  border-top: 0;
}

.life-wheel__legend-emoji {
  display: inline-flex;
  width: 24px;
  justify-content: center;
  font-size: 18px;
}

.life-wheel__legend-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.life-wheel__legend-score {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.life-wheel__legend-score.is-unscored {
  color: var(--ui-text-muted);
  font-weight: 400;
}

.life-wheel__stage-foot {
  display: flex;
  justify-content: center;
  width: min(300px, 100%);
  margin-top: 16px;
}

.life-wheel__save {
  width: 100%;
}

.life-wheel__latest {
  margin: 8px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.35;
  text-align: center;
}

.life-wheel__text-button {
  min-height: 32px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.life-wheel__text-button:focus-visible,
.life-wheel-saved__head:focus-visible,
.life-wheel-areas__remove:focus-visible,
.life-wheel-areas__add:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

/* Saved snapshot */
.life-wheel-saved {
  display: grid;
  grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
  gap: 28px;
  width: min(860px, 100%);
  margin: 0 auto;
  padding: 0 8px;
  align-items: start;
}

.life-wheel-saved__wheel {
  display: grid;
  justify-items: center;
}

.life-wheel-saved__date {
  margin: 0 0 4px;
  color: var(--ui-text-muted);
  font-size: 14px;
  outline: none;
}

.life-wheel-saved__key {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 26px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.life-wheel-saved__dash {
  display: inline-block;
  width: 18px;
  border-top: 2px dashed var(--ui-text-muted);
}

.life-wheel-saved__average {
  margin: 6px 0 0;
  font-size: 15px;
  text-align: center;
}

.life-wheel-saved__average strong {
  font-variant-numeric: tabular-nums;
}

.life-wheel-saved__rows {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.life-wheel-saved__row {
  border-top: 1px solid var(--ui-border);
}

.life-wheel-saved__row:first-child {
  border-top: 0;
}

.life-wheel-saved__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 0;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.life-wheel-saved__emoji {
  display: inline-flex;
  width: 26px;
  justify-content: center;
  font-size: 19px;
}

.life-wheel-saved__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.life-wheel-saved__score {
  width: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: right;
}

.life-wheel-saved__chip {
  min-width: 46px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.life-wheel-saved__chip.is-up {
  background: var(--ui-accent-soft);
  color: var(--ui-accent);
}

.life-wheel-saved__chip.is-down,
.life-wheel-saved__chip.is-new {
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
}

.life-wheel-saved__chip.is-same {
  color: var(--ui-text-muted);
}

.life-wheel-saved__note,
.life-wheel-saved__note-text {
  margin: -6px 0 0;
  padding: 0 0 10px 36px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.life-wheel-saved__note input {
  width: 100%;
  padding: 6px 0;
  border: 0;
  border-bottom: 1px solid var(--ui-border);
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 14px;
  outline: none;
}

.life-wheel-saved__note input:focus {
  border-bottom-color: var(--ui-accent);
}

.life-wheel-saved__private {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.4;
}

.life-wheel-saved__actions {
  display: flex;
  gap: 8px;
  margin-top: 18px;
}

/* Dialogs */
.life-wheel-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 18px;
  background: color-mix(in oklab, #000, transparent 54%);
}

.life-wheel-modal__dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(520px, 100%);
  max-height: min(760px, calc(100vh - 36px));
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}

.life-wheel-modal__dialog--wide {
  width: min(760px, 100%);
  overflow: hidden;
}

.life-wheel-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 14px 6px 22px;
}

.life-wheel-modal__header h2 {
  margin: 0;
  color: var(--ui-text);
  font-size: 18px;
  line-height: 1.2;
}

.life-wheel-modal__header p {
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.life-wheel-modal__body {
  min-height: 0;
  overflow: auto;
  padding: 6px 22px 8px;
}

.life-wheel-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px 18px;
}

.life-wheel-areas {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
}

.life-wheel-areas__row,
.life-wheel-areas__add {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-top: 1px solid var(--ui-border);
}

.life-wheel-areas__row:first-child {
  border-top: 0;
}

.life-wheel-areas__emoji {
  --color-bg: var(--ui-bg);
  --color-border: var(--ui-border);
  --color-text: var(--ui-text);
  --color-text-muted: var(--ui-text-muted);
  flex: none;
}

.life-wheel-areas__emoji :deep(.icon-picker-trigger) {
  gap: 0;
}

.life-wheel-areas__emoji :deep(.trigger-btn) {
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in oklab, var(--area-tint, var(--ui-accent)), transparent 86%);
}

.life-wheel-areas__emoji :deep(.current-icon .emoji) {
  font-size: 22px;
}

.life-wheel-areas__emoji :deep(.clear-btn) {
  display: none;
}

.life-wheel-areas__emoji :deep(.picker-dropdown) {
  z-index: 120;
}

.life-wheel-areas__name {
  flex: 1;
  min-width: 0;
  padding: 10px 4px;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-weight: 500;
  outline: none;
}

.life-wheel-areas__name:focus-visible {
  box-shadow: inset 0 -2px 0 var(--ui-accent);
}

.life-wheel-areas__remove {
  min-height: 44px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-danger, color-mix(in oklab, #d23b2f 78%, var(--ui-text)));
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.life-wheel-areas__add {
  width: 100%;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  background: transparent;
  color: var(--ui-accent);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.life-wheel-areas__add-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-accent-soft);
}

.life-wheel-areas__add:disabled {
  color: var(--ui-text-muted);
  cursor: default;
}

.life-wheel-areas__add:disabled .life-wheel-areas__add-icon {
  background: var(--ui-surface-muted);
}

.life-wheel-areas__foot {
  margin: 10px 6px 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.life-wheel-areas__count {
  margin-left: 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.life-wheel-history {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.life-wheel-history__item {
  display: grid;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.life-wheel-history__item:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.life-wheel-history__item header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.life-wheel-history__item header span {
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 800;
}

.life-wheel-history__inline-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: -0.15em;
}

.life-wheel-history__segments {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}

.life-wheel-history__segment {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px;
  color: var(--ui-text);
  font-size: 13px;
}

.life-wheel-history__segment small {
  grid-column: 2 / 4;
  color: var(--ui-text-muted);
  line-height: 1.35;
}

.life-wheel-history__swatch {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

@media (max-width: 720px) {
  .life-wheel-saved {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .life-wheel-saved__wheel {
    width: min(100%, 360px);
    margin: 0 auto;
  }

  .life-wheel-saved__actions > * {
    flex: 1;
  }

  .life-wheel-history__segments {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .life-wheel-modal {
    padding: 10px;
  }

  .life-wheel-modal__body {
    padding: 6px 14px 8px;
  }
}
</style>
