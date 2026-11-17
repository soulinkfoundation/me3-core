<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import { matchEvidence, type WaitingPayment } from "../../utils/payDirectly";

/**
 * Home's "Needs you" for Pay me directly: buyers who say they have paid, and unpaid bookings or
 * orders about to be released, and payment emails that match a waiting order. A match shows its
 * evidence with Confirm and Not yet; everything else points to Accounts -> Waiting. ME3 never
 * confirms a payment by itself.
 */
const { toastSuccess, toastFromUnknown } = useAppToast();
const acting = ref<string | null>(null);
const items = ref<WaitingPayment[]>([]);
const money = (item: WaitingPayment) => new Intl.NumberFormat(undefined, { style: "currency", currency: item.currency || "USD" }).format(item.amountCents / 100);
const lines = computed(() => items.value.slice(0, 3).map((item) => ({
  key: `${item.kind}:${item.id}`,
  item,
  // "paid" is what the email says; with two possible orders ME3 does not say whose it is.
  title: item.match ? (item.match.alsoFits.length ? `A ${money(item)} payment may be ${item.customerName}’s` : `${item.customerName} paid ${money(item)}`) : item.saysPaidAt ? `${item.customerName} says they’ve paid ${money(item)}` : `${item.customerName} hasn’t paid ${money(item)}`,
  detail: item.match
    ? `${item.title} · ${matchEvidence(item)}`
    : item.needsDecision
    ? `${item.title} · still waiting. Mark it paid or release it.`
    : item.saysPaidAt
      ? `${item.title} · check your account, then mark it paid.`
      : `${item.title} · released soon unless you mark it paid or keep holding.`,
})));

async function load() {
  try {
    const response = await api.get<{ waiting?: WaitingPayment[] }>("/accounts/waiting");
    items.value = (response?.waiting || []).filter((item) => item.needsYou);
  } catch { /* Accounts may be switched off; Home stays quiet. */ }
}

/** Confirm (the money arrived) or Not yet (leave it waiting) on a matched payment email. */
async function decide(item: WaitingPayment, action: "confirm" | "not-yet") {
  if (acting.value) return;
  acting.value = item.reference;
  try {
    await api.post(`/accounts/waiting/${encodeURIComponent(item.reference)}/${action}`, {});
    toastSuccess(action === "confirm" ? `Confirmed. ${item.customerName} has their confirmation.` : "Left waiting.");
    await load();
  } catch (error) { toastFromUnknown(error, "That didn't work."); }
  finally { acting.value = null; }
}

onMounted(load);
</script>

<template>
  <section v-if="lines.length" class="payments-need-you" aria-labelledby="payments-need-you-title">
    <h2 id="payments-need-you-title">Needs you</h2>
    <div v-for="line in lines" :key="line.key" class="payments-need-you__item">
      <RouterLink class="payments-need-you__row" to="/accounts?view=waiting">
        <strong>{{ line.title }}</strong>
        <span>{{ line.detail }}</span>
      </RouterLink>
      <div v-if="line.item.match && !line.item.match.alsoFits.length" class="payments-need-you__actions">
        <button type="button" :disabled="acting === line.item.reference" @click="decide(line.item, 'not-yet')">Not yet</button>
        <button type="button" class="is-primary" :disabled="acting === line.item.reference" @click="decide(line.item, 'confirm')">Confirm</button>
      </div>
    </div>
    <RouterLink v-if="items.length > lines.length" class="payments-need-you__more" to="/accounts?view=waiting">{{ items.length - lines.length }} more waiting</RouterLink>
  </section>
</template>

<style scoped>
.payments-need-you { display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; width: min(620px, 100%); margin: 0 auto 16px; padding: 12px 14px; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); color: var(--ui-text); }
.payments-need-you h2 { margin: 0 0 2px; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.payments-need-you__row { display: grid; gap: 2px; min-height: 44px; padding: 6px 0; color: inherit; text-decoration: none; }
.payments-need-you__item + .payments-need-you__item { border-top: 1px solid var(--ui-border); }
.payments-need-you__actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 0 8px; }
.payments-need-you__actions button { min-width: 88px; min-height: 44px; padding: 0 14px; border: 1px solid var(--ui-border); border-radius: 12px; background: transparent; color: var(--ui-text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.payments-need-you__actions button.is-primary { border-color: transparent; background: var(--ui-primary); color: var(--ui-primary-contrast); }
.payments-need-you__actions button:disabled { opacity: .5; cursor: default; }
.payments-need-you__actions button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.payments-need-you__row strong { font-size: 15px; }
.payments-need-you__row span, .payments-need-you__more { color: var(--ui-text-muted); font-size: 13px; }
.payments-need-you__row:focus-visible, .payments-need-you__more:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 8px; }
</style>
