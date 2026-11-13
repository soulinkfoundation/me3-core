<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import {
  formatMailMoney,
  type MailboxBrief,
  type MailboxBriefAction,
  type MailboxBriefItem,
  type MailboxFollowUp,
  type MailboxHandledItem,
  mailInitials,
} from "./brief";
import EmailSenderAvatar from "./EmailSenderAvatar.vue";

/**
 * The Brief: what needs the owner (one small action each), what ME3 handled today
 * (each reversible), what is left in Inbox, and a clear finish.
 */
const props = defineProps<{
  active: boolean;
  formatTime: (value: string) => string;
}>();

const emit = defineEmits<{
  openThread: [threadId: string, messageId: string];
  openInbox: [];
  openRules: [];
  editDraft: [draftId: string, item?: MailboxBriefItem];
  countChanged: [count: number];
}>();

const { toast, toastFromUnknown, toastSuccess } = useAppToast();

const brief = ref<MailboxBrief | null>(null);
const loading = ref(false);
const unsupported = ref(false);
const offlineSince = ref<string | null>(null);
const pending = ref<Set<string>>(new Set());
const expandedGroups = ref<Set<string>>(new Set());
let loadedAt = 0;

const followUps = computed(() => brief.value?.followUps || []);
const needsCount = computed(() => (brief.value?.needsYou.length || 0) + followUps.value.length);
// Follow-ups ME3 has already been asked to draft, so a failed draft is not retried in a loop.
const draftRequested = new Set<string>();

const headline = computed(() => {
  if (!brief.value) return "";
  const count = needsCount.value;
  if (count === 0) return "You're all caught up";
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
});

const subline = computed(() => {
  if (!brief.value) return "";
  const handled = brief.value.handled.total;
  const parts: string[] = [];
  if (handled > 0) parts.push(`ME3 handled ${handled} email${handled === 1 ? "" : "s"} today`);
  if (brief.value.checkedAt) parts.push(`checked ${props.formatTime(brief.value.checkedAt)}`);
  return parts.join(" · ");
});

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

function removeItem(id: string) {
  if (!brief.value) return;
  brief.value = { ...brief.value, needsYou: brief.value.needsYou.filter((item) => item.messageId !== id) };
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
    pending.value = new Set([...pending.value, key]);
    try {
      await api.post(`/mailbox/followups/${encodeURIComponent(item.contactId)}/draft`);
      drafted = true;
    } catch {
      // The card stays, with "Draft a follow-up" to try again.
    } finally {
      const next = new Set(pending.value);
      next.delete(key);
      pending.value = next;
    }
  }
  if (drafted) await load(true);
}

function followUpTitle(item: MailboxFollowUp): string {
  return item.organisation && item.organisation.toLowerCase() !== item.name.toLowerCase()
    ? `${item.name} · ${item.organisation}`
    : item.name;
}

function followUpDetail(item: MailboxFollowUp): string {
  const waited = item.daysWaiting === 1 ? "No reply in 1 day" : `No reply in ${item.daysWaiting} days`;
  const parts = [item.daysWaiting > 0 ? waited : "No reply yet"];
  if (item.offer) parts.push(`you offered ${item.offer}`);
  if (item.followUpNumber > 1) parts.push(`follow-up ${item.followUpNumber} of ${item.followUpCap}`);
  return parts.join(" · ");
}

function removeFollowUp(contactId: string) {
  if (!brief.value) return;
  brief.value = { ...brief.value, followUps: followUps.value.filter((item) => item.contactId !== contactId) };
  emit("countChanged", needsCount.value);
}

async function followUpAction(kind: "send" | "draft" | "later" | "stop", item: MailboxFollowUp) {
  const key = `followup:${item.contactId}`;
  if (pending.value.has(key)) return;
  pending.value = new Set([...pending.value, key]);
  const path = `/mailbox/followups/${encodeURIComponent(item.contactId)}`;
  try {
    if (kind === "send") {
      if (!item.draft) return;
      await api.post(`/mailbox/drafts/${encodeURIComponent(item.draft.id)}/approve`);
      removeFollowUp(item.contactId);
      toastSuccess(`Follow-up sent to ${item.name}.`);
    } else if (kind === "draft") {
      await api.post(`${path}/draft`);
      await load(true);
    } else if (kind === "later") {
      await api.post(`${path}/later`);
      removeFollowUp(item.contactId);
      toastSuccess("Back in the Brief tomorrow morning.");
    } else {
      await api.post(`${path}/stop`);
      removeFollowUp(item.contactId);
      toastSuccess(`ME3 won't follow up with ${item.name} again.`);
    }
  } catch (error) {
    toastFromUnknown(error, "That didn't work");
    await load(true);
  } finally {
    const next = new Set(pending.value);
    next.delete(key);
    pending.value = next;
  }
}

