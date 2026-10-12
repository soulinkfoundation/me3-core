<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import type { CommerceSettingsResponse } from "../../utils/commerce";
import UiIcon from "../UiIcon.vue";

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);

const loading = ref(true);
const configured = ref(false);
const managed = ref(false);
const connectionStatus = ref<CommerceSettingsResponse["stripe"]["connectionStatus"]>(null);

const statusLabel = computed(() => {
  if (loading.value) return "Checking Stripe";
  if (configured.value) return "Stripe connected";
  if (connectionStatus.value === "pending") return "Stripe setup incomplete";
  if (connectionStatus.value === "restricted") return "Stripe needs attention";
  if (connectionStatus.value === "unavailable") return "Stripe status unavailable";
  return "Stripe not connected";
});

const setupHint = computed(() =>
  managed.value
    ? "Connect Stripe before publishing paid offers."
    : "Add a Stripe key before publishing paid offers.",
);

async function loadCommerceStatus() {
  loading.value = true;
  try {
    const response = await api.get<CommerceSettingsResponse>("/commerce/status");
    configured.value = response.stripe.configured === true;
    managed.value = response.stripe.mode === "managed";
    connectionStatus.value = response.stripe.connectionStatus;
  } catch {
    configured.value = false;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadCommerceStatus();
});
</script>

<template>
  <div
    class="stripe-payment-callout"
    :class="{
      'stripe-payment-callout--connected': configured,
      'stripe-payment-callout--compact': compact,
    }"
  >
    <div class="stripe-status-row">
      <div class="connect-status">
        <UiIcon :name="configured ? 'CircleCheck' : loading ? 'Clock' : 'CircleAlert'" :size="20" class="status-icon" aria-hidden="true" />
        <span class="status-text">{{ statusLabel }}</span>
      </div>
      <router-link
        v-if="configured"
        class="disconnect-btn"
        to="/account?section=payments"
      >
        Manage
      </router-link>
    </div>

    <template v-if="!loading && !configured">
      <p class="connect-hint">{{ setupHint }}</p>
      <div class="stripe-actions">
        <router-link class="connect-btn stripe" to="/account?section=payments">
          <UiIcon name="CreditCard" :size="18" />
          {{ managed ? "Connect Stripe" : "Set up Stripe" }}
        </router-link>
        <a
          v-if="!managed"
          class="stripe-docs-link"
          href="https://docs.stripe.com/keys"
          target="_blank"
          rel="noreferrer"
        >
          Docs
        </a>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stripe-payment-callout {
  margin-top: 14px;
  padding: 14px;
  border: 0;
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-sm);
}

.stripe-payment-callout--compact {
  margin-top: 10px;
  margin-bottom: 14px;
}

.stripe-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.connect-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 600;
}

.status-icon {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-text-muted);
  font-size: 12px;
  flex: 0 0 auto;
}

.stripe-payment-callout--connected .status-icon {
  color: var(--ui-accent-strong);
}

.status-text {
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
}

.connect-hint {
  margin: 10px 0 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.stripe-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.connect-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 24px;
  color: var(--ui-text, var(--color-text));
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s;
}

.connect-btn.stripe {
  border: none;
  background: var(--ui-primary);
  color: var(--ui-primary-contrast);
}

.connect-btn.stripe:hover {
  background: var(--ui-primary-strong);
}

.disconnect-btn,
.stripe-docs-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.disconnect-btn:hover,
.stripe-docs-link:hover {
  border-color: var(--ui-text, var(--color-text));
  color: var(--ui-text, var(--color-text));
}

</style>
