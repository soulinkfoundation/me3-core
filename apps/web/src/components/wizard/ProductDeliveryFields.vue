<script setup lang="ts">
import { computed, ref } from "vue";
import { DELIVERY_COUNTRIES, PRODUCT_DOWNLOAD_MAX_BYTES, type ProductDelivery } from "../../../../../shared/product-delivery";
import UiIcon from "../UiIcon.vue";
import { useWizardStore } from "../../stores/wizard";
import { useSitesStore } from "../../stores/sites";
import { useAppToast } from "../../composables/useAppToast";

const props = defineProps<{ modelValue?: ProductDelivery }>();
const emit = defineEmits<{ 'update:modelValue': [value: ProductDelivery] }>();
const wizard = useWizardStore();
const sites = useSitesStore();
const { toastError, toastFromUnknown } = useAppToast();

const kinds: Array<{ kind: ProductDelivery['kind']; emoji: string; title: string; hint: string }> = [
  { kind: 'physical', emoji: '📦', title: 'Something I post', hint: 'Book, journal, print' },
  { kind: 'digital', emoji: '⬇️', title: 'A download', hint: 'PDF, EPUB, ZIP, audio' },
  { kind: 'manual', emoji: '✉️', title: 'I’ll arrange it', hint: 'Service or hand delivery' },
  { kind: 'external', emoji: '↗', title: 'Sold elsewhere', hint: 'Link to another shop' },
];

function update(patch: Partial<ProductDelivery>) {
  emit('update:modelValue', { kind: 'manual', instructions: '', shippingCost: 0, countries: [], ...props.modelValue, ...patch });
}
const selectedCountries = computed({ get: () => props.modelValue?.countries || [], set: (countries: string[]) => update({ countries }) });
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = DELIVERY_COUNTRIES.map(code => ({ code, name: names.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const fileSize = computed(() => {
  const size = props.modelValue?.file?.size || 0;
  return size >= 1_000_000 ? `${(size / 1_000_000).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round(size / 1000))} KB`;
});

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const username = wizard.username.trim();
  if (!username) return toastError('Claim your username before adding a download.');
  if (file.size > PRODUCT_DOWNLOAD_MAX_BYTES) return toastError('Downloads must be 100 MB or smaller.');
  uploading.value = true;
  try {
    const result = await sites.uploadProductDownload(username, file);
    update({ file: result.file });
  } catch (error) {
    if (error instanceof Error && /site not found/i.test(error.message)) return toastError('Publish your site once, then add the download.');
    toastFromUnknown(error, 'Couldn’t upload that file');
  } finally {
    uploading.value = false;
  }
}
</script>
<template>
  <fieldset class="delivery-fields">
    <legend>What are you selling?</legend>
    <div class="delivery-kinds">
      <label v-for="option in kinds" :key="option.kind" class="delivery-kind" :class="{ 'is-selected': (modelValue?.kind || 'manual') === option.kind }">
        <input type="radio" name="product-delivery-kind" :value="option.kind" :checked="(modelValue?.kind || 'manual') === option.kind" @change="update({ kind: option.kind })">
        <span class="delivery-kind-title"><span aria-hidden="true">{{ option.emoji }}</span> {{ option.title }}</span>
        <span class="delivery-kind-hint">{{ option.hint }}</span>
      </label>
    </div>

    <template v-if="modelValue?.kind === 'digital'">
      <div v-if="modelValue.file" class="delivery-file">
        <UiIcon name="FileText" :size="20" aria-hidden="true" />
        <span class="delivery-file-name">{{ modelValue.file.name }}</span>
        <span class="delivery-file-size">{{ fileSize }} · private</span>
        <button type="button" class="delivery-quiet" :disabled="uploading" @click="fileInput?.click()">Replace</button>
      </div>
      <button v-else type="button" class="delivery-upload" :disabled="uploading" @click="fileInput?.click()">
        <UiIcon name="Upload" :size="16" aria-hidden="true" />
        {{ uploading ? 'Uploading…' : 'Upload the file buyers get' }}
      </button>
      <input ref="fileInput" class="visually-hidden" type="file" accept=".pdf,.epub,.zip,.mp3,.m4a,.wav" tabindex="-1" aria-hidden="true" @change="onFileSelected">
      <p>Buyers get a private link after payment that works 5 times over 7 days. The file is never public.</p>
      <label for="product-delivery-instructions">Note for buyers (optional)</label>
      <textarea id="product-delivery-instructions" :value="modelValue.instructions || ''" maxlength="2000" placeholder="e.g. Best printed on A5." @input="update({instructions: ($event.target as HTMLTextAreaElement).value})" />
    </template>

    <template v-else-if="modelValue?.kind === 'external'">
      <label for="product-external-url">Where to buy it</label>
      <input id="product-external-url" type="url" inputmode="url" :value="modelValue.url || ''" placeholder="https://" maxlength="2000" @input="update({url: ($event.target as HTMLInputElement).value.trim()})">
      <label for="product-external-label">Button text (optional)</label>
      <input id="product-external-label" type="text" :value="modelValue.label || ''" maxlength="60" placeholder="Buy on etsy.com" @input="update({label: ($event.target as HTMLInputElement).value})">
      <p>Your page links to the other shop instead of taking payment.</p>
    </template>

    <template v-else>
      <label for="product-delivery-instructions">What happens after purchase?</label>
      <textarea id="product-delivery-instructions" :value="modelValue?.instructions || ''" maxlength="2000" placeholder="Explain how and when the buyer will receive their purchase." @input="update({instructions: ($event.target as HTMLTextAreaElement).value})" />
    </template>

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
    </template>
  </fieldset>
</template>
<style scoped>
.delivery-fields{display:grid;gap:10px;border:0;padding:0;margin:24px 0;min-width:0}
legend,label{font-weight:600}legend{margin-bottom:12px}p{margin:0 0 8px;color:var(--ui-text-muted,var(--color-text-muted));font-size:.9rem}
input,select,textarea{width:100%;box-sizing:border-box;min-height:44px;padding:12px;font:inherit;border:1px solid var(--ui-border,var(--color-border));border-radius:var(--ui-radius-sm,8px);background:var(--ui-surface,var(--color-bg));color:var(--ui-text,var(--color-text))}
textarea{min-height:100px}input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--ui-focus,var(--color-accent));outline-offset:2px}
.delivery-kinds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}
.delivery-kind{position:relative;display:grid;gap:2px;padding:12px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-md,12px);cursor:pointer;font-weight:400}
.delivery-kind input{position:absolute;opacity:0;width:1px;height:1px;min-height:0;padding:0}
.delivery-kind.is-selected{border-color:var(--ui-primary);box-shadow:inset 0 0 0 1px var(--ui-primary)}
.delivery-kind:has(input:focus-visible){outline:3px solid var(--ui-focus);outline-offset:2px}
.delivery-kind-title{font-weight:600}.delivery-kind-hint{font-size:.85rem;color:var(--ui-text-muted)}
.delivery-file{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-sm,8px)}
.delivery-file-name{font-weight:600;min-width:0;overflow-wrap:anywhere}.delivery-file-size{color:var(--ui-text-muted);font-size:.85rem}
.delivery-quiet{margin-left:auto;border:0;background:none;color:var(--ui-text-muted);font:inherit;cursor:pointer;padding:4px}
.delivery-upload{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 14px;border:1.5px dashed var(--ui-border-strong,var(--ui-border));border-radius:var(--ui-radius-sm,8px);background:none;color:var(--ui-text);font:inherit;cursor:pointer}
.delivery-upload:disabled,.delivery-quiet:disabled{opacity:.6;cursor:progress}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
</style>
