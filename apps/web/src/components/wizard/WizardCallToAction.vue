<script setup lang="ts">
import { ref, computed } from "vue";
import draggable from "vuedraggable";
import { useWizardStore, type Me3Button } from "../../stores/wizard";
import UiIcon from "../UiIcon.vue";
import IconPicker from "../IconPicker.vue";
import { isUiIconName, type UiIconName } from "../../utils/icons";
import { normalizeCtaUrl } from "../../utils/cta-url";

const wizard = useWizardStore();

// ============================================================================
// Buttons Config
// ============================================================================
const suggestions: Array<{ icon: UiIconName; text: string; hint: string }> = [
  { icon: "ShoppingCart", text: "View Shop", hint: "etsy.com, gumroad.com" },
  {
    icon: "GraduationCap",
    text: "Join My Course",
    hint: "teachable.com, thinkific.com",
  },
  { icon: "Infinity", text: "Join Community", hint: "circle.so, skool.com" },
];

// Form state
const showForm = ref(false);
const editIndex = ref<number | null>(null);
const buttonText = ref("");
const buttonUrl = ref("");
const buttonIcon = ref("");
const buttonStyle = ref<"primary" | "secondary" | "outline">("primary");
const formError = ref("");

// Dynamic placeholder based on button type
const urlPlaceholder = computed(() => {
  const text = buttonText.value.toLowerCase();
  if (text.includes("shop")) {
    return "https://etsy.com/shop/yourshop";
  } else if (text.includes("donate")) {
    return "https://gofundme.com/f/campaign";
  } else if (text.includes("course") || text.includes("enroll")) {
    return "https://yoursite.teachable.com/courses/your-course";
  } else if (text.includes("community")) {
    return "https://soulinkfoundation.org/community";
  }
  return "https://example.com";
});

function openForm(suggestion?: { text: string; icon: UiIconName }) {
  buttonText.value = suggestion?.text || "";
  buttonIcon.value = suggestion?.icon || "";
  buttonUrl.value = "";
  buttonStyle.value = "primary";
  editIndex.value = null;
  formError.value = "";
  showForm.value = true;
}

function editButton(index: number) {
  const button = wizard.profile.buttons[index];
  buttonText.value = button.text;
  buttonIcon.value = button.icon || "";
  buttonUrl.value = button.url;
  buttonStyle.value = button.style || "primary";
  editIndex.value = index;
  formError.value = "";
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  buttonText.value = "";
  buttonIcon.value = "";
  buttonUrl.value = "";
  buttonStyle.value = "primary";
  editIndex.value = null;
  formError.value = "";
}

function saveButton() {
  if (!buttonText.value.trim()) {
    formError.value = "Button text is required";
    return;
  }
  if (!buttonUrl.value.trim()) {
    formError.value = "URL is required";
    return;
  }

  const url = normalizeCtaUrl(buttonUrl.value);
  if (!url) {
    formError.value =
      "Use an https:// URL, /page path, #section, mailto:, or tel: link";
    return;
  }

  const button: Me3Button = {
    text: buttonText.value.trim(),
    url,
    style: buttonStyle.value,
  };

  // Add icon if provided
  if (buttonIcon.value.trim()) {
    button.icon = buttonIcon.value.trim();
  }

  if (editIndex.value !== null) {
    wizard.updateButton(editIndex.value, button);
  } else {
    wizard.addButton(button);
  }

  closeForm();
}

function deleteButton(index: number) {
  wizard.removeButton(index);
}

