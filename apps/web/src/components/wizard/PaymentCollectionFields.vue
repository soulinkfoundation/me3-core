<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import type { WizardPaymentMethod } from "../../stores/wizard";
import { methodsOfferedFor, PAY_DIRECTLY_SETTINGS_PATH, paymentMethodName, usePayDirectlyMethods } from "../../utils/payDirectly";
import StripePaymentSetupCallout from "./StripePaymentSetupCallout.vue";
import { GETTING_PAID_KEY } from "../../utils/gettingPaid";

const props = withDefaults(
  defineProps<{
    modelValue: WizardPaymentMethod;
    /** The owner's optional note for buyers (the offer's paymentInstructions). */
    instructions: string;
    inputId: string;
    /** The offer's currency: a bank account is offered only for orders in its own currency. */
    currency?: string;
    /** "Let them choose": a card offer whose buyer may pay the owner directly instead. */
    allowPayDirectly?: boolean;
    compact?: boolean;
  }>(),
  {
    currency: "USD",
    allowPayDirectly: false,
    compact: true,
  },
);

const TIDY_KEY = "me3.payDirectly.tidyNoteSeen";
// In the site editor, payment setup opens over the step instead of sending the owner to Settings.
const openGettingPaid = inject(GETTING_PAID_KEY, null);
const { methods, loaded, load } = usePayDirectlyMethods();
const offered = computed(() => methodsOfferedFor(methods.value, props.currency));
const offeredNames = computed(() => offered.value.map((method) => paymentMethodName(method.kind)).join(", "));
const tidySeen = ref(true);
// Shown once: a note written before saved methods may repeat details buyers now get anyway.
const suggestTidy = computed(() => !tidySeen.value && offered.value.length > 0 && Boolean(props.instructions.trim()));

function dismissTidy() {
  tidySeen.value = true;
  try { localStorage.setItem(TIDY_KEY, "1"); } catch { /* per-browser convenience only */ }
}

onMounted(() => {
  try { tidySeen.value = localStorage.getItem(TIDY_KEY) === "1"; } catch { tidySeen.value = false; }
  // The Worker checks again on publish, so a failed load only hides the summary.
  void load().catch(() => undefined);
});

const emit = defineEmits<{
  "update:modelValue": [value: WizardPaymentMethod];
  "update:instructions": [value: string];
  "update:allowPayDirectly": [value: boolean];
}>();

// "Let them choose" is saved as a card offer plus a flag, so older apps and buying agents,
// which read anything that is not "manual" as card, keep treating it as a card offer.
const choice = computed<"stripe" | "manual" | "choose">(() =>
  props.modelValue === "manual" ? "manual" : props.allowPayDirectly ? "choose" : "stripe");
const showsDirect = computed(() => choice.value !== "stripe");

function updateMethod(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit("update:modelValue", value === "manual" ? "manual" : "stripe");
  emit("update:allowPayDirectly", value === "choose");
}

