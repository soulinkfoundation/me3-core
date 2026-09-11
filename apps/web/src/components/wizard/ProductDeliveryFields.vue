<script setup lang="ts">
import { computed } from "vue";
import { DELIVERY_COUNTRIES, type ProductDelivery } from "../../../../../shared/product-delivery";
const props = defineProps<{ modelValue?: ProductDelivery }>();
const emit = defineEmits<{ 'update:modelValue': [value: ProductDelivery] }>();
function update(patch: Partial<ProductDelivery>) {
  emit('update:modelValue', { kind: 'manual', instructions: '', shippingCost: 0, countries: [], ...props.modelValue, ...patch });
}
const selectedCountries = computed({ get: () => props.modelValue?.countries || [], set: (countries: string[]) => update({ countries }) });
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = DELIVERY_COUNTRIES.map(code => ({ code, name: names.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));
</script>
<template>
  <fieldset class="delivery-fields">
    <legend>Delivery</legend>
    <label for="product-delivery-kind">How will the buyer receive this?</label>
    <select id="product-delivery-kind" :value="modelValue?.kind || 'manual'" @change="update({kind: ($event.target as HTMLSelectElement).value as ProductDelivery['kind']})">
      <option value="manual">I’ll arrange delivery or provide the service</option>
      <option value="physical">Send a physical product</option>
    </select>
    <label for="product-delivery-instructions">What happens after purchase?</label>
    <textarea id="product-delivery-instructions" :value="modelValue?.instructions || ''" maxlength="2000" placeholder="Explain how and when the buyer will receive their purchase." @input="update({instructions: ($event.target as HTMLTextAreaElement).value})" />
    <template v-if="modelValue?.kind === 'physical'">
      <label for="product-returns">Returns and cancellations</label>
      <textarea id="product-returns" :value="modelValue.returns || ''" maxlength="2000" placeholder="Explain how buyers can request a return or cancellation." @input="update({returns: ($event.target as HTMLTextAreaElement).value})" />
      <label for="product-shipping-cost">Shipping charge (in the product’s currency)</label>
      <input id="product-shipping-cost" type="number" min="0" step="0.01" :value="(modelValue.shippingCost || 0) / 100" @input="update({shippingCost: Math.round(Number(($event.target as HTMLInputElement).value) * 100)})">
      <p>Enter final prices and shipping charges, including any taxes you need to charge. Tax is not calculated automatically.</p>
      <p>Use 0 for free shipping. This charge applies to one item in any supported country.</p>
      <label for="product-shipping-countries">Delivery countries</label>
      <select id="product-shipping-countries" multiple size="6" v-model="selectedCountries">
        <option v-for="country in countries" :key="country.code" :value="country.code">{{ country.name }}</option>
      </select>
      <p>Select every country you can deliver to for the shipping charge above.</p>
      <p>Stock is managed manually. Turn off “Available for purchase” when you cannot fulfil more orders. Checkout does not reserve limited stock.</p>
    </template>
  </fieldset>
</template>
<style scoped>
.delivery-fields{display:grid;gap:10px;border:0;padding:0;margin:24px 0;min-width:0}
legend,label{font-weight:600}legend{margin-bottom:12px}p{margin:0 0 8px;color:var(--ui-text-muted,var(--color-text-muted));font-size:.9rem}
input,select,textarea{width:100%;box-sizing:border-box;min-height:44px;padding:12px;font:inherit;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text))}
textarea{min-height:100px}input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--ui-focus,var(--color-accent));outline-offset:2px}
</style>
