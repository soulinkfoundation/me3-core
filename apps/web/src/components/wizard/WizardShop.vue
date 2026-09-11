<script setup lang="ts">
import ProductDeliveryFields from "./ProductDeliveryFields.vue";
import { ref, computed, watch, nextTick } from "vue";
import {
  useWizardStore,
  type WizardContentAsset,
  type WizardProduct,
} from "../../stores/wizard";
import { useSitesStore } from "../../stores/sites";
import { useAuthStore } from "../../stores/auth";
import TiptapEditor from "../TiptapEditor.vue";
import PaymentCollectionFields from "./PaymentCollectionFields.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";
import { productSendsPurchaseConfirmation } from "../../../../../shared/product-purchase-confirmation";

const wizard = useWizardStore();
const sites = useSitesStore();
const auth = useAuthStore();
const { toastError, toastSuccess, toastFromUnknown } = useAppToast();

const selectedProductIndex = ref<number | null>(null);
const editingTitle = ref("");
const editingSlug = ref("");
const routeTouched = ref(false);
const showRouteEditor = ref(false);
const routeInputRef = ref<HTMLInputElement | null>(null);
const editorContent = ref("");
const editorRef = ref<InstanceType<typeof TiptapEditor> | null>(null);

const isSendingConfirmationTest = ref(false);

const selectedProduct = computed(() => {
  if (selectedProductIndex.value === null) return null;
  return wizard.products[selectedProductIndex.value] || null;
});

