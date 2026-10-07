<script setup lang="ts">
import { computed } from "vue";
import type { RegionalPrice } from "../../../../../shared/regional-pricing";

const props = defineProps<{ modelValue?: RegionalPrice[]; inputId: string; shipping?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: RegionalPrice[] | undefined] }>();
const pakistan = computed(() => props.modelValue?.find(price => price.country === "PK"));
function update(patch: Partial<RegionalPrice>) {
  const other = (props.modelValue || []).filter(price => price.country !== "PK");
  emit("update:modelValue", [...other, { country: "PK", currency: "PKR", amount: 0, shippingCost: 0, ...pakistan.value, ...patch }]);
}
function toggle(event: Event) {
  if ((event.target as HTMLInputElement).checked) update({});
  else {
    const other = props.modelValue?.filter(price => price.country !== "PK");
    emit("update:modelValue", other?.length ? other : undefined);
  }
}
function minorUnits(event: Event): number {
  return Math.round(Number((event.target as HTMLInputElement).value) * 100);
}
</script>

<template>
  <fieldset class="regional-prices">
    <legend>Regional pricing</legend>
    <label class="regional-toggle" :for="`${inputId}-pakistan-enabled`">
      <input :id="`${inputId}-pakistan-enabled`" type="checkbox" :checked="Boolean(pakistan)" @change="toggle">
      <span>Set a separate price for Pakistan</span>
    </label>
    <template v-if="pakistan">
      <p :id="`${inputId}-pakistan-help`">Visitors in Pakistan see your fixed PKR price. Everywhere else uses your USD price above. Unknown locations use USD.</p>
      <label :for="`${inputId}-pakistan-price`">Pakistan price (PKR)</label>
      <input :id="`${inputId}-pakistan-price`" type="number" min="0.50" step="0.01" required :value="pakistan.amount ? pakistan.amount / 100 : ''" :aria-describedby="`${inputId}-pakistan-help ${inputId}-pakistan-error`" :aria-invalid="pakistan.amount < 50" @input="update({ amount: minorUnits($event) })">
      <p :id="`${inputId}-pakistan-error`" class="field-error" v-if="pakistan.amount < 50">Enter the fixed Pakistan price before publishing.</p>
      <template v-if="shipping">
        <label :for="`${inputId}-pakistan-shipping`">Pakistan shipping charge (PKR)</label>
        <input :id="`${inputId}-pakistan-shipping`" type="number" min="0" step="0.01" required :value="(pakistan.shippingCost || 0) / 100" @input="update({ shippingCost: minorUnits($event) })">
        <p>Use 0 for free shipping.</p>
      </template>
    </template>
  </fieldset>
</template>

<style scoped>
.regional-prices{display:grid;gap:10px;border:0;padding:0;margin:20px 0;min-width:0}
legend,label{font-weight:600}legend{margin-bottom:12px}
.regional-toggle{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer}
.regional-toggle input{width:20px;height:20px;flex:none;accent-color:var(--ui-accent,var(--color-accent))}
p{margin:0;color:var(--ui-text-muted,var(--color-text-muted));font-size:.9rem;line-height:1.5}
input[type=number]{width:100%;box-sizing:border-box;min-height:44px;padding:12px;font:inherit;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text))}
input:focus-visible{outline:3px solid var(--ui-focus,var(--color-accent));outline-offset:2px}
.field-error{color:var(--ui-danger,var(--color-error))}
</style>
