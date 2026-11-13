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
import { useRoute, useRouter } from "vue-router";
import type { Editor } from "@tiptap/core";
import { ApiError, api } from "../api";
import Button from "../components/Button.vue";
import DatePickerPopover from "../components/calendar/DatePickerPopover.vue";
import TiptapEditor from "../components/TiptapEditor.vue";
import UiIcon from "../components/UiIcon.vue";
import { useVoiceDictation } from "../composables/useVoiceDictation";
import { useAuthStore } from "../stores/auth";
import { findInlineTextMatch } from "../utils/inlineJournalChips";
import { parseJournalReminderCapture } from "../utils/journalReminderCapture";
import { journalBodyForEditor } from "../utils/journalContent";
import { writtenGratitude } from "../utils/gratitude";
import JournalNoteMoveMenu from "../components/journal/JournalNoteMoveMenu.vue";
import JournalNotesTree from "../components/journal/JournalNotesTree.vue";
import type { NoteFolder, NotePlacement } from "../utils/journalNotes";
import { plainPreview } from "../utils/homeSummary";

definePage({
  meta: {
    requiresAuth: true,
    requiresPlugin: "me3.journal",
    title: "Writing | ME3",
    description: "Private ME3 Journal workspace.",
    robots: "noindex,follow",
  },
});

type JournalEntry = {
  metadata?: Record<string, unknown>;
  id: string;
  date: string;
  title: string | null;
  body: string;
  bodyFormat: "plain_text" | "markdown" | "html";
  createdAt: string;
  updatedAt: string;
  revision: number;
};

type Article = Omit<JournalEntry, "date"> & { projectId?: string | null; folderId?: string | null };

type JournalArchiveEntry = JournalEntry & {
  preview: string;
};

type JournalMediaUploadResponse = {
  ok: true;
  id: string;
  src: string;
  filename: string;
  mimeType: string;
  size: number;
  storage: "r2" | "inline";
};

type MissionProject = {
  id: string;
  name: string;
  slug?: string | null;
};

type JournalProjectLink = {
  id: string;
  journalEntryId: string;
  projectId: string;
  sourceText: string | null;
  createdTaskId: string | null;
  createdReminderId: string | null;
  createdAt: string;
  entryDate: string;
  entryTitle: string | null;
  taskTitle: string | null;
};

