<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "../../api";
import type { WaitingPayment } from "../../utils/payDirectly";

/**
 * Home's "Needs you" for Pay me directly: buyers who say they have paid, and unpaid bookings or
 * orders about to be released. It only points to Accounts -> Waiting, where the owner decides.
 */
const items = ref<WaitingPayment[]>([]);
const money = (item: WaitingPayment) => new Intl.NumberFormat(undefined, { style: "currency", currency: item.currency || "USD" }).format(item.amountCents / 100);
const lines = computed(() => items.value.slice(0, 3).map((item) => ({
  key: `${item.kind}:${item.id}`,
  title: item.saysPaidAt ? `${item.customerName} says they’ve paid ${money(item)}` : `${item.customerName} hasn’t paid ${money(item)}`,
  detail: item.needsDecision
    ? `${item.title} · still waiting. Mark it paid or release it.`
    : item.saysPaidAt
      ? `${item.title} · check your account, then mark it paid.`
      : `${item.title} · released soon unless you mark it paid or keep holding.`,
})));

onMounted(async () => {
  try {
    const response = await api.get<{ waiting?: WaitingPayment[] }>("/accounts/waiting");
    items.value = (response?.waiting || []).filter((item) => item.needsYou);
  } catch { /* Accounts may be switched off; Home stays quiet. */ }
});
</script>

<template>
  <section v-if="lines.length" class="payments-need-you" aria-labelledby="payments-need-you-title">
    <h2 id="payments-need-you-title">Needs you</h2>
    <RouterLink v-for="line in lines" :key="line.key" class="payments-need-you__row" to="/accounts?view=waiting">
      <strong>{{ line.title }}</strong>
      <span>{{ line.detail }}</span>
    </RouterLink>
    <RouterLink v-if="items.length > lines.length" class="payments-need-you__more" to="/accounts?view=waiting">{{ items.length - lines.length }} more waiting</RouterLink>
  </section>
</template>

<style scoped>
.payments-need-you { display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; width: min(620px, 100%); margin: 0 auto 16px; padding: 12px 14px; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); color: var(--ui-text); }
.payments-need-you h2 { margin: 0 0 2px; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.payments-need-you__row { display: grid; gap: 2px; min-height: 44px; padding: 6px 0; color: inherit; text-decoration: none; }
.payments-need-you__row + .payments-need-you__row { border-top: 1px solid var(--ui-border); }
.payments-need-you__row strong { font-size: 15px; }
.payments-need-you__row span, .payments-need-you__more { color: var(--ui-text-muted); font-size: 13px; }
.payments-need-you__row:focus-visible, .payments-need-you__more:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 8px; }
</style>
