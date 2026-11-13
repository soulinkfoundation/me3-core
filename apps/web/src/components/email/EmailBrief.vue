<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import {
  formatMailMoney,
  type MailboxBrief,
  type MailboxBriefAction,
  type MailboxBriefItem,
  type MailboxClearedItem,
  type MailboxFollowUp,
  type MailboxHandledItem,
} from "./brief";
import EmailSenderAvatar from "./EmailSenderAvatar.vue";

/**
 * The Brief (v2, 13 Nov 2026): one row per decision. A row shows who and what they need and has
 * one control, a Done check. The open row is the single place to act: ME3's draft is read and
 * edited there, then sent (with a ten-second Undo) or discarded. Rows leave once dealt with,
 * here or anywhere else. What ME3 handled and what was cleared open from the line under the title.
 */
const props = defineProps<{
  active: boolean;
  formatTime: (value: string) => string;
}>();

const emit = defineEmits<{
  openThread: [threadId: string, messageId: string];
  openInbox: [];
  openRules: [];
  countChanged: [count: number];
}>();

const { toast, toastFromUnknown, toastSuccess } = useAppToast();

type BriefDraft = NonNullable<MailboxBriefItem["draft"]>;
/** A mail item or an outreach follow-up: both are one decision with, usually, a draft. */
type BriefRow =
  | { key: string; kind: "mail"; name: string; draft: BriefDraft | null; item: MailboxBriefItem }
  | { key: string; kind: "followup"; name: string; draft: BriefDraft | null; item: MailboxFollowUp };

const SEND_UNDO_SECONDS = 10;

const brief = ref<MailboxBrief | null>(null);
const loading = ref(false);
const unsupported = ref(false);
const offlineSince = ref<string | null>(null);
const pending = ref<Set<string>>(new Set());
const expandedGroups = ref<Set<string>>(new Set());
const openKey = ref<string | null>(null);
const menuKey = ref<string | null>(null);
const panel = ref<"handled" | "cleared" | null>(null);
/** The owner's edits, per draft version: a draft ME3 rewrote since shows ME3's new text. */
const draftEdits = ref<Record<string, string>>({});
const instructions = ref<Record<string, string>>({});
const writing = ref<Set<string>>(new Set());
const discarded = ref<Set<string>>(new Set());
/** Said to screen readers when a row leaves or returns. */
const announcement = ref("");
const root = ref<HTMLElement | null>(null);
let loadedAt = 0;

const followUps = computed(() => brief.value?.followUps || []);
const cleared = computed<MailboxClearedItem[]>(() => brief.value?.cleared || []);
const rows = computed<BriefRow[]>(() => [
  ...(brief.value?.needsYou || []).map((item): BriefRow => ({ key: `mail:${item.messageId}`, kind: "mail", name: item.sender.name, draft: item.draft, item })),
  ...followUps.value.map((item): BriefRow => ({ key: `followup:${item.contactId}`, kind: "followup", name: item.name, draft: item.draft, item })),
]);
const needsCount = computed(() => rows.value.length);
// Follow-ups ME3 has already been asked to draft, so a failed or discarded draft is not redone in a loop.
const draftRequested = new Set<string>();

const headline = computed(() => {
  if (!brief.value) return "";
  const count = needsCount.value;
  if (count === 0) return "You're all caught up";
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
});

// The top row opens by default; when the open row leaves, the next one takes its place.
watch(rows, (list) => {
  if (!list.some((row) => row.key === openKey.value)) openKey.value = list[0]?.key || null;
}, { immediate: true });

function setPending(key: string, on: boolean) {
  const next = new Set(pending.value);
  if (on) next.add(key);
  else next.delete(key);
  pending.value = next;
}

async function load(force = false) {
  if (unsupported.value) return;
  if (!force && brief.value && Date.now() - loadedAt < 20_000) return;
  loading.value = !brief.value;
  try {
    const data = await api.get<MailboxBrief>("/mailbox/brief");
    brief.value = data;
    loadedAt = Date.now();
    offlineSince.value = null;
    emit("countChanged", needsCount.value);
    void draftMissingFollowUps();
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : 0;
    if (status === 404 || status === 405) {
      unsupported.value = true;
      emit("openInbox");
      return;
    }
    if (brief.value) {
      offlineSince.value = offlineSince.value || new Date(loadedAt || Date.now()).toISOString();
    } else {
      toastFromUnknown(error, "The Brief could not be loaded");
    }
  } finally {
    loading.value = false;
  }
}

/** Takes a row off the screen at once; the next load confirms it. */
function removeRow(row: BriefRow) {
  if (!brief.value) return;
  brief.value = row.kind === "mail"
    ? { ...brief.value, needsYou: brief.value.needsYou.filter((item) => item.messageId !== row.item.messageId) }
    : { ...brief.value, followUps: followUps.value.filter((item) => item.contactId !== row.item.contactId) };
  menuKey.value = null;
  emit("countChanged", needsCount.value);
}

