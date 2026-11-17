<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import type { WaitingPayment } from "../../utils/payDirectly";
import Button from "../Button.vue";
import PageLoading from "../PageLoading.vue";

// Accounts -> Waiting: every pay-directly order, booking and event the owner has not been paid for.
// ME3 never marks anything paid by itself; Mark paid is the owner saying the money arrived.

const { toastSuccess, toastFromUnknown } = useAppToast();
const loading = ref(true);
const loadError = ref("");
const waiting = ref<WaitingPayment[]>([]);
/** Mark paid emails the buyer, so the first tap asks and the second does it. */
const confirming = ref<string | null>(null);
const marking = ref<string | null>(null);

const key = (item: WaitingPayment) => `${item.kind}:${item.id}`;
const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100);
const totals = computed(() => {
  const byCurrency = new Map<string, number>();
  for (const item of waiting.value) byCurrency.set(item.currency, (byCurrency.get(item.currency) || 0) + item.amountCents);
  return [...byCurrency].map(([currency, cents]) => money(cents, currency)).join(" + ");
});

function waitingFor(item: WaitingPayment): string {
  const days = Math.floor((Date.now() - Date.parse(item.createdAt)) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

function what(item: WaitingPayment): string {
  const when = item.startsAt ? new Date(item.startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  return [item.title, item.quantity > 1 ? `${item.quantity} places` : "", when].filter(Boolean).join(" · ");
}

async function load() {
  loading.value = true; loadError.value = "";
  try { waiting.value = (await api.get<{ waiting?: WaitingPayment[] }>("/accounts/waiting")).waiting || []; }
  catch (error) { loadError.value = error instanceof Error && error.message ? error.message : "Couldn't load what you're waiting on."; }
  finally { loading.value = false; }
}

async function markPaid(item: WaitingPayment) {
  if (marking.value) return;
  if (confirming.value !== key(item)) { confirming.value = key(item); return; }
  marking.value = key(item);
  try {
    const path = item.kind === "order" ? "orders" : "bookings";
    await api.post(`/accounts/${path}/${encodeURIComponent(item.id)}/manual-payment`, {});
    waiting.value = waiting.value.filter((other) => key(other) !== key(item));
    toastSuccess(item.kind === "order"
      ? `Marked paid. ${item.customerName} has been sent their confirmation.`
      : `Marked paid. ${item.customerName} is booked and has their confirmation.`);
  } catch (error) { toastFromUnknown(error, "Could not mark this as paid."); }
  finally { marking.value = null; confirming.value = null; }
}

onMounted(load);
</script>

<template>
  <div class="waiting-payments" :aria-busy="loading">
    <PageLoading v-if="loading" compact label="Loading what you're waiting on..." />
    <p v-else-if="loadError" class="waiting-payments__error" role="alert">{{ loadError }}</p>
    <p v-else-if="!waiting.length" class="waiting-payments__empty">Nothing is waiting to be paid. Orders and bookings from your Pay me directly offers appear here until you mark them paid.</p>
    <template v-else>
      <ul class="waiting-payments__list">
        <li v-for="item in waiting" :key="key(item)" class="waiting-payments__row">
          <div class="waiting-payments__who">
            <strong>{{ item.customerName }}</strong>
            <span>{{ what(item) }}</span>
            <small>{{ item.reference }} · Waiting {{ waitingFor(item).toLowerCase() }}<span v-if="item.saysPaidAt" class="waiting-payments__pill">Says paid</span><span v-else-if="item.remindedAt" class="waiting-payments__pill waiting-payments__pill--quiet">Reminded</span></small>
          </div>
          <span class="waiting-payments__amount">{{ money(item.amountCents, item.currency) }}</span>
          <Button :color="confirming === key(item) ? 'primary' : 'outline'" shape="soft" size="compact" :disabled="marking === key(item)" @click="markPaid(item)">
            {{ marking === key(item) ? "Saving…" : confirming === key(item) ? "Yes, it arrived" : "Mark paid" }}
          </Button>
        </li>
      </ul>
      <p class="waiting-payments__note">{{ totals }} waiting. Mark paid once the money is in your account: ME3 then confirms with the buyer and counts it as income. ME3 never marks anything paid for you.</p>
    </template>
  </div>
</template>

<style scoped>
.waiting-payments { display: grid; gap: 12px; }
.waiting-payments__list { display: grid; margin: 0; padding: 0; border-top: 1px solid var(--ui-border); list-style: none; }
.waiting-payments__row { display: flex; align-items: center; gap: 14px; min-height: 64px; padding: 10px 0; border-bottom: 1px solid var(--ui-border); }
.waiting-payments__who { display: grid; flex: 1; gap: 2px; min-width: 0; color: var(--ui-text-muted); font-size: 13px; }
.waiting-payments__who strong { color: var(--ui-text); font-size: 14px; }
.waiting-payments__who span, .waiting-payments__who small { overflow-wrap: anywhere; }
.waiting-payments__who small { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
.waiting-payments__pill { padding: 2px 8px; border-radius: 999px; background: var(--ui-primary); color: var(--ui-primary-contrast); font-size: 11px; font-weight: 700; }
.waiting-payments__pill--quiet { background: var(--ui-surface-muted, var(--ui-bg)); color: var(--ui-text-muted); }
.waiting-payments__amount { flex: 0 0 auto; color: var(--ui-text); font-variant-numeric: tabular-nums; font-weight: 700; }
.waiting-payments__row :deep(.me3-btn) { flex: 0 0 auto; min-height: 44px; }
.waiting-payments__note, .waiting-payments__empty { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }
.waiting-payments__empty { padding: 24px 0; font-size: 14px; }
.waiting-payments__error { margin: 0; color: var(--ui-danger, #e5484d); font-size: 14px; }
@media (max-width: 560px) { .waiting-payments__row { flex-wrap: wrap; } .waiting-payments__who { flex-basis: 100%; } .waiting-payments__amount { margin-right: auto; } }
</style>
