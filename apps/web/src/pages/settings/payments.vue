<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { api } from "../../api";
import Button from "../../components/Button.vue";
import UiIcon from "../../components/UiIcon.vue";
import PaymentReceiptDialog from "../../components/payments/PaymentReceiptDialog.vue";
import { useAppToast } from "../../composables/useAppToast";
import { formatPaymentMoney, paymentDate, paymentDisplayStatus, paymentReceiptWarning, type PaymentLimits, type PaymentRecord } from "../../utils/agentPayments";

definePage({
  meta: {
    requiresAuth: true,
    title: "Payments | ME3",
    description: "Spend limits for purchases ME3 proposes, and every payment you approved or declined.",
    robots: "noindex,follow",
  },
});

// Launch has no stored payment methods (me3-2gdu.2): the owner pays on their own device.
const CURRENCY_KEY = "me3.payments.currencies";
const { toastSuccess, toastFromUnknown } = useAppToast();
const loading = ref(true);
const payments = ref<PaymentRecord[]>([]);
const limits = ref<PaymentLimits[]>([]);
const editing = ref<string | null>(null);
const draft = reactive({ perPaymentMax: "", monthlyMax: "" });
const saving = ref(false);
const limitError = ref("");
const newCurrency = ref("");
const addingCurrency = ref(false);
const currencyError = ref("");
const receiptFor = ref<string | null>(null);

const sortedLimits = computed(() => [...limits.value].sort((a, b) => a.currency.localeCompare(b.currency)));

function rememberedCurrencies(): string[] {
  try { const saved = JSON.parse(localStorage.getItem(CURRENCY_KEY) || "[]"); return Array.isArray(saved) ? saved.filter(item => typeof item === "string") : []; }
  catch { return []; }
}
function rememberCurrency(currency: string) {
  try { localStorage.setItem(CURRENCY_KEY, JSON.stringify([...new Set([...rememberedCurrencies(), currency])])); } catch { /* per-browser convenience only */ }
}

async function fetchLimits(currency: string) {
  return (await api.get<{ limits: PaymentLimits }>(`/payments/limits?currency=${encodeURIComponent(currency)}`)).limits;
}

async function load() {
  loading.value = true;
  try {
    payments.value = (await api.get<{ payments: PaymentRecord[] }>("/payments?limit=100")).payments || [];
  } catch (error) { toastFromUnknown(error, "Couldn't load your payments"); }
  const currencies = [...new Set(["EUR", ...rememberedCurrencies(), ...payments.value.map(payment => payment.currency)])];
  const results = await Promise.allSettled(currencies.map(fetchLimits));
  limits.value = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") toastFromUnknown(failed.reason, "Some limits couldn't load");
  loading.value = false;
}

function startEdit(limit: PaymentLimits) {
  editing.value = limit.currency; limitError.value = "";
  draft.perPaymentMax = limit.perPaymentMax; draft.monthlyMax = limit.monthlyMax;
}

async function saveLimits(currency: string) {
  if (saving.value) return;
  saving.value = true; limitError.value = "";
  try {
    // The server checks the numbers and that one payment can't exceed the monthly limit.
    const { limits: saved } = await api.put<{ limits: PaymentLimits }>("/payments/limits", { currency, perPaymentMax: draft.perPaymentMax.trim(), monthlyMax: draft.monthlyMax.trim() });
    limits.value = limits.value.map(item => item.currency === currency ? saved : item);
    editing.value = null; toastSuccess(`${currency} limits saved`);
  } catch (error) { limitError.value = error instanceof Error ? error.message : "Couldn't save these limits."; }
  finally { saving.value = false; }
}

async function addCurrency() {
  const currency = newCurrency.value.trim().toUpperCase();
  if (!currency || addingCurrency.value) return;
  if (limits.value.some(item => item.currency === currency)) { currencyError.value = `${currency} is already listed.`; return; }
  addingCurrency.value = true; currencyError.value = "";
  try {
    limits.value = [...limits.value, await fetchLimits(currency)];
    rememberCurrency(currency); newCurrency.value = "";
  } catch (error) { currencyError.value = error instanceof Error ? error.message : "Couldn't add that currency."; }
  finally { addingCurrency.value = false; }
}

