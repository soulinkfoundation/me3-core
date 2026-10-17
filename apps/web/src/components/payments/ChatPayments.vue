<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import PaymentApprovalCard from "./PaymentApprovalCard.vue";
import PaymentReceiptDialog from "./PaymentReceiptDialog.vue";
import {
  formatPaymentMoney, paymentApprovalView, paymentHandOver, paymentReceiptWarning, paymentTimestamp,
  type PaymentApprovalLike, type PaymentRecord,
} from "../../utils/agentPayments";

/** Payment approvals, hand-overs and recent receipts for the open Chat thread. */
const props = defineProps<{ threadId: string | null; refreshKey?: number }>();
const emit = defineEmits<{ decided: [] }>();
const route = useRoute();
const router = useRouter();
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

const approvals = ref<PaymentApprovalLike[]>([]);
const payments = ref<PaymentRecord[]>([]);
const receiptFor = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
let loadSeq = 0;

const returnedApprovalId = computed(() => typeof route.query.payment === "string" ? route.query.payment : null);
const pendingIds = computed(() => new Set(approvals.value.map(approval => paymentApprovalView(approval)?.proposalId)));
const recent = computed(() => payments.value.filter(payment => {
  if (payment.status === "proposed" || pendingIds.value.has(payment.id)) return false;
  if (payment.status === "handed_over") return true;
  const at = paymentTimestamp(payment.completedAt || payment.decidedAt || payment.createdAt);
  return at !== null && Date.now() - at < RECENT_MS;
}).reverse());

async function load() {
  const threadId = props.threadId, seq = ++loadSeq;
  if (!threadId) { approvals.value = []; payments.value = []; return; }
  const [pending, list] = await Promise.allSettled([
    api.get<{ approvals: PaymentApprovalLike[] }>("/assistant/approvals?status=pending"),
    api.get<{ payments: PaymentRecord[] }>("/payments?limit=25"),
  ]);
  if (seq !== loadSeq) return;
  approvals.value = pending.status === "fulfilled" ? (pending.value.approvals || []).filter(approval => approval.threadId === threadId && paymentApprovalView(approval)).reverse() : [];
  payments.value = list.status === "fulfilled" ? (list.value.payments || []).filter(payment => payment.threadId === threadId) : [];
  if (returnedApprovalId.value) {
    await nextTick();
    root.value?.querySelector(`[data-approval-id="${CSS.escape(returnedApprovalId.value)}"]`)?.scrollIntoView({ block: "center" });
  }
}

async function resolved(approvalId: string) {
  if (returnedApprovalId.value === approvalId) {
    const query = { ...route.query }; delete query.payment;
    await router.replace({ query });
  }
  emit("decided");
}

function pill(payment: PaymentRecord) {
  const total = formatPaymentMoney(payment.amount, payment.currency);
  if (payment.status === "paid") return `Paid ${payment.receipt ? formatPaymentMoney(payment.receipt.amount, payment.receipt.currency) : total} to ${payment.merchant.name}`;
  if (payment.status === "declined") return `Declined ${total} to ${payment.merchant.name}`;
  return `Didn't buy from ${payment.merchant.name}`;
}

watch(() => [props.threadId, props.refreshKey], load, { immediate: true });
</script>

<template>
  <!-- Stays mounted while a receipt is open, even if the payment drops out of the recent list. -->
  <div v-if="approvals.length || recent.length || receiptFor" ref="root" class="chat-payments" aria-label="Payments">
    <PaymentApprovalCard v-for="approval in approvals" :key="approval.id" :data-approval-id="approval.id" :approval="approval"
      :returned-from-sign-in="returnedApprovalId === approval.id" @resolved="resolved(approval.id)" @receipt="receiptFor = $event" />
    <template v-for="payment in recent" :key="payment.id">
      <section v-if="payment.status === 'handed_over'" class="chat-payments__handover" :aria-label="`Pay ${payment.merchant.name}`">
        <div class="chat-payments__head"><span aria-hidden="true">💳</span><span><strong>Pay {{ formatPaymentMoney(payment.amount, payment.currency) }} to {{ payment.merchant.name }}</strong><small>Approved · waiting for your receipt</small></span></div>
        <p>{{ paymentHandOver(payment)?.instructions }}</p>
        <div class="chat-payments__btns">
          <Button color="ghost" shape="soft" @click="receiptFor = payment.id">Receipt</Button>
          <Button v-if="paymentHandOver(payment)" class="chat-payments__primary" color="primary" shape="soft" :href="paymentHandOver(payment)!.openUrl" target="_blank" rel="noopener noreferrer"><UiIcon name="ExternalLink" :size="18" />Open checkout</Button>
        </div>
      </section>
      <div v-else class="chat-payments__pill">
        <UiIcon :name="payment.status === 'paid' ? 'Check' : 'X'" :size="16" class="chat-payments__mark" />
        <span>{{ pill(payment) }}<small v-if="paymentReceiptWarning(payment)"> · amount differs</small></span>
        <button v-if="payment.status !== 'declined'" type="button" @click="receiptFor = payment.id">Receipt</button>
      </div>
    </template>
    <PaymentReceiptDialog :payment-id="receiptFor" @close="receiptFor = null" @changed="load" />
  </div>
</template>

<style scoped>
.chat-payments { display: flex; flex-direction: column; gap: 10px; width: min(560px, 100%); }
.chat-payments__handover { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.chat-payments__head { display: flex; align-items: center; gap: 12px; font-size: 24px; }
.chat-payments__head > span:last-child { display: flex; flex-direction: column; font-size: 15px; }
.chat-payments__head strong { font-weight: 600; overflow-wrap: anywhere; }
.chat-payments__head small { color: var(--ui-text-muted); font-size: 13px; }
.chat-payments__handover p { margin: 0; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.chat-payments__btns { display: flex; gap: 8px; }
.chat-payments__btns :deep(.me3-btn) { min-height: 44px; }
.chat-payments__btns :deep(svg) { margin-right: 6px; }
.chat-payments__primary { flex: 1; }
.chat-payments__pill { display: flex; align-items: center; gap: 10px; align-self: flex-start; max-width: 100%; min-height: 44px; padding: 6px 8px 6px 14px; border-radius: 999px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); font-size: 14px; }
.chat-payments__pill > span { overflow-wrap: anywhere; }
.chat-payments__pill small { color: var(--ui-danger, #e5484d); font-size: 13px; }
.chat-payments__mark { flex: 0 0 auto; color: var(--ui-accent); }
.chat-payments__pill button { min-height: 32px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-accent-strong, var(--ui-accent)); font: inherit; font-weight: 600; cursor: pointer; }
</style>