type CaptureMode = "task" | "reminder";
type InlineJournalChip = {
  id: string;
  label: string;
  kind: "task";
  taskId: string;
  projectId: string;
  left: number;
  top: number;
};
type TiptapEditorExpose = {
  insertText: (text: string) => void;
  editor: Editor | null;
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const selectedDate = ref(normalizeLocalDateInput(rawDateQuery(route.query.date)) || todayKey());
const dayTitle = computed(() => new Date(`${selectedDate.value}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }));
const datePickerOpen = ref(false);
const datePickerMonth = ref(monthKey(selectedDate.value));
const title = ref("");
const description = ref("");
const loadedEntry = ref<JournalEntry | null>(null);
const archiveEntries = ref<JournalArchiveEntry[]>([]);
// The Daily and Notes buttons in the top bar show that list; pressing the shown one hides it.
// Desktop starts with the list beside a page-centred editor and remembers if you hide it.
// On phones the list takes the screen, and picking something returns to the editor.
const WIDE_SCREEN_QUERY = "(min-width: 1180px)";
const NARROW_SCREEN_QUERY = "(max-width: 900px)";
const LIBRARY_HIDDEN_KEY = "me3.journal.library.hidden";
function mediaMatches(query: string) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}
function libraryHiddenPreference() {
  try { return window.localStorage.getItem(LIBRARY_HIDDEN_KEY) === "1"; } catch { return false; }
}
const wideScreen = ref(mediaMatches(WIDE_SCREEN_QUERY));
const narrowScreen = ref(mediaMatches(NARROW_SCREEN_QUERY));
const libraryOpen = ref(wideScreen.value && !libraryHiddenPreference());
const monthToggles = ref<Record<string, boolean>>({});
const keyboardInset = ref(0);
const archiveLoaded = ref(false);
const libraryTab = ref<"daily" | "articles">("daily");
const articles = ref<Article[]>([]);
const currentArticle = ref<Article | null>(null);
const folders = ref<NoteFolder[]>([]);
const noteLocationOpen = ref(false);
// Where the open note is filed, for the topbar location button.
const currentNotePlacement = computed<NotePlacement>(() => {
  const article = currentArticle.value;
  const projectId = article?.projectId && projects.value.some((item) => item.id === article.projectId) ? article.projectId : null;
  const folderId = article?.folderId && folders.value.some((item) => item.id === article.folderId) ? article.folderId : null;
  return { projectId, folderId };
});
const currentNoteLocation = computed(() => {
  const { projectId, folderId } = currentNotePlacement.value;
  const project = projects.value.find((item) => item.id === projectId)?.name || "No project";
  const folder = folders.value.find((item) => item.id === folderId)?.name;
  return folder ? `${project} / ${folder}` : project;
});
const loading = ref(false);
const archiveLoading = ref(false);
const archiveActionDate = ref<string | null>(null);
const deletingDate = ref("");
const error = ref("");
const projects = ref<MissionProject[]>([]);
const entryLinks = ref<JournalProjectLink[]>([]);
const captureOpen = ref(false);
const captureMode = ref<CaptureMode>("task");
const captureText = ref("");
const captureTitle = ref("");
const captureProjectId = ref("");
const captureReminderDate = ref("");
const captureReminderTime = ref("");
const captureReminderTimezone = ref(browserTimezone());
const captureSaving = ref(false);
const captureError = ref("");
const editorWrap = ref<HTMLElement | null>(null);
const editorRef = ref<TiptapEditorExpose | null>(null);
const inlineJournalChips = ref<InlineJournalChip[]>([]);
const selectionToolbar = ref({
  visible: false,
  text: "",
  left: 0,
  top: 0,
});
const saveState = ref<"idle" | "saving" | "saved" | "error">("idle");
const hydratingEntry = ref(false);
let saveTimer: number | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let currentLoadToken = 0;
let inlineChipFrame: number | null = null;

const currentDateIsToday = computed(() => selectedDate.value === todayKey());
const selectedDateLabel = computed(() =>
  currentDateIsToday.value
    ? "Today"
    : formatDaySwitcherDate(selectedDate.value, narrowScreen.value ? "short" : "long"),
);
const saveStatusText = computed(() => {
  if (saveState.value === "saving") return "Saving";
  if (saveState.value === "saved") return "Saved";
  if (saveState.value === "error") return "Could not save";
  return "";
});
const hasLoadedEntry = computed(
  () => !currentArticle.value && loadedEntry.value?.date === selectedDate.value,
);
const wordCount = computed(() => htmlToPlainText(description.value).split(/\s+/).filter(Boolean).length);
const nonEmptyArchiveEntries = computed(() =>
  archiveEntries.value.filter(entryHasContent),
);
// The newest month and the month you are reading start open; older months stay folded until opened.
const archiveMonths = computed(() => {
  const months: { key: string; label: string; open: boolean; entries: JournalArchiveEntry[] }[] = [];
  for (const entry of nonEmptyArchiveEntries.value) {
    const key = monthKey(entry.date);
    let month = months[months.length - 1];
    if (!month || month.key !== key) {
      const selected = !currentArticle.value && key === monthKey(selectedDate.value);
      month = { key, label: formatArchiveMonth(entry.date), open: monthToggles.value[key] ?? (months.length === 0 || selected), entries: [] };
      months.push(month);
    }
    month.entries.push(entry);
  }
  return months;
});
function toggleMonth(key: string, open: boolean) {
  monthToggles.value = { ...monthToggles.value, [key]: !open };
}
const journalEntryDates = computed(() =>
  nonEmptyArchiveEntries.value.map((entry) => entry.date),
);
const inlineJournalChipIds = computed(
  () => new Set(inlineJournalChips.value.map((chip) => chip.id)),
);
const fallbackEntryLinks = computed(() =>
  entryLinks.value.filter(
    (link) => link.createdTaskId && !inlineJournalChipIds.value.has(link.id),
  ),
);
const captureHeading = computed(() => {
  if (captureMode.value === "task") return "Create task";
  return "Create reminder";
});
const captureTextLabel = computed(() => {
  if (captureMode.value === "task") return "Description";
  return "Notes";
});
const captureSubmitDisabled = computed(() => {
  if (captureSaving.value) return true;
  if (captureMode.value === "reminder") {
    return (
      !captureTitle.value.trim() ||
      !captureReminderDate.value ||
      !captureReminderTime.value ||
      !captureReminderTimezone.value.trim()
    );
  }
  return !captureProjectId.value || !captureText.value.trim();
});
const accountTimezone = computed(() => auth.user?.timezone || browserTimezone());
const {
  canUse: canUseVoiceDictation,
  elapsedLabel: voiceRecordingElapsedLabel,
  state: voiceDictationState,
  statusText: voiceDictationStatusText,
  toggle: toggleVoiceDictation,
} = useVoiceDictation({
  disabled: () => loading.value,
  filenamePrefix: "journal-dictation",
  onTranscript: insertVoiceTranscript,
});

function dateToKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayKey(): string {
  return dateToKey(new Date());
}

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function todayKeyInTimezone(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
    if (value("year") && value("month") && value("day")) {
      return `${value("year")}-${value("month")}-${value("day")}`;
    }
  } catch {
    // Fall back to the browser date if the account timezone is unavailable.
  }
  return todayKey();
}

function defaultReminderDate(): string {
  const today = todayKey();
  return selectedDate.value >= today ? selectedDate.value : today;
}

function defaultReminderTime(): string {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

function normalizeLocalDateInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function rawDateQuery(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

function addDays(dateKey: string, days: number): string {
  const [year, month, dayNumber] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, dayNumber + days);
  return dateToKey(date);
}

function addMonths(monthKeyValue: string, months: number): string {
  const [year, month] = monthKeyValue.split("-").map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKey(dateKey: string): string {
  const normalized = normalizeLocalDateInput(dateKey);
  if (normalized) return normalized.slice(0, 7);
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDaySwitcherDate(value: string, month: "short" | "long" = "long"): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month,
  }).format(date);
}

// Rows sit under their month, so a row only needs its day: "Thu 12".
function formatArchiveDay(value: string): string {
  if (value === todayKey()) return "Today";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatArchiveDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatArchiveTitle(entry: JournalArchiveEntry): string {
  const date = formatArchiveDate(entry.date);
  const entryTitle = entry.title?.trim();
  return entryTitle ? `${date} - ${entryTitle}` : date;
}

function formatArchiveMonth(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", ...(value.slice(0, 4) === todayKey().slice(0, 4) ? {} : { year: "numeric" }) })
    .format(new Date(`${value}T12:00:00`));
}

function archiveWordCount(entry: JournalArchiveEntry) {
  return htmlToPlainText(entry.body).split(/\s+/).filter(Boolean).length;
}

function articleWordCount(article: Article): number {
  return htmlToPlainText(article.body).split(/\s+/).filter(Boolean).length;
}

// The tree already shows each note's project and folder, so the row shows its words.
function noteSubtitle(article: Article): string {
  const preview = plainPreview(htmlToPlainText(article.body));
  return preview ? preview : articleEditedLabel(article.updatedAt);
}

function articleEditedLabel(value: string) {
  const hours = Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `edited ${hours}h ago`;
  if (hours < 48) return "yesterday";
  return formatArchiveDate(value.slice(0, 10));
}

function htmlToPlainText(value: string): string {
  if (!value) return "";
  const doc = new DOMParser().parseFromString(value, "text/html");
  doc.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, div, br")
    .forEach((node) => node.append(" "));
  return (doc.body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function insertVoiceTranscript(text: string) {
  editorRef.value?.insertText(text);
}

function defaultCaptureTitle(text: string): string {
  return text.split(/\r?\n/)[0]?.trim().slice(0, 180) || text.slice(0, 180);
}

function missionTaskHref(projectId: string, taskId: string): string {
  const query = new URLSearchParams({ project: projectId, task: taskId });
  return `/tasks?${query.toString()}`;
}

function taskLinkHref(link: JournalProjectLink): string {
  return missionTaskHref(link.projectId, link.createdTaskId || "");
}

function entryHasContent(entry: Pick<JournalArchiveEntry, "title" | "body" | "preview" | "metadata">): boolean {
  return Boolean(
    entry.title?.trim() ||
      entry.preview?.trim() ||
      htmlToPlainText(entry.body).length > 0 ||
      writtenGratitude(entry.metadata).gratitude.length || writtenGratitude(entry.metadata).goodThings.length,
  );
}

function previewFromEntry(entry: JournalEntry): string {
  return htmlToPlainText(entry.body).slice(0, 180);
}

function updateArchiveEntry(entry: JournalEntry) {
  const archivedEntry: JournalArchiveEntry = {
    ...entry,
    preview: previewFromEntry(entry),
  };
  archiveEntries.value = [
    archivedEntry,
    ...archiveEntries.value.filter((candidate) => candidate.date !== entry.date),
  ]
    .filter(entryHasContent)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

function clearSaveTimer() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function scheduleSave() {
  if (hydratingEntry.value) return;
  if (!hasLoadedEntry.value && loading.value) return;
  clearSaveTimer();
  saveTimer = window.setTimeout(() => {
    void saveEntry();
  }, 700);
}

function saveEntry() {
  clearSaveTimer();
  const next = saveQueue.then(performSave);
  saveQueue = next.catch(() => {});
  return next;
}

async function performSave() {
  saveState.value = "saving";
  try {
    if (currentArticle.value) {
      const article = currentArticle.value;
      const response = await api.patch<{ article: Article }>(
        `/journal/articles/${encodeURIComponent(article.id)}`,
        { title: title.value.trim() || null, body: description.value, bodyFormat: "html" },
        { headers: { "If-Match": `"journal-${article.revision}"` } },
      );
      currentArticle.value = response.article;
      articles.value = [response.article, ...articles.value.filter((item) => item.id !== article.id)];
      saveState.value = "saved";
      return;
    }
    const response = await api.patch<{ entry: JournalEntry }>(
      `/journal/days/${encodeURIComponent(selectedDate.value)}`,
      {
        title: title.value.trim() || null,
        body: description.value,
        bodyFormat: "html",
      },
    );
    loadedEntry.value = response.entry;
    updateArchiveEntry(response.entry);
    void loadEntryLinks(response.entry.id);
    saveState.value = "saved";
  } catch (saveError) {
    saveState.value = "error";
    error.value =
      saveError instanceof Error
        ? saveError.message
        : "Could not save journal entry.";
  }
}

async function uploadJournalImage(input: {
  blob: Blob;
  id: string;
  filename: string;
  mimeType: string;
  ext: string;
}) {
  const form = new FormData();
  form.append("date", selectedDate.value);
  form.append(
    "image",
    new File([input.blob], input.filename, { type: input.mimeType }),
  );
  const response = await api.upload<JournalMediaUploadResponse>(
    "/journal/media",
    form,
  );
  return {
    id: response.id || input.id,
    src: response.src,
  };
}

async function flushPendingSave() {
  if (saveTimer) await saveEntry();
  else await saveQueue;
}

async function loadDay(date: string) {
  const token = ++currentLoadToken;
  loading.value = true;
  error.value = "";
  saveState.value = "idle";
  try {
    const response = await api.get<{ entry: JournalEntry | null }>(
      `/journal/days/${encodeURIComponent(date)}`,
    );
    if (token !== currentLoadToken) return;
    hydratingEntry.value = true;
    currentArticle.value = null;
    loadedEntry.value = response.entry;
    title.value = response.entry?.title || "";
    description.value = response.entry
      ? journalBodyForEditor(response.entry.body, response.entry.bodyFormat)
      : "";
    entryLinks.value = [];
    if (response.entry) void loadEntryLinks(response.entry.id);
    await nextTick();
    hydratingEntry.value = false;
    saveState.value = response.entry ? "saved" : "idle";
  } catch (loadError) {
    if (token !== currentLoadToken) return;
    error.value =
      loadError instanceof Error
        ? loadError.message
        : "Could not load journal entry.";
  } finally {
    hydratingEntry.value = false;
    if (token === currentLoadToken) loading.value = false;
  }
}

async function loadProjects() {
  if (projects.value.length > 0) return;
  const response = await api.get<{ projects: MissionProject[] }>(
    "/mission-control/projects",
  );
  projects.value = response.projects || [];
  if (!captureProjectId.value) captureProjectId.value = projects.value[0]?.id || "";
}

async function loadEntryLinks(entryId: string) {
  try {
    const response = await api.get<{ links: JournalProjectLink[] }>(
      `/mission-control/journal/entries/${encodeURIComponent(entryId)}/links`,
    );
    if (loadedEntry.value?.id === entryId) entryLinks.value = response.links || [];
  } catch {
    entryLinks.value = [];
  }
}

async function openCapture(mode: CaptureMode) {
  error.value = "";
  captureError.value = "";
  const text = selectionToolbar.value.text;
  hideSelectionToolbar();
  await flushPendingSave();
  const entry = loadedEntry.value;
  if (!entry && !currentArticle.value) {
    error.value = "Write something first, then capture it.";
    return;
  }
  if (!text) {
    error.value = "Highlight journal text first.";
    return;
  }
  if (mode !== "reminder") {
    try {
      await loadProjects();
    } catch (projectError) {
      error.value =
        projectError instanceof Error
          ? projectError.message
          : "Could not load projects.";
      return;
    }
  }
  captureMode.value = mode;
  captureText.value = mode === "reminder" ? "" : text;
  captureTitle.value = defaultCaptureTitle(text);
  captureProjectId.value = captureProjectId.value || projects.value[0]?.id || "";
  captureReminderDate.value = defaultReminderDate();
  captureReminderTime.value = defaultReminderTime();
  captureReminderTimezone.value = accountTimezone.value;
  if (mode === "reminder") {
    const draft = parseJournalReminderCapture(text, {
      today: todayKeyInTimezone(accountTimezone.value),
      fallbackDate: captureReminderDate.value,
      fallbackTime: captureReminderTime.value,
    });
    captureTitle.value = defaultCaptureTitle(draft.title);
    captureReminderDate.value = draft.date;
    captureReminderTime.value = draft.time;
  }
  captureOpen.value = true;
}

function hideSelectionToolbar() {
  selectionToolbar.value = {
    visible: false,
    text: "",
    left: 0,
    top: 0,
  };
}

function updateSelectionToolbar() {
  if (captureOpen.value) {
    hideSelectionToolbar();
    return;
  }
  const selection = window.getSelection();
  const root = editorWrap.value;
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (
    !selection ||
    selection.isCollapsed ||
    !root ||
    !anchorNode ||
    !focusNode ||
    !root.contains(anchorNode) ||
    !root.contains(focusNode)
  ) {
    hideSelectionToolbar();
    return;
  }

  const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!text || selection.rangeCount === 0) {
    hideSelectionToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  const rect = rects[rects.length - 1] || range.getBoundingClientRect();
  const toolbarWidth = 76;
  const toolbarHeight = 38;
  const left =
    rect.right + toolbarWidth + 12 <= window.innerWidth
      ? rect.right + 8
      : Math.max(8, rect.left - toolbarWidth - 8);
  const top = Math.min(
    window.innerHeight - toolbarHeight - 8,
    Math.max(8, rect.top + rect.height / 2 - toolbarHeight / 2),
  );
  selectionToolbar.value = { visible: true, text, left, top };
}

function findSourceRange(root: HTMLElement, sourceText: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent?.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const match = findInlineTextMatch(textNode.data, sourceText);
    if (match) {
      const range = document.createRange();
      range.setStart(textNode, Math.max(match.start, match.end - 1));
      range.setEnd(textNode, match.end);
      return range;
    }
    current = walker.nextNode();
  }

  return null;
}

function updateInlineJournalChips() {
  const root = editorWrap.value?.querySelector(".ProseMirror");
  if (!(root instanceof HTMLElement) || entryLinks.value.length === 0) {
    inlineJournalChips.value = [];
    return;
  }

  const contentWrapper = root.closest(".editor-content-wrapper");
  const scrollHost =
    contentWrapper instanceof HTMLElement ? contentWrapper : root;
  const visibleRect = scrollHost.getBoundingClientRect();
  const chips: InlineJournalChip[] = [];

  for (const link of entryLinks.value) {
    const sourceText = link.sourceText?.trim();
    if (!sourceText || !link.createdTaskId) continue;

    const range = findSourceRange(root, sourceText);
    if (!range) continue;

    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const rect = rects[rects.length - 1] || range.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      rect.bottom < visibleRect.top ||
      rect.top > visibleRect.bottom ||
      rect.bottom < 0 ||
      rect.top > window.innerHeight
    ) {
      continue;
    }

    const label = "Task";
    const estimatedWidth = Math.min(96, Math.max(38, label.length * 7 + 14));
    const height = 20;
    const minTop = Math.max(8, visibleRect.top + 4);
    const maxTop = Math.min(
      window.innerHeight - height - 8,
      visibleRect.bottom - height - 4,
    );
    if (maxTop < minTop) continue;

    let left = rect.right + 6;
    let top = rect.top + rect.height / 2 - height / 2;

    if (left + estimatedWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - estimatedWidth - 8);
      top = rect.bottom + 3;
    }

    chips.push({
      id: link.id,
      label,
      kind: "task",
      taskId: link.createdTaskId,
      projectId: link.projectId,
      left: Math.round(left),
      top: Math.round(
        Math.min(maxTop, Math.max(minTop, top)),
      ),
    });
  }

  inlineJournalChips.value = chips;
}

function scheduleInlineJournalChips() {
  if (inlineChipFrame !== null) {
    window.cancelAnimationFrame(inlineChipFrame);
  }
  inlineChipFrame = window.requestAnimationFrame(() => {
    inlineChipFrame = null;
    updateInlineJournalChips();
  });
}

function closeCapture() {
  if (captureSaving.value) return;
  captureOpen.value = false;
  captureError.value = "";
}

async function submitCapture() {
  const entry = loadedEntry.value;
  if ((!entry && !currentArticle.value) || captureSubmitDisabled.value) return;
  captureSaving.value = true;
  captureError.value = "";
  try {
    if (captureMode.value === "reminder") {
      await api.post("/agent/reminders", {
        title: captureTitle.value.trim(),
        date: captureReminderDate.value,
        time: captureReminderTime.value,
        timezone: captureReminderTimezone.value.trim(),
        recurrence: "none",
        notes: captureText.value.trim() || undefined,
      });
      captureOpen.value = false;
      return;
    }

    if (currentArticle.value) {
      await api.post("/mission-control/tasks", {
        title: captureTitle.value.trim(),
        description: captureText.value.trim(),
        projectId: captureProjectId.value,
        status: "backlog",
        priority: 3,
      });
      captureOpen.value = false;
      return;
    }
    const payload = {
      journalEntryId: entry!.id,
      projectId: captureProjectId.value,
      sourceText: captureText.value.trim(),
      title: captureTitle.value.trim(),
    };
    const response = await api.post<{ link: JournalProjectLink }>(
      "/mission-control/journal/tasks",
      payload,
    );
    entryLinks.value = [
      response.link,
      ...entryLinks.value.filter((link) => link.id !== response.link.id),
    ];
    captureOpen.value = false;
  } catch (captureSubmitError) {
    captureError.value =
      captureSubmitError instanceof ApiError
        ? captureSubmitError.message
        : "Could not capture this journal text.";
  } finally {
    captureSaving.value = false;
  }
}

async function loadArchive() {
  archiveLoading.value = true;
  try {
    const response = await api.get<{ entries: JournalArchiveEntry[] }>(
      "/journal/archive?limit=100",
    );
    archiveEntries.value = (response.entries || []).filter(entryHasContent);
    archiveLoaded.value = true;
  } catch (archiveError) {
    error.value =
      archiveError instanceof Error
        ? archiveError.message
        : "Could not load archive.";
  } finally {
    archiveLoading.value = false;
  }
}

function closeArchiveActions() {
  archiveActionDate.value = null;
}

function toggleArchiveActions(date: string) {
  archiveActionDate.value = archiveActionDate.value === date ? null : date;
}

async function setDate(date: string) {
  const normalized = normalizeLocalDateInput(date);
  if (!normalized || (normalized === selectedDate.value && !currentArticle.value)) return;
  await flushPendingSave();
  selectedDate.value = normalized;
  libraryTab.value = "daily";
  datePickerMonth.value = monthKey(normalized);
  datePickerOpen.value = false;
  await loadDay(normalized);
}

async function selectArchiveEntry(entry: JournalArchiveEntry) {
  closeArchiveActions();
  await setDate(entry.date);
  if (narrowScreen.value) libraryOpen.value = false;
}

function clearCurrentEntryForDeletedDate(date: string) {
  if (selectedDate.value !== date) return;
  hydratingEntry.value = true;
  loadedEntry.value = null;
  title.value = "";
  description.value = "";
  saveState.value = "idle";
  void nextTick(() => {
    hydratingEntry.value = false;
  });
}

async function deleteArchiveEntry(entry: JournalArchiveEntry) {
  closeArchiveActions();
  const confirmed = window.confirm(
    `Delete "${formatArchiveTitle(entry)}"? This removes it from your journal.`,
  );
  if (!confirmed) return;

  deletingDate.value = entry.date;
  error.value = "";
  try {
    await flushPendingSave();
    await api.delete<{ ok: true }>(
      `/journal/days/${encodeURIComponent(entry.date)}`,
    );
    archiveEntries.value = archiveEntries.value.filter(
      (candidate) => candidate.date !== entry.date,
    );
    clearCurrentEntryForDeletedDate(entry.date);
  } catch (deleteError) {
    error.value =
      deleteError instanceof Error
        ? deleteError.message
        : "Could not delete journal entry.";
  } finally {
    deletingDate.value = "";
  }
}

function moveDatePickerMonth(direction: number) {
  datePickerMonth.value = addMonths(datePickerMonth.value, direction);
}

function toggleDatePicker() {
  datePickerOpen.value = !datePickerOpen.value;
  datePickerMonth.value = monthKey(selectedDate.value);
  if (datePickerOpen.value && !archiveLoaded.value) {
    void loadArchive();
  }
}

function setLibraryOpen(open: boolean) {
  libraryOpen.value = open;
  // Phones always start on the editor, so only larger screens remember the choice.
  if (!narrowScreen.value) {
    try { window.localStorage.setItem(LIBRARY_HIDDEN_KEY, open ? "0" : "1"); } catch { /* per-browser convenience only */ }
  }
}

async function pickLibraryTab(tab: "daily" | "articles") {
  datePickerOpen.value = false;
  closeArchiveActions();
  if (libraryOpen.value && libraryTab.value === tab) {
    setLibraryOpen(false);
    return;
  }
  libraryTab.value = tab;
  if (!libraryOpen.value) {
    setLibraryOpen(true);
    await flushPendingSave();
  }
  await (tab === "articles" ? loadArticles() : loadArchive());
}

async function loadLibrary() {
  await loadArchive();
  await loadArticles();
}

let wideScreenMedia: MediaQueryList | null = null;
let narrowScreenMedia: MediaQueryList | null = null;
function handleScreenChange() {
  wideScreen.value = Boolean(wideScreenMedia?.matches);
  narrowScreen.value = Boolean(narrowScreenMedia?.matches);
  libraryOpen.value = wideScreen.value && !libraryHiddenPreference();
  if (libraryOpen.value) void loadLibrary();
}

// Keeps the dictate button above the on-screen keyboard.
function updateKeyboardInset() {
  const viewport = window.visualViewport;
  keyboardInset.value = viewport ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0;
}

async function loadArticles() {
  try {
    const [response, folderResponse] = await Promise.all([
      api.get<{ articles: Article[] }>("/journal/articles"),
      api.get<{ folders: NoteFolder[] }>("/journal/folders"),
      // Notes still list without projects when Projects is turned off.
      loadProjects().catch(() => undefined),
    ]);
    articles.value = response.articles || [];
    folders.value = folderResponse.folders || [];
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not load notes."; }
}

async function openArticle(id: string) {
  await flushPendingSave();
  const token = ++currentLoadToken;
  loading.value = true;
  try {
    const response = await api.get<{ article: Article }>(`/journal/articles/${encodeURIComponent(id)}`);
    if (token !== currentLoadToken) return;
    hydratingEntry.value = true;
    currentArticle.value = response.article;
    libraryTab.value = "articles";
    title.value = response.article.title || "";
    description.value = journalBodyForEditor(response.article.body, response.article.bodyFormat);
    entryLinks.value = [];
    await nextTick();
    if (narrowScreen.value) libraryOpen.value = false;
    saveState.value = "saved";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not load note."; }
  finally { hydratingEntry.value = false; if (token === currentLoadToken) loading.value = false; }
}

async function createArticle(placement?: NotePlacement) {
  await flushPendingSave();
  try {
    const where = placement?.folderId ? { folderId: placement.folderId } : { projectId: placement?.projectId ?? null };
    const response = await api.post<{ article: Article }>("/journal/articles", { title: null, body: "", bodyFormat: "html", ...where });
    articles.value = [response.article, ...articles.value];
    await openArticle(response.article.id);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not create note."; }
}

async function deleteArticle(article: Article) {
  if (!window.confirm(`Delete "${article.title || "Untitled note"}"?`)) return;
  try {
    await flushPendingSave();
    const revision = articles.value.find((item) => item.id === article.id)?.revision ?? article.revision;
    await api.delete(`/journal/articles/${encodeURIComponent(article.id)}`, { headers: { "If-Match": `"journal-${revision}"` } });
    articles.value = articles.value.filter((item) => item.id !== article.id);
    if (currentArticle.value?.id === article.id) await loadDay(selectedDate.value);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not delete note."; }
}

// Moves go through the save queue so they never race the editor's autosave.
async function moveArticle(article: Article, placement: NotePlacement) {
  noteLocationOpen.value = false;
  await flushPendingSave();
  const move = async () => {
    const isOpen = currentArticle.value?.id === article.id;
    const source = isOpen ? currentArticle.value! : articles.value.find((item) => item.id === article.id) ?? article;
    const response = await api.patch<{ article: Article }>(
      `/journal/articles/${encodeURIComponent(article.id)}`,
      {
        title: isOpen ? title.value.trim() || null : source.title,
        body: isOpen ? description.value : source.body,
        bodyFormat: isOpen ? "html" : source.bodyFormat,
        ...(placement.folderId ? { folderId: placement.folderId } : { projectId: placement.projectId, folderId: null }),
      },
      { headers: { "If-Match": `"journal-${source.revision}"` } },
    );
    if (currentArticle.value?.id === article.id) currentArticle.value = response.article;
    articles.value = [response.article, ...articles.value.filter((item) => item.id !== article.id)];
  };
  const next = saveQueue.then(move);
  saveQueue = next.catch(() => {});
  try { await next; } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not move note."; }
}

async function createFolder(projectId: string | null) {
  noteLocationOpen.value = false;
  const name = window.prompt("Folder name")?.trim();
  if (!name) return;
  try {
    const response = await api.post<{ folder: NoteFolder }>("/journal/folders", { name, projectId });
    folders.value = [...folders.value, response.folder];
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not create folder."; }
}

async function renameFolder(folder: NoteFolder) {
  const name = window.prompt("Rename folder", folder.name)?.trim();
  if (!name || name === folder.name) return;
  try {
    const response = await api.patch<{ folder: NoteFolder }>(`/journal/folders/${encodeURIComponent(folder.id)}`, { name });
    folders.value = folders.value.map((item) => (item.id === folder.id ? response.folder : item));
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not rename folder."; }
}

// Deleting a folder keeps its notes, loose in the same project.
async function deleteFolder(folder: NoteFolder) {
  if (!window.confirm(`Delete the folder "${folder.name}"? Its notes stay in the project.`)) return;
  try {
    await api.delete(`/journal/folders/${encodeURIComponent(folder.id)}`);
    folders.value = folders.value.filter((item) => item.id !== folder.id);
    articles.value = articles.value.map((item) => (item.folderId === folder.id ? { ...item, folderId: null } : item));
    if (currentArticle.value?.folderId === folder.id) currentArticle.value = { ...currentArticle.value, folderId: null };
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Could not delete folder."; }
}

function handleWindowClick() {
  datePickerOpen.value = false;
  noteLocationOpen.value = false;
  closeArchiveActions();
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (selectionToolbar.value.visible) {
      hideSelectionToolbar();
      return;
    }
    if (archiveActionDate.value) {
      closeArchiveActions();
      return;
    }
    datePickerOpen.value = false;
    if (narrowScreen.value) libraryOpen.value = false;
  }
}

watch([title, description], scheduleSave);
watch([entryLinks, description, projects], scheduleInlineJournalChips, {
  flush: "post",
});

// Links into Notes from Home's Notes card and the "New note" app shortcut (me3-qvyt):
// ?tab=notes opens the Notes list, ?note=<id> opens that note, ?new=note starts one.
watch(() => [route.query.tab, route.query.note, route.query.new], async ([tab, note, fresh]) => {
  if (route.path !== "/journal" || (tab !== "notes" && typeof note !== "string" && fresh !== "note")) return;
  const { tab: _tab, note: _note, new: _new, ...query } = route.query;
  await router.replace({ query });
  libraryTab.value = "articles";
  libraryOpen.value = true;
  await loadArticles();
  if (typeof note === "string") await openArticle(note);
  else if (fresh === "note") await createArticle();
}, { immediate: true, flush: "post" });

onMounted(() => {
  void loadDay(selectedDate.value);
  if (typeof window.matchMedia === "function") {
    wideScreenMedia = window.matchMedia(WIDE_SCREEN_QUERY);
    narrowScreenMedia = window.matchMedia(NARROW_SCREEN_QUERY);
    wideScreenMedia.addEventListener("change", handleScreenChange);
    narrowScreenMedia.addEventListener("change", handleScreenChange);
  }
  if (libraryOpen.value) void loadLibrary();
  window.visualViewport?.addEventListener("resize", updateKeyboardInset);
  window.visualViewport?.addEventListener("scroll", updateKeyboardInset);
  window.addEventListener("click", handleWindowClick);
  window.addEventListener("keydown", handleWindowKeydown);
  document.addEventListener("selectionchange", updateSelectionToolbar);
  window.addEventListener("mouseup", updateSelectionToolbar);
  window.addEventListener("keyup", updateSelectionToolbar);
  window.addEventListener("scroll", updateSelectionToolbar, true);
  window.addEventListener("scroll", scheduleInlineJournalChips, true);
  window.addEventListener("resize", updateSelectionToolbar);
  window.addEventListener("resize", scheduleInlineJournalChips);
});

onBeforeUnmount(() => {
  clearSaveTimer();
  wideScreenMedia?.removeEventListener("change", handleScreenChange);
  narrowScreenMedia?.removeEventListener("change", handleScreenChange);
  window.visualViewport?.removeEventListener("resize", updateKeyboardInset);
  window.visualViewport?.removeEventListener("scroll", updateKeyboardInset);
  if (inlineChipFrame !== null) {
    window.cancelAnimationFrame(inlineChipFrame);
  }
  window.removeEventListener("click", handleWindowClick);
  window.removeEventListener("keydown", handleWindowKeydown);
  document.removeEventListener("selectionchange", updateSelectionToolbar);
  window.removeEventListener("mouseup", updateSelectionToolbar);
  window.removeEventListener("keyup", updateSelectionToolbar);
  window.removeEventListener("scroll", updateSelectionToolbar, true);
  window.removeEventListener("scroll", scheduleInlineJournalChips, true);
  window.removeEventListener("resize", updateSelectionToolbar);
  window.removeEventListener("resize", scheduleInlineJournalChips);
});
</script>

<template>
  <main class="journal">
    <Teleport to="#app-page-controls" defer>
    <header class="journal__topbar">
      <div class="journal__tabs" role="group" aria-label="Writing library">
        <button type="button" :aria-pressed="libraryOpen && libraryTab === 'daily' ? 'true' : 'false'" :title="libraryOpen && libraryTab === 'daily' ? 'Hide daily pages' : 'Show daily pages'" @click="pickLibraryTab('daily')">Daily</button>
        <button type="button" :aria-pressed="libraryOpen && libraryTab === 'articles' ? 'true' : 'false'" :title="libraryOpen && libraryTab === 'articles' ? 'Hide notes' : 'Show notes'" @click="pickLibraryTab('articles')">Notes</button>
      </div>
      <div v-if="currentArticle" class="journal__day-switcher journal__note-location" @click.stop>
        <button
          type="button"
          class="journal__note-location-button"
          aria-haspopup="menu"
          :aria-expanded="noteLocationOpen ? 'true' : 'false'"
          :title="`Filed in ${currentNoteLocation}. Move to…`"
          @click="noteLocationOpen = !noteLocationOpen"
        >
          <UiIcon :name="currentNotePlacement.folderId ? 'Folder' : currentNotePlacement.projectId ? 'Target' : 'FileText'" :size="15" aria-hidden="true" />
          <span>{{ currentNoteLocation }}</span>
          <UiIcon name="ChevronDown" :size="15" aria-hidden="true" />
        </button>
        <JournalNoteMoveMenu
          v-if="noteLocationOpen"
          class="journal__note-location-menu"
          :projects="projects"
          :folders="folders"
          :current="currentNotePlacement"
          @move="moveArticle(currentArticle, $event)"
          @new-folder="createFolder"
        />
      </div>
      <div v-else class="journal__day-switcher" aria-label="Selected day" @click.stop>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          aria-label="Previous day"
          title="Previous day"
          type="button"
          @click="setDate(addDays(selectedDate, -1))"
        >
          <UiIcon name="ChevronLeft" :size="18" />
        </Button>
        <button
          type="button"
          class="journal__day-label"
          :aria-expanded="datePickerOpen"
          aria-haspopup="dialog"
          aria-label="Choose journal date"
          @click="toggleDatePicker"
        >
          <strong>{{ selectedDateLabel }}</strong>
        </button>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          aria-label="Next day"
          title="Next day"
          type="button"
          @click="setDate(addDays(selectedDate, 1))"
        >
          <UiIcon name="ChevronRight" :size="18" />
        </Button>
        <DatePickerPopover
          v-if="datePickerOpen"
          :month-key="datePickerMonth"
          :selected-date="selectedDate"
          :today-date="todayKey()"
          :marked-dates="journalEntryDates"
          aria-label="Choose journal date"
          @move-month="moveDatePickerMonth"
          @select-date="setDate"
          @today="setDate(todayKey())"
        />
      </div>
      <div class="journal__topbar-end" />
    </header>
    </Teleport>

    <div
      class="journal__workspace"
      :class="{ 'journal__workspace--library': libraryOpen }"
    >
      <aside
        v-if="libraryOpen"
        class="journal__archive"
        :aria-label="libraryTab === 'daily' ? 'Daily pages' : 'Notes'"
      >
        <template v-if="libraryTab === 'daily'">
          <section v-for="month in archiveMonths" :key="month.key" class="journal__month">
            <button type="button" class="journal__month-toggle" :aria-expanded="month.open ? 'true' : 'false'" @click="toggleMonth(month.key, month.open)">
              <UiIcon class="journal__month-chevron" name="ChevronDown" :size="15" aria-hidden="true" />
              <span>{{ month.label }}</span>
              <small>{{ month.entries.length }}</small>
            </button>
            <template v-if="month.open">
              <div v-for="entry in month.entries" :key="entry.id" class="journal__archive-row" :class="{
                'is-active': entry.date === selectedDate && !currentArticle,
                'is-menu-open': archiveActionDate === entry.date,
              }">
                <button
                  type="button"
                  class="journal__archive-row-main"
                  :disabled="deletingDate === entry.date"
                  :aria-label="`${formatArchiveTitle(entry)}, ${archiveWordCount(entry)} words`"
                  @click="selectArchiveEntry(entry)"
                >
                  <span class="journal__library-row-head"><strong>{{ formatArchiveDay(entry.date) }}</strong><small>{{ archiveWordCount(entry).toLocaleString() }} words</small></span>
                  <span v-if="entry.preview" class="journal__archive-preview">{{ plainPreview(entry.preview) }}</span>
                </button>
                <div class="journal__archive-row-actions" @click.stop>
                  <Button
                    color="ghost"
                    shape="soft"
                    size="compact"
                    icon-only
                    class="journal__archive-menu-button"
                    :aria-label="`Actions for ${formatArchiveTitle(entry)}`"
                    aria-haspopup="menu"
                    :aria-expanded="archiveActionDate === entry.date ? 'true' : 'false'"
                    title="Entry actions"
                    type="button"
                    :disabled="deletingDate === entry.date"
                    @click="toggleArchiveActions(entry.date)"
                  >
                    <UiIcon name="Ellipsis" :size="16" aria-hidden="true" />
                  </Button>
                  <div v-if="archiveActionDate === entry.date" class="journal__archive-menu" role="menu">
                    <button
                      type="button"
                      class="journal__archive-menu-item is-danger"
                      role="menuitem"
                      :disabled="deletingDate === entry.date"
                      @click="deleteArchiveEntry(entry)"
                    >
                      <UiIcon name="Trash2" :size="15" aria-hidden="true" />
                      Delete entry
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </section>
          <p v-if="nonEmptyArchiveEntries.length === 0" class="journal__empty">{{ archiveLoading ? 'Loading…' : 'No saved entries yet.' }}</p>
        </template>
        <template v-else>
          <button type="button" class="journal__new-note" @click="createArticle()"><UiIcon name="Plus" :size="16" aria-hidden="true" />New note</button>
          <JournalNotesTree
            :notes="articles"
            :folders="folders"
            :projects="projects"
            :active-id="currentArticle?.id ?? null"
            :word-count="articleWordCount"
            :subtitle="noteSubtitle"
            @open="openArticle"
            @delete="deleteArticle"
            @move="moveArticle"
            @new-note="createArticle"
            @new-folder="createFolder"
            @rename-folder="renameFolder"
            @delete-folder="deleteFolder"
          />
          <p v-if="articles.length === 0" class="journal__empty">No notes yet.</p>
        </template>
      </aside>

      <section class="journal__sheet" :aria-label="currentArticle ? 'Note' : 'Daily page'">
        <p v-if="error" class="journal__message is-error">{{ error }}</p>

        <div
          ref="editorWrap"
          class="journal__editor-wrap"
          :class="{ 'is-loading': loading }"
        >
          <TiptapEditor
            ref="editorRef"
            v-model="description"
            v-model:title="title"
            show-title-field
            variant="workspace"
            :title-placeholder="currentArticle ? 'Untitled note' : dayTitle"
            :title-prefilled="!currentArticle"
            :title-max-length="180"
            :title-disabled="loading"
            :upload-image="uploadJournalImage"
            :placeholder="currentArticle ? 'Write your note here...' : 'Write about your day...'"
          >
            <template #title-meta>
              <span v-if="!loading" class="journal__title-meta">{{ wordCount.toLocaleString() }} {{ wordCount === 1 ? 'word' : 'words' }}<template v-if="saveStatusText"> · <strong>{{ saveStatusText }}</strong></template></span>
            </template>
          </TiptapEditor>
        </div>

        <div
          v-if="fallbackEntryLinks.length > 0"
          class="journal__chips"
          aria-label="Journal captures"
        >
          <a
            v-for="link in fallbackEntryLinks"
            :key="link.id"
            class="journal__chip journal__chip--task"
            :href="taskLinkHref(link)"
            aria-label="Open task"
            title="Open task"
          >
            Task
          </a>
        </div>

        <div class="journal__status" aria-live="polite">
          <span v-if="loading">Loading</span>
          <span v-else-if="voiceDictationStatusText">
            {{ voiceDictationStatusText }}
          </span>
        </div>
      </section>
    </div>

    <!-- Dictation is a writing tool, so it sits by the page, not in the app's top bar. -->
    <button
      v-if="!(narrowScreen && libraryOpen) && voiceDictationState !== 'unsupported'"
      type="button"
      class="journal__dictate"
      :class="{ 'is-listening': voiceDictationState === 'listening', 'is-busy': voiceDictationState === 'processing' }"
      :style="keyboardInset ? { bottom: `${keyboardInset + 16}px` } : undefined"
      :aria-label="voiceDictationState === 'listening' ? 'Stop voice dictation' : voiceDictationState === 'processing' ? 'Transcribing' : 'Start voice dictation'"
      :aria-pressed="voiceDictationState === 'listening' ? 'true' : 'false'"
      :title="voiceDictationState === 'listening' ? 'Stop dictation' : 'Dictate'"
      :disabled="!canUseVoiceDictation"
      @mousedown.prevent
      @click="toggleVoiceDictation"
    >
      <UiIcon :name="voiceDictationState === 'listening' ? 'Square' : voiceDictationState === 'processing' ? 'RefreshCw' : 'Mic'" :size="20" aria-hidden="true" />
      <span v-if="voiceDictationState === 'listening'">{{ voiceRecordingElapsedLabel }}</span>
      <span v-else-if="voiceDictationState === 'processing'">Transcribing</span>
    </button>

    <a
      v-for="chip in inlineJournalChips"
      :key="chip.id"
      class="journal-inline-chip"
      :class="`journal-inline-chip--${chip.kind}`"
      :style="{
        left: `${chip.left}px`,
        top: `${chip.top}px`,
      }"
      :href="missionTaskHref(chip.projectId, chip.taskId)"
      aria-label="Open task"
      title="Open task"
    >
      {{ chip.label }}
    </a>

    <div
      v-if="selectionToolbar.visible"
      class="journal-selection-toolbar"
      :style="{
        left: `${selectionToolbar.left}px`,
        top: `${selectionToolbar.top}px`,
      }"
      role="toolbar"
      aria-label="Selected journal text actions"
      @mousedown.prevent
      @click.stop
    >
      <Button
        color="ghost"
        shape="soft"
        size="compact"
        icon-only
        aria-label="Create task from highlighted text"
        title="Create task"
        type="button"
        @click="openCapture('task')"
      >
        <UiIcon name="CircleCheckBig" :size="16" />
      </Button>
      <Button
        color="ghost"
        shape="soft"
        size="compact"
        icon-only
        aria-label="Create reminder from highlighted text"
        title="Create reminder"
        type="button"
        @click="openCapture('reminder')"
      >
        <UiIcon name="AlarmClock" :size="16" />
      </Button>
    </div>

    <div v-if="captureOpen" class="journal-capture" role="dialog" aria-modal="true">
      <form class="journal-capture__panel" @submit.prevent="submitCapture">
        <header>
          <h2>{{ captureHeading }}</h2>
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            icon-only
            type="button"
            aria-label="Close"
            title="Close"
            @click="closeCapture"
          >
            <UiIcon name="X" :size="16" />
          </Button>
        </header>
        <label>
          <span>Title</span>
          <input v-model="captureTitle" type="text" maxlength="180" required />
        </label>
        <div v-if="captureMode === 'reminder'" class="journal-capture__row">
          <label>
            <span>Date</span>
            <input v-model="captureReminderDate" type="date" required />
          </label>
          <label>
            <span>Time</span>
            <input v-model="captureReminderTime" type="time" required />
          </label>
        </div>
        <label v-if="captureMode !== 'reminder'">
          <select v-model="captureProjectId" aria-label="Project" required>
            <option
              v-for="project in projects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.name }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ captureTextLabel }}</span>
          <textarea
            v-model="captureText"
            rows="5"
            :required="captureMode !== 'reminder'"
          />
        </label>
        <p v-if="captureError" class="journal__message is-error">
          {{ captureError }}
        </p>
        <footer>
          <Button
            color="accent"
            shape="soft"
            size="compact"
            type="submit"
            :disabled="captureSubmitDisabled"
          >
            {{ captureSaving ? "Saving" : "Confirm" }}
          </Button>
        </footer>
      </form>
    </div>

  </main>
</template>

<style scoped>
.journal {
  --workspace-topbar-height: 0px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
}

/* Lives in the app top bar, so the page has no second header row. */
.journal__topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.journal__topbar-end {
  min-width: 0;
}

.journal__day-switcher {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-self: center;
}

.journal__day-label {
  border: 1px solid transparent;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  cursor: pointer;
  border-radius: var(--ui-radius-sm, 8px);
}

.journal__day-label:focus,
.journal__day-label:focus-visible {
  outline: none;
}

.journal__day-label {
  display: inline-flex;
  min-width: 138px;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.journal__day-label strong {
  font-weight: inherit;
}

.journal__day-label[aria-expanded="true"] {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.journal__day-label:hover {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.journal__workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 24px;
  flex: 1;
  min-height: 0;
  width: min(100%, 980px);
  margin: 0 auto;
  padding: 0 24px 16px;
  box-sizing: border-box;
  min-height: calc(100dvh - var(--app-topbar-height) - var(--workspace-topbar-height));
}

.journal__workspace:has(.journal__archive) {
  grid-template-columns: minmax(220px, 280px) minmax(0, 628px);
  align-items: stretch;
}

/* Desktop: the library is always open on the left and the editor stays centred on the page. */
@media (min-width: 1180px) {
  .journal__workspace,
  .journal__workspace:has(.journal__archive) {
    width: 100%;
    grid-template-columns: minmax(240px, 1fr) minmax(0, 700px) minmax(240px, 1fr);
    align-items: stretch;
    gap: 24px;
    padding: 0 24px 16px;
  }

  .journal__archive {
    grid-column: 1;
    width: min(100%, 300px);
  }

  .journal__sheet {
    grid-column: 2;
    width: 100%;
  }
}

/* Quiet text buttons beside the back arrow; the shown list's button is filled. */
.journal__tabs { display: inline-flex; align-items: center; gap: 2px; justify-self: start; }
.journal__tabs button {
  min-height: 34px; border: 0; border-radius: var(--ui-radius-sm, 8px); padding: 0 10px;
  background: transparent; color: var(--ui-text-muted, var(--color-text-muted));
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
}
.journal__tabs button:hover { color: var(--ui-text, var(--color-text)); }
.journal__tabs button[aria-pressed="true"] { background: var(--ui-surface-muted, var(--color-surface-muted)); color: var(--ui-text, var(--color-text)); }
.journal__tabs button:focus-visible, .journal__month-toggle:focus-visible, .journal__new-note:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); }

.journal__month { display: flex; flex-direction: column; gap: 2px; }
.journal__month + .journal__month { margin-top: 6px; }
.journal__month-toggle {
  display: flex; align-items: center; gap: 6px; width: 100%; border: 0; border-radius: var(--ui-radius-sm, 8px); padding: 7px 8px;
  background: transparent; color: var(--ui-text, var(--color-text));
  font: inherit; font-size: 0.88rem; font-weight: 600; text-align: left; cursor: pointer;
}
.journal__month-toggle:hover { background: var(--ui-surface-muted, var(--color-surface-muted)); }
.journal__month-toggle small { margin-left: auto; color: var(--ui-text-muted, var(--color-text-muted)); font-size: 0.78rem; font-weight: 400; }
.journal__month-chevron { color: var(--ui-text-muted, var(--color-text-muted)); transition: transform 0.15s ease; }
.journal__month-toggle[aria-expanded="false"] .journal__month-chevron { transform: rotate(-90deg); }
.journal__library-row-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.journal__library-row-head small { flex-shrink: 0; color: var(--ui-text-muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.journal__new-note {
  display: flex; align-items: center; gap: 6px; width: 100%; margin-bottom: 6px; border: 0; border-radius: var(--ui-radius-sm, 8px); padding: 8px;
  background: transparent; color: var(--ui-accent-strong, var(--ui-accent));
  font: inherit; font-size: 0.88rem; font-weight: 600; text-align: left; cursor: pointer;
}
.journal__new-note:hover { background: var(--ui-surface-muted, var(--color-surface-muted)); }

/* The list scrolls on its own, so a long page never carries it away. */
.journal__archive {
  position: sticky;
  top: calc(var(--app-topbar-height) + var(--workspace-topbar-height));
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: calc(100dvh - var(--app-topbar-height) - var(--workspace-topbar-height));
  overflow-y: auto;
  overscroll-behavior: contain;
  border-right: 1px solid var(--ui-border, var(--color-border));
  padding: 8px 14px 24px 0;
  box-sizing: border-box;
}

.journal__note-location-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(420px, 50vw);
  min-height: 36px;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  padding: 0 10px;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.journal__note-location-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.journal__note-location-button:hover,
.journal__note-location-button[aria-expanded="true"] {
  background: var(--ui-surface-muted, var(--color-surface-muted));
}

.journal__note-location-button:focus-visible {
  outline: 2px solid var(--ui-focus, var(--ui-accent));
}

.journal__note-location-menu {
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.journal__empty,
.journal__status,
.journal__message {
  font-size: 0.86rem;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.journal__empty {
  margin: 8px;
}

.journal__archive-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  width: 100%;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  background: transparent;
  color: var(--ui-text, var(--color-text));
}

.journal__archive-row:hover,
.journal__archive-row.is-active,
.journal__archive-row.is-menu-open {
  background: var(--ui-surface-muted, var(--color-surface-muted));
}

.journal__archive-row.is-active {
  box-shadow: inset 3px 0 0 var(--ui-accent);
}

.journal__archive-row.is-active .journal__archive-row-main strong {
  color: var(--ui-accent-strong, var(--ui-accent));
}

.journal__archive-row-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  border: 0;
  padding: 9px 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.journal__archive-row-main:disabled {
  cursor: default;
  opacity: 0.65;
}

.journal__archive-row-main strong {
  font-size: 0.92rem;
  font-weight: 600;
}

/* Two lines of the page's opening, so a row says what the day was about. */
.journal__archive-preview {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--ui-text-muted, var(--color-text-muted));
}

/* Sits over the word count on hover, so it never narrows the row. */
.journal__archive-row-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  justify-content: center;
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-surface-muted));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.journal__archive-row:hover .journal__archive-row-actions,
.journal__archive-row:focus-within .journal__archive-row-actions,
.journal__archive-row.is-menu-open .journal__archive-row-actions {
  opacity: 1;
  pointer-events: auto;
}

.journal__archive-menu-button {
  min-width: 30px;
}

.journal__archive-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 4px;
  z-index: 35;
  min-width: 152px;
  box-sizing: border-box;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  padding: 6px;
  background: var(--ui-surface, var(--color-surface));
  box-shadow: var(--ui-shadow-md, 0 14px 32px rgba(15, 23, 42, 0.16));
}

.journal__archive-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  padding: 8px 10px;
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.journal__archive-menu-item:hover,
.journal__archive-menu-item:focus-visible {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  outline: none;
}

.journal__archive-menu-item.is-danger {
  color: var(--color-danger, #b42318);
}

.journal__archive-menu-item:disabled {
  cursor: default;
  opacity: 0.55;
}

.journal__sheet {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: min(100%, 700px);
  margin: 0 auto;
}

.journal__editor-wrap {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: auto;
  --tiptap-toolbar-offset: calc(var(--app-topbar-height) + var(--workspace-topbar-height));
}

.journal__editor-wrap.is-loading {
  opacity: 0.58;
  pointer-events: none;
}

.journal__editor-wrap :deep(.tiptap-editor--workspace) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: auto;
}

.journal__editor-wrap :deep(.tiptap-editor--workspace .editor-toolbar),
.journal__editor-wrap :deep(.tiptap-editor--workspace .editor-title-field) {
  flex-shrink: 0;
}

/* Beside the list the toolbar keeps to the page column and stays on one row, scrolling if it must. */
.journal__workspace:has(.journal__archive)
  .journal__editor-wrap
  :deep(.tiptap-editor--workspace .editor-toolbar) {
  width: 100%;
  margin-left: 0;
  margin-right: 0;
  flex-wrap: nowrap;
  justify-content: flex-start;
  overflow-x: auto;
  scrollbar-width: none;
}

.journal__workspace:has(.journal__archive) .journal__editor-wrap :deep(.tiptap-editor--workspace .toolbar-btn),
.journal__workspace:has(.journal__archive) .journal__editor-wrap :deep(.tiptap-editor--workspace .toolbar-divider) {
  flex: 0 0 auto;
}

/* Desktop: one row that starts at the page's left edge and runs into the free space on the right. */
@media (min-width: 1180px) {
  .journal__workspace .journal__editor-wrap :deep(.tiptap-editor--workspace .editor-toolbar),
  .journal__workspace:has(.journal__archive) .journal__editor-wrap :deep(.tiptap-editor--workspace .editor-toolbar) {
    width: max-content;
    max-width: calc(100% + 264px);
    margin-left: -8px;
    margin-right: 0;
    padding-left: 0;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: visible;
  }
}

.journal__editor-wrap :deep(.tiptap-editor--workspace .editor-content-wrapper) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: auto;
  overflow-y: visible;
  padding: 8px 0 0;
  background: transparent;
}

.journal__editor-wrap :deep(.tiptap-editor--workspace .editor-content-wrapper .ProseMirror) {
  flex: 1;
  min-height: max(200px, calc(100dvh - var(--app-topbar-height) - var(--workspace-topbar-height) - 132px));
}

.journal__title-meta { flex-shrink: 0; color: var(--ui-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.journal__title-meta strong { font-weight: 600; }

.journal__dictate {
  position: fixed;
  right: max(20px, env(safe-area-inset-right));
  bottom: calc(20px + env(safe-area-inset-bottom));
  z-index: 40;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 52px;
  height: 52px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 999px;
  padding: 0 15px;
  background: var(--ui-surface, var(--color-surface));
  color: var(--ui-text, var(--color-text));
  box-shadow: var(--ui-shadow-md, 0 14px 32px rgba(15, 23, 42, 0.16));
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.journal__dictate:hover:not(:disabled) { color: var(--ui-accent-strong, var(--ui-accent)); }
.journal__dictate:focus-visible { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 2px; }
.journal__dictate.is-listening { border-color: transparent; background: var(--ui-primary); color: var(--ui-primary-contrast); }
.journal__dictate.is-listening:hover { color: var(--ui-primary-contrast); }
.journal__dictate.is-busy { cursor: default; color: var(--ui-text-muted, var(--color-text-muted)); }
.journal__dictate.is-busy :deep(svg) { animation: journal-dictate-spin 1s linear infinite; }
@keyframes journal-dictate-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .journal__dictate.is-busy :deep(svg) { animation: none; } }
.journal__status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px 12px;
  flex-shrink: 0;
  min-height: 22px;
  padding-top: 12px;
  text-align: right;
}

.journal__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-top: 8px;
}

.journal__chip,
.journal-inline-chip {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
}

.journal-inline-chip {
  position: fixed;
  z-index: 45;
  cursor: pointer;
  box-shadow: var(--ui-shadow-sm, 0 6px 14px rgba(15, 23, 42, 0.12));
}

.journal__chip--task,
.journal-inline-chip--task {
  border-color: color-mix(in srgb, var(--ui-accent, #2563eb) 36%, transparent);
  background: color-mix(in srgb, var(--ui-accent, #2563eb) 11%, var(--ui-surface, #ffffff));
  color: var(--ui-accent-strong, #1d4ed8);
}

.journal__chip--task:hover,
.journal__chip--task:focus-visible,
.journal-inline-chip--task:hover,
.journal-inline-chip--task:focus-visible {
  border-color: var(--ui-accent, #2563eb);
  outline: none;
}

.journal__message {
  flex-shrink: 0;
  margin: 0 0 16px;
}

.journal__message.is-error {
  color: var(--color-danger, #b42318);
}

.journal-selection-toolbar {
  position: fixed;
  z-index: 55;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  padding: 0;
  background: var(--ui-surface, var(--color-surface));
  box-shadow: var(--ui-shadow-md, 0 14px 32px rgba(15, 23, 42, 0.16));
}

.journal-selection-toolbar :deep(button) {
  min-width: 34px;
}

.journal-capture {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 18px;
  background: color-mix(in srgb, var(--ui-bg, var(--color-bg)) 60%, transparent);
  backdrop-filter: blur(8px);
}

.journal-capture__panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(100%, 440px);
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 8px);
  padding: 16px;
  background: var(--ui-surface, var(--color-surface));
  box-shadow: var(--ui-shadow-md, 0 18px 42px rgba(15, 23, 42, 0.2));
}

.journal-capture__panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.journal-capture__panel footer {
  display: flex;
  justify-content: flex-end;
}

.journal-capture__panel h2 {
  margin: 0;
  font-size: 1rem;
}

.journal-capture__panel label {
  display: grid;
  gap: 6px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.82rem;
  font-weight: 700;
}

.journal-capture__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.journal-capture__panel input,
.journal-capture__panel select,
.journal-capture__panel textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  padding: 9px 10px;
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
}

.journal-capture__panel textarea {
  resize: vertical;
}

@media (max-width: 900px) {
  .journal__topbar {
    grid-template-columns: auto 1fr;
    gap: 8px;
  }

  .journal__topbar-end {
    display: none;
  }

  .journal__day-switcher {
    justify-self: end;
  }

  .journal__workspace,
  .journal__workspace:has(.journal__archive) {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    padding: 0 14px 12px;
  }

  /* The list takes the screen; picking a page or note returns to the editor. */
  .journal__archive {
    position: static;
    height: auto;
    min-height: calc(100dvh - var(--app-topbar-height) - var(--workspace-topbar-height));
    border-right: 0;
    padding: 4px 0 24px;
  }

  .journal__workspace--library .journal__sheet {
    display: none;
  }

  /* Room for the last lines to clear the dictate button. */
  .journal__sheet {
    padding-bottom: 72px;
  }
}

/* Touch has no hover, so the actions button keeps its own column. */
@media (hover: none) {
  .journal__archive-row {
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .journal__archive-row-actions {
    position: relative;
    top: auto;
    right: auto;
    background: transparent;
    opacity: 1;
    pointer-events: auto;
  }
}

@media (max-width: 560px) {
  .journal__day-label {
    min-width: 0;
    padding-inline: 6px;
    font-size: 14px;
    white-space: nowrap;
  }

  .journal__tabs button {
    padding: 0 8px;
  }

}
</style>