// ME3 drafts each due follow-up once; nothing is sent until the owner presses Send.
async function draftMissingFollowUps() {
  const missing = followUps.value.filter((item) => !item.draft && !draftRequested.has(item.contactId));
  if (missing.length === 0) return;
  let drafted = false;
  for (const item of missing) {
    const key = `followup:${item.contactId}`;
    draftRequested.add(item.contactId);
    setPending(key, true);
    try {
      await api.post(`/mailbox/followups/${encodeURIComponent(item.contactId)}/draft`);
      drafted = true;
    } catch {
      // The row stays, with "Draft a follow-up" to try again.
    } finally {
      setPending(key, false);
    }
  }
  if (drafted) await load(true);
}

function rowTitle(row: BriefRow): string {
  if (row.kind === "mail") return row.item.sender.name;
  const item = row.item;
  return item.organisation && item.organisation.toLowerCase() !== item.name.toLowerCase() ? `${item.name} · ${item.organisation}` : item.name;
}

function rowSubject(row: BriefRow): string {
  return row.kind === "mail" ? row.item.subject : row.item.subject || "Follow-up";
}

function rowSummary(row: BriefRow): string {
  if (row.kind === "mail") return row.item.summary;
  const item = row.item;
  const parts = [item.daysWaiting > 0 ? (item.daysWaiting === 1 ? "No reply in 1 day" : `No reply in ${item.daysWaiting} days`) : "No reply yet"];
  if (item.offer) parts.push(`you offered ${item.offer}`);
  if (item.followUpNumber > 1) parts.push(`follow-up ${item.followUpNumber} of ${item.followUpCap}`);
  return parts.join(" · ");
}

/** The short status under the ask: what ME3 has ready, or what the owner did. */
function rowHint(row: BriefRow): string {
  if (writing.value.has(row.key)) return "ME3 is writing…";
  if (row.draft) return row.kind === "followup" ? "Follow-up drafted" : "Reply drafted";
  if (discarded.value.has(row.key)) return "Draft discarded";
  if (row.kind === "followup") return pending.value.has(row.key) ? "ME3 is drafting a follow-up…" : "";
  return row.item.pending ? "ME3 is reading this…" : "";
}

function draftLabel(row: BriefRow): string {
  return row.kind === "followup" ? `ME3's draft follow-up to ${row.name}` : `ME3's draft reply to ${row.name}`;
}

function editKey(draft: BriefDraft): string {
  return `${draft.id}:${draft.updatedAt || ""}`;
}

function draftText(row: BriefRow): string {
  if (!row.draft) return "";
  return draftEdits.value[editKey(row.draft)] ?? row.draft.body;
}

function setDraftText(row: BriefRow, value: string) {
  if (!row.draft) return;
  draftEdits.value = { ...draftEdits.value, [editKey(row.draft)]: value };
}

function draftRows(row: BriefRow): number {
  return Math.max(4, Math.min(14, draftText(row).split("\n").length + 1));
}

function errorStatus(error: unknown): number {
  return error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : 0;
}

async function openRow(row: BriefRow | undefined, focus = false) {
  if (!row) return;
  openKey.value = row.key;
  menuKey.value = null;
  if (!focus) return;
  await nextTick();
  root.value?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(row.key)}"] .brief-row__main`)?.focus();
}

function toggleRow(row: BriefRow) {
  openKey.value = openKey.value === row.key ? null : row.key;
  menuKey.value = null;
}

/** Send: an edit is saved first, then Core holds the send so Undo works and a closed tab still sends. */
async function send(row: BriefRow) {
  const draft = row.draft;
  if (!draft || pending.value.has(row.key)) return;
  const text = draftText(row);
  if (!text.trim()) {
    toast.error("Write something before you send.");
    return;
  }
  setPending(row.key, true);
  try {
    if (text !== draft.body) {
      await api.put(`/mailbox/drafts/${encodeURIComponent(draft.id)}`, { textBody: text, ...(draft.updatedAt ? { expectedUpdatedAt: draft.updatedAt } : {}) });
    }
    const sent = await api.post<{ held?: boolean }>(`/mailbox/drafts/${encodeURIComponent(draft.id)}/approve`, { holdSeconds: SEND_UNDO_SECONDS });
    removeRow(row);
    if (sent?.held) {
      toast(`Sending to ${row.name} in ${SEND_UNDO_SECONDS} seconds.`, {
        duration: SEND_UNDO_SECONDS * 1000,
        action: { label: "Undo", onClick: () => void undoSend(row, draft) },
      });
    } else {
      // An older Core sends at once.
      toastSuccess(row.kind === "followup" ? `Follow-up sent to ${row.name}.` : `Reply sent to ${row.name}.`);
    }
  } catch (error) {
    if (errorStatus(error) === 409) toast.error("This draft changed since you opened it. Check it before you send.");
    else toastFromUnknown(error, "That could not be sent");
    await load(true);
  } finally {
    setPending(row.key, false);
  }
}