function replacePayment(next: PaymentRecord) {
  payments.value = payments.value.map(item => item.id === next.id ? { ...item, ...next } : item);
}

onMounted(load);
</script>

<template>
  <main class="payments-page">
    <Teleport to="#app-page-controls" defer>
      <div class="payments-bar"><span>Payments</span></div>
    </Teleport>
    <div class="payments-col" :aria-busy="loading">
      <section class="payments-intro">
        <span class="payments-intro__emoji" aria-hidden="true">💳</span>
        <p>When ME3 finds something to buy, it shows you the exact purchase and asks first. You pay on your own device. ME3 doesn't store cards, never charges you and never sees your card details. When you buy from another ME3 site, the receipt comes straight from the seller.</p>
      </section>

      <section class="payments-section" aria-labelledby="payments-limits-title">
        <h2 id="payments-limits-title">Spend limits</h2>
        <div class="payments-card">
          <div v-for="limit in sortedLimits" :key="limit.currency" class="payments-limit">
            <form v-if="editing === limit.currency" class="payments-limit__form" @submit.prevent="saveLimits(limit.currency)">
              <strong>{{ limit.currency }}</strong>
              <label><span>Most for one payment</span><input v-model="draft.perPaymentMax" class="input" inputmode="decimal" autocomplete="off" required :aria-invalid="Boolean(limitError)"></label>
              <label><span>Most in 30 days</span><input v-model="draft.monthlyMax" class="input" inputmode="decimal" autocomplete="off" required :aria-invalid="Boolean(limitError)"></label>
              <p v-if="limitError" class="payments-error" role="alert">{{ limitError }}</p>
              <div class="payments-limit__actions">
                <Button color="ghost" shape="soft" :disabled="saving" @click="editing = null">Cancel</Button>
                <Button color="primary" shape="soft" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</Button>
              </div>
            </form>
            <template v-else>
              <div class="payments-limit__head">
                <strong>{{ limit.currency }}</strong>
                <button type="button" class="payments-quiet" :aria-label="`Edit ${limit.currency} limits`" @click="startEdit(limit)">Edit</button>
              </div>
              <dl class="payments-limit__facts">
                <div><dt>Most for one payment</dt><dd>{{ formatPaymentMoney(limit.perPaymentMax, limit.currency) }}</dd></div>
                <div><dt>Most in 30 days</dt><dd>{{ formatPaymentMoney(limit.monthlyMax, limit.currency) }}</dd></div>
                <div><dt>Approved in the last 30 days</dt><dd>{{ formatPaymentMoney(limit.usedLast30Days, limit.currency) }}</dd></div>
                <div><dt>Left</dt><dd>{{ formatPaymentMoney(limit.remaining, limit.currency) }}</dd></div>
              </dl>
              <p v-if="!limit.custom" class="payments-note">Default limits. ME3 can't propose more than these.</p>
            </template>
          </div>
          <form class="payments-add" @submit.prevent="addCurrency">
            <UiIcon name="Plus" :size="18" class="payments-muted" />
            <input v-model="newCurrency" maxlength="3" placeholder="Add a currency, e.g. GBP" aria-label="Add a currency" autocomplete="off" :aria-invalid="Boolean(currencyError)">
            <Button v-if="newCurrency.trim()" color="ghost" shape="soft" size="small" type="submit" :disabled="addingCurrency">Add</Button>
          </form>
          <p v-if="currencyError" class="payments-error payments-error--inset" role="alert">{{ currencyError }}</p>
        </div>
        <p class="payments-note">Approved payments count toward the 30-day limit as soon as they're handed over to you, even before a receipt arrives.</p>
      </section>

      <section class="payments-section" aria-labelledby="payments-history-title">
        <h2 id="payments-history-title">History</h2>
        <div class="payments-card">
          <button v-for="payment in payments" :key="payment.id" type="button" class="payments-row" @click="receiptFor = payment.id">
            <span class="payments-row__text">
              <span>{{ payment.merchant.name }}</span>
              <small><template v-if="payment.network">ME3 network · </template>{{ paymentDisplayStatus(payment) }} · {{ paymentDate(payment.createdAt) }}<template v-if="paymentReceiptWarning(payment)"> · <span class="payments-danger">amount differs</span></template></small>
            </span>
            <span class="payments-row__amount">{{ formatPaymentMoney(payment.receipt?.amount ?? payment.amount, payment.receipt?.currency ?? payment.currency) }}</span>
            <UiIcon name="ChevronRight" :size="18" class="payments-muted" />
          </button>
          <p v-if="!loading && !payments.length" class="payments-empty">No payments yet. When ME3 proposes a purchase in Chat, it appears here.</p>
        </div>
      </section>
    </div>
    <PaymentReceiptDialog :payment-id="receiptFor" @close="receiptFor = null" @changed="replacePayment" />
  </main>