function slugifyRouteSegment(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

const previewSlug = computed(() => {
  const shouldUseCustomRoute =
    routeTouched.value || Boolean(selectedProduct.value?.slugCustomized);

  if (shouldUseCustomRoute) {
    const customSlug = slugifyRouteSegment(editingSlug.value);
    if (customSlug) return customSlug;
  }

  if (!editingTitle.value.trim()) {
    return selectedProduct.value?.slug || "untitled";
  }

  return slugifyRouteSegment(editingTitle.value) || "untitled";
});

const priceDollars = computed({
  get: () => {
    if (!selectedProduct.value) return 0;
    const cents = Number(selectedProduct.value.price);
    return Number.isFinite(cents) && cents >= 0 ? cents / 100 : 0;
  },
  set: (val: number) => {
    if (selectedProductIndex.value === null) return;
    const dollars = Number(val);
    const cents = Number.isFinite(dollars)
      ? Math.max(0, Math.round(dollars * 100))
      : 0;
    wizard.updateProduct(selectedProductIndex.value, { price: cents });
  },
});

function formatProductPrice(product: WizardProduct): string {
  const cents = Number(product.price);
  const safeCents = Number.isFinite(cents) && cents >= 0 ? cents : 0;
  return `${(safeCents / 100).toFixed(2)} ${product.currency}`;
}

const productCurrency = computed({
  get: () => selectedProduct.value?.currency || "USD",
  set: (
    val: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR",
  ) => {
    if (selectedProductIndex.value === null) return;
    wizard.updateProduct(selectedProductIndex.value, { currency: val });
  },
});

const productAvailable = computed({
  get: () => selectedProduct.value?.available ?? true,
  set: (val: boolean) => {
    if (selectedProductIndex.value === null) return;
    wizard.updateProduct(selectedProductIndex.value, { available: val });
  },
});

const productExcerpt = computed({
  get: () => selectedProduct.value?.excerpt || "",
  set: (val: string) => {
    if (selectedProductIndex.value === null) return;
    wizard.updateProduct(selectedProductIndex.value, { excerpt: val });
  },
});

const confirmationEmailEnabled = computed({
  get: () => Boolean(selectedProduct.value?.confirmationEmail?.enabled),
  set: (val: boolean) => {
    if (selectedProductIndex.value === null) return;
    const cur = selectedProduct.value?.confirmationEmail;
    wizard.updateProduct(selectedProductIndex.value, {
      confirmationEmail: {
        ...cur,
        enabled: val,
      },
    });
  },
});

const confirmationEmailSubject = computed({
  get: () => selectedProduct.value?.confirmationEmail?.subject ?? "",
  set: (val: string) => {
    if (selectedProductIndex.value === null) return;
    const cur = selectedProduct.value?.confirmationEmail;
    wizard.updateProduct(selectedProductIndex.value, {
      confirmationEmail: {
        ...cur,
        subject: val,
      },
    });
  },
});

const confirmationEmailMessage = computed({
  get: () => selectedProduct.value?.confirmationEmail?.message ?? "",
  set: (val: string) => {
    if (selectedProductIndex.value === null) return;
    const cur = selectedProduct.value?.confirmationEmail;
    wizard.updateProduct(selectedProductIndex.value, {
      confirmationEmail: {
        ...cur,
        message: val,
      },
    });
  },
});

const confirmationEmailIncomplete = computed(() => {
  const ce = selectedProduct.value?.confirmationEmail;
  if (!ce?.enabled) return false;
  return !productSendsPurchaseConfirmation(ce);
});

const confirmationTestInbox = computed(() => auth.user?.email?.trim() || "");

const confirmationTestUsername = computed(() => wizard.username.trim());

const confirmationTestTokenPreview = computed(() => {
  const productTitle =
    selectedProduct.value?.title?.trim() ||
    editingTitle.value.trim() ||
    "Product";
  const siteName = wizard.profile.name.trim() || confirmationTestUsername.value;
  const supportEmail = confirmationTestInbox.value || "you@example.com";

  return {
    buyerName: "Test Buyer",
    buyerNote: "Looking forward to this.",
    productTitle,
    siteName,
    supportEmail,
  };
});

const canSendConfirmationTest = computed(
  () =>
    Boolean(confirmationTestInbox.value) &&
    Boolean(confirmationTestUsername.value) &&
    !confirmationEmailIncomplete.value,
);

const canAddMore = computed(() => wizard.products.length < 20);

const selectedProductIsPaid = computed(
  () =>
    Boolean(selectedProduct.value) &&
    productAvailable.value &&
    priceDollars.value > 0,
);

const productPaymentMethod = computed({
  get: () => selectedProduct.value?.paymentMethod ?? "stripe",
  set: (val: WizardProduct["paymentMethod"]) => {
    if (selectedProductIndex.value === null) return;
    wizard.updateProduct(selectedProductIndex.value, { paymentMethod: val });
  },
});

const productPaymentInstructions = computed({
  get: () => selectedProduct.value?.paymentInstructions ?? "",
  set: (val: string) => {
    if (selectedProductIndex.value === null) return;
    wizard.updateProduct(selectedProductIndex.value, {
      paymentInstructions: val,
    });
  },
});

const shopTitle = computed({
  get: () => wizard.shopTitle,
  set: (val: string) => {
    wizard.shopTitle = val;
  },
});

function handleContentAssetAdded(asset: WizardContentAsset) {
  if (selectedProductIndex.value === null) return;
  wizard.addProductContentAsset(selectedProductIndex.value, asset);
}

watch(selectedProductIndex, (newIndex) => {
  if (newIndex !== null && wizard.products[newIndex]) {
    const product = wizard.products[newIndex];
    editingTitle.value = product.title;
    editingSlug.value = product.slug;
    routeTouched.value = false;
    showRouteEditor.value = false;
    editorContent.value = product.content || "";
  }
});

watch(editorContent, (newContent) => {
  if (selectedProductIndex.value !== null) {
    const assetIds = editorRef.value?.getAssetIds() || new Set<string>();
    wizard.updateProduct(selectedProductIndex.value, {
      content: newContent,
    });
    wizard.syncProductContentAssets(selectedProductIndex.value, assetIds);
  }
});

function addNewProduct() {
  const newProduct = wizard.addProduct("New Product");
  if (newProduct) {
    const newIndex = wizard.products.length - 1;
    selectedProductIndex.value = newIndex;
  }
}

function selectProduct(index: number) {
  persistProductMeta();
  selectedProductIndex.value = index;
}

function syncEditingRoute() {
  if (selectedProductIndex.value === null) return;
  const product = wizard.products[selectedProductIndex.value];
  if (!product) return;
  editingSlug.value = product.slug;
  routeTouched.value = false;
}

function persistProductMeta() {
  if (selectedProductIndex.value === null) return;

  const updates: Partial<WizardProduct> = {};
  if (editingTitle.value.trim()) {
    updates.title = editingTitle.value.trim();
  }
  if (routeTouched.value || selectedProduct.value?.slugCustomized) {
    updates.slug = editingSlug.value;
  }
  if (Object.keys(updates).length === 0) return;

  wizard.updateProduct(selectedProductIndex.value, updates);
  syncEditingRoute();
}

function updateProductTitle() {
  persistProductMeta();
}

function updateProductSlug() {
  if (selectedProductIndex.value === null) return;
  const updates: Partial<WizardProduct> = {
    slug: editingSlug.value,
  };
  if (editingTitle.value.trim()) {
    updates.title = editingTitle.value.trim();
  }
  wizard.updateProduct(selectedProductIndex.value, updates);
  syncEditingRoute();
}

async function openRouteEditor() {
  showRouteEditor.value = true;
  await nextTick();
  routeInputRef.value?.focus();
  routeInputRef.value?.select();
}

function closeRouteEditor() {
  showRouteEditor.value = false;
}

function handleRouteBlur() {
  updateProductSlug();
  closeRouteEditor();
}

function cancelRouteEdit() {
  syncEditingRoute();
  closeRouteEditor();
}

function deleteProduct(index: number) {
  if (!confirm("Delete this product?")) return;

  wizard.removeProduct(index);

  if (selectedProductIndex.value === index) {
    selectedProductIndex.value = wizard.products.length > 0 ? 0 : null;
  } else if (
    selectedProductIndex.value !== null &&
    selectedProductIndex.value > index
  ) {
    selectedProductIndex.value--;
  }
}

function closeEditor() {
  persistProductMeta();
  editorRef.value?.flushPendingAssets?.();
  selectedProductIndex.value = null;
}

async function sendConfirmationEmailTest() {
  if (isSendingConfirmationTest.value) return;

  const product = selectedProduct.value;
  if (!product) return;

  const siteUsername = confirmationTestUsername.value;
  if (!siteUsername) {
    toastError("Claim your username before sending a test email.");
    return;
  }

  if (!confirmationTestInbox.value) {
    toastError("Sign in to send a test email.");
    return;
  }

  if (!productSendsPurchaseConfirmation(product.confirmationEmail)) {
    toastError("Add both a subject and message before sending a test email.");
    return;
  }

  isSendingConfirmationTest.value = true;

  try {
    const response = await sites.sendProductConfirmationTest(siteUsername, {
      productSlug: previewSlug.value,
      productTitle:
        product.title.trim() || editingTitle.value.trim() || "Product",
      siteName: wizard.profile.name.trim() || siteUsername,
      subject: product.confirmationEmail.subject.trim(),
      message: product.confirmationEmail.message.trim(),
    });

    toastSuccess(`Test email sent to ${response.sentTo}.`);
  } catch (error) {
    toastFromUnknown(error, "Failed to send test email");
  } finally {
    isSendingConfirmationTest.value = false;
  }
}

const isEditingProduct = computed(() => selectedProductIndex.value !== null);

defineExpose({
  isEditingProduct,
});
</script>

<template>
  <div class="step-shop">
    <h2>Products</h2>

    <div v-if="!isEditingProduct" class="shop-menu-title">
      <label class="shop-menu-title-label" for="shop-menu-title-input">
        Main menu title
      </label>
      <input
        id="shop-menu-title-input"
        v-model="shopTitle"
        type="text"
        class="shop-menu-title-input"
        placeholder="Products"
        maxlength="40"
      />
      <p class="shop-menu-title-hint">URL path: /{{ wizard.shopPath }}</p>
    </div>

    <!-- Product list -->
    <div
      v-if="wizard.products.length > 0 && selectedProductIndex === null"
      class="product-list"
    >
      <div
        v-for="(product, index) in wizard.products"
        :key="product.slug"
        class="product-item"
      >
        <div class="product-header">
          <span class="product-icon" aria-hidden="true">
            <UiIcon name="ShoppingCart" :size="18" />
          </span>
          <div class="product-details">
            <span class="product-title">{{ product.title }}</span>
            <span class="product-meta">
              {{ formatProductPrice(product) }}
            </span>
          </div>
          <span v-if="!product.available" class="product-tag">Unavailable</span>
        </div>
        <div class="product-actions">
          <button
            class="action-btn edit-btn"
            type="button"
            title="Edit product"
            @click="selectProduct(index)"
          >
            <UiIcon name="Pencil" :size="16" />
          </button>
          <button
            class="action-btn remove-btn"
            type="button"
            title="Delete product"
            @click="deleteProduct(index)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="selectedProductIndex === null && canAddMore"
      class="add-products"
    >
      <button class="add-btn" type="button" @click="addNewProduct">
        + Add product
      </button>
    </div>

    <!-- Editor view -->
    <div
      v-if="selectedProductIndex !== null && selectedProduct"
      class="editor-view"
    >
      <div class="editor-form">
        <div class="form-group">
          <label for="shop-title-input">Product title</label>
          <input
            id="shop-title-input"
            v-model="editingTitle"
            type="text"
            placeholder="e.g. Handmade print"
            maxlength="80"
            @blur="updateProductTitle"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
        </div>
        <div class="route-row">
          <template v-if="showRouteEditor">
            <span class="slug-preview">URL: /{{ wizard.shopPath }}/</span>
            <input
              id="shop-route-input"
              ref="routeInputRef"
              v-model="editingSlug"
              class="route-inline-input"
              type="text"
              inputmode="url"
              placeholder="handmade-print"
              maxlength="50"
              @input="routeTouched = true"
              @blur="handleRouteBlur"
              @keydown.esc.prevent="cancelRouteEdit"
              @keyup.enter="($event.target as HTMLInputElement).blur()"
            />
          </template>
          <template v-else>
            <span class="slug-preview"
              >URL: /{{ wizard.shopPath }}/{{ previewSlug }}</span
            >
            <button
              class="route-edit-btn"
              type="button"
              @click="openRouteEditor"
            >
              <UiIcon name="Pencil" :size="14" />
              <span>Edit</span>
            </button>
          </template>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label>Price</label>
            <input
              v-model.number="priceDollars"
              type="number"
              min="0"
              step="0.01"
            />
          </div>
          <div class="form-group">
            <label>Currency</label>
            <select v-model="productCurrency">
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
              <option value="CAD">CAD</option>
              <option value="AUD">AUD</option>
              <option value="CHF">CHF</option>
              <option value="SGD">SGD</option>
              <option value="INR">INR</option>
              <option value="PKR">PKR</option>
            </select>
          </div>
        </div>

        <PaymentCollectionFields
          v-if="selectedProductIsPaid"
          v-model="productPaymentMethod"
          v-model:instructions="productPaymentInstructions"
          :input-id="`product-${selectedProduct.slug}`"
        />

        <div class="form-group">
          <label>Short description</label>
          <input
            v-model="productExcerpt"
            type="text"
            placeholder="Optional short summary"
            maxlength="160"
          />
        </div>

        <div class="toggle-row">
          <label class="toggle">
            <input type="checkbox" v-model="productAvailable" />
            <span class="toggle-ui" />
          </label>
          <span>Available for purchase</span>
        </div>

        <ProductDeliveryFields :model-value="selectedProduct.delivery" @update:model-value="wizard.updateProduct(selectedProductIndex, { delivery: $event })" />

        <div class="confirmation-email-section">
          <h3 class="confirmation-email-title">Customer email</h3>
          <p class="confirmation-email-lead">
            {{
              productPaymentMethod === "manual"
                ? "ME3 sends the payment instructions above after the request is confirmed. Add an optional message if you need to include other next steps."
                : "Buyers receive a standard order confirmation after payment. Add a custom message if needed."
            }}
          </p>
          <div class="toggle-row">
            <label class="toggle">
              <input type="checkbox" v-model="confirmationEmailEnabled" />
              <span class="toggle-ui" />
            </label>
            <span>
              {{
                productPaymentMethod === "manual"
                  ? "Add a message to the payment email"
                  : "Customize the confirmation email"
              }}
            </span>
          </div>
          <template v-if="confirmationEmailEnabled">
            <p
              v-if="confirmationEmailIncomplete"
              class="confirmation-email-warn"
            >
              Add both a subject and a message, or turn this off — publishing is
              blocked until this is complete.
            </p>
            <div class="form-group">
              <label for="product-confirmation-subject">Email subject</label>
              <input
                id="product-confirmation-subject"
                v-model="confirmationEmailSubject"
                type="text"
                maxlength="200"
                placeholder="e.g. Your download + next steps"
                autocomplete="off"
              />
            </div>
            <div class="form-group">
              <label for="product-confirmation-message">Email message</label>
              <textarea
                id="product-confirmation-message"
                v-model="confirmationEmailMessage"
                class="confirmation-email-textarea"
                rows="8"
                maxlength="8000"
                placeholder="Plain text with links. You can use placeholders in either field."
              ></textarea>
            </div>
            <div class="confirmation-email-actions">
              <button
                class="suggest-btn suggest-btn--compact"
                type="button"
                :disabled="
                  isSendingConfirmationTest || !canSendConfirmationTest
                "
                @click="sendConfirmationEmailTest"
              >
                {{ isSendingConfirmationTest ? "Sending…" : "Send test email" }}
              </button>
              <p class="confirmation-email-test-note">
                {{
                  !confirmationTestInbox
                    ? "Sign in to send a test."
                    : !confirmationTestUsername
                      ? "Claim your username first."
                      : `Sends to ${confirmationTestInbox}.`
                }}
                Test values:
                <code>{{ confirmationTestTokenPreview.buyerName }}</code
                >,
                <code>{{ confirmationTestTokenPreview.buyerNote }}</code>
              </p>
            </div>
            <p class="confirmation-email-tokens" v-pre>
              Placeholders:
              <code>{{ buyerName }}</code
              >, <code>{{ buyerNote }}</code
              >, <code>{{ productTitle }}</code
              >, <code>{{ siteName }}</code
              >,
              <code>{{ supportEmail }}</code>
            </p>
          </template>
        </div>

        <TiptapEditor
          ref="editorRef"
          v-model="editorContent"
          placeholder="Write your product description..."
          @asset-added="handleContentAssetAdded"
        />
      </div>

      <div class="editor-nav">
        <button class="editor-back-btn" @click="closeEditor">
          ← Back to offerings
        </button>
      </div>
    </div>

    <p
      v-if="
        wizard.products.length === 0 &&
        selectedProductIndex === null
      "
      class="empty-hint"
    >
      No products yet. Add your first item to start selling.
    </p>

    <p v-if="!canAddMore && selectedProductIndex === null" class="max-hint">
      Maximum 20 products reached.
    </p>
  </div>
</template>

<style scoped>
.step-shop h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.shop-menu-title {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 320px;
  margin-bottom: 20px;
}

.shop-menu-title-label {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  font-weight: 600;
}

.shop-menu-title-input {
  width: 100%;
  border: 2px solid var(--ui-border, var(--color-border));
  border-radius: 10px;
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  padding: 10px 12px;
}

.shop-menu-title-input:focus {
  outline: 2px solid var(--ui-accent, var(--color-primary));
  outline-offset: 1px;
}

.shop-menu-title-hint {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.suggest-btn {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 14px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.suggest-btn:hover:not(:disabled) {
  border-color: var(--color-text);
  transform: translateY(-1px);
}

.suggest-btn:disabled {
  opacity: 0.7;
  cursor: progress;
}

.suggest-btn--compact {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
}

.product-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.product-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg);
}

.product-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.product-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-border);
  color: var(--color-text);
}