async function undoSend(row: BriefRow, draft: BriefDraft) {
  try {
    await api.post(`/mailbox/drafts/${encodeURIComponent(draft.id)}/cancel-send`);
  } catch (error) {
    toastFromUnknown(error, "That email had already been sent");
    return;
  }
  await load(true);
  openKey.value = row.key;
  announcement.value = `${row.name} is back in your Brief.`;
}

/** Discard removes ME3's draft only; the row stays until Done. */
async function discardDraft(row: BriefRow) {
  if (!row.draft || pending.value.has(row.key)) return;
  setPending(row.key, true);
  try {
    await api.post(`/mailbox/drafts/${encodeURIComponent(row.draft.id)}/reject`);
    if (row.kind === "followup") draftRequested.add(row.item.contactId);
    discarded.value = new Set([...discarded.value, row.key]);
    await load(true);
  } catch (error) {
    toastFromUnknown(error, "The draft could not be discarded");
  } finally {
    setPending(row.key, false);
  }
}

/** ME3 writes a draft in the row: a quick answer, the owner's own words, or the follow-up. */
async function writeDraft(row: BriefRow, intent?: string) {
  if (pending.value.has(row.key)) return;
  setPending(row.key, true);
  writing.value = new Set([...writing.value, row.key]);
  try {
    if (row.kind === "followup") await api.post(`/mailbox/followups/${encodeURIComponent(row.item.contactId)}/draft`);
    else await api.post(`/mailbox/brief/${encodeURIComponent(row.item.messageId)}/draft`, intent ? { intent } : {});
    instructions.value = { ...instructions.value, [row.key]: "" };
    const next = new Set(discarded.value);
    next.delete(row.key);
    discarded.value = next;
    await load(true);
  } catch (error) {
    toastFromUnknown(error, "ME3 could not write a reply this time");
  } finally {
    const next = new Set(writing.value);
    next.delete(row.key);
    writing.value = next;
    setPending(row.key, false);
  }
}

/** "Ask ME3 to change it": ME3 rewrites the text in place; nothing is saved or sent until Send. */
async function askToChange(row: BriefRow) {
  const instruction = (instructions.value[row.key] || "").trim();
  if (!row.draft || !instruction || pending.value.has(row.key)) return;
  setPending(row.key, true);
  writing.value = new Set([...writing.value, row.key]);
  try {
    const result = await api.post<{ subject: string; body: string }>("/mailbox/drafts/assist", {
      subject: rowSubject(row),
      body: draftText(row),
      instruction,
      ...(row.kind === "mail" ? { replyToMessageId: row.item.messageId } : { to: row.item.email }),
    });
    if (result?.body) setDraftText(row, result.body);
    instructions.value = { ...instructions.value, [row.key]: "" };
  } catch (error) {
    toastFromUnknown(error, "ME3 could not change the draft this time");
  } finally {
    const next = new Set(writing.value);
    next.delete(row.key);
    writing.value = next;
    setPending(row.key, false);
  }
}

function submitInstruction(row: BriefRow) {
  if (row.draft) void askToChange(row);
  else if ((instructions.value[row.key] || "").trim()) void writeDraft(row, instructions.value[row.key].trim());
}

/** The Done check: the row leaves the Brief. For a follow-up, ME3 stops chasing. */
async function done(row: BriefRow) {
  if (pending.value.has(row.key)) return;
  setPending(row.key, true);
  try {
    if (row.kind === "followup") {
      await api.post(`/mailbox/followups/${encodeURIComponent(row.item.contactId)}/stop`);
      removeRow(row);
      toastSuccess(`ME3 won't follow up with ${row.name} again.`);
    } else {
      const messageId = row.item.messageId;
      await api.post(`/mailbox/brief/${encodeURIComponent(messageId)}/done`);
      removeRow(row);
      toast.success(`Cleared ${row.name}.`, { action: { label: "Undo", onClick: () => void bringBack(messageId, row.name) } });
      void load(true);
    }
    announcement.value = `Cleared ${row.name}.`;
  } catch (error) {
    toastFromUnknown(error, "That didn't work");
    await load(true);
  } finally {
    setPending(row.key, false);
  }
}

async function bringBack(messageId: string, name: string) {
  try {
    await api.post(`/mailbox/brief/${encodeURIComponent(messageId)}/reopen`);
    await load(true);
    openKey.value = `mail:${messageId}`;
    announcement.value = `${name} is back in your Brief.`;
  } catch (error) {
    toastFromUnknown(error, "That could not be brought back");
  }
}

async function remindTomorrow(row: BriefRow) {
  await menuAction(row, async () => {
    if (row.kind === "followup") await api.post(`/mailbox/followups/${encodeURIComponent(row.item.contactId)}/later`);
    else await api.post(`/mailbox/brief/${encodeURIComponent(row.item.messageId)}/snooze`, {});
    removeRow(row);
    toastSuccess("Back in the Brief tomorrow morning.");
  });
}

