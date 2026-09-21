<script setup lang="ts">
import { ref, computed } from "vue";
import { useWizardStore, type WizardTestimonial } from "../../stores/wizard";
import TestimonialCard from "../TestimonialCard.vue";
import UiIcon from "../UiIcon.vue";

const wizard = useWizardStore();

const showForm = ref(false);
const editIndex = ref<number | null>(null);
const formError = ref("");

const name = ref("");
const quote = ref("");
const handle = ref("");
/** External image URL (not used when a file is pending). */
const avatarUrl = ref("");
/** Object URL for pending or in-session uploaded file preview. */
const avatarObjectUrl = ref<string | null>(null);
const avatarBlobPending = ref<Blob | null>(null);
const profileUrl = ref("");

const avatarInput = ref<HTMLInputElement | null>(null);

const avatarPreviewSrc = computed(() => {
  if (avatarObjectUrl.value) return avatarObjectUrl.value;
  const u = avatarUrl.value.trim();
  return u || "";
});

function revokeAvatarObjectUrl() {
  if (avatarObjectUrl.value) {
    URL.revokeObjectURL(avatarObjectUrl.value);
    avatarObjectUrl.value = null;
  }
}

const testimonialsTitle = computed({
  get: () => wizard.testimonialsTitle,
  set: (val: string) => {
    wizard.testimonialsTitle = val;
  },
});

const canAddMore = computed(() => true);
function openForm() {
  name.value = "";
  quote.value = "";
  handle.value = "";
  revokeAvatarObjectUrl();
  avatarUrl.value = "";
  avatarBlobPending.value = null;
  profileUrl.value = "";
  editIndex.value = null;
  formError.value = "";
  showForm.value = true;
}

function editTestimonial(index: number) {
  const testimonial = wizard.testimonials[index];
  if (!testimonial) return;
  name.value = testimonial.name || "";
  quote.value = testimonial.quote || "";
  handle.value = testimonial.handle || "";
  revokeAvatarObjectUrl();
  avatarBlobPending.value = testimonial.avatarBlob ?? null;
  if (avatarBlobPending.value) {
    avatarObjectUrl.value = URL.createObjectURL(avatarBlobPending.value);
    avatarUrl.value = "";
  } else {
    avatarUrl.value = testimonial.avatar || "";
  }
  profileUrl.value = testimonial.profileUrl || "";
  editIndex.value = index;
  formError.value = "";
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  formError.value = "";
  revokeAvatarObjectUrl();
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function validateUrl(value: string, label: string): boolean {
  if (!value || value.startsWith("data:")) return true;
  try {
    new URL(value);
    return true;
  } catch {
    formError.value = `${label} must be a valid URL`;
    return false;
  }
}

function saveTestimonial() {
  if (!name.value.trim()) {
    formError.value = "Name is required";
    return;
  }
  if (!quote.value.trim()) {
    formError.value = "Quote is required";
    return;
  }

  const cleanedHandle = handle.value.trim().replace(/^@/, "");
  const normalizedProfileUrl = normalizeUrl(profileUrl.value);

  if (!validateUrl(normalizedProfileUrl, "Profile URL")) return;

  const testimonial: WizardTestimonial = {
    name: name.value.trim(),
    quote: quote.value.trim(),
  };

  if (cleanedHandle) {
    testimonial.handle = cleanedHandle;
  }

  if (avatarBlobPending.value && avatarObjectUrl.value) {
    testimonial.avatar = avatarObjectUrl.value;
    testimonial.avatarBlob = avatarBlobPending.value;
  } else if (avatarUrl.value.trim()) {
    const normalizedAvatar = normalizeUrl(avatarUrl.value.trim());
    if (normalizedAvatar.startsWith("data:")) {
      formError.value =
        "Use Upload for image files instead of pasting a data URL";
      return;
    }
    if (!validateUrl(normalizedAvatar, "Avatar URL")) return;
    testimonial.avatar = normalizedAvatar;
    testimonial.avatarBlob = null;
  } else {
    testimonial.avatarBlob = null;
    testimonial.avatar = undefined;
  }

  if (normalizedProfileUrl) {
    testimonial.profileUrl = normalizedProfileUrl;
  }

  if (editIndex.value !== null) {
    wizard.updateTestimonial(editIndex.value, testimonial);
  } else {
    wizard.addTestimonial(testimonial);
  }

  // If the avatar is a blob: URL stored on the testimonial, do not revoke it here.
  // closeForm() would revoke the same URL and break the generated preview / list.
  const keptBlobObjectUrl = Boolean(
    avatarBlobPending.value &&
      avatarObjectUrl.value &&
      testimonial.avatar === avatarObjectUrl.value,
  );
  showForm.value = false;
  formError.value = "";
  if (keptBlobObjectUrl) {
    avatarObjectUrl.value = null;
    avatarBlobPending.value = null;
  } else {
    revokeAvatarObjectUrl();
    avatarBlobPending.value = null;
  }
}

function removeTestimonial(index: number) {
  wizard.removeTestimonial(index);
}

function triggerAvatarUpload() {
  avatarInput.value?.click();
}

function handleAvatarUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  revokeAvatarObjectUrl();
  avatarBlobPending.value = file;
  avatarObjectUrl.value = URL.createObjectURL(file);
  avatarUrl.value = "";
  input.value = "";
}

function clearAvatar() {
  revokeAvatarObjectUrl();
  avatarBlobPending.value = null;
  avatarUrl.value = "";
  if (avatarInput.value) {
    avatarInput.value.value = "";
  }
}
</script>

