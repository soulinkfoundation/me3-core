<script setup lang="ts">
import { nextTick } from "vue";
import { regionalCurrencySupported, type RegionalPrice } from "../../../../../shared/regional-pricing";
import { DELIVERY_COUNTRIES } from "../../../../../shared/product-delivery";
import { COMMERCE_CURRENCY_OPTIONS } from "../../utils/commerce";

const props = defineProps<{ modelValue?: RegionalPrice[]; inputId: string; shipping?: boolean; defaultCurrency?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: RegionalPrice[] | undefined] }>();
const names = new Intl.DisplayNames(["en"], { type: "region" });
const countries = DELIVERY_COUNTRIES.map(code => ({ code, name: names.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));
const currencies = COMMERCE_CURRENCY_OPTIONS.filter(option => regionalCurrencySupported(option.value));
function update(index: number, patch: Partial<RegionalPrice>) {
  emit("update:modelValue", props.modelValue?.map((price, i) => i === index ? { ...price, ...patch } : price));
}
async function add() {
  const prices = props.modelValue || [];
  if (prices.length >= 2) return;
  emit("update:modelValue", [...prices, { country: "", currency: props.defaultCurrency || "USD", amount: 0, shippingCost: 0 }]);
  await nextTick();
  document.getElementById(`${props.inputId}-country-${prices.length}`)?.focus();
}
async function remove(index: number) {
  const prices = props.modelValue?.filter((_, i) => i !== index);
  emit("update:modelValue", prices?.length ? prices : undefined);
  await nextTick();
  document.getElementById(`${props.inputId}-add-country`)?.focus();
}
function minorUnits(event: Event): number {
  return Math.round(Number((event.target as HTMLInputElement).value) * 100);
}
</script>

<template>
  <fieldset class="regional-prices">
    <legend>Regional pricing</legend>
    <p :id="`${inputId}-regional-help`">Set fixed prices for up to two countries. Visitors in those countries see their country’s price. Everyone else, including unknown locations, sees the default price above.</p>
    <div v-for="(price, index) in modelValue" :key="index" class="country-price">
      <div class="price-heading">
        <strong>Country price {{ index + 1 }}</strong>
        <button type="button" :aria-label="`Remove country price ${index + 1}`" @click="remove(index)">Remove</button>
      </div>
      <label :for="`${inputId}-country-${index}`">Country {{ index + 1 }}</label>
      <select :id="`${inputId}-country-${index}`" required :value="price.country" :aria-describedby="`${inputId}-regional-help ${inputId}-error-${index}`" :aria-invalid="!price.country" @change="update(index, { country: ($event.target as HTMLSelectElement).value })">
        <option disabled value="">Choose a country</option>
        <option v-for="country in countries" :key="country.code" :value="country.code" :disabled="modelValue?.some((other, i) => i !== index && other.country === country.code)">{{ country.name }}</option>
      </select>
      <label :for="`${inputId}-currency-${index}`">Currency {{ index + 1 }}</label>
      <select :id="`${inputId}-currency-${index}`" required :value="price.currency" @change="update(index, { currency: ($event.target as HTMLSelectElement).value })">
        <option v-for="currency in currencies" :key="currency.value" :value="currency.value">{{ currency.label }}</option>
      </select>
      <label :for="`${inputId}-price-${index}`">Price {{ index + 1 }} ({{ price.currency }})</label>
      <input :id="`${inputId}-price-${index}`" type="number" min="0.50" step="0.01" required :value="price.amount ? price.amount / 100 : ''" :aria-describedby="`${inputId}-error-${index}`" :aria-invalid="price.amount < 50" @input="update(index, { amount: minorUnits($event) })">
      <p :id="`${inputId}-error-${index}`" class="field-error" v-if="!price.country || price.amount < 50">Choose a country and enter its fixed price before publishing.</p>
      <template v-if="shipping">
        <label :for="`${inputId}-shipping-${index}`">Shipping charge {{ index + 1 }} ({{ price.currency }})</label>
        <input :id="`${inputId}-shipping-${index}`" type="number" min="0" step="0.01" required :value="(price.shippingCost || 0) / 100" @input="update(index, { shippingCost: minorUnits($event) })">
        <p>Use 0 for free shipping.</p>
      </template>
    </div>
    <button :id="`${inputId}-add-country`" class="add-country" type="button" :disabled="(modelValue?.length || 0) >= 2" @click="add">Add country price</button>
  </fieldset>
</template>

<style scoped>
.regional-prices,.country-price{display:grid;gap:10px;min-width:0}
.regional-prices{border:0;padding:0;margin:20px 0}
.country-price{border-top:1px solid var(--ui-border,var(--color-border));padding-top:14px;margin-top:4px}
legend,label{font-weight:600}legend{margin-bottom:12px}
.price-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
p{margin:0;color:var(--ui-text-muted,var(--color-text-muted));font-size:.9rem;line-height:1.5}
input,select,button{box-sizing:border-box;min-height:44px;padding:12px;font:inherit;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text))}
input,select{width:100%;min-width:0}
button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.add-country{justify-self:start}
input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid var(--ui-focus,var(--color-accent));outline-offset:2px}
.field-error{color:var(--ui-danger,var(--color-error))}
</style>