function testButton(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

const buttonsList = computed(() => wizard.profile.buttons);

const dragOptions = {
  animation: 200,
  handle: ".drag-handle",
  ghostClass: "ghost",
};

function onButtonsDragEnd() {
  wizard.setButtons([...wizard.profile.buttons]);
}

function buttonItemKey(button: Me3Button) {
  return `${button.url}\0${button.text}\0${button.style ?? "primary"}\0${button.icon ?? ""}`;
}

</script>

<template>
  <div class="step-cta">
    <h2>Add call-to-action buttons</h2>
    <p class="section-desc">Prominent buttons for anything important.</p>

    <!-- Current buttons -->
    <draggable
      v-if="wizard.profile.buttons.length > 0"
      :list="buttonsList"
      :item-key="buttonItemKey"
      v-bind="dragOptions"
      class="buttons-list"
      @end="onButtonsDragEnd"
    >
      <template #item="{ element: button, index }">
        <div class="button-item">
          <div class="button-header">
            <button
              class="drag-handle"
              type="button"
              title="Drag to reorder"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"
                  stroke-linecap="round"
                />
              </svg>
            </button>

          <span class="button-icon" v-if="button.icon" aria-hidden="true">
            <UiIcon
              v-if="isUiIconName(button.icon)"
              :name="button.icon"
              :size="20"
            />
            <span v-else class="emoji-icon">{{ button.icon }}</span>
          </span>
          <span class="button-icon placeholder-icon" v-else>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            </svg>
          </span>

          <span class="button-label">{{ button.text }}</span>

          <div class="button-actions">
            <button
              class="action-btn test-btn"
              type="button"
              title="Test link"
              @click="testButton(button.url)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
            <button
              class="action-btn remove-btn"
              type="button"
              title="Remove"
              @click="deleteButton(index)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div class="button-input-wrapper">
          <span class="input-preview" :class="button.style || 'primary'">
            <span v-if="button.icon" class="preview-icon" aria-hidden="true">
              <UiIcon
                v-if="isUiIconName(button.icon)"
                :name="button.icon"
                :size="14"
              />
              <span v-else>{{ button.icon }}</span>
            </span>
            {{ button.text }}
          </span>
          <input
            :value="button.url"
            readonly
            class="button-url-input"
            @click="editButton(index)"
          />
        </div>
        </div>
      </template>
    </draggable>

    <!-- Add button suggestions -->
    <div class="add-buttons">
      <p class="add-label">Add a button</p>
      <div class="platform-buttons">
        <button
          v-for="s in suggestions"
          :key="s.text"
          class="platform-btn"
          type="button"
          @click="openForm(s)"
        >
          <span class="platform-btn-icon" aria-hidden="true">
            <UiIcon :name="s.icon" :size="16" />
          </span>
          <span class="platform-btn-label">{{ s.text }}</span>
        </button>
        <button class="platform-btn more-btn" type="button" @click="openForm()">
          <span class="platform-btn-icon">
            <UiIcon name="Pencil" :size="16" aria-hidden="true" />
          </span>
          <span class="platform-btn-label">Custom</span>
        </button>
      </div>
    </div>

    <!-- Button Form Modal -->
    <div v-if="showForm" class="modal-overlay" @click.self="closeForm">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editIndex !== null ? "Edit button" : "Add a button" }}</h3>
          <button class="modal-close" type="button" @click="closeForm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal-content">
          <div class="form-group">
            <label>Button text</label>
            <input
              v-model="buttonText"
              type="text"
              placeholder="e.g. Shop"
              maxlength="30"
              @keyup.enter="saveButton"
            />
          </div>

          <div class="form-group">
            <label>Icon <span class="optional">(optional)</span></label>
            <div class="icon-picker-row">
              <IconPicker v-model="buttonIcon" />
              <span class="icon-picker-hint">Choose an icon or emoji</span>
            </div>
          </div>

          <div class="form-group">
            <label>Link URL</label>
            <input
              v-model="buttonUrl"
              type="text"
              inputmode="url"
              :placeholder="urlPlaceholder"
              @keyup.enter="saveButton"
            />
            <p class="url-hint">Use /about or #section for an internal link that stays in this tab.</p>
          </div>

          <div class="form-group">
            <label>Button style</label>
            <div class="style-options">
              <label
                class="style-option"
                :class="{ selected: buttonStyle === 'primary' }"
              >
                <input type="radio" v-model="buttonStyle" value="primary" />
                <span class="style-preview primary">Primary</span>
              </label>
              <label
                class="style-option"
                :class="{ selected: buttonStyle === 'secondary' }"
              >
                <input type="radio" v-model="buttonStyle" value="secondary" />
                <span class="style-preview secondary">Secondary</span>
              </label>
              <label
                class="style-option"
                :class="{ selected: buttonStyle === 'outline' }"
              >
                <input type="radio" v-model="buttonStyle" value="outline" />
                <span class="style-preview outline">Outline</span>
              </label>
            </div>
          </div>

          <p v-if="formError" class="form-error">{{ formError }}</p>
        </div>

        <div class="modal-footer">
          <button class="btn secondary" type="button" @click="closeForm">
            Cancel
          </button>
          <button class="btn primary" type="button" @click="saveButton">
            {{ editIndex !== null ? "Save changes" : "Add button" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-cta h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.section-desc {
  color: var(--color-text-muted);
  font-size: 14px;
  margin-bottom: 16px;
}

.limit-hint {
  font-size: 13px;
}

/* Gift Card */
.gift-card {
  background: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 20px;
}

.gift-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.gift-card-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gift-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--color-border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.gift-text {
  display: flex;
  flex-direction: column;
}

.gift-title {
  font-weight: 600;
  font-size: 15px;
}

.gift-desc {
  font-size: 13px;
  color: var(--color-text-muted);
}

.gift-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gift-connect-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s;
}

.gift-connect-btn:hover:not(:disabled) {
  background: var(--color-border);
  border-color: var(--color-text-muted);
}

.gift-connect-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.gift-disconnect-btn {
  border: 1px solid var(--color-text-muted);
  background: transparent;
  color: var(--color-text-muted);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.gift-disconnect-btn:hover:not(:disabled) {
  border-color: #ef4444;
  color: #ef4444;
}

.gift-disconnect-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.gift-toggle {
  position: relative;
  display: inline-flex;
  width: 44px;
  height: 24px;
  align-items: center;
}

.gift-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.gift-toggle-ui {
  width: 100%;
  height: 100%;
  background: var(--color-border);
  border-radius: 999px;
  position: relative;
  transition: background 0.2s;
}

.gift-toggle-ui::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: var(--color-bg);
  border-radius: 50%;
  transition: transform 0.2s;
}

.gift-toggle input:checked + .gift-toggle-ui {
  background: var(--color-text);
}

.gift-toggle input:checked + .gift-toggle-ui::after {
  transform: translateX(20px);
}

.gift-toggle.disabled {
  opacity: 0.5;
}

.gift-country-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.gift-country-field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
}

