<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { PaymentMethodKind } from "../../../../../shared/pay-directly";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import { buyerPreview, paymentMethodDetail, paymentMethodName, usePayDirectlyMethods, type PaymentMethod } from "../../utils/payDirectly";
import AppDialog from "../AppDialog.vue";
import AppSwitch from "../AppSwitch.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";

// Settings -> Payments: the owner's saved ways to get paid directly. Saved once, offered by
// every "Pay me directly" offer. Bank details stay in ME3 and are never on the website.

type BankMode = "iban" | "uk";
const KINDS: PaymentMethodKind[] = ["paypal", "revolut", "wise", "bank"];
const BANK_CURRENCIES = ["EUR", "GBP", "USD", "CAD", "AUD", "CHF", "SGD", "INR", "PKR"];
const PREVIEW_CURRENCIES = ["EUR", "GBP", "USD"];
const BADGES: Record<PaymentMethodKind, string> = { paypal: "P", revolut: "R", wise: "W", bank: "€" };

const { toastSuccess, toastFromUnknown } = useAppToast();
const { methods, loaded, load, set } = usePayDirectlyMethods();
const loadError = ref("");
const switching = ref<string | null>(null);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const formError = ref("");
const confirmingRemove = ref(false);
const form = reactive({
  kind: "paypal" as PaymentMethodKind, link: "", accountName: "", bankMode: "iban" as BankMode,
  iban: "", bic: "", currency: "EUR", sortCode: "", accountNumber: "",
});
const previewCurrency = ref("EUR");

const preview = computed(() => buyerPreview(methods.value, 6000, previewCurrency.value));
const previewAmount = computed(() => new Intl.NumberFormat("en", { style: "currency", currency: previewCurrency.value }).format(60));
const linkLabel = computed(() => form.kind === "wise" ? "Your Wise payment link" : `Your ${paymentMethodName(form.kind)} link or name`);
const linkHelp = computed(() => form.kind === "paypal"
  ? "For example paypal.me/yourname. Buyers open it with the amount filled in."
  : form.kind === "revolut"
    ? "For example revolut.me/yourname. Buyers type the amount themselves."
    : "Paste the link from Wise (wise.com/pay/…). A Wise Business link fills in the amount and reference.");

function openAdd() {
  editingId.value = null;
  Object.assign(form, { kind: "paypal", link: "", accountName: "", bankMode: "iban", iban: "", bic: "", currency: "EUR", sortCode: "", accountNumber: "" });
  formError.value = ""; confirmingRemove.value = false; dialogOpen.value = true;
}

function openEdit(method: PaymentMethod) {
  editingId.value = method.id;
  Object.assign(form, {
    kind: method.kind, link: method.link || "", accountName: method.accountName || "",
    bankMode: method.sortCode ? "uk" : "iban", iban: method.iban || "", bic: method.bic || "",
    currency: method.currency || "EUR", sortCode: method.sortCode || "", accountNumber: method.accountNumber || "",
  });
  formError.value = ""; confirmingRemove.value = false; dialogOpen.value = true;
}

function payload(): Record<string, unknown> {
  if (form.kind !== "bank") return { kind: form.kind, link: form.link.trim() };
  // The unused half is sent empty so switching between IBAN and UK details clears the old ones.
  return form.bankMode === "iban"
    ? { kind: "bank", accountName: form.accountName.trim(), iban: form.iban.trim(), bic: form.bic.trim(), currency: form.currency, sortCode: "", accountNumber: "" }
    : { kind: "bank", accountName: form.accountName.trim(), sortCode: form.sortCode.trim(), accountNumber: form.accountNumber.trim(), iban: "", bic: "", currency: "GBP" };
}

async function save() {
  if (saving.value) return;
  saving.value = true; formError.value = "";
  try {
    if (editingId.value) {
      const { kind: _kind, ...changes } = payload();
      const { method } = await api.patch<{ method: PaymentMethod }>(`/commerce/payment-methods/${encodeURIComponent(editingId.value)}`, changes);
      set(methods.value.map((item) => item.id === method.id ? method : item));
    } else {
      const { method } = await api.post<{ method: PaymentMethod }>("/commerce/payment-methods", payload());
      set([...methods.value, method]);
    }
    dialogOpen.value = false;
    toastSuccess("Saved. Buyers of your Pay me directly offers will see it.");
  } catch (error) {
    // The Worker's messages are written for the owner (a wrong IBAN, sort code or link).
    formError.value = error instanceof Error && error.message ? error.message : "Couldn't save this way to get paid.";
  } finally { saving.value = false; }
}