async function archiveConversation(row: BriefRow) {
  if (row.kind !== "mail") return;
  const threadId = row.item.threadId;
  await menuAction(row, async () => {
    await api.post(`/mailbox/threads/${encodeURIComponent(threadId)}/move`, { folder: "archive", fromFolder: "inbox" });
    removeRow(row);
    toast.success("Conversation archived.", {
      action: {
        label: "Undo",
        onClick: () => void api.post(`/mailbox/threads/${encodeURIComponent(threadId)}/move`, { folder: "inbox", fromFolder: "archive" })
          .then(() => load(true))
          .catch((error) => toastFromUnknown(error, "That could not be undone")),
      },
    });
  });
}

async function alwaysArchiveSender(row: BriefRow) {
  if (row.kind !== "mail") return;
  await menuAction(row, async () => {
    await api.post("/mailbox/rules", { kind: "archive_sender", messageId: row.item.messageId });
    removeRow(row);
    toastSuccess(`ME3 will archive mail from ${row.name} from now on.`);
  });
}

async function menuAction(row: BriefRow, run: () => Promise<void>) {
  menuKey.value = null;
  if (pending.value.has(row.key)) return;
  setPending(row.key, true);
  try {
    await run();
  } catch (error) {
    toastFromUnknown(error, "That didn't work");
    await load(true);
  } finally {
    setPending(row.key, false);
  }
}

/** A row whose next step is not a reply: a link out (ME3 never pays), Accounts, unsubscribe, archive. */
function otherAction(row: BriefRow): MailboxBriefAction | null {
  if (row.kind !== "mail" || row.draft) return null;
  const action = row.item.primaryAction;
  return action && ["open_url", "open_accounts", "unsubscribe", "archive"].includes(action.kind) ? action : null;
}

async function runOtherAction(row: BriefRow, action: MailboxBriefAction) {
  if (row.kind !== "mail") return;
  if (action.kind === "open_url") {
    if (action.url && /^https:\/\//i.test(action.url)) window.open(action.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (action.kind === "open_accounts") {
    window.location.assign("/accounts");
    return;
  }
  if (action.kind === "archive") {
    await archiveConversation(row);
    return;
  }
  await menuAction(row, async () => {
    const response = await api.post<{ mode: string; url?: string }>(`/mailbox/messages/${encodeURIComponent(row.item.messageId)}/unsubscribe`);
    if (response.mode === "open" && response.url) window.open(response.url, "_blank", "noopener,noreferrer");
    await api.post(`/mailbox/brief/${encodeURIComponent(row.item.messageId)}/done`);
    removeRow(row);
    toastSuccess("Unsubscribed.");
  });
}

async function undo(item: MailboxHandledItem) {
  try {
    await api.post(`/mailbox/handled/${encodeURIComponent(item.id)}/undo`);
    toast.success(
      item.undo?.kind === "remove_ledger_entry"
        ? "Removed from Accounts."
        : item.undo?.kind === "restore_outreach"
          ? "Status and follow-up date put back."
          : item.kind === "spam"
          ? "Moved back to Inbox. ME3 will show this sender from now on."
          : "Moved back to Inbox.",
    );
    await load(true);
  } catch (error) {
    toastFromUnknown(error, "That could not be undone");
  }
}

function togglePanel(name: "handled" | "cleared") {
  panel.value = panel.value === name ? null : name;
  if (panel.value === "handled" && brief.value) expandedGroups.value = new Set(brief.value.handled.groups.length === 1 ? [brief.value.handled.groups[0].kind] : []);
}

function toggleGroup(kind: string) {
  const next = new Set(expandedGroups.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  expandedGroups.value = next;
}

function groupTitle(group: MailboxBrief["handled"]["groups"][number]): string {
  const parts = [group.title];
  if (group.amountCents !== null && group.currency) parts.push(formatMailMoney(group.amountCents, group.currency));
  if (group.byRule) parts.push("your rule");
  return parts.join(" · ");
}

function groupIcon(kind: string) {
  switch (kind) {
    case "receipt": return "CreditCard";
    case "newsletter": return "FileText";
    case "notification": return "Archive";
    case "rule_reply": return "Send";
    case "outreach": return "Send";
    case "spam": return "ShieldAlert";
    default: return "Sparkles";
  }
}

function clearedHow(item: MailboxClearedItem): string {
  switch (item.how) {
    case "replied": return "you replied";
    case "replied_elsewhere": return "you replied from another app";
    case "archived": return "you archived it";
    case "trashed": return "you moved it to Trash";
    case "spam": return "marked as spam";
    default: return "you marked it done";
  }
}

/**
 * J/K (or the arrows) move between rows, E clears the open row, and Cmd/Ctrl+Enter sends from the
 * draft. They only act while focus is inside the Brief and never while typing.
 */
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  if (typing) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      const key = target.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
      const row = rows.value.find((candidate) => candidate.key === key);
      if (row?.draft) {
        event.preventDefault();
        void send(row);
      }
    }
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const list = rows.value;
  if (list.length === 0) return;
  const index = list.findIndex((row) => row.key === openKey.value);
  if (event.key === "j" || event.key === "ArrowDown") {
    event.preventDefault();
    void openRow(list[Math.min(index + 1, list.length - 1)], true);
  } else if (event.key === "k" || event.key === "ArrowUp") {
    event.preventDefault();
    void openRow(list[Math.max(index - 1, 0)], true);
  } else if (event.key === "e" && list[index]) {
    event.preventDefault();
    void done(list[index]);
  } else if (event.key === "Escape" && menuKey.value) {
    menuKey.value = null;
  }
}

