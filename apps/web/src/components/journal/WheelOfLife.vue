<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "../Button.vue";
import IconPicker from "../IconPicker.vue";
import LifeWheelChart from "./LifeWheelChart.vue";
import UiIcon from "../UiIcon.vue";
import { api } from "../../api";
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

const segments = ref<WheelSegment[]>([]);
const snapshots = ref<WheelSnapshot[]>([]);
const editModalOpen = ref(false);
const saveModalOpen = ref(false);
const historyModalOpen = ref(false);
const snapshotNotes = ref<Record<string, string>>({});
const loading = ref(true);
const saving = ref(false);
const syncError = ref("");
let settingsSyncTimer: ReturnType<typeof setTimeout> | null = null;

const allSegmentsScored = computed(() =>
  segments.value.every((segment) => segment.value !== null),
);

const latestSnapshot = computed(() => snapshots.value[0] || null);
const historyAvailable = computed(() => snapshots.value.length > 1);

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
        segments: segments.value,
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

function addSegment() {
  if (segments.value.length >= MAX_SEGMENTS) return;
  const palette = ["#0f766e", "#9333ea", "#0e7490", "#b45309", "#be185d"];
  segments.value.push({
    id: createId("area"),
    label: `Area ${segments.value.length + 1}`,
    helper: "Personal context",
    color: palette[segments.value.length % palette.length],
    emoji: "✦",
    value: null,
  });
}

function removeSegment(segmentId: string) {
  if (segments.value.length <= MIN_SEGMENTS) return;
  segments.value = segments.value.filter((segment) => segment.id !== segmentId);
}

function openSaveModal() {
  if (!allSegmentsScored.value) return;
  snapshotNotes.value = Object.fromEntries(
    segments.value.map((segment) => [segment.id, ""]),
  );
  saveModalOpen.value = true;
  nextTick(() => {
    document.querySelector<HTMLInputElement>("[data-wheel-note-input]")?.focus();
  });
}

async function saveSnapshot() {
  const localSnapshot: WheelSnapshot = {
    id: createId("snapshot"),
    createdAt: new Date().toISOString(),
    segments: segments.value.map((segment) => ({
      id: segment.id,
      label: segment.label,
      helper: segment.helper,
      color: segment.color,
      emoji: segment.emoji,
      value: segment.value,
      notes: snapshotNotes.value[segment.id]?.trim() || "",
    })),
  };
  saving.value = true;
  try {
    const response = await api.post<WheelSnapshotResponse>(
      "/journal/wheel/snapshots",
      {
        id: localSnapshot.id,
        createdAt: localSnapshot.createdAt,
        segments: localSnapshot.segments,
        notes: Object.fromEntries(
          localSnapshot.segments.map((segment) => [segment.id, segment.notes || ""]),
        ),
      },
    );
    snapshots.value = [response.snapshot, ...snapshots.value];
    syncError.value = "";
  } catch {
    snapshots.value = [localSnapshot, ...snapshots.value];
    syncError.value = "Snapshot saved in this browser; server save did not complete.";
  } finally {
    saving.value = false;
    saveModalOpen.value = false;
    snapshotNotes.value = {};
  }
}

