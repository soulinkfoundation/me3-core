<script setup lang="ts">
import { computed, useId } from "vue";
import AppDialog from "./AppDialog.vue";
import Button from "./Button.vue";
import UiIcon from "./UiIcon.vue";
import PaymentApprovalCard from "./payments/PaymentApprovalCard.vue";
import { paymentApprovalView, type PaymentApprovalLike } from "../utils/agentPayments";
import SiteDraftCard from "./first-site/SiteDraftCard.vue";
import FreeCallBookingCard from "./first-site/FreeCallBookingCard.vue";
import { freeCallView, siteDraftView } from "../utils/firstSite";

const props = defineProps<{ approval: { id?: string; title: string; summary?: string | null; payload?: Record<string, unknown> } | null; busy?: boolean; error?: string }>();
// Payment cards decide for themselves (fresh sign-in, hand-over) and report `resolved` instead of `decide`.
const emit = defineEmits<{ close: []; decide: [decision: "approved" | "declined"]; resolved: [decision: "approved" | "declined"] }>();
const headingId = useId();
// The first site draft and a free call booking have their own cards, as in Chat (me3-iyql).
const siteDraft = computed(() => props.approval?.id ? siteDraftView({ ...props.approval, id: props.approval.id }) : null);
const freeCall = computed(() => props.approval?.id ? freeCallView({ ...props.approval, id: props.approval.id }) : null);
const payment = computed(() => props.approval?.id && paymentApprovalView(props.approval as PaymentApprovalLike) ? props.approval as PaymentApprovalLike : null);
const labels: Record<string, string> = { recipient: "To", fromAddress: "From", fromName: "Sender name", replyToAddress: "Replies to", deliveryIdentity: "Sending details", body: "Body", bodyText: "Body", textBody: "Body", htmlBody: "HTML body", replacementBody: "Replacement body", target: "Reviewed item", startsAt: "Starts", endsAt: "Ends", remindAt: "Reminder time", requestedTimezone: "Requested timezone", request: "Meeting request", selectedSlot: "Selected time", scheduledFor: "Scheduled time" };
const metadata = new Set(["title", "summary", "targetDomain", "id", "revision", "routeRevision", "storedFromAddress", "updatedAt", "createdAt", "requestedAt", "resolvedAt", "status", "pluginId", "actionId", "riskLevel", "readAt", "sourceKind", "sourceName", "peerNodeId", "threadKey", "direction", "kind", "folder", "unread", "createdBy", "preview", "rawHeadersJson", "rawMessage", "inReplyTo", "referencesHeader", "messageIdHeader"]);
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
    if (["fromAddress", "fromName"].includes(key) && path.includes("Sending details") && value === (card.target as Record<string, unknown> | undefined)?.[key]) return;
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
    <section v-if="payment" class="approval-review approval-review--payment">
      <Button class="approval-review__close" color="ghost" shape="soft" size="large" icon-only aria-label="Close approval review" @click="emit('close')"><UiIcon name="X" :size="20" /></Button>
      <PaymentApprovalCard :approval="payment" :heading-id="headingId" @resolved="emit('resolved', $event)" />
    </section>
    <section v-else-if="siteDraft || freeCall" class="approval-review approval-review--payment">
      <Button class="approval-review__close" color="ghost" shape="soft" size="large" icon-only aria-label="Close approval review" @click="emit('close')"><UiIcon name="X" :size="20" /></Button>
      <SiteDraftCard v-if="siteDraft" :draft="siteDraft" @resolved="emit('resolved', $event); emit('close')" />
      <FreeCallBookingCard v-else-if="freeCall" :call="freeCall" @resolved="emit('resolved', $event); emit('close')" />
    </section>
    <section v-else-if="approval" class="approval-review">
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
.approval-review--payment { position: relative; padding: 0; max-height: min(88vh, 900px); overflow-y: auto; border: 0; }
.approval-review--payment :deep(.pay-card), .approval-review--payment :deep(.site-draft), .approval-review--payment :deep(.free-call) { width: 100%; box-shadow: none; padding: 20px; }
.approval-review--payment :deep(.pay-card__head) { padding-right: 44px; }
.approval-review__close { position: absolute; top: 12px; right: 12px; z-index: 1; }
@media (max-width: 640px) { .approval-review { border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; padding: 18px; } }
</style>