defineExpose({ refresh: () => load(true) });

onMounted(() => { if (props.active) void load(); });
watch(() => props.active, (active) => { if (active) void load(); });
</script>

<template>
  <section ref="root" class="brief" aria-label="Brief" @keydown="onKeydown">
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    <div v-if="offlineSince" class="brief-offline" role="status">
      <UiIcon name="WifiOff" :size="15" aria-hidden="true" />
      <span>Offline. Showing the Brief from {{ formatTime(offlineSince) }}.</span>
      <button type="button" class="brief-quiet" @click="load(true)">Retry</button>
    </div>

    <div v-if="loading && !brief" class="brief-skeleton" aria-label="Loading the Brief" aria-busy="true">
      <div class="brief-skeleton__line brief-skeleton__line--title" />
      <div v-for="index in 3" :key="index" class="brief-skeleton__item">
        <span class="brief-skeleton__avatar" />
        <span class="brief-skeleton__lines"><i /><i /></span>
      </div>
    </div>

    <template v-else-if="brief">
      <header class="brief-head">
        <h1>{{ headline }}</h1>
        <p class="brief-sub">
          <button
            v-if="brief.handled.total > 0"
            type="button"
            class="brief-sub__toggle"
            :aria-expanded="panel === 'handled'"
            aria-controls="brief-handled"
            @click="togglePanel('handled')"
          >
            ME3 handled {{ brief.handled.total }} today
            <UiIcon :name="panel === 'handled' ? 'ChevronUp' : 'ChevronDown'" :size="14" aria-hidden="true" />
          </button>
          <button
            v-if="cleared.length"
            type="button"
            class="brief-sub__toggle brief-sub__toggle--muted"
            :aria-expanded="panel === 'cleared'"
            aria-controls="brief-cleared"
            @click="togglePanel('cleared')"
          >
            {{ cleared.length }} cleared
            <UiIcon :name="panel === 'cleared' ? 'ChevronUp' : 'ChevronDown'" :size="14" aria-hidden="true" />
          </button>
          <span v-if="brief.checkedAt">checked {{ formatTime(brief.checkedAt) }}</span>
        </p>
      </header>

      <div v-if="panel === 'handled' && brief.handled.groups.length" id="brief-handled" class="brief-panel brief-fold">
        <div v-for="group in brief.handled.groups" :key="group.kind" class="brief-group">
          <button
            type="button"
            class="brief-group__head"
            :aria-expanded="expandedGroups.has(group.kind)"
            :disabled="group.items.length === 0"
            @click="toggleGroup(group.kind)"
          >
            <span class="brief-group__icon"><UiIcon :name="groupIcon(group.kind)" :size="15" aria-hidden="true" /></span>
            <span class="brief-group__title">{{ groupTitle(group) }}</span>
            <UiIcon v-if="group.items.length" :name="expandedGroups.has(group.kind) ? 'ChevronUp' : 'ChevronDown'" :size="16" aria-hidden="true" />
          </button>
          <ul v-if="expandedGroups.has(group.kind)" class="brief-group__items">
            <li v-for="item in group.items" :key="item.id" class="brief-handled">
              <button type="button" class="brief-handled__open" :disabled="!item.threadId" @click="item.threadId && emit('openThread', item.threadId, item.messageId)">
                <EmailSenderAvatar :name="item.sender?.name || item.label" :avatar-url="item.sender?.avatarUrl || null" :size="24" />
                <span class="brief-handled__text">
                  <strong>{{ item.sender?.name || item.label }}</strong>
                  <span>{{ item.detail || item.subject || item.label }}</span>
                </span>
                <span v-if="item.amountCents !== null && item.currency" class="brief-handled__amount">{{ formatMailMoney(item.amountCents, item.currency) }}</span>
              </button>
              <button v-if="item.undo" type="button" class="brief-quiet" @click="undo(item)">
                {{ item.undo.kind === "remove_ledger_entry" ? "Remove entry" : item.kind === "spam" ? "Not spam" : "Move to Inbox" }}
              </button>
              <button v-else-if="item.kind === 'rule_reply'" type="button" class="brief-quiet" @click="emit('openRules')">Edit rule</button>
            </li>
          </ul>
        </div>
        <div class="brief-fold__foot">
          <button type="button" class="brief-quiet" @click="emit('openRules')">How ME3 handles mail</button>
        </div>
      </div>

      <ul v-if="panel === 'cleared' && cleared.length" id="brief-cleared" class="brief-panel brief-fold brief-cleared" aria-label="Cleared today">
        <li v-for="item in cleared" :key="item.messageId">
          <span class="brief-cleared__text">
            <strong>{{ item.sender.name }}</strong>
            <span>{{ clearedHow(item) }} · {{ formatTime(item.clearedAt) }}</span>
          </span>
          <button type="button" class="brief-quiet" @click="bringBack(item.messageId, item.sender.name)">Bring back</button>
        </li>
      </ul>

      <div v-if="needsCount === 0" class="brief-caught-up">
        <UiIcon name="CircleCheck" :size="28" aria-hidden="true" />
        <p>
          {{ brief.handled.total > 0 ? `Nothing needs you. ME3 handled ${brief.handled.total} email${brief.handled.total === 1 ? "" : "s"} today.` : "Nothing needs you right now. ME3 checks new mail as it arrives." }}
        </p>
        <div class="brief-caught-up__actions">
          <button v-if="brief.fyi.inboxLeft > 0" type="button" class="brief-quiet" @click="emit('openInbox')">Open Inbox</button>
          <button type="button" class="brief-quiet" @click="emit('openRules')">How ME3 handles mail</button>
        </div>
      </div>

      <div v-else class="brief-panel" role="list">
        <article
          v-for="row in rows"
          :key="row.key"
          class="brief-row"
          :class="{ 'brief-row--open': openKey === row.key, 'brief-row--busy': pending.has(row.key) }"
          role="listitem"
          :data-row-key="row.key"
        >
          <div class="brief-row__head">
            <button type="button" class="brief-row__main" :aria-expanded="openKey === row.key" @click="toggleRow(row)">
              <EmailSenderAvatar :name="rowTitle(row)" :avatar-url="row.kind === 'mail' ? row.item.sender.avatarUrl : null" :size="36" />
              <span class="brief-row__content">
                <span class="brief-row__top">
                  <strong>{{ rowTitle(row) }}</strong>
                  <span class="brief-row__subject">{{ rowSubject(row) }}</span>
                  <span v-if="row.kind === 'mail' && row.item.urgency === 'urgent'" class="brief-tag brief-tag--urgent">Urgent</span>
                  <span v-if="row.kind === 'mail' && row.item.duplicates" class="brief-tag" :title="`${row.item.duplicates + 1} similar emails`">×{{ row.item.duplicates + 1 }}</span>
                  <time v-if="row.kind === 'mail'" class="brief-row__time">{{ formatTime(row.item.receivedAt) }}</time>
                </span>
                <span class="brief-row__summary">{{ rowSummary(row) }}</span>
                <span v-if="rowHint(row)" class="brief-row__hint" :class="{ 'brief-row__hint--ready': Boolean(row.draft) }">
                  <UiIcon v-if="row.draft" name="Sparkles" :size="13" aria-hidden="true" />
                  {{ rowHint(row) }}
                </span>
              </span>
            </button>
            <button
              type="button"
              class="brief-row__done"
              :aria-label="row.kind === 'followup' ? `Done: clear ${row.name} from the Brief and stop following up` : `Done: clear ${row.name} from the Brief`"
              title="Done (E)"
              :disabled="pending.has(row.key)"
              @click="done(row)"
            >
              <UiIcon name="Check" :size="16" aria-hidden="true" />
            </button>
          </div>

          <div v-if="openKey === row.key" class="brief-work">
            <p v-if="row.kind === 'mail' && row.item.checked" class="brief-work__checked">
              <UiIcon name="Sparkles" :size="14" aria-hidden="true" />
              <span><span class="sr-only">ME3 checked: </span>{{ row.item.checked }}</span>
            </p>
            <div v-if="row.draft" class="brief-draft">
              <div class="brief-draft__head">
                <strong>{{ row.kind === "followup" ? `Follow-up to ${row.name}` : `Reply to ${row.name}` }}</strong>
                <span>Edit freely</span>
              </div>
              <textarea
                class="brief-draft__body"
                :value="draftText(row)"
                :rows="draftRows(row)"
                :aria-label="draftLabel(row)"
                :disabled="writing.has(row.key)"
                @input="setDraftText(row, ($event.target as HTMLTextAreaElement).value)"
              />
            </div>
            <p v-else-if="writing.has(row.key)" class="brief-work__writing" role="status">ME3 is writing…</p>
            <div v-else-if="otherAction(row)" class="brief-choices">
              <Button color="primary" shape="soft" size="compact" type="button" :disabled="pending.has(row.key)" @click="runOtherAction(row, otherAction(row)!)">
                {{ otherAction(row)!.label }}
              </Button>
              <button type="button" class="brief-quiet" :disabled="pending.has(row.key)" @click="writeDraft(row)">Draft a reply</button>
            </div>
            <div v-else-if="row.kind === 'mail'" class="brief-choices">
              <button type="button" class="brief-choice" :disabled="pending.has(row.key)" @click="writeDraft(row, 'accept')">Say yes</button>
              <button type="button" class="brief-choice" :disabled="pending.has(row.key)" @click="writeDraft(row, 'decline')">No thanks</button>
              <button type="button" class="brief-choice" :disabled="pending.has(row.key)" @click="writeDraft(row)">{{ discarded.has(row.key) ? "Draft again" : "Draft a reply" }}</button>
            </div>
            <div v-else class="brief-choices">
              <button type="button" class="brief-choice" :disabled="pending.has(row.key)" @click="writeDraft(row)">Draft a follow-up</button>
            </div>

            <form v-if="row.draft || (row.kind === 'mail' && !otherAction(row))" class="brief-ask" @submit.prevent="submitInstruction(row)">
              <UiIcon name="Sparkles" :size="14" aria-hidden="true" />
              <input
                v-model="instructions[row.key]"
                type="text"
                :placeholder="row.draft ? 'Ask ME3 to change it, e.g. shorter' : 'Or tell ME3 what to say'"
                :aria-label="row.draft ? 'Ask ME3 to change the draft' : 'Tell ME3 what to say'"
                :disabled="pending.has(row.key)"
                enterkeyhint="send"
              />
            </form>

            <div class="brief-work__foot">
              <Button v-if="row.draft" color="primary" shape="soft" size="compact" type="button" title="Send (⌘↵)" :disabled="pending.has(row.key)" @click="send(row)">
                <UiIcon name="Send" :size="14" aria-hidden="true" />
                Send
              </Button>
              <button v-if="row.draft" type="button" class="brief-quiet brief-quiet--muted" :disabled="pending.has(row.key)" @click="discardDraft(row)">Discard draft</button>
              <span class="brief-work__spacer" />
              <button v-if="row.kind === 'mail'" type="button" class="brief-quiet" @click="emit('openThread', row.item.threadId, row.item.messageId)">Open conversation</button>
              <div class="brief-menu" @keydown.esc.stop="menuKey = null">
                <button
                  type="button"
                  class="brief-menu__button"
                  aria-label="More"
                  title="More"
                  aria-haspopup="menu"
                  :aria-expanded="menuKey === row.key"
                  @click="menuKey = menuKey === row.key ? null : row.key"
                >
                  <UiIcon name="Ellipsis" :size="16" aria-hidden="true" />
                </button>
                <div v-if="menuKey === row.key" class="brief-menu__list" role="menu">
                  <button type="button" role="menuitem" @click="remindTomorrow(row)">Remind me tomorrow morning</button>
                  <button v-if="row.kind === 'mail'" type="button" role="menuitem" @click="archiveConversation(row)">Archive conversation</button>
                  <button v-if="row.kind === 'mail'" type="button" role="menuitem" @click="alwaysArchiveSender(row)">Always archive {{ row.name }}</button>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.brief {
  width: min(100%, 720px);
  margin: 0 auto;
  padding: 8px 16px 48px;
  box-sizing: border-box;
}