<template>
  <div class="step-testimonials">
    <h2>Add testimonials</h2>
    <p class="section-desc">
      Short quotes from clients or collaborators build trust fast.
      <span class="limit-hint">(No limit)</span>
    </p>

    <div class="title-row">
      <label for="testimonial-title">Section title</label>
      <input
        id="testimonial-title"
        v-model="testimonialsTitle"
        type="text"
        placeholder="Testimonials"
        maxlength="80"
      />
      <p class="title-hint">
        Shown on the testimonials section and page.
      </p>
    </div>

    <div v-if="wizard.testimonials.length > 0" class="testimonial-list">
      <div
        v-for="(testimonial, index) in wizard.testimonials"
        :key="index"
        class="testimonial-item"
      >
        <div class="testimonial-preview">
          <TestimonialCard
            :name="testimonial.name"
            :handle="testimonial.handle"
            :avatar="testimonial.avatar"
            :quote="testimonial.quote"
            :profile-url="testimonial.profileUrl"
          />
        </div>
        <div class="testimonial-actions">
          <button
            class="action-btn"
            type="button"
            title="Edit testimonial"
            @click="editTestimonial(index)"
          >
            <UiIcon name="Pencil" :size="16" />
          </button>
          <button
            class="action-btn remove-btn"
            type="button"
            title="Remove testimonial"
            @click="removeTestimonial(index)"
          >
            <UiIcon name="Trash2" :size="16" />
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      No testimonials yet. Add your first one.
    </div>

    <div class="add-row">
      <button
        v-if="canAddMore"
        class="btn primary"
        type="button"
        @click="openForm"
      >
        Add testimonial
      </button>
    </div>

    <!-- Testimonial Form Modal -->
    <div v-if="showForm" class="modal-overlay" @click.self="closeForm">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editIndex !== null ? "Edit testimonial" : "Add testimonial" }}</h3>
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
            <label>Name</label>
            <input v-model="name" type="text" placeholder="Jordan Lee" />
          </div>

          <div class="form-group">
            <label>Quote</label>
            <textarea
              v-model="quote"
              rows="4"
              placeholder="A short quote about working with you..."
            ></textarea>
          </div>

          <div class="form-group">
            <label>Avatar <span class="optional">(optional)</span></label>
            <div class="avatar-row">
              <input
                v-model="avatarUrl"
                type="url"
                placeholder="https://example.com/avatar.jpg"
              />
              <button class="btn secondary" type="button" @click="triggerAvatarUpload">
                Upload
              </button>
              <input
                ref="avatarInput"
                type="file"
                accept="image/*"
                class="hidden-input"
                @change="handleAvatarUpload"
              />
            </div>
            <div v-if="avatarPreviewSrc" class="avatar-preview">
              <img :src="avatarPreviewSrc" alt="" />
              <button class="text-btn" type="button" @click="clearAvatar">
                Remove
              </button>
            </div>
          </div>

          <div class="form-group">
            <label>Handle <span class="optional">(optional)</span></label>
            <input v-model="handle" type="text" placeholder="@handle" />
          </div>

          <div class="form-group">
            <label>Profile URL <span class="optional">(optional)</span></label>
            <input
              v-model="profileUrl"
              type="url"
              placeholder="https://example.com"
            />
          </div>

          <p v-if="formError" class="form-error">{{ formError }}</p>
        </div>

        <div class="modal-footer">
          <button class="btn secondary" type="button" @click="closeForm">
            Cancel
          </button>
          <button class="btn primary" type="button" @click="saveTestimonial">
            {{ editIndex !== null ? "Save changes" : "Add testimonial" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-testimonials h2 {
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

.title-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.title-row label {
  font-size: 13px;
  font-weight: 600;
}

.title-row input {
  max-width: 320px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 14px;
}

.title-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}

.testimonial-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.testimonial-item {
  border: 2px solid var(--color-border);
  border-radius: 12px;
  padding: 12px;
  background: var(--color-bg);
}

.testimonial-preview :deep(.testimonial-card) {
  max-width: 100%;
  box-shadow: none;
}

.testimonial-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--color-border);
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text);
  transition: background 0.2s, color 0.2s;
}

.action-btn:hover {
  background: var(--color-text);
  color: var(--color-bg);
}

.action-btn.remove-btn:hover {
  background: #ef4444;
  color: #fff;
}

.empty-state {
  color: var(--color-text-muted);
  font-style: italic;
  margin-bottom: 16px;
}

.add-row {
  margin-bottom: 20px;
}

.placement-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.placement-row select {
  max-width: 220px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
}

.placement-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  background: var(--color-bg);
  border-radius: 16px;
  padding: 20px;
  width: min(520px, 92vw);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
}

.modal-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  display: block;
  margin-bottom: 6px;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  font-size: 14px;
}

.form-group textarea {
  resize: vertical;
}

.optional {
  color: var(--color-text-muted);
  font-weight: 400;
  font-size: 12px;
}

.form-error {
  color: #ef4444;
  font-size: 13px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.btn {
  padding: 10px 14px;
  border-radius: 10px;
  border: none;
  font-weight: 600;
  cursor: pointer;
}

.btn.primary {
  background: var(--color-text);
  color: var(--color-bg);
}

.btn.secondary {
  background: var(--color-border);
  color: var(--color-text);
}

.avatar-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.avatar-row input[type="url"] {
  flex: 1;
}

.hidden-input {
  display: none;
}

.avatar-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.avatar-preview img {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--color-border);
}

.text-btn {
  border: none;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12px;
}
</style>
