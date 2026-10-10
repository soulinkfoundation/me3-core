<script setup lang="ts">
import { computed, useId } from "vue";
import AppDialog from "./AppDialog.vue";
import Button from "./Button.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{ approval: { title: string; summary?: string | null; payload?: Record<string, unknown> } | null; busy?: boolean; error?: string }>();
const emit = defineEmits<{ close: []; decide: [decision: "approved" | "declined"] }>();
const headingId = useId();
const labels: Record<string, string> = { recipient: "To", body: "Body", bodyText: "Body", textBody: "Body", htmlBody: "HTML body", replacementBody: "Replacement body", target: "Reviewed item", startsAt: "Starts", endsAt: "Ends", remindAt: "Reminder time", requestedTimezone: "Requested timezone", request: "Meeting request", selectedSlot: "Selected time", scheduledFor: "Scheduled time" };
const metadata = new Set(["title", "summary", "targetDomain", "id", "revision", "updatedAt", "createdAt", "requestedAt", "resolvedAt", "status", "pluginId", "actionId", "riskLevel", "readAt", "sourceKind", "sourceName", "peerNodeId", "threadKey", "direction", "kind", "folder", "unread", "createdBy", "preview", "rawHeadersJson", "rawMessage", "inReplyTo", "referencesHeader", "messageIdHeader"]);
const fields = computed(() => {
  const rows: Array<{ label: string; value: string }> = [];
  const card = props.approval?.payload || {};
  function visit(value: unknown, path: string[], key: string) {
    if (key === "metadata" && value && typeof value === "object" && !Array.isArray(value)) {
      const count = (value as Record<string, unknown>).attachmentCount;
      if (count !== undefined) visit(count, ["Attachments"], "attachmentCount");
      return;
    }
    if (value === null || value === undefined || metadata.has(key) && key !== "title" || /Id$/.test(key)) return;
    if (path.length === 1 && ["title", "summary"].includes(key)) return;
    if (path[0] === "Reviewed item" && ((["to", "toAddress"].includes(key) && card.recipient !== undefined) || key === "subject" && card.subject !== undefined || ["body", "bodyText", "textBody"].includes(key) && card.body !== undefined)) return;
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, [...path, String(index + 1)], "")); return; }
    if (typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, [...path, labels[childKey] || childKey.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase())], childKey);
      return;
    }
    rows.push({ label: path.join(" · "), value: typeof value === "boolean" ? value ? "Yes" : "No" : String(value) });
  }
  for (const [key, value] of Object.entries(card)) visit(value, [labels[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase())], key);
  return rows;
});
function close() { if (!props.busy) emit("close"); }
</script>

<template>
  <AppDialog :open="Boolean(approval)" :labelled-by="headingId" @close="close">
    <section v-if="approval" class="approval-review">
      <header>
        <h2 :id="headingId">{{ approval.title }}</h2>
        <Button color="ghost" shape="soft" size="large" icon-only aria-label="Close approval review" :disabled="busy" @click="close"><UiIcon name="X" :size="20" /></Button>
      </header>
      <p v-if="approval.summary" class="approval-review__summary">{{ approval.summary }}</p>
      <dl>
        <div v-for="(field, index) in fields" :key="index"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div>
      </dl>
      <p v-if="error" class="approval-review__error" role="alert">{{ error }}</p>
      <footer class="approval-review__actions">
        <Button color="secondary" shape="soft" :disabled="busy" @click="emit('decide', 'declined')">Decline</Button>
        <Button color="primary" shape="soft" :disabled="busy" @click="emit('decide', 'approved')">{{ busy ? 'Saving…' : 'Approve' }}</Button>
      </footer>
    </section>
  </AppDialog>
</template>

<style scoped>
.approval-review { box-sizing: border-box; width: min(640px, 100%); padding: 20px; background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg); }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
.approval-review__summary { color: var(--ui-text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
dl { margin: 16px 0; }
dl > div { padding: 12px 0; border-top: 1px solid var(--ui-border); }
dt { margin-bottom: 6px; font-size: 13px; color: var(--ui-text-muted); }
dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.5; }
.approval-review__actions { display: flex; justify-content: flex-end; gap: 12px; padding-top: 8px; }
.approval-review__actions :deep(.me3-btn) { min-height: 44px; }
.approval-review__error { color: var(--ui-danger); }
@media (max-width: 640px) { .approval-review { border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; padding: 18px; } }
</style>
