<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Cropper } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import { useWizardStore } from "../../stores/wizard";
import UiIcon from "../UiIcon.vue";
import Button from "../Button.vue";

const wizard = useWizardStore();
const isOrganization = computed(() => wizard.siteRole === "organization");

const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);
/** When re-crop starts from a data/remote URL (no stored original), we persist this on save. */
const cropSessionSourceBlob = ref<Blob | null>(null);
const tempImageUrl = ref<string | null>(null);
const showCropper = ref(false);
const isTouchLike = ref(false);
const avatarError = ref<string | null>(null);

const stencilProps = {
  aspectRatio: 1,
  handlers: {},
  movable: true,
  resizable: true,
};

const canRecropAvatar = computed(() => {
  const av = wizard.profile.avatar?.trim();
  if (!av) return false;
  if (wizard.profile.avatarOriginalBlob) return true;
  return av.startsWith("data:");
});

onMounted(() => {
  // Heuristic for showing better interaction hints.
  isTouchLike.value =
    (typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)")?.matches ||
        "ontouchstart" in window ||
        (navigator?.maxTouchPoints ?? 0) > 0)) ||
    false;
});

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    cropSessionSourceBlob.value = null;
    // Keep original upload around (in-memory) for re-cropping.
    wizard.updateProfile({ avatarOriginalBlob: input.files[0] });
    tempImageUrl.value = URL.createObjectURL(input.files[0]);
    showCropper.value = true;
  }
}

function zoomBy(factor: number) {
  const cropper = cropperRef.value as unknown as {
    zoom?: (factor: number) => void;
  } | null;
  cropper?.zoom?.(factor);
}

function zoomIn() {
  zoomBy(1.1);
}

function zoomOut() {
  zoomBy(0.9);
}

function handleWheel(event: WheelEvent) {
  // Don't fight browser pinch-to-zoom on trackpads.
  if (event.ctrlKey) return;
  event.preventDefault();
  event.stopPropagation();

  zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
}

function cancelCrop() {
  if (tempImageUrl.value) {
    URL.revokeObjectURL(tempImageUrl.value);
  }
  tempImageUrl.value = null;
  cropSessionSourceBlob.value = null;
  showCropper.value = false;
}

async function startRecropAvatar() {
  if (!canRecropAvatar.value) return;
  avatarError.value = null;
  cropSessionSourceBlob.value = null;

  if (wizard.profile.avatarOriginalBlob) {
    tempImageUrl.value = URL.createObjectURL(wizard.profile.avatarOriginalBlob);
    showCropper.value = true;
    return;
  }

  const av = wizard.profile.avatar!.trim();
  if (av.startsWith("data:")) {
    try {
      const res = await fetch(av);
      const blob = await res.blob();
      cropSessionSourceBlob.value = blob;
      tempImageUrl.value = URL.createObjectURL(blob);
      showCropper.value = true;
    } catch (e) {
      console.error(e);
      avatarError.value =
        "Couldn't open this image for cropping. Try uploading again.";
    }
  }
}

async function confirmCrop() {
  if (!cropperRef.value) return;

  const { canvas } = cropperRef.value.getResult();
  if (!canvas) return;

  // Create 400x400 output
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = 400;
  outputCanvas.height = 400;

  const ctx = outputCanvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(canvas, 0, 0, 400, 400);

    // Get as blob for uploading later
    const blob = await new Promise<Blob | null>((resolve) => {
      outputCanvas.toBlob(resolve, "image/jpeg", 0.9);
    });

    // Get as data URL for preview
    const dataUrl = outputCanvas.toDataURL("image/jpeg", 0.9);

    wizard.updateProfile({
      avatar: dataUrl,
      avatarBlob: blob,
      ...(cropSessionSourceBlob.value
        ? { avatarOriginalBlob: cropSessionSourceBlob.value }
        : {}),
    });
  }

  cancelCrop();
}

function removeAvatar() {
  wizard.updateProfile({
    avatar: null,
    avatarBlob: null,
    avatarOriginalBlob: null,
  });
}
</script>