function updateInstructions(event: Event) {
  emit("update:instructions", (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <fieldset class="payment-collection-fields">
    <legend>How will customers pay?</legend>
    <div class="payment-method-options">
      <label class="payment-method-option">
        <input
          type="radio"
          :name="`${inputId}-method`"
          value="stripe"
          :checked="choice === 'stripe'"
          @change="updateMethod"
        />
        <span>
          <strong>Pay online with Stripe</strong>
          <small>Payment is required before the booking or order is confirmed.</small>
        </span>
      </label>
      <label class="payment-method-option">
        <input
          type="radio"
          :name="`${inputId}-method`"
          value="manual"
          :checked="choice === 'manual'"
          @change="updateMethod"
        />
        <span>
          <strong>Pay me directly</strong>
          <small>
            The customer pays you by PayPal, Revolut, Wise or bank transfer. Their
            booking or order is held until you mark it paid.
          </small>
        </span>
      </label>
      <label class="payment-method-option payment-method-option--wide">
        <input
          type="radio"
          :name="`${inputId}-method`"
          value="choose"
          :checked="choice === 'choose'"
          @change="updateMethod"
        />
        <span>
          <strong>Let them choose</strong>
          <small>
            Card or paying you directly. Needs Stripe connected and a saved way to
            get paid (or a note).
          </small>
        </span>
      </label>
    </div>

    <div v-if="showsDirect" class="payment-instructions-field">
      <p v-if="offered.length" class="pay-directly-summary" data-test="pay-directly-offered">
        Buyers paying in {{ currency }} are offered: <strong>{{ offeredNames }}</strong>.
        <button v-if="openGettingPaid" type="button" class="pay-directly-link" @click="openGettingPaid()">Change</button>
        <RouterLink v-else :to="PAY_DIRECTLY_SETTINGS_PATH">Change in Settings → Payments</RouterLink>
      </p>
      <p v-else-if="loaded && !instructions.trim()" class="pay-directly-summary pay-directly-summary--missing" role="status" data-test="pay-directly-missing">
        You have no way to get paid in {{ currency }} yet.
        <button v-if="openGettingPaid" type="button" class="pay-directly-link" @click="openGettingPaid()">Add one</button>
        <RouterLink v-else :to="PAY_DIRECTLY_SETTINGS_PATH">Add one in Settings → Payments</RouterLink>,
        or write a note for buyers below.
      </p>
      <p v-else-if="loaded" class="pay-directly-summary">
        Buyers get your note. To offer one-tap PayPal, Revolut, Wise or bank details,
        <button v-if="openGettingPaid" type="button" class="pay-directly-link" @click="openGettingPaid()">save them here</button>
        <RouterLink v-else :to="PAY_DIRECTLY_SETTINGS_PATH">save them in Settings → Payments</RouterLink>.
      </p>
      <label :for="`${inputId}-instructions`">Note for buyers (optional)</label>
      <textarea
        :id="`${inputId}-instructions`"
        :value="instructions"
        rows="3"
        maxlength="4000"
        :aria-describedby="`${inputId}-instructions-help`"
        placeholder="e.g. Cash on the day is fine too."
        @input="updateInstructions"
      ></textarea>
      <small :id="`${inputId}-instructions-help`">
        Shown on the buyer’s payment page and in their email, under your ways to get
        paid. It never appears on your website.
      </small>
      <p v-if="suggestTidy" class="pay-directly-summary pay-directly-tidy" data-test="pay-directly-tidy">
        Your saved ways to get paid are now shown to buyers for you. If this note
        repeats those details, you can shorten it.
        <button type="button" @click="dismissTidy">Got it</button>
      </p>
    </div>

    <StripePaymentSetupCallout
      v-if="modelValue === 'stripe'"
      :compact="compact"
    />
  </fieldset>
</template>

<style scoped>
.pay-directly-link { padding: 0; border: 0; background: none; color: var(--ui-accent-strong, var(--ui-accent)); font: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.pay-directly-link:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 4px; }
.payment-collection-fields {
  display: grid;
  gap: 12px;
  margin: 14px 0 0;
  padding: 0;
  border: 0;
  color: var(--ui-text, var(--color-text));
}

.payment-collection-fields legend {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 700;
}

.payment-method-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.payment-method-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  padding: 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 10px);
  background: var(--ui-bg, var(--color-bg));
  cursor: pointer;
}

.payment-method-option--wide {
  grid-column: 1 / -1;
}

.payment-method-option:has(input:checked) {
  border-color: var(--ui-border-strong, var(--color-text));
}

.payment-method-option input {
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: var(--ui-accent, var(--color-primary));
}

.payment-method-option span,
.payment-method-option strong,
.payment-method-option small {
  display: block;
}

.payment-method-option strong {
  font-size: 13px;
}

.payment-method-option small,
.payment-instructions-field small {
  margin-top: 3px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
}

.payment-instructions-field {
  display: grid;
  gap: 7px;
}

.pay-directly-summary {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.5;
}

.pay-directly-summary strong {
  color: var(--ui-text, var(--color-text));
}

.pay-directly-summary a {
  color: inherit;
  text-underline-offset: 3px;
}

.pay-directly-summary--missing {
  padding: 10px 12px;
  border: 1px solid var(--ui-border-strong, var(--color-border));
  border-radius: var(--ui-radius-md, 10px);
  color: var(--ui-text, var(--color-text));
}

.pay-directly-tidy button {
  min-height: 32px;
  margin-left: 4px;
  padding: 0 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.payment-instructions-field label {
  font-size: 13px;
  font-weight: 700;
}

.payment-instructions-field textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 96px;
  padding: 11px 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 10px);
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
}

.payment-instructions-field textarea:focus-visible,
.payment-method-option:focus-within {
  outline: 2px solid var(--ui-accent, var(--color-primary));
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .payment-method-options {
    grid-template-columns: 1fr;
  }
}
</style>