.product-details {
  display: flex;
  flex-direction: column;
}

.product-title {
  font-weight: 600;
  font-size: 15px;
}

.product-meta {
  font-size: 12px;
  color: var(--color-text-muted);
}

.product-tag {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--color-border);
}

.product-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--color-text-muted);
}

.action-btn:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.add-products {
  margin-bottom: 20px;
}

.add-btn {
  background: var(--color-text);
  color: var(--color-bg);
  border: none;
  padding: 10px 16px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
}

.editor-view {
  margin-top: 16px;
}

.editor-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group input,
.form-group select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 2px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.slug-preview {
  font-size: 12px;
  color: var(--color-text-muted);
}

.route-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  margin-top: -2px;
}

.route-inline-input {
  min-width: 0;
  width: min(260px, 100%);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
}

.route-inline-input:focus {
  outline: none;
  border-color: var(--color-text);
}

.route-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  padding: 4px 0;
  font-size: 12px;
  cursor: pointer;
}

.route-edit-btn:hover {
  color: var(--color-text);
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-ui {
  width: 42px;
  height: 22px;
  background: var(--color-border);
  border-radius: 999px;
  position: relative;
  transition: background 0.2s ease;
}

.toggle-ui::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--color-bg);
  transition: transform 0.2s ease;
}

.toggle input:checked + .toggle-ui {
  background: var(--color-text);
}

.toggle input:checked + .toggle-ui::after {
  transform: translateX(20px);
}

.editor-nav {
  margin-top: 16px;
}

.editor-back-btn {
  background: none;
  border: none;
  color: var(--color-text);
  cursor: pointer;
  font-weight: 600;
}

.empty-hint,
.max-hint {
  color: var(--color-text-muted);
  font-size: 13px;
  margin-top: 8px;
}

.confirmation-email-section {
  padding: 14px 16px;
  border-radius: 12px;
  border: 2px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.confirmation-email-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.confirmation-email-lead {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.confirmation-email-warn {
  margin: 0;
  font-size: 13px;
  color: #b45309;
  line-height: 1.45;
}

.confirmation-email-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 2px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  line-height: 1.5;
  resize: vertical;
  min-height: 120px;
}

.confirmation-email-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.confirmation-email-test-note {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.confirmation-email-test-note code {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.confirmation-email-tokens {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.confirmation-email-tokens code {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}
</style>
