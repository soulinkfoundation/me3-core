<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { api } from "../../api";
import Button from "../Button.vue";
import { useAppToast } from "../../composables/useAppToast";
import {
  formatPaymentMoney, paymentActions, paymentAuditLabel, paymentDate, paymentHandOver, paymentDisplayStatus, paymentNetworkNote, paymentReceiptWarning, paymentSlotLabel, safeHttpsUrl,
  type PaymentAuditEvent, type PaymentRecord,
} from "../../utils/agentPayments";

/** One payment: what was approved, the receipt, and the full audit trail. */
const props = defineProps<{ paymentId: string; headingId?: string }>();
const emit = defineEmits<{ changed: [payment: PaymentRecord] }>();
const { toastSuccess, toastFromUnknown } = useAppToast();
const fallbackHeadingId = useId();
const formId = useId();

const payment = ref<PaymentRecord | null>(null);
const audit = ref<PaymentAuditEvent[]>([]);
const loading = ref(true);
const loadError = ref("");
const busy = ref<"" | "receipt" | "not-paid" | "check">("");
const formError = ref("");
const amountDraft = ref("");
const referenceDraft = ref("");

const actions = computed(() => payment.value ? paymentActions(payment.value) : { confirm: false, notPaid: false, checkSeller: false });
const networkNote = computed(() => payment.value ? paymentNetworkNote(payment.value) : null);
const warning = computed(() => payment.value ? paymentReceiptWarning(payment.value) : null);
const handOver = computed(() => payment.value ? paymentHandOver(payment.value) : null);
const merchantHref = computed(() => safeHttpsUrl(payment.value?.merchant.url)?.toString() ?? null);

async function load() {
  loading.value = true; loadError.value = "";
  try {
    const response = await api.get<{ payment: PaymentRecord; audit: PaymentAuditEvent[] }>(`/payments/${encodeURIComponent(props.paymentId)}`);
    apply(response.payment); audit.value = response.audit || [];
  } catch (error) { loadError.value = error instanceof Error ? error.message : "Couldn't load this payment."; }
  finally { loading.value = false; }
}

function apply(next: PaymentRecord) {
  payment.value = next;
  amountDraft.value = next.receipt?.amount ?? next.amount;
  referenceDraft.value = next.receipt?.orderReference ?? "";
}

async function confirmAmount() {
  if (!payment.value || busy.value) return;
  busy.value = "receipt"; formError.value = "";
  try {
    const { payment: saved } = await api.post<{ payment: PaymentRecord }>(`/payments/${encodeURIComponent(payment.value.id)}/receipt`, {
      amount: amountDraft.value.trim(), currency: payment.value.receipt?.currency ?? payment.value.currency, orderReference: referenceDraft.value.trim() || undefined,
    });
    toastSuccess("Receipt saved"); emit("changed", saved); await load();
  } catch (error) { formError.value = error instanceof Error ? error.message : "Couldn't save the receipt."; }
  finally { busy.value = ""; }
}

async function markNotPaid() {
  if (!payment.value || busy.value) return;
  busy.value = "not-paid";
  try {
    const { payment: saved } = await api.post<{ payment: PaymentRecord }>(`/payments/${encodeURIComponent(payment.value.id)}/not-paid`, {});
    toastSuccess("Marked as not bought"); emit("changed", saved); await load();
  } catch (error) { toastFromUnknown(error, "Couldn't update this payment"); }
  finally { busy.value = ""; }
}

async function checkSeller() {
  if (!payment.value || busy.value) return;
  busy.value = "check";
  try {
    const { payment: saved } = await api.post<{ payment: PaymentRecord }>(`/payments/${encodeURIComponent(payment.value.id)}/refresh`, {});
    emit("changed", saved); await load();
  } catch (error) { toastFromUnknown(error, "Couldn't reach the seller"); }
  finally { busy.value = ""; }
}

watch(() => props.paymentId, load, { immediate: true });
</script>

