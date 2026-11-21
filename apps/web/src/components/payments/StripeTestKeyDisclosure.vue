<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import type { CommerceSettingsResponse } from "../../utils/commerce";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";

/**
 * Hosted ME3 takes live card payments through Stripe Connect only, but an owner can add a Stripe
 * test key (sk_test_) to try paid bookings and products without real money. Kept folded away so it
 * never competes with Connect. Saving republishes the site, so Enquire turns into Book or Buy.
 */
const emit = defineEmits<{ saved: [settings: CommerceSettingsResponse] }>();

const { toastSuccess, toastFromUnknown } = useAppToast();
const key = ref("");
const visible = ref(false);
const saving = ref(false);
const looksRight = computed(() => /^sk_test_\S{8,}$/.test(key.value.trim()));

async function save() {
  if (!looksRight.value || saving.value) return;
  saving.value = true;
  try {
    const settings = await api.put<CommerceSettingsResponse>("/commerce/settings", { stripeSecretKey: key.value.trim() });
    key.value = "";
    toastSuccess("Stripe test key saved. Card payments work in test mode.");
    emit("saved", settings);
  } catch (error) {
    toastFromUnknown(error, "Couldn't save the Stripe test key.");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <details class="stripe-test-key">
    <summary>Use a Stripe test key</summary>
    <div class="stripe-test-key__body">
      <p>Try paid bookings and products without real money. Live payments use Stripe Connect.</p>
      <label for="stripe-test-key-input" class="sr-only">Stripe test key</label>
      <div class="stripe-test-key__row">
        <div class="stripe-test-key__field">
          <input
            id="stripe-test-key-input"
            v-model="key"
            :type="visible ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
            placeholder="sk_test_..."
            @keydown.enter.prevent="save"
          />
          <button
            type="button"
            :aria-label="visible ? 'Hide Stripe test key' : 'Show Stripe test key'"
            :aria-pressed="visible"
            @click="visible = !visible"
          >
            <UiIcon :name="visible ? 'EyeOff' : 'Eye'" :size="18" />
          </button>
        </div>
        <Button color="primary" shape="soft" size="compact" type="button" :disabled="!looksRight || saving" @click="save">
          {{ saving ? "Saving…" : "Save" }}
        </Button>
      </div>
      <small v-if="key.trim() && !looksRight">Test keys start with sk_test_.</small>
    </div>
  </details>
</template>

<style scoped>
.stripe-test-key { border-top: 1px solid var(--ui-border); padding-top: 12px; }
.stripe-test-key summary { width: fit-content; min-height: 44px; display: flex; align-items: center; color: var(--ui-text); font-size: 14px; font-weight: 700; cursor: pointer; }
.stripe-test-key summary:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 6px; }
.stripe-test-key__body { display: grid; gap: 10px; padding-top: 6px; }
.stripe-test-key__body p { margin: 0; color: var(--ui-text-muted); font-size: 13px; }
.stripe-test-key__body small { color: var(--ui-text-muted); font-size: 13px; }
.stripe-test-key__row { display: flex; align-items: center; gap: 10px; }
.stripe-test-key__field { position: relative; flex: 1; min-width: 0; }
.stripe-test-key__field input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 44px 0 12px; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-bg); color: var(--ui-text); font: inherit; }
.stripe-test-key__field button { position: absolute; top: 0; right: 0; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.stripe-test-key__field button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; border-radius: 10px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
