<script setup lang="ts">
import { computed } from "vue";
import UiIcon from "../UiIcon.vue";
import { MAX_PRODUCT_OPTIONS, productOptionId, type ProductOption } from "../../../../../shared/product-offer";

const props = defineProps<{
  stock?: number;
  options?: ProductOption[];
  currency: string;
  price: number;
  /** Copies left right now on the published site, when counted. */
  live?: { remaining: number | null; options?: Record<string, number | null> };
}>();
const emit = defineEmits<{
  update: [value: { stock?: number; stockSetAt?: string; options?: ProductOption[] }];
}>();

const hasOptions = computed(() => Boolean(props.options?.length));
const now = () => new Date().toISOString();

function parseCount(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 0 ? count : undefined;
}

function setStock(value: string) {
  const stock = parseCount(value);
  emit("update", { stock, stockSetAt: stock === undefined ? undefined : now() });
}

function liveNote(setCount: number | undefined, left: number | null | undefined): string {
  if (setCount === undefined || left === null || left === undefined || left === setCount) return "";
  return `${left} left now`;
}

function setOptions(options: ProductOption[] | undefined) {
  emit("update", options?.length ? { options, stock: undefined, stockSetAt: undefined } : { options: undefined });
}

function updateOption(index: number, patch: Partial<ProductOption>) {
  const options = [...(props.options || [])];
  options[index] = { ...options[index], ...patch };
  setOptions(options);
}

function setOptionLabel(index: number, label: string) {
  updateOption(index, { label });
}

function setOptionPrice(index: number, value: string) {
  const amount = Number(value);
  updateOption(index, { price: Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0 });
}

function setOptionStock(index: number, value: string) {
  const stock = parseCount(value);
  const { stock: _stock, stockSetAt: _setAt, ...rest } = props.options![index];
  const options = [...props.options!];
  options[index] = stock === undefined ? rest : { ...rest, stock, stockSetAt: now() };
  setOptions(options);
}

function addOption() {
  const options = props.options || [];
  const label = `Option ${options.length + 1}`;
  setOptions([...options, { id: productOptionId(label, options.map((option) => option.id)), label, price: options.at(-1)?.price ?? props.price }]);
}

function removeOption(index: number) {
  setOptions((props.options || []).filter((_, i) => i !== index));
}
</script>

<template>
  <div class="stock-fields">
    <div v-if="!hasOptions" class="stock-row">
      <label for="product-stock">Copies left</label>
      <input id="product-stock" type="number" min="0" step="1" inputmode="numeric" :value="stock ?? ''" placeholder="Unlimited" @change="setStock(($event.target as HTMLInputElement).value)" />
      <p class="stock-hint">
        <template v-if="liveNote(stock, live?.remaining)">{{ liveNote(stock, live?.remaining) }}. </template>
        Leave blank for unlimited. Paid orders count down, and it sells out at 0.
      </p>
    </div>

    <div v-if="hasOptions" class="option-list">
      <div class="option-head" aria-hidden="true"><span>Option</span><span>Price ({{ currency }})</span><span>Copies left</span><span /></div>
      <div v-for="(option, index) in options" :key="option.id" class="option-row">
        <input :id="`product-option-${option.id}-label`" type="text" maxlength="60" :value="option.label" :aria-label="`Option ${index + 1} name`" @change="setOptionLabel(index, ($event.target as HTMLInputElement).value)" />
        <input :id="`product-option-${option.id}-price`" type="number" min="0.5" step="0.01" :value="option.price / 100" :aria-label="`${option.label} price`" @change="setOptionPrice(index, ($event.target as HTMLInputElement).value)" />
        <div class="option-stock">
          <input :id="`product-option-${option.id}-stock`" type="number" min="0" step="1" inputmode="numeric" placeholder="Unlimited" :value="option.stock ?? ''" :aria-label="`${option.label} copies left`" @change="setOptionStock(index, ($event.target as HTMLInputElement).value)" />
          <span v-if="liveNote(option.stock, live?.options?.[option.id])" class="stock-hint">{{ liveNote(option.stock, live?.options?.[option.id]) }}</span>
        </div>
        <button type="button" class="option-remove" :aria-label="`Remove ${option.label}`" :disabled="options!.length <= 1" @click="removeOption(index)">
          <UiIcon name="X" :size="16" aria-hidden="true" />
        </button>
      </div>
      <button v-if="options!.length < MAX_PRODUCT_OPTIONS" type="button" class="option-add" @click="addOption">+ Add option</button>
    </div>
  </div>
</template>

<style scoped>
.stock-fields { display: grid; gap: 14px; margin: 8px 0 16px; }
.stock-row { display: grid; gap: 6px; }
.stock-row label { font-weight: 600; }
.stock-hint { margin: 0; font-size: .85rem; color: var(--ui-text-muted); }
input[type="number"], input[type="text"] { width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px 12px; font: inherit; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm, 8px); background: var(--ui-surface); color: var(--ui-text); }
input:focus-visible, button:focus-visible { outline: 3px solid var(--ui-focus); outline-offset: 2px; }
.stock-row input { max-width: 180px; }
.option-list { display: grid; gap: 8px; }
.option-head, .option-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 36px; gap: 8px; align-items: start; }
.option-head { font-size: .8rem; color: var(--ui-text-muted); font-weight: 600; }
.option-stock { display: grid; gap: 2px; }
.option-remove { width: 36px; height: 44px; display: grid; place-items: center; border: 0; background: none; color: var(--ui-text-muted); cursor: pointer; }
.option-remove:disabled { opacity: .35; cursor: default; }
.option-add { justify-self: start; border: 0; background: none; padding: 6px 0; color: var(--ui-text-muted); font: inherit; cursor: pointer; }
@media (max-width: 520px) {
  .option-head { display: none; }
  .option-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px; }
  .option-row > :first-child { grid-column: 1 / -1; }
}
</style>