<template>
  <section class="payment-receipt" :aria-busy="loading">
    <p v-if="loading" class="payment-receipt__muted">Loading payment…</p>
    <p v-else-if="loadError" role="alert" class="payment-receipt__error">{{ loadError }} <button type="button" class="payment-receipt__link" @click="load">Try again</button></p>
    <template v-else-if="payment">
      <header class="payment-receipt__head">
        <h2 :id="headingId || fallbackHeadingId">{{ payment.merchant.name }}</h2>
        <span class="payment-receipt__status" :class="`is-${payment.status}`">{{ paymentDisplayStatus(payment) }}</span>
      </header>
      <p class="payment-receipt__amount">{{ formatPaymentMoney(payment.amount, payment.currency) }} <small>approved</small></p>
      <p v-if="payment.purpose" class="payment-receipt__muted">{{ payment.purpose }}</p>

      <dl class="payment-receipt__facts">
        <div><dt>Items</dt><dd><span v-for="(item, index) in payment.items" :key="index" class="payment-receipt__item">{{ item.quantity }} × {{ item.name }}<template v-if="item.options"> · {{ item.options }}</template></span></dd></div>
        <template v-if="payment.network">
          <div><dt>Seller</dt><dd>{{ payment.network.seller.name }} · ME3 network<template v-if="networkNote"><br><span class="payment-receipt__muted">{{ networkNote }}</span></template></dd></div>
          <div v-if="payment.network.slot"><dt>When</dt><dd>{{ paymentSlotLabel(payment.network.slot.start, payment.network.slot.timezone) }}</dd></div>
          <div><dt>Shared with seller</dt><dd>{{ payment.network.sharesWith.name }} · {{ payment.network.sharesWith.email }}</dd></div>
          <div v-if="payment.network.reference"><dt>{{ payment.network.reference.type === 'booking' ? 'Booking' : 'Order' }}</dt><dd>{{ payment.network.reference.id }}</dd></div>
        </template>
        <div v-if="merchantHref"><dt>Merchant</dt><dd><a :href="merchantHref" target="_blank" rel="noopener noreferrer">{{ payment.merchant.url }}</a></dd></div>
        <div v-if="payment.refundPolicy"><dt>Refunds</dt><dd>{{ payment.refundPolicy }}</dd></div>
        <template v-if="payment.receipt">
          <div><dt>Receipt</dt><dd>{{ formatPaymentMoney(payment.receipt.amount, payment.receipt.currency) }}</dd></div>
          <div v-if="payment.receipt.orderReference"><dt>Order reference</dt><dd>{{ payment.receipt.orderReference }}</dd></div>
          <div><dt>Source</dt><dd>{{ payment.receipt.source === 'owner' ? 'Confirmed by you' : payment.receipt.source === 'seller' ? (payment.receipt.ownerConfirmed ? 'From the seller, confirmed by you' : "From the seller's checkout") : payment.receipt.ownerConfirmed ? 'Order email, confirmed by you' : 'Read from the order email' }}</dd></div>
          <div v-if="payment.receipt.paidAt"><dt>Paid</dt><dd>{{ paymentDate(payment.receipt.paidAt) }}</dd></div>
        </template>
      </dl>
      <p v-if="warning" class="payment-receipt__warning" role="alert">{{ warning }}</p>
      <p v-if="handOver" class="payment-receipt__muted">{{ handOver.instructions }} <a :href="handOver.openUrl" target="_blank" rel="noopener noreferrer">Open checkout</a></p>
      <div v-if="actions.checkSeller" class="payment-receipt__actions">
        <Button color="ghost" shape="soft" :disabled="Boolean(busy)" @click="checkSeller">{{ busy === 'check' ? 'Checking…' : 'Check with the seller' }}</Button>
      </div>

      <form v-if="actions.confirm" :id="formId" class="payment-receipt__form" @submit.prevent="confirmAmount">
        <label><span>Amount you paid ({{ payment.receipt?.currency ?? payment.currency }})</span><input v-model="amountDraft" class="input" inputmode="decimal" autocomplete="off" required :aria-invalid="Boolean(formError)"></label>
        <label><span>Order reference (optional)</span><input v-model="referenceDraft" class="input" maxlength="200" autocomplete="off"></label>
        <p v-if="formError" class="payment-receipt__error" role="alert">{{ formError }}</p>
        <div class="payment-receipt__actions">
          <Button v-if="actions.notPaid" color="ghost" shape="soft" :disabled="Boolean(busy)" @click="markNotPaid">{{ busy === 'not-paid' ? 'Saving…' : "I didn't buy it" }}</Button>
          <Button color="primary" shape="soft" type="submit" :disabled="Boolean(busy) || !amountDraft.trim()">{{ busy === 'receipt' ? 'Saving…' : 'Confirm amount' }}</Button>
        </div>
      </form>

      <section class="payment-receipt__audit" aria-label="History">
        <h3>History</h3>
        <ol>
          <li v-for="(event, index) in audit" :key="index"><span>{{ paymentAuditLabel(event) }}</span><time v-if="event.at">{{ paymentDate(event.at) }}</time></li>
        </ol>
      </section>
    </template>
  </section>