<template>
  <div class="step-avatar">
    <h2>{{ isOrganization ? "Add a site logo" : "Add your avatar" }}</h2>

    <div class="avatar-upload">
      <!-- Current avatar or placeholder -->
      <div
        class="avatar-preview"
        :class="{ 'has-image': wizard.profile.avatar }"
      >
        <img
          v-if="wizard.profile.avatar"
          :src="wizard.profile.avatar"
          :alt="isOrganization ? 'Site logo' : 'Your avatar'"
          class="avatar-preview-img"
          draggable="false"
        />
        <span v-else class="placeholder" aria-hidden="true">
          <UiIcon name="User" :size="68" />
        </span>

        <button
          v-if="canRecropAvatar"
          class="crop-overlay"
          type="button"
          :aria-label="isOrganization ? 'Crop site logo' : 'Crop avatar'"
          @click="startRecropAvatar"
        >
          <UiIcon name="Crop" :size="32" />
        </button>
      </div>

      <div class="avatar-actions">
        <label class="upload-btn">
          {{ wizard.profile.avatar ? "Change" : "Upload" }}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            @change="handleFileSelect"
          />
        </label>

        <Button v-if="wizard.profile.avatar" color="ghost" size="large" icon-only aria-label="Remove avatar" @click="removeAvatar"><UiIcon name="Trash2" :size="20" /></Button>
      </div>

      <p v-if="avatarError" class="error-hint">{{ avatarError }}</p>
    </div>

    <!-- Cropper Modal -->
    <div v-if="showCropper" class="cropper-modal">
      <div class="cropper-container">
        <h3>{{ isOrganization ? "Crop the site logo" : "Crop your avatar" }}</h3>
        <p class="cropper-instructions">
          {{
            isTouchLike
              ? "Drag to move • Pinch to zoom • Use corners to resize"
              : "Drag to move • Scroll to zoom • Use corners to resize"
          }}
        </p>

        <div class="cropper-wrapper" @wheel="handleWheel">
          <div class="cropper-stage">
            <Cropper
              ref="cropperRef"
              :src="tempImageUrl!"
              :stencil-props="stencilProps"
              image-restriction="stencil"
              class="cropper"
            />
          </div>
        </div>

        <div class="cropper-actions">
          <div class="zoom-controls">
            <button
              class="btn secondary zoom-btn"
              type="button"
              @click="zoomOut"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              class="btn secondary zoom-btn"
              type="button"
              @click="zoomIn"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
          <div class="action-buttons">
            <button class="btn secondary" @click="cancelCrop">Cancel</button>
            <button class="btn primary" @click="confirmCrop">Save</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-avatar h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.avatar-upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.avatar-preview {
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: var(--color-border);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 3px dashed var(--color-border);
}

.avatar-preview.has-image {
  border-style: solid;
  border-color: var(--color-text);
}

.avatar-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}

.crop-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.avatar-preview.has-image:hover .crop-overlay {
  opacity: 1;
}

@media (hover: none) {
  .crop-overlay {
    opacity: 1;
  }
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.loading-pill {
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 999px;
}

.placeholder {
  font-size: 48px;
}

.avatar-actions {
  display: flex;
  gap: 12px;
}

.upload-btn {
  padding: 12px 24px;
  background: var(--color-text);
  color: var(--color-bg);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.upload-btn:hover {
  opacity: 0.9;
}

.upload-btn input {
  display: none;
}

.error-hint {
  font-size: 13px;
  color: #c62828;
  margin-top: -8px;
}

/* Cropper Modal */
.cropper-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1000;
}

.cropper-container {
  background: var(--color-bg);
  border-radius: 16px;
  padding: 24px;
  width: 100%;
  max-width: 500px;
}

.cropper-container h3 {
  font-size: 20px;
  margin-bottom: 16px;
}

.cropper-instructions {
  color: var(--color-text-muted);
  font-size: 13px;
  margin-top: -6px;
  margin-bottom: 14px;
}

.cropper-wrapper {
  height: 350px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.cropper-stage {
  position: relative;
  width: 100%;
  height: 100%;
}

.cropper {
  height: 100%;
  width: 100%;
}

.cropper-actions {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  justify-content: space-between;
  align-items: center;
}

.zoom-controls {
  display: flex;
  gap: 8px;
}

.zoom-btn {
  width: 44px;
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.action-buttons {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
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
</style>