.brief-head {
  padding: 12px 0 14px;
}

.brief-head h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  line-height: 1.2;
}

.brief-head p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-offline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  padding: 8px 12px;
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.brief-panel {
  border-radius: var(--ui-radius-lg, 16px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-sm, 0 2px 10px rgba(13, 18, 20, 0.07));
  overflow: hidden;
}

.brief-tag {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  background: var(--ui-accent-soft, rgba(34, 152, 116, 0.14));
  color: var(--ui-accent-strong, var(--ui-accent, #229874));
}

.brief-tag--urgent {
  background: var(--ui-danger-soft, rgba(219, 31, 31, 0.12));
  color: var(--ui-danger, #db1f1f);
}

.brief-quiet {
  min-height: 36px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--ui-accent-strong, var(--ui-accent, #229874));
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.brief-quiet--muted {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-quiet:hover:not(:disabled) {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.brief-quiet:disabled {
  opacity: 0.5;
  cursor: default;
}

.brief-quiet:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 2px;
  border-radius: 6px;
}

.brief-group {
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.brief-group:last-child {
  border-bottom: 0;
}

.brief-group__head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  padding: 6px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.brief-group__head:disabled {
  cursor: default;
}

.brief-group__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--ui-accent-soft, rgba(34, 152, 116, 0.14));
  color: var(--ui-accent-strong, var(--ui-accent, #229874));
}

.brief-group__title {
  flex: 1 1 auto;
  min-width: 0;
}

.brief-group__items {
  margin: 0;
  padding: 0 16px 8px 56px;
  list-style: none;
}

.brief-handled {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  font-size: 13px;
}

.brief-handled__open {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.brief-handled__open:disabled {
  cursor: default;
}

.brief-handled__text {
  display: flex;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
}

.brief-handled__text strong {
  font-weight: 650;
  white-space: nowrap;
}

.brief-handled__text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-handled__amount {
  flex-shrink: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-variant-numeric: tabular-nums;
}

.brief-caught-up {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 40px 16px 24px;
  text-align: center;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-caught-up p {
  margin: 0;
  max-width: 340px;
  font-size: 14px;
}

.brief-caught-up__actions {
  display: flex;
  gap: 16px;
}

.brief-skeleton {
  display: grid;
  gap: 14px;
  padding: 16px 0;
}

.brief-skeleton__line,
.brief-skeleton__avatar,
.brief-skeleton__lines i {
  display: block;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  border-radius: 8px;
}

.brief-skeleton__line--title {
  width: 180px;
  height: 20px;
}

.brief-skeleton__item {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 12px;
}

.brief-skeleton__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
}

.brief-skeleton__lines {
  display: grid;
  gap: 8px;
}

.brief-skeleton__lines i:first-child {
  width: 45%;
  height: 14px;
}

.brief-skeleton__lines i:last-child {
  width: 90%;
  height: 13px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.brief-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 12px;
}

.brief-sub__toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-accent-strong, var(--ui-accent, var(--color-accent)));
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.brief-sub__toggle--muted {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-sub__toggle:hover {
  text-decoration: underline;
}

.brief-sub__toggle:focus-visible,
.brief-row__main:focus-visible,
.brief-row__done:focus-visible,
.brief-choice:focus-visible,
.brief-menu__button:focus-visible,
.brief-menu__list button:focus-visible {
  outline: 2px solid var(--ui-focus, var(--ui-accent, var(--color-accent)));
  outline-offset: 2px;
  border-radius: 8px;
}

.brief-fold {
  margin-bottom: 12px;
}

.brief-fold__foot {
  padding: 8px 16px 10px;
}

.brief-cleared {
  margin-top: 0;
  padding: 4px 0;
  list-style: none;
}

.brief-cleared li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
}

.brief-cleared__text {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 2px 8px;
  min-width: 0;
  font-size: 13px;
}

.brief-cleared__text strong {
  font-weight: 650;
}

.brief-cleared__text span {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-row {
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.brief-row:last-child {
  border-bottom: 0;
}

.brief-row--busy {
  opacity: 0.7;
}

.brief-row--open {
  background: color-mix(in oklab, var(--ui-accent-soft, var(--ui-surface-muted)) 35%, transparent);
}

.brief-row__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 12px 12px 16px;
}

.brief-row__main {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.brief-row__content {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.brief-row__top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
}

.brief-row__top strong {
  flex-shrink: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
}

.brief-row__subject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-row__time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-row__summary {
  font-size: 14px;
  line-height: 1.4;
}

.brief-row__hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-row__hint--ready {
  color: var(--ui-accent-strong, var(--ui-accent, var(--color-accent)));
  font-weight: 600;
}

.brief-row__done {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: 1px solid var(--ui-border-strong, var(--ui-border, var(--color-border)));
  border-radius: 50%;
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
}

.brief-row__done:hover:not(:disabled) {
  border-color: var(--ui-accent, var(--color-accent));
  background: var(--ui-accent-soft, var(--ui-surface-muted));
  color: var(--ui-accent-strong, var(--ui-accent, var(--color-accent)));
}

.brief-row__done:disabled {
  cursor: default;
  opacity: 0.5;
}

.brief-work {
  display: grid;
  gap: 10px;
  padding: 0 16px 14px 64px;
}

.brief-work__checked {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-work__checked :deep(svg) {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--ui-accent-strong, var(--ui-accent, #229874));
}

.brief-work__writing {
  margin: 0;
  font-size: 13px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-draft {
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface, var(--color-bg));
  overflow: hidden;
}

.brief-draft:focus-within {
  border-color: var(--ui-accent, var(--color-accent));
}

.brief-draft__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px 0;
  font-size: 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-draft__head strong {
  font-weight: 650;
  color: var(--ui-text, inherit);
}

.brief-draft__body {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px 12px;
  border: 0;
  outline: 0;
  resize: vertical;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}

.brief-choices {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.brief-choice {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--ui-border-strong, var(--ui-border, var(--color-border)));
  border-radius: 999px;
  background: var(--ui-surface, var(--color-bg));
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.brief-choice:hover:not(:disabled) {
  border-color: var(--ui-accent, var(--color-accent));
}

.brief-choice:disabled {
  cursor: default;
  opacity: 0.5;
}

.brief-ask {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-ask:focus-within {
  outline: 2px solid var(--ui-focus, var(--ui-accent, var(--color-accent)));
  outline-offset: 1px;
}

.brief-ask input {
  flex: 1 1 auto;
  min-width: 0;
  height: 36px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text, inherit);
  font: inherit;
  font-size: 13px;
}

.brief-work__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
}

.brief-work__spacer {
  flex: 1 1 auto;
}

.brief-menu {
  position: relative;
}

.brief-menu__button {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
}

.brief-menu__button:hover {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.brief-menu__list {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  z-index: 5;
  display: grid;
  min-width: 240px;
  padding: 6px;
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md, 0 8px 28px rgba(13, 18, 20, 0.18));
}

.brief-menu__list button {
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.brief-menu__list button:hover {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

@media (max-width: 640px) {
  .brief {
    padding-bottom: 32px;
  }

  .brief-group__items {
    padding-left: 16px;
  }

  .brief-work {
    padding-left: 16px;
  }

  .brief-row__top {
    flex-wrap: wrap;
  }

  .brief-row__subject {
    flex-basis: 100%;
    order: 3;
  }

  .brief-row__done,
  .brief-menu__button {
    width: 44px;
    height: 44px;
  }
}
</style>
