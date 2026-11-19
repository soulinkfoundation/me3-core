<script setup lang="ts">
import { computed, inject, onMounted } from "vue";
import { useWizardStore } from "../../stores/wizard";
import { GETTING_PAID_KEY, offerCanTakePayment, paidOffersFor, stripeReady, useStripeStatus } from "../../utils/gettingPaid";
import { paymentMethodName, usePayDirectlyMethods } from "../../utils/payDirectly";
import UiIcon from "../UiIcon.vue";

/** Top of Bookings and Offerings: how this step's paid offers get paid. Shown only when there is one. */
const props = defineProps<{ step: "bookings" | "shop" }>();

const wizard = useWizardStore();
const openGettingPaid = inject(GETTING_PAID_KEY, null);
const { stripe, loaded: stripeLoaded, load: loadStripe } = useStripeStatus();
const { methods, loaded: methodsLoaded, load: loadMethods } = usePayDirectlyMethods();

const paid = computed(() => paidOffersFor(wizard, props.step));
const stuck = computed(() => paid.value.filter((offer) => !offerCanTakePayment(offer, methods.value, stripe.value)));
const ready = computed(() => stripeLoaded.value && methodsLoaded.value && stuck.value.length === 0);
const noun = computed(() => props.step === "bookings" ? "paid session" : "paid offering");
const detail = computed(() => {
  if (!stripeLoaded.value || !methodsLoaded.value) return "Checking…";
  if (stuck.value.length) {
    const count = stuck.value.length;
    const anySetUp = stripeReady(stripe.value) || methods.value.some((method) => method.enabled);
    return anySetUp
      ? `${count} ${noun.value}${count === 1 ? "" : "s"} can't take payment`
      : `Not set up · ${paid.value.length} ${noun.value}${paid.value.length === 1 ? "" : "s"}`;
  }
  const ways = [
    ...(stripeReady(stripe.value) ? ["Card"] : []),
    ...[...new Set(methods.value.filter((method) => method.enabled).map((method) => paymentMethodName(method.kind)))],
  ];
  return ways.join(" · ") || "Ready";
});

onMounted(() => {
  void loadStripe();
  void loadMethods().catch(() => undefined);
});
</script>

<template>
  <button v-if="paid.length && openGettingPaid" type="button" class="getting-paid-row" :class="{ 'getting-paid-row--stuck': !ready && stripeLoaded && methodsLoaded }" @click="openGettingPaid()">
    <span class="getting-paid-row__dot" aria-hidden="true" />
    <span class="getting-paid-row__text"><strong>Getting paid</strong><small>{{ detail }}</small></span>
    <UiIcon name="ChevronRight" :size="18" aria-hidden="true" />
  </button>
</template>

<style scoped>
.getting-paid-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; margin: 0 0 18px; padding: 8px 14px; border: 0; border-radius: 16px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; text-align: left; cursor: pointer; }
.getting-paid-row:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.getting-paid-row__dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--ui-success, #1f8a4c); }
.getting-paid-row--stuck .getting-paid-row__dot { background: var(--ui-warning, #b26a00); }
.getting-paid-row__text { display: grid; flex: 1; min-width: 0; }
.getting-paid-row__text small { color: var(--ui-text-muted); font-size: 13px; }
.getting-paid-row > svg { flex: none; color: var(--ui-text-muted); }
</style>