async function remove() {
  if (!editingId.value || saving.value) return;
  if (!confirmingRemove.value) { confirmingRemove.value = true; return; }
  saving.value = true; formError.value = "";
  try {
    await api.delete(`/commerce/payment-methods/${encodeURIComponent(editingId.value)}`);
    set(methods.value.filter((item) => item.id !== editingId.value));
    dialogOpen.value = false;
  } catch (error) {
    formError.value = error instanceof Error && error.message ? error.message : "Couldn't remove this way to get paid.";
  } finally { saving.value = false; }
}

async function setEnabled(method: PaymentMethod, enabled: boolean) {
  if (switching.value) return;
  switching.value = method.id;
  try {
    const { method: saved } = await api.patch<{ method: PaymentMethod }>(`/commerce/payment-methods/${encodeURIComponent(method.id)}`, { enabled });
    set(methods.value.map((item) => item.id === saved.id ? saved : item));
  } catch (error) { toastFromUnknown(error, "Couldn't change that."); }
  finally { switching.value = null; }
}

onMounted(async () => {
  try { await load(true); }
  catch (error) { loadError.value = error instanceof Error && error.message ? error.message : "Couldn't load your ways to get paid."; }
});
</script>

<template>
  <section class="pay-directly" aria-labelledby="pay-directly-title">
    <h3 id="pay-directly-title">Pay me directly</h3>
    <p class="pay-directly__intro">Save how you get paid once. Buyers see it with the amount and a reference for their order. Money goes straight to you; ME3 never holds it.</p>
    <p v-if="loadError" class="pay-directly__error" role="alert">{{ loadError }}</p>

    <ul v-if="methods.length" class="pay-directly__list">
      <li v-for="method in methods" :key="method.id" class="pay-directly__row">
        <span class="pay-directly__badge" aria-hidden="true">{{ BADGES[method.kind] }}</span>
        <span class="pay-directly__text">
          <strong>{{ paymentMethodName(method.kind) }}</strong>
          <small>{{ paymentMethodDetail(method) }}</small>
        </span>
        <button type="button" class="pay-directly__quiet" :aria-label="`Edit ${paymentMethodName(method.kind)}`" @click="openEdit(method)">Edit</button>
        <AppSwitch :model-value="method.enabled" :label="`Offer ${paymentMethodName(method.kind)} to buyers`" :disabled="switching === method.id" @update:model-value="setEnabled(method, $event)" />
      </li>
    </ul>
    <p v-else-if="loaded" class="pay-directly__empty">Nothing saved yet. Add PayPal, Revolut, Wise or a bank account to take payment without Stripe.</p>

    <button type="button" class="pay-directly__add" @click="openAdd"><UiIcon name="Plus" :size="18" />Add a way to get paid</button>

    <div v-if="methods.length" class="pay-directly__preview" aria-labelledby="pay-directly-preview-title">
      <div class="pay-directly__preview-head">
        <h4 id="pay-directly-preview-title">Buyers see</h4>
        <label><span class="visually-hidden">Currency of the example order</span>
          <select v-model="previewCurrency"><option v-for="code in PREVIEW_CURRENCIES" :key="code" :value="code">{{ code }}</option></select>
        </label>
      </div>
      <p class="pay-directly__preview-note">For a {{ previewAmount }} order with the reference ME3-4F7K.</p>
      <ul v-if="preview.length">
        <li v-for="(line, index) in preview" :key="index"><strong>{{ line.name }}</strong><small>{{ line.hint }}</small></li>
      </ul>
      <p v-else class="pay-directly__empty">Nothing here takes {{ previewCurrency }} yet. Offers priced in {{ previewCurrency }} need a note for buyers, or add PayPal, Revolut, Wise or a {{ previewCurrency }} bank account.</p>
    </div>

    <AppDialog :open="dialogOpen" labelled-by="pay-directly-dialog-title" @close="dialogOpen = false">
      <form class="pay-directly-dialog" @submit.prevent="save">
        <header><h2 id="pay-directly-dialog-title">{{ editingId ? `Edit ${paymentMethodName(form.kind)}` : "Add a way to get paid" }}</h2>
          <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="dialogOpen = false"><UiIcon name="X" :size="18" /></Button></header>
        <div class="pay-directly-dialog__content">
          <div v-if="!editingId" class="pay-directly-segments" role="radiogroup" aria-label="Kind">
            <button v-for="kind in KINDS" :key="kind" type="button" role="radio" :aria-checked="form.kind === kind" :class="{ 'is-active': form.kind === kind }" @click="form.kind = kind; formError = ''">{{ kind === "bank" ? "Bank" : paymentMethodName(kind) }}</button>
          </div>

          <template v-if="form.kind !== 'bank'">
            <label class="pay-directly-field"><span>{{ linkLabel }}</span>
              <input v-model="form.link" name="link" required autocomplete="off" autocapitalize="none" spellcheck="false" :aria-invalid="Boolean(formError)" />
              <small>{{ linkHelp }}</small></label>
          </template>
          <template v-else>
            <label class="pay-directly-field"><span>Account name</span><input v-model="form.accountName" name="accountName" required autocomplete="off" /></label>
            <div class="pay-directly-segments" role="radiogroup" aria-label="Account details">
              <button type="button" role="radio" :aria-checked="form.bankMode === 'iban'" :class="{ 'is-active': form.bankMode === 'iban' }" @click="form.bankMode = 'iban'">IBAN</button>
              <button type="button" role="radio" :aria-checked="form.bankMode === 'uk'" :class="{ 'is-active': form.bankMode === 'uk' }" @click="form.bankMode = 'uk'">UK sort code</button>
            </div>
            <template v-if="form.bankMode === 'iban'">
              <label class="pay-directly-field"><span>IBAN</span><input v-model="form.iban" name="iban" required autocomplete="off" autocapitalize="characters" spellcheck="false" /></label>
              <div class="pay-directly-dialog__grid">
                <label class="pay-directly-field"><span>BIC (optional)</span><input v-model="form.bic" name="bic" autocomplete="off" autocapitalize="characters" spellcheck="false" /></label>
                <label class="pay-directly-field"><span>Currency</span><select v-model="form.currency" name="currency"><option v-for="code in BANK_CURRENCIES" :key="code" :value="code">{{ code }}</option></select></label>
              </div>
              <small class="pay-directly-dialog__hint">Offered only for orders in this currency. Euro orders also get a QR code that banking apps scan.</small>
            </template>
            <template v-else>
              <div class="pay-directly-dialog__grid">
                <label class="pay-directly-field"><span>Sort code</span><input v-model="form.sortCode" name="sortCode" required inputmode="numeric" autocomplete="off" placeholder="12-34-56" /></label>
                <label class="pay-directly-field"><span>Account number</span><input v-model="form.accountNumber" name="accountNumber" required inputmode="numeric" autocomplete="off" placeholder="12345678" /></label>
              </div>
              <small class="pay-directly-dialog__hint">Offered only for orders in pounds. UK banks have no QR code, so buyers copy the details.</small>
            </template>
          </template>
          <p v-if="formError" class="pay-directly__error" role="alert">{{ formError }}</p>
        </div>
        <footer>
          <Button v-if="editingId" color="ghost" shape="soft" size="compact" type="button" class="pay-directly-dialog__remove" :disabled="saving" @click="remove">{{ confirmingRemove ? "Remove for good?" : "Remove" }}</Button>
          <Button color="outline" shape="soft" size="compact" type="button" @click="dialogOpen = false">Cancel</Button>
          <Button color="primary" shape="soft" size="compact" type="submit" :disabled="saving">{{ saving ? "Saving…" : "Save" }}</Button>
        </footer>
      </form>
    </AppDialog>
  </section>
