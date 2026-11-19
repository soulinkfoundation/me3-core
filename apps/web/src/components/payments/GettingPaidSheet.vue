<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import { getInitialStripeConnectCountry, persistStripeConnectCountry, STRIPE_CONNECT_COUNTRIES } from "../../utils/commerce";
import { stripeReady, stripeStatusLabel, useStripeStatus } from "../../utils/gettingPaid";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import PayDirectlySettings from "./PayDirectlySettings.vue";

/**
 * "Getting paid" over the site editor: card payments (Stripe) and pay-me-directly methods, the same
 * settings as Settings → Payments, so the owner never leaves the step they're on.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const route = useRoute();
const { toastFromUnknown } = useAppToast();
const { stripe, loaded, load } = useStripeStatus();
const country = ref(getInitialStripeConnectCountry());
const connecting = ref(false);

const ready = computed(() => stripeReady(stripe.value));
const managed = computed(() => stripe.value?.managedAvailable === true);
const statusLabel = computed(() => stripeStatusLabel(stripe.value, loaded.value));
const actionLabel = computed(() => stripe.value?.connected ? "Finish setup" : "Connect");

watch(() => props.open, (open) => { if (open) void load(true); }, { immediate: true });

/** Stripe finishes on its own pages, then brings the owner back to this step of the editor. */
async function connectStripe() {
  if (connecting.value) return;
  connecting.value = true;
  try {
    persistStripeConnectCountry(country.value);
    const query = { ...route.query };
    delete query.stripe_connect;
    const returnPath = `/create?${new URLSearchParams(query as Record<string, string>).toString()}`.replace(/\?$/, "");
    const response = await api.post<{ url: string }>(
      `/commerce/connect/${stripe.value?.connected ? "refresh" : "onboard"}`,
      { country: country.value, returnPath },
    );
    window.location.assign(response.url);
  } catch (error) {
    toastFromUnknown(error, "Couldn't open Stripe.");
    connecting.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" labelled-by="getting-paid-title" close-on-backdrop @close="emit('close')">
    <section class="getting-paid">
      <header class="getting-paid__head">
        <span aria-hidden="true" />
        <h2 id="getting-paid-title">Getting paid</h2>
        <button type="button" class="getting-paid__close" aria-label="Close" @click="emit('close')"><UiIcon name="X" :size="20" /></button>
      </header>

      <section class="getting-paid__card" aria-labelledby="getting-paid-card-title">
        <h3 id="getting-paid-card-title">Card payments</h3>
        <div class="getting-paid__stripe">
          <span class="getting-paid__dot" :class="{ 'getting-paid__dot--ready': ready }" aria-hidden="true" />
          <span class="getting-paid__stripe-text"><strong>Stripe</strong><small>{{ statusLabel }}</small></span>
          <template v-if="loaded && !ready">
            <Button v-if="managed" color="primary" shape="soft" size="compact" :disabled="connecting" @click="connectStripe">{{ connecting ? "Opening…" : actionLabel }}</Button>
            <!-- Self-hosted installs add their own Stripe key, which lives with the other secrets in Settings. -->
            <Button v-else color="outline" shape="soft" size="compact" to="/settings?section=payments">Add a Stripe key</Button>
          </template>
        </div>
        <label v-if="loaded && !ready && managed && !stripe?.connected" class="getting-paid__country">
          <span>Business country</span>
          <select v-model="country">
            <option v-for="option in STRIPE_CONNECT_COUNTRIES" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <p v-if="loaded && !ready && managed" class="getting-paid__hint">Opens Stripe to finish, then brings you back here.</p>
      </section>

      <PayDirectlySettings class="getting-paid__direct" />
    </section>
  </AppDialog>
</template>

<style scoped>
.getting-paid { display: grid; gap: 18px; box-sizing: border-box; width: min(100%, 560px); max-height: min(88dvh, 820px); margin: auto; padding: 12px 20px 24px; overflow-y: auto; border-radius: 24px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.getting-paid__head { position: sticky; top: -12px; z-index: 1; display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; margin: -12px -20px 0; padding: 12px 20px 4px; background: var(--ui-surface); }
.getting-paid__head h2 { margin: 0; font-size: 17px; text-align: center; }
.getting-paid__close { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text); cursor: pointer; }
.getting-paid__close:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.getting-paid__card { display: grid; gap: 10px; }
.getting-paid__card h3 { margin: 0; font-size: 15px; }
.getting-paid__stripe { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 14px; border-radius: 14px; background: var(--ui-surface-muted); }
.getting-paid__dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--ui-warning, #b26a00); }
.getting-paid__dot--ready { background: var(--ui-success, #1f8a4c); }
.getting-paid__stripe-text { display: grid; flex: 1; min-width: 0; }
.getting-paid__stripe-text small { color: var(--ui-text-muted); font-size: 13px; }
.getting-paid__country { display: grid; gap: 6px; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.getting-paid__country select { min-height: 44px; padding: 0 10px; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-bg); color: var(--ui-text); font: inherit; font-weight: 400; }
.getting-paid__hint { margin: 0; color: var(--ui-text-muted); font-size: 13px; }
</style>