.gift-country-field select {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
}

.gift-hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.gift-settings {
  margin-top: 16px;
}

.gift-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 120px);
  gap: 12px;
}

/* Buttons List */
.buttons-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.button-item {
  background: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: 12px;
  padding: 12px 16px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.button-item:hover {
  border-color: var(--color-text-muted);
}

.button-item.ghost {
  opacity: 0.5;
  background: var(--color-border);
}

.drag-handle {
  cursor: grab;
  padding: 4px;
  color: var(--color-text-muted);
  background: none;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle svg {
  width: 16px;
  height: 16px;
}

.button-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.button-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
}

.button-icon .emoji-icon {
  font-size: 18px;
}

.button-icon.placeholder-icon {
  color: var(--color-text-muted);
}

.button-icon.placeholder-icon svg {
  width: 20px;
  height: 20px;
}

.button-label {
  flex: 1;
  font-weight: 500;
  font-size: 15px;
}

.button-actions {
  display: flex;
  gap: 4px;
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
  transition:
    background 0.2s,
    color 0.2s;
}

.action-btn:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.action-btn.remove-btn:hover {
  color: #ef4444;
}

.action-btn svg {
  width: 16px;
  height: 16px;
}

.button-input-wrapper {
  display: flex;
  align-items: center;
  position: relative;
}

.input-preview {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 10px 12px;
  background: var(--color-border);
  border-radius: 8px 0 0 8px;
  white-space: nowrap;
  color: var(--color-text);
}

.input-preview.primary {
  background: var(--color-text);
  color: var(--color-bg);
}

.input-preview.secondary {
  border: 1px solid var(--color-text);
  background: var(--color-bg);
  color: var(--color-text);
}

.input-preview.outline {
  background: transparent;
  border: 2px solid var(--color-text);
  border-right: none;
  color: var(--color-text);
}

.input-preview .preview-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
}