</template>

<style scoped>
.pay-directly { display: grid; gap: 12px; margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--ui-border); }
.pay-directly h3 { margin: 0; font-size: 16px; }
.pay-directly h4 { margin: 0; font-size: 13px; color: var(--ui-text-muted); }
.pay-directly__intro, .pay-directly__empty, .pay-directly__preview-note { margin: 0; color: var(--ui-text-muted); font-size: 14px; line-height: 1.5; }
.pay-directly__list { display: grid; margin: 0; padding: 0; list-style: none; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md, 10px); }
.pay-directly__row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 12px 8px 14px; }
.pay-directly__row + .pay-directly__row { border-top: 1px solid var(--ui-border); }
.pay-directly__badge { display: grid; flex: 0 0 auto; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--ui-surface-muted, var(--ui-bg)); color: var(--ui-text); font-weight: 700; }
.pay-directly__text { display: grid; flex: 1; min-width: 0; }
.pay-directly__text strong { font-size: 14px; }
.pay-directly__text small { overflow-wrap: anywhere; color: var(--ui-text-muted); font-size: 13px; }
.pay-directly__quiet { min-width: 44px; min-height: 44px; padding: 0 6px; border: 0; background: transparent; color: var(--ui-accent-strong, var(--ui-accent)); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.pay-directly__add { display: inline-flex; align-items: center; gap: 10px; justify-self: start; min-height: 44px; padding: 0 14px 0 10px; border: 1px dashed var(--ui-border-strong, var(--ui-border)); border-radius: var(--ui-radius-md, 10px); background: transparent; color: var(--ui-text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.pay-directly__quiet:focus-visible, .pay-directly__add:focus-visible, .pay-directly-segments button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.pay-directly__preview { display: grid; gap: 8px; padding: 14px; border-radius: var(--ui-radius-md, 10px); background: var(--ui-surface-muted, var(--ui-bg)); }
.pay-directly__preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pay-directly__preview select { min-height: 36px; padding: 0 8px; border: 1px solid var(--ui-border); border-radius: 8px; background: var(--ui-surface); color: var(--ui-text); font: inherit; font-size: 13px; }
.pay-directly__preview ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.pay-directly__preview li { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-surface); }
.pay-directly__preview li strong { font-size: 14px; }
.pay-directly__preview li small { color: var(--ui-text-muted); font-size: 13px; line-height: 1.4; }
.pay-directly__error { margin: 0; color: var(--ui-danger, #e5484d); font-size: 14px; }
.pay-directly-dialog { display: grid; width: min(480px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 48px)); overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg); background: var(--ui-surface); color: var(--ui-text); }
.pay-directly-dialog header, .pay-directly-dialog footer { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.pay-directly-dialog header { justify-content: space-between; border-bottom: 1px solid var(--ui-border); }
.pay-directly-dialog header h2 { margin: 0; font-size: 16px; }
.pay-directly-dialog footer { justify-content: flex-end; border-top: 1px solid var(--ui-border); }
.pay-directly-dialog__remove { margin-right: auto; color: var(--ui-danger, #e5484d); }
.pay-directly-dialog__content { display: grid; gap: 14px; overflow-y: auto; padding: 18px 16px; }
.pay-directly-dialog__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pay-directly-dialog__hint { color: var(--ui-text-muted); font-size: 12px; line-height: 1.45; }
.pay-directly-segments { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted, var(--ui-bg)); }
.pay-directly-segments button { min-height: 38px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 13px; cursor: pointer; }
.pay-directly-segments button.is-active { background: var(--ui-surface); color: var(--ui-text); font-weight: 700; box-shadow: var(--ui-shadow-sm); }
.pay-directly-field { display: grid; gap: 6px; font-size: 13px; font-weight: 650; }
.pay-directly-field input, .pay-directly-field select { width: 100%; min-height: 44px; box-sizing: border-box; padding: 0 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md, 10px); background: var(--ui-bg); color: var(--ui-text); font: inherit; font-size: 14px; font-weight: 400; }
.pay-directly-field small { color: var(--ui-text-muted); font-size: 12px; font-weight: 400; line-height: 1.45; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 480px) { .pay-directly-dialog__grid { grid-template-columns: 1fr; } }
</style>