function closeModals() {
  editModalOpen.value = false;
  saveModalOpen.value = false;
  historyModalOpen.value = false;
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

function snapshotAverage(snapshot: WheelSnapshot) {
  const scored = snapshot.segments.filter((segment) => segment.value !== null);
  if (!scored.length) return "No score";
  const total = scored.reduce((sum, segment) => sum + (segment.value || 0), 0);
  return `${(total / scored.length).toFixed(1)}/10`;
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeModals();
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
    <h1
      v-if="!props.labelledBy"
      id="life-wheel-title"
      class="life-wheel__sr-only"
    >
      Wheel of Life
    </h1>

    <div class="life-wheel__actions" aria-label="Wheel of Life actions">
      <Button color="ghost" shape="soft" size="compact" icon-only type="button"
        :disabled="!historyAvailable"
        aria-label="View snapshot history"
        title="View snapshot history"
        @click="historyModalOpen = true"
      >
        <UiIcon name="History" :size="18" />
      </Button>
      <Button color="ghost" shape="soft" size="compact" icon-only type="button"
        aria-label="Edit wheel segments"
        title="Edit wheel segments"
        @click="editModalOpen = true"
      >
        <UiIcon name="Pencil" :size="18" />
      </Button>
      <Button color="ghost" shape="soft" size="compact" icon-only type="button"
        :disabled="!allSegmentsScored || saving"
        aria-label="Save snapshot"
        :title="saving ? 'Saving snapshot' : 'Save snapshot'"
        @click="openSaveModal"
      >
        <UiIcon name="Save" :size="18" />
      </Button>
    </div>

    <div class="life-wheel__workspace">
      <div class="life-wheel__stage">
        <LifeWheelChart
          :segments="segments"
          aria-label="Wheel of Life score selector"
          @update:segment-value="setSegmentValue"
        />

        <p v-if="latestSnapshot" class="life-wheel__latest">
          Last saved {{ formatSnapshotDate(latestSnapshot.createdAt) }}
        </p>
        <p v-else-if="loading" class="life-wheel__latest">Loading Wheel...</p>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="editModalOpen"
        class="life-wheel-modal"
        role="presentation"
        @click.self="editModalOpen = false"
      >
        <section
          class="life-wheel-modal__dialog life-wheel-modal__dialog--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-wheel-title"
        >
          <header class="life-wheel-modal__header">
            <div>
              <h2 id="edit-wheel-title">Edit areas</h2>
              <p>Adjust labels, colors, helper text, and scores.</p>
            </div>
            <div class="life-wheel-modal__header-actions">
              <button
                type="button"
                class="life-wheel__mini-button"
                :disabled="segments.length >= MAX_SEGMENTS"
                @click="addSegment"
              >
                <UiIcon name="Plus" :size="15" aria-hidden="true" />
                <span>Add</span>
              </button>
              <Button color="ghost" shape="soft" size="compact" icon-only type="button"
                aria-label="Close"
                @click="editModalOpen = false"
              >
                <UiIcon name="X" :size="18" />
              </Button>
            </div>
          </header>

          <div class="life-wheel-modal__body life-wheel-modal__body--edit">
            <div class="life-wheel__segment-list">
              <article
                v-for="segment in segments"
                :key="segment.id"
                class="life-wheel__segment-editor"
              >
                <div class="life-wheel__segment-editor-top">
                  <IconPicker
                    v-model="segment.emoji"
                    class="life-wheel__area-icon-picker"
                    :aria-label="`${segment.label} icon`"
                  />
                  <input
                    v-model="segment.label"
                    class="life-wheel__text-input"
                    :aria-label="`${segment.label} label`"
                    maxlength="36"
                  />
                  <input
                    v-model="segment.helper"
                    class="life-wheel__helper-input"
                    :aria-label="`${segment.label} helper text`"
                    maxlength="180"
                  />
                  <input
                    v-model="segment.color"
                    class="life-wheel__color-input"
                    type="color"
                    :aria-label="`${segment.label} color`"
                  />
                  <button
                    type="button"
                    class="life-wheel__remove-button"
                    :disabled="segments.length <= MIN_SEGMENTS"
                    :aria-label="`Remove ${segment.label}`"
                    @click="removeSegment(segment.id)"
                  >
                    <UiIcon name="Trash2" :size="15" />
                  </button>
                </div>
                <div class="life-wheel__score-row">
                  <input
                    :id="`score-${segment.id}`"
                    type="range"
                    min="1"
                    max="10"
                    :value="segment.value || 1"
                    :aria-label="`${segment.label} score`"
                    @input="
                      setSegmentValue(
                        segment.id,
                        Number(($event.target as HTMLInputElement).value),
                      )
                    "
                  />
                  <output :for="`score-${segment.id}`">
                    {{ segment.value ? `${segment.value}/10` : "Unset" }}
                  </output>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>

      <div
        v-if="saveModalOpen"
        class="life-wheel-modal"
        role="presentation"
        @click.self="saveModalOpen = false"
      >
        <section
          class="life-wheel-modal__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-wheel-title"
        >
          <header class="life-wheel-modal__header">
            <div>
              <h2 id="save-wheel-title">Save snapshot</h2>
              <p>Optional notes stay with this private entry.</p>
            </div>
            <Button color="ghost" shape="soft" size="compact" icon-only type="button"
              aria-label="Close"
              @click="saveModalOpen = false"
            >
              <UiIcon name="X" :size="18" />
            </Button>
          </header>
          <div class="life-wheel-modal__body">
            <label
              v-for="(segment, index) in segments"
              :key="segment.id"
              class="life-wheel-modal__note"
            >
              <span>
                <strong>
                  <span class="life-wheel-modal__inline-icon" aria-hidden="true">
                    <UiIcon
                      v-if="isUiIconName(segment.emoji)"
                      :name="segment.emoji as UiIconName"
                      :size="16"
                    />
                    <template v-else>{{ segment.emoji }}</template>
                  </span>
                  {{ segment.label }}
                </strong>
                <small>{{ segment.value }}/10</small>
              </span>
              <input
                v-model="snapshotNotes[segment.id]"
                :data-wheel-note-input="index === 0 ? true : undefined"
                :placeholder="`Notes for ${segment.label}`"
                maxlength="600"
              />
            </label>
          </div>
          <footer class="life-wheel-modal__footer">
            <button type="button" class="life-wheel__mini-button" @click="saveModalOpen = false">
              Cancel
            </button>
            <button
              type="button"
              class="life-wheel__save"
              :disabled="saving"
              @click="saveSnapshot"
            >
              <UiIcon name="Check" :size="16" aria-hidden="true" />
              <span>{{ saving ? "Saving..." : "Confirm save" }}</span>
            </button>
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
              <h2 id="wheel-history-title">Snapshot history</h2>
              <p>{{ snapshots.length }} saved entries</p>
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
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  width: min(1180px, 100%);
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  color: var(--ui-text);
}

.life-wheel--embedded,
.life-wheel--embedded .life-wheel__stage {
  height: auto;
}

.life-wheel-modal__dialog {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
}

.life-wheel__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.life-wheel__panel-header h2,
.life-wheel-modal__header h2 {
  margin: 0;
  color: var(--ui-text);
  font-size: 18px;
  line-height: 1.2;
}

.life-wheel__latest,
.life-wheel-modal__header p {
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.35;
}

.life-wheel__actions,
.life-wheel__panel-header,
.life-wheel__segment-editor-top,
.life-wheel__score-row,
.life-wheel-modal__header,
.life-wheel-modal__footer,
.life-wheel-history__item header {
  display: flex;
  align-items: center;
}

.life-wheel__actions {
  z-index: 22;
  justify-self: end;
  display: flex;
  gap: 8px;
  margin-bottom: -44px;
}

.life-wheel__icon-button,
.life-wheel__save,
.life-wheel__mini-button,
.life-wheel__remove-button {
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  cursor: pointer;
}

.life-wheel__icon-button {
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
}

.life-wheel__save,
.life-wheel__mini-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 700;
}