.button-url-input {
  flex: 1;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 0 8px 8px 0;
  border-left: none;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.2s;
}

.button-url-input:hover {
  border-color: var(--color-text-muted);
}

.button-url-input:focus {
  outline: none;
  border-color: var(--color-text);
}

/* Add Buttons */
.add-buttons {
  margin-bottom: 20px;
}

.add-label {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-bottom: 10px;
  font-weight: 500;
}

.platform-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.platform-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-border);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text);
  transition:
    background 0.2s,
    transform 0.1s;
}

.platform-btn:hover {
  background: var(--color-text-muted);
  color: var(--color-bg);
}

.platform-btn:active {
  transform: scale(0.98);
}

.platform-btn-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.platform-btn.more-btn {
  background: transparent;
  border: 2px dashed var(--color-border);
}

.platform-btn.more-btn:hover {
  border-color: var(--color-text-muted);
  background: var(--color-border);
  color: var(--color-text);
}

.max-reached {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
  padding: 16px;
  background: var(--color-border);
  border-radius: 8px;
  margin-bottom: 20px;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal {
  background: var(--color-bg);
  border-radius: 16px;
  width: 100%;
  max-width: 440px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h3 {
  font-size: 18px;
  font-weight: 600;
}

.modal-close {
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

.modal-close:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.modal-close svg {
  width: 18px;
  height: 18px;
}

.modal-content {
  padding: 24px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
}

.btn {
  flex: 1;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background 0.2s,
    transform 0.1s;
}

.btn:active {
  transform: scale(0.98);
}

.btn.primary {
  background: var(--color-text);
  color: var(--color-bg);
  border: none;
}

.btn.primary:hover {
  opacity: 0.9;
}

.btn.secondary {
  background: var(--color-border);
  color: var(--color-text);
  border: none;
}

.btn.secondary:hover {
  background: var(--color-text-muted);
  color: var(--color-bg);
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.form-group input[type="text"],
.form-group input[type="url"],
.form-group input[type="number"],
.form-group select {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-text);
}

.optional {
  font-weight: 400;
  color: var(--color-text-muted);
}

/* Style Options */
.style-options {
  display: flex;
  gap: 8px;
}

.style-option {
  flex: 1;
  cursor: pointer;
}

.style-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.style-preview {
  display: block;
  text-align: center;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  transition:
    transform 0.1s,
    box-shadow 0.2s;
}

.style-option:hover .style-preview {
  transform: translateY(-1px);
}

.style-option.selected .style-preview {
  box-shadow: 0 0 0 2px var(--color-text);
}

.style-preview.primary {
  background: var(--color-text);
  color: var(--color-bg);
}

.style-preview.secondary {
  border: 1px solid var(--color-text);
  background: var(--color-bg);
  color: var(--color-text);
}

.style-preview.outline {
  background: transparent;
  border: 2px solid var(--color-text);
  color: var(--color-text);
}

.form-error {
  font-size: 13px;
  color: #ef4444;
  margin-top: 16px;
}

.url-hint {
  margin: -4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.icon-picker-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-picker-hint {
  font-size: 13px;
  color: var(--color-text-muted);
}
</style>