</template>

<style scoped>
.payments-page { padding: 8px 16px 96px; }
.payments-bar { display: flex; justify-content: center; width: 100%; font-size: 15px; font-weight: 700; }
.payments-col { display: flex; flex-direction: column; gap: 20px; width: min(620px, 100%); margin: 0 auto; }
.payments-intro { display: flex; align-items: flex-start; gap: 12px; padding: 8px 4px 0; }
.payments-intro__emoji { font-size: 26px; line-height: 1.2; }
.payments-intro p { margin: 0; color: var(--ui-text-muted); font-size: 15px; line-height: 1.5; }
.payments-section { display: flex; flex-direction: column; gap: 8px; }
.payments-section h2 { margin: 0 4px; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.payments-card { overflow: hidden; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.payments-card > * + * { box-shadow: inset 0 1px 0 var(--ui-border); }
.payments-limit { padding: 14px 16px; }
.payments-limit__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.payments-limit__facts { margin: 6px 0 0; }
.payments-limit__facts > div { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 14px; }
.payments-limit__facts dt { color: var(--ui-text-muted); }
.payments-limit__facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.payments-limit__form { display: flex; flex-direction: column; gap: 10px; }
.payments-limit__form label { display: flex; flex-direction: column; gap: 4px; color: var(--ui-text-muted); font-size: 13px; }
.payments-limit__form .input { min-height: 44px; }
.payments-limit__actions { display: flex; justify-content: flex-end; gap: 8px; }
.payments-limit__actions :deep(.me3-btn) { min-height: 44px; }
.payments-quiet { min-height: 44px; padding: 0 6px; border: 0; background: transparent; color: var(--ui-accent-strong, var(--ui-accent)); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.payments-add { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 4px 10px 4px 16px; }
.payments-add input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; text-transform: uppercase; }
.payments-add input::placeholder { text-transform: none; color: var(--ui-text-muted); }
.payments-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 8px 14px 8px 16px; border: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; text-align: left; cursor: pointer; }
.payments-row__text { display: flex; flex: 1; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.payments-row__text small { color: var(--ui-text-muted); font-size: 13px; }
.payments-row__amount { flex: 0 0 auto; font-variant-numeric: tabular-nums; font-weight: 600; }
.payments-muted { flex: 0 0 auto; color: var(--ui-text-muted); }
.payments-danger { color: var(--ui-danger, #e5484d); }
.payments-note { margin: 4px 4px 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.payments-limit .payments-note { margin: 4px 0 0; }
.payments-error { margin: 0; color: var(--ui-danger, #e5484d); font-size: 14px; }
.payments-error--inset { padding: 0 16px 12px; box-shadow: none !important; }
.payments-empty { margin: 0; padding: 16px; color: var(--ui-text-muted); font-size: 14px; }
@media (max-width: 640px) { .payments-page { padding-inline: 10px; } }
</style>