.life-wheel__save {
  background: var(--ui-accent);
  color: var(--ui-accent-contrast);
}

.life-wheel__mini-button,
.life-wheel__remove-button {
  border-color: var(--ui-border);
}

.life-wheel__icon-button:hover:not(:disabled),
.life-wheel__mini-button:hover:not(:disabled),
.life-wheel__remove-button:hover:not(:disabled) {
  background: var(--ui-surface-muted);
}

.life-wheel__save:hover:not(:disabled) {
  background: var(--ui-accent-strong);
}

.life-wheel__icon-button:disabled,
.life-wheel__save:disabled,
.life-wheel__mini-button:disabled,
.life-wheel__remove-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.life-wheel__workspace {
  display: block;
  min-width: 0;
  min-height: 0;
}

.life-wheel__stage {
  display: grid;
  align-content: center;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.life-wheel__canvas {
  position: relative;
  display: grid;
  width: min(840px, 100%);
  aspect-ratio: 1;
  place-items: center;
  margin: 0 auto;
}

.life-wheel__svg {
  display: block;
  width: 100%;
  max-width: 780px;
  aspect-ratio: 1;
  overflow: visible;
}

.life-wheel__grid circle,
.life-wheel__grid line {
  fill: none;
  stroke: color-mix(in oklab, var(--ui-text-muted), transparent 58%);
  stroke-width: 0.65;
  vector-effect: non-scaling-stroke;
}

.life-wheel__grid circle.is-outer {
  stroke: var(--ui-text);
  stroke-width: 1.6;
}

.life-wheel__center-dot {
  fill: var(--ui-text);
  stroke: none;
}

.life-wheel__hit-area {
  cursor: crosshair;
  outline: none;
}

.life-wheel__hit-area:focus-visible {
  stroke: var(--ui-accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.life-wheel__hover-number text,
.life-wheel__hover-number {
  fill: var(--ui-text);
  font-size: 9px;
  font-weight: 800;
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}

.life-wheel__labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.life-wheel__label {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: clamp(68px, 10vw, 90px);
  max-width: 18%;
  gap: 2px;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.05;
  text-align: center;
  transform: translate(
    calc(
      var(--life-wheel-label-transform-x, -50%) +
        var(--life-wheel-label-active-nudge, 0%)
    ),
    -50%
  );
  cursor: pointer;
  pointer-events: auto;
}

.life-wheel__label-name,
.life-wheel__label-score {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.life-wheel__label-name {
  white-space: nowrap;
}

.life-wheel__label-score {
  max-height: 0;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    max-height 160ms ease,
    opacity 160ms ease,
    transform 160ms ease;
}

.life-wheel__label-score::before {
  content: "";
}

.life-wheel__label-score::after {
  content: "";
}

.life-wheel__label:hover,
.life-wheel__label:focus-visible,
.life-wheel__label.is-active {
  border-color: var(--ui-border);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

.life-wheel__label:hover .life-wheel__label-score,
.life-wheel__label:focus-visible .life-wheel__label-score,
.life-wheel__label.is-active .life-wheel__label-score {
  max-height: 1.2em;
  opacity: 1;
  transform: translateY(0);
}

.life-wheel__label-emoji {
  flex: 0 0 auto;
  font-size: 18px;
  line-height: 1;
}

.life-wheel__latest {
  text-align: center;
}

.life-wheel__panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-width: 0 0 0 1px;
  border-radius: 0;
}

.life-wheel__panel-header {
  justify-content: space-between;
  gap: 12px;
}

.life-wheel__segment-list {
  display: grid;
  gap: 7px;
  overflow: visible;
}

.life-wheel__segment-editor {
  display: grid;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ui-border);
}

.life-wheel__segment-editor:last-child {
  border-bottom: 0;
}

.life-wheel__segment-editor-top {
  display: grid;
  grid-template-columns: 42px minmax(120px, 0.42fr) minmax(180px, 1fr) 34px 34px;
  align-items: center;
  gap: 6px;
}

.life-wheel__text-input,
.life-wheel__helper-input,
.life-wheel-modal__note input {
  min-width: 0;
  min-height: 34px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.life-wheel__area-icon-picker {
  --color-bg: var(--ui-bg);
  --color-border: var(--ui-border);
  --color-text: var(--ui-text);
  --color-text-muted: var(--ui-text-muted);
  width: 42px;
}

.life-wheel__area-icon-picker :deep(.icon-picker-trigger) {
  gap: 0;
}

.life-wheel__area-icon-picker :deep(.trigger-btn) {
  width: 42px;
  height: 34px;
  border-width: 1px;
  border-style: solid;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg);
}

.life-wheel__area-icon-picker :deep(.current-icon .emoji) {
  font-size: 18px;
}

.life-wheel__area-icon-picker :deep(.clear-btn) {
  display: none;
}

.life-wheel__area-icon-picker :deep(.picker-dropdown) {
  z-index: 120;
}

.life-wheel__text-input {
  flex: 1;
  padding: 0 9px;
  font-weight: 700;
}

.life-wheel__helper-input {
  padding: 0 9px;
  color: var(--ui-text-muted);
}

.life-wheel__text-input:focus,
.life-wheel__helper-input:focus,
.life-wheel-modal__note input:focus {
  border-color: var(--ui-accent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ui-accent), transparent 82%);
}

.life-wheel__color-input {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: transparent;
  cursor: pointer;
}

.life-wheel__remove-button {
  display: inline-grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--ui-text-muted);
}

.life-wheel__score-row {
  gap: 10px;
}

.life-wheel__score-row input[type="range"] {
  min-width: 0;
  flex: 1;
  accent-color: var(--ui-accent);
}

.life-wheel__score-row output {
  width: 54px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 800;
  text-align: right;
}

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
  width: min(620px, 100%);
  max-height: min(760px, calc(100vh - 36px));
  overflow: hidden;
  box-shadow: 0 24px 70px color-mix(in oklab, #000, transparent 70%);
}

.life-wheel-modal__dialog--wide {
  width: min(760px, 100%);
  overflow: visible;
}

.life-wheel-modal__header {
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--ui-border);
}