async function perform(action: MailboxBriefAction, item: MailboxBriefItem) {
  if (pending.value.has(item.messageId)) return;
  pending.value = new Set([...pending.value, item.messageId]);
  try {
    switch (action.kind) {
      case "send_draft": {
        if (!item.draft) return;
        await api.post(`/mailbox/drafts/${encodeURIComponent(item.draft.id)}/approve`);
        removeItem(item.messageId);
        toastSuccess(`Reply sent to ${item.sender.name}.`);
        break;
      }
      case "edit_draft": {
        if (item.draft) emit("editDraft", item.draft.id, item);
        break;
      }
      case "draft_reply": {
        const label = action.label.toLowerCase();
        const intent = label.includes("yes") || label.includes("accept") ? "accept" : label.includes("decline") || label.includes("no thanks") ? "decline" : undefined;
        await api.post(`/mailbox/brief/${encodeURIComponent(item.messageId)}/draft`, intent ? { intent } : {});
        toastSuccess("ME3 drafted a reply. Read it before you send.");
        await load(true);
        break;
      }
      case "open_url": {
        if (action.url && /^https:\/\//i.test(action.url)) window.open(action.url, "_blank", "noopener,noreferrer");
        break;
      }
      case "open_accounts": {
        window.location.assign("/accounts");
        break;
      }
      case "archive": {
        await api.post(`/mailbox/messages/${encodeURIComponent(item.messageId)}/move`, { folder: "archive" });
        removeItem(item.messageId);
        toastSuccess("Archived.");
        break;
      }
      case "remind_later": {
        await api.post(`/mailbox/brief/${encodeURIComponent(item.messageId)}/snooze`, {});
        removeItem(item.messageId);
        toastSuccess("Back in the Brief tomorrow morning.");
        break;
      }
      case "unsubscribe": {
        const response = await api.post<{ mode: string; url?: string }>(`/mailbox/messages/${encodeURIComponent(item.messageId)}/unsubscribe`);
        if (response.mode === "open" && response.url) window.open(response.url, "_blank", "noopener,noreferrer");
        await api.post(`/mailbox/brief/${encodeURIComponent(item.messageId)}/done`);
        removeItem(item.messageId);
        toastSuccess("Unsubscribed.");
        break;
      }
      case "mark_done": {
        await api.post(`/mailbox/brief/${encodeURIComponent(item.messageId)}/done`);
        removeItem(item.messageId);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    toastFromUnknown(error, "That didn't work");
    await load(true);
  } finally {
    const next = new Set(pending.value);
    next.delete(item.messageId);
    pending.value = next;
  }
}

async function undo(item: MailboxHandledItem) {
  try {
    await api.post(`/mailbox/handled/${encodeURIComponent(item.id)}/undo`);
    toast.success(
      item.undo?.kind === "remove_ledger_entry"
        ? "Removed from Accounts."
        : item.kind === "spam"
          ? "Moved back to Inbox. ME3 will show this sender from now on."
          : "Moved back to Inbox.",
    );
    await load(true);
  } catch (error) {
    toastFromUnknown(error, "That could not be undone");
  }
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
    case "spam": return "ShieldAlert";
    default: return "Sparkles";
  }
}

defineExpose({ refresh: () => load(true) });

onMounted(() => { if (props.active) void load(); });
watch(() => props.active, (active) => { if (active) void load(); });
</script>

<template>
  <section class="brief" aria-label="Brief">
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
        <p v-if="subline">{{ subline }}</p>
      </header>

      <div v-if="needsCount === 0" class="brief-caught-up">
        <UiIcon name="CircleCheck" :size="28" aria-hidden="true" />
        <p>
          {{ brief.handled.total > 0 ? `Nothing needs you. ME3 handled ${brief.handled.total} email${brief.handled.total === 1 ? "" : "s"} today.` : "Nothing needs you right now. ME3 checks new mail as it arrives." }}
        </p>
        <div class="brief-caught-up__actions">
          <button v-if="brief.handled.total > 0" type="button" class="brief-quiet" @click="expandedGroups = new Set(brief!.handled.groups.map((group) => group.kind))">See what ME3 handled</button>
          <button v-if="brief.fyi.inboxLeft > 0" type="button" class="brief-quiet" @click="emit('openInbox')">Open Inbox</button>
          <button v-if="!brief.handled.groups.length" type="button" class="brief-quiet" @click="emit('openRules')">How ME3 handles mail</button>
        </div>
      </div>

      <div v-else-if="brief.needsYou.length" class="brief-panel" role="list">
        <article
          v-for="item in brief.needsYou"
          :key="item.messageId"
          class="brief-item"
          :class="{ 'brief-item--pending': pending.has(item.messageId) }"
          role="listitem"
        >
          <button type="button" class="brief-item__open" :aria-label="`Open conversation with ${item.sender.name}: ${item.summary}`" @click="emit('openThread', item.threadId, item.messageId)">
            <EmailSenderAvatar :name="item.sender.name" :avatar-url="item.sender.avatarUrl" :size="36" />
            <span class="brief-item__content">
              <span class="brief-item__top">
                <strong>{{ item.sender.name }}</strong>
                <span class="brief-item__subject">{{ item.subject }}</span>
                <span v-if="item.urgency === 'urgent'" class="brief-tag brief-tag--urgent">Urgent</span>
                <span v-if="item.duplicates" class="brief-tag" :title="`${item.duplicates + 1} similar emails`">×{{ item.duplicates + 1 }}</span>
                <time class="brief-item__time">{{ formatTime(item.receivedAt) }}</time>
              </span>
              <span class="brief-item__summary" :class="{ 'brief-item__summary--pending': item.pending }">{{ item.summary }}</span>
              <span v-if="item.draft" class="brief-item__draft">Draft: “{{ item.draft.preview }}”</span>
            </span>
          </button>
          <div class="brief-item__acts">
            <Button
              v-if="item.primaryAction"
              color="primary"
              shape="soft"
              size="compact"
              type="button"
              :disabled="pending.has(item.messageId)"
              @click="perform(item.primaryAction, item)"
            >
              <UiIcon v-if="item.primaryAction.kind === 'send_draft'" name="Send" :size="14" aria-hidden="true" />
              {{ item.primaryAction.label }}
            </Button>
            <button
              v-if="item.secondaryAction"
              type="button"
              class="brief-quiet"
              :disabled="pending.has(item.messageId)"
              @click="perform(item.secondaryAction, item)"
            >
              {{ item.secondaryAction.label }}
            </button>
            <button type="button" class="brief-quiet brief-quiet--muted" :disabled="pending.has(item.messageId)" @click="perform({ kind: 'mark_done', label: 'Done' }, item)">Done</button>
          </div>
        </article>
      </div>

      <template v-if="followUps.length">
        <h2 class="brief-section">Follow-ups due <span>{{ followUps.length }}</span></h2>
        <div class="brief-followups">
          <article
            v-for="item in followUps"
            :key="item.contactId"
            class="brief-followup"
            :class="{ 'brief-item--pending': pending.has(`followup:${item.contactId}`) }"
          >
            <div class="brief-followup__who">
              <span class="brief-followup__avatar" aria-hidden="true">{{ mailInitials(item.organisation || item.name) }}</span>
              <span class="brief-followup__text">
                <strong>{{ followUpTitle(item) }}</strong>
                <span>{{ followUpDetail(item) }}</span>
              </span>
            </div>
            <div v-if="item.draft" class="brief-followup__draft">
              <small>ME3 drafted a follow-up</small>
              {{ item.draft.body }}
            </div>
            <p v-else class="brief-followup__waiting">
              {{ pending.has(`followup:${item.contactId}`) ? "ME3 is drafting a follow-up…" : "No draft yet." }}
            </p>
            <div class="brief-item__acts brief-followup__acts">
              <Button
                v-if="item.draft"
                color="primary"
                shape="soft"
                size="compact"
                type="button"
                :disabled="pending.has(`followup:${item.contactId}`)"
                @click="followUpAction('send', item)"
              >
                Send
              </Button>
              <Button
                v-else
                color="outline"
                shape="soft"
                size="compact"
                type="button"
                :disabled="pending.has(`followup:${item.contactId}`)"
                @click="followUpAction('draft', item)"
              >
                Draft a follow-up
              </Button>
              <button v-if="item.draft" type="button" class="brief-quiet" :disabled="pending.has(`followup:${item.contactId}`)" @click="emit('editDraft', item.draft.id)">Edit</button>
              <button type="button" class="brief-quiet brief-quiet--muted" :disabled="pending.has(`followup:${item.contactId}`)" @click="followUpAction('later', item)">Later</button>
              <button type="button" class="brief-quiet brief-quiet--muted" :disabled="pending.has(`followup:${item.contactId}`)" @click="followUpAction('stop', item)">Stop following up</button>
            </div>
          </article>
        </div>
      </template>

      <template v-if="brief.handled.groups.length">
        <h2 class="brief-section">Handled by ME3 <span>Today</span></h2>
        <div class="brief-panel">
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
        </div>
      </template>

      <!-- An empty Brief already says it is caught up above, so the sign-off only follows a list. -->
      <footer v-if="brief.needsYou.length || brief.handled.groups.length" class="brief-finish">
        <strong>That's everything for now</strong>
        <p>
          <template v-if="brief.fyi.inboxLeft > 0">{{ brief.fyi.inboxLeft }} more in Inbox to read later. </template>
          ME3 checks new mail as it arrives.
        </p>
        <div class="brief-finish__actions">
          <button v-if="brief.fyi.inboxLeft > 0" type="button" class="brief-quiet" @click="emit('openInbox')">Open Inbox</button>
          <button type="button" class="brief-quiet" @click="emit('openRules')">How ME3 handles mail</button>
        </div>
      </footer>
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

.brief-item {
  display: grid;
  gap: 4px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.brief-item:last-child {
  border-bottom: 0;
}

.brief-item--pending {
  opacity: 0.7;
}

.brief-item__open {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.brief-item__open:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 4px;
  border-radius: 8px;
}

.brief-item__content {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.brief-item__top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
}

.brief-item__top strong {
  font-weight: 650;
  white-space: nowrap;
}

.brief-item__subject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-item__time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-item__summary {
  font-size: 14px;
  line-height: 1.4;
}

.brief-item__summary--pending {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-item__draft {
  padding-left: 10px;
  border-left: 2px solid color-mix(in oklab, var(--ui-accent, var(--color-accent)) 50%, transparent);
  font-size: 13px;
  color: var(--ui-text-muted, var(--color-text-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.brief-item__acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin-top: 6px;
  padding-left: 48px;
}

.brief-followups {
  display: grid;
  gap: 10px;
}

.brief-followup {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg, 12px);
  background: var(--ui-surface);
}

.brief-followup__who {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brief-followup__avatar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.brief-followup__text {
  display: grid;
  min-width: 0;
}

.brief-followup__text strong {
  font-weight: 600;
}

.brief-followup__text span,
.brief-followup__waiting {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12.5px;
}

.brief-followup__draft {
  padding: 10px 12px;
  border-radius: var(--ui-radius-md, 8px);
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font-size: 13.5px;
  white-space: pre-wrap;
}

.brief-followup__draft small {
  display: block;
  margin-bottom: 4px;
  color: var(--ui-text-muted);
  font-size: 11.5px;
  font-weight: 600;
}

.brief-followup__acts {
  margin-top: 0;
  flex-wrap: wrap;
  padding: 0;
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

.brief-section {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 26px 0 10px;
  padding: 0 2px;
  font-size: 15px;
  font-weight: 650;
}

.brief-section span {
  font-size: 13px;
  font-weight: 500;
  color: var(--ui-text-muted, var(--color-text-muted));
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

.brief-finish {
  margin-top: 28px;
  padding: 0 2px;
}

.brief-finish strong {
  font-weight: 650;
}

.brief-finish p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.brief-finish__actions {
  display: flex;
  gap: 16px;
  margin-top: 4px;
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

@media (max-width: 640px) {
  .brief {
    padding-bottom: 32px;
  }

  .brief-item__acts {
    padding-left: 0;
  }

  .brief-group__items {
    padding-left: 16px;
  }
}
</style>