</template>

<style scoped>
.payment-receipt { display: flex; flex-direction: column; gap: 10px; color: var(--ui-text); }
.payment-receipt__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.payment-receipt__head h2 { margin: 0; font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
.payment-receipt__status { flex: 0 0 auto; padding: 3px 10px; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.payment-receipt__status.is-paid { background: var(--ui-success-soft, color-mix(in srgb, var(--ui-success, #2e9e6b) 18%, transparent)); color: var(--ui-text); }
.payment-receipt__status.is-handed_over, .payment-receipt__status.is-proposed { background: var(--ui-accent-soft); color: var(--ui-accent-strong, var(--ui-accent)); }
.payment-receipt__amount { margin: 0; font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.payment-receipt__amount small { color: var(--ui-text-muted); font-size: 14px; font-weight: 500; }
.payment-receipt__muted { margin: 0; color: var(--ui-text-muted); font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.payment-receipt__facts { margin: 0; }
.payment-receipt__facts > div { display: grid; grid-template-columns: 130px 1fr; gap: 12px; padding: 10px 0; box-shadow: inset 0 1px 0 var(--ui-border); }
.payment-receipt__facts dt { color: var(--ui-text-muted); font-size: 13px; }
.payment-receipt__facts dd { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.payment-receipt__item { display: block; }
.payment-receipt a, .payment-receipt__link { color: var(--ui-accent-strong, var(--ui-accent)); font-weight: 600; }
.payment-receipt__link { border: 0; background: none; font: inherit; cursor: pointer; text-decoration: underline; }
.payment-receipt__warning { margin: 0; padding: 10px 12px; border-radius: var(--ui-radius-md); background: var(--ui-danger-soft, color-mix(in srgb, var(--ui-danger, #e5484d) 16%, transparent)); color: var(--ui-text); font-size: 14px; }
.payment-receipt__error { margin: 0; color: var(--ui-danger, #e5484d); font-weight: 600; font-size: 14px; }
.payment-receipt__form { display: flex; flex-direction: column; gap: 10px; padding-top: 6px; }
.payment-receipt__form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--ui-text-muted); }
.payment-receipt__form .input { min-height: 44px; }
.payment-receipt__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.payment-receipt__actions :deep(.me3-btn) { min-height: 44px; }
.payment-receipt__audit h3 { margin: 6px 0 4px; font-size: 13px; font-weight: 600; color: var(--ui-text-muted); }
.payment-receipt__audit ol { margin: 0; padding: 0; list-style: none; }
.payment-receipt__audit li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; font-size: 14px; box-shadow: inset 0 1px 0 var(--ui-border); }
.payment-receipt__audit time { flex: 0 0 auto; color: var(--ui-text-muted); font-size: 13px; }
@media (max-width: 520px) { .payment-receipt__facts > div { grid-template-columns: 1fr; gap: 2px; } }
</style>