.life-wheel-modal__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.life-wheel-modal__body,
.life-wheel-history {
  display: grid;
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.life-wheel-modal__body--edit {
  overflow: visible;
}

.life-wheel-modal__note {
  display: grid;
  gap: 7px;
}

.life-wheel-modal__note span {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.life-wheel-modal__note small {
  color: var(--ui-text-muted);
  font-weight: 800;
}

.life-wheel-modal__inline-icon,
.life-wheel-history__inline-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: -0.15em;
}

.life-wheel-modal__note input {
  width: 100%;
  padding: 0 10px;
}

.life-wheel-modal__footer {
  justify-content: flex-end;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--ui-border);
}

.life-wheel-history {
  gap: 12px;
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
  justify-content: space-between;
  gap: 12px;
}

.life-wheel-history__item header span {
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 800;
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

@media (max-width: 959px) {
  .life-wheel__actions {
    margin-bottom: -40px;
  }

  .life-wheel__workspace {
    display: block;
  }

  .life-wheel__stage {
    min-height: 0;
    padding: 0;
  }

  .life-wheel__canvas {
    width: min(100%, 680px);
  }

  .life-wheel__svg {
    width: 100%;
  }

  .life-wheel-history__segments {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .life-wheel__actions {
    justify-self: stretch;
    justify-content: flex-end;
  }

  .life-wheel__canvas {
    width: min(100%, 430px);
  }

  .life-wheel__svg {
    width: 80%;
  }

  .life-wheel__label {
    --life-wheel-label-active-nudge: var(--life-wheel-label-mobile-nudge, 0%);
    width: 66px;
    max-width: 22%;
    gap: 1px;
    padding: 3px 2px;
    background: var(--ui-surface);
    font-size: 9px;
  }

  .life-wheel__label-emoji {
    font-size: 15px;
  }

  .life-wheel__save {
    min-width: 0;
  }

  .life-wheel__segment-editor-top {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 34px 34px;
  }

  .life-wheel__helper-input {
    grid-column: 1 / -1;
  }

  .life-wheel__color-input {
    grid-column: 3;
    grid-row: 1;
  }

  .life-wheel__remove-button {
    grid-column: 4;
    grid-row: 1;
  }

  .life-wheel-modal {
    padding: 10px;
  }
}
</style>
