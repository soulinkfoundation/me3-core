<script setup lang="ts">
import { ref } from "vue";
import { Cropper } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import { useWizardStore } from "../../stores/wizard";
import UiIcon from "../UiIcon.vue";
import Button from "../Button.vue";

const wizard = useWizardStore();

const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);
const tempImageUrl = ref<string | null>(null);
const showCropper = ref(false);
const isLoadingRandomBanner = ref(false);
const randomBannerError = ref<string | null>(null);

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    // Keep original upload around (in-memory) for re-cropping.
    wizard.updateProfile({ bannerOriginalBlob: input.files[0] });
    tempImageUrl.value = URL.createObjectURL(input.files[0]);
    showCropper.value = true;
  }
}

function cancelCrop() {
  if (tempImageUrl.value) {
    URL.revokeObjectURL(tempImageUrl.value);
  }
  tempImageUrl.value = null;
  showCropper.value = false;
}

async function fetchWithTimeout(input: RequestInfo | URL, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadRandomBanner() {
  if (isLoadingRandomBanner.value) return;
  isLoadingRandomBanner.value = true;
  randomBannerError.value = null;

  // Picsum supports CORS, so we can fetch → blob → upload safely.
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/400`;

  try {
    const res = await fetchWithTimeout(url, 10_000);
    if (!res.ok) throw new Error(`Failed to fetch banner (${res.status})`);

    const fetchedBlob = await res.blob();
    const objectUrl = URL.createObjectURL(fetchedBlob);

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(new Error("Failed to decode banner image"));
        image.src = objectUrl;
      });

      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = 1200;
      outputCanvas.height = 400;

      const ctx = outputCanvas.getContext("2d");
      if (!ctx) throw new Error("Failed to prepare image canvas");

      // Ensure JPEG has an opaque background.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 1200, 400);
      ctx.drawImage(img, 0, 0, 1200, 400);

      const blob = await new Promise<Blob | null>((resolve) => {
        outputCanvas.toBlob(resolve, "image/jpeg", 0.9);
      });
      const dataUrl = outputCanvas.toDataURL("image/jpeg", 0.9);

      wizard.updateProfile({
        banner: dataUrl,
        bannerBlob: blob,
        bannerOriginalBlob: null,
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (e) {
    console.error(e);
    randomBannerError.value =
      "Couldn't load a random banner right now. Please try again.";
  } finally {
    isLoadingRandomBanner.value = false;
  }
}

function startRecropBanner() {
  if (!wizard.profile.bannerOriginalBlob) return;
  randomBannerError.value = null;
  tempImageUrl.value = URL.createObjectURL(wizard.profile.bannerOriginalBlob);
  showCropper.value = true;
}

async function confirmCrop() {
  if (!cropperRef.value) return;

  const { canvas } = cropperRef.value.getResult();
  if (!canvas) return;

  // Create 1200x400 output (3:1 ratio)
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = 1200;
  outputCanvas.height = 400;

  const ctx = outputCanvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(canvas, 0, 0, 1200, 400);

    // Get as blob for uploading later
    const blob = await new Promise<Blob | null>((resolve) => {
      outputCanvas.toBlob(resolve, "image/jpeg", 0.9);
    });

    // Get as data URL for preview
    const dataUrl = outputCanvas.toDataURL("image/jpeg", 0.9);

    wizard.updateProfile({
      banner: dataUrl,
      bannerBlob: blob,
    });
  }

  cancelCrop();
}

function removeBanner() {
  wizard.updateProfile({
    banner: null,
    bannerBlob: null,
    bannerOriginalBlob: null,
  });
}
</script>

<template>
  <div class="step-banner">
    <h2>Add a banner image</h2>

    <div class="banner-upload">
      <!-- Current banner or placeholder -->
      <div
        class="banner-preview"
        :class="{ 'has-image': wizard.profile.banner }"
      >
        <img
          v-if="wizard.profile.banner"
          :src="wizard.profile.banner"
          alt="Site banner"
        />
        <span v-else class="placeholder">
          <UiIcon name="Image" :size="18" aria-hidden="true" />
          <span>Banner image</span>
        </span>

        <div
          v-if="isLoadingRandomBanner"
          class="loading-overlay"
          aria-hidden="true"
        >
          <div class="loading-pill">Loading…</div>
        </div>

        <button
          v-if="wizard.profile.banner && wizard.profile.bannerOriginalBlob"
          class="crop-overlay"
          type="button"
          aria-label="Re-crop banner"
          @click="startRecropBanner"
        >
          ✂︎
        </button>
      </div>

      <div class="banner-actions">
        <label class="upload-btn">
          {{ wizard.profile.banner ? "Change" : "Upload" }}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            @change="handleFileSelect"
          />
        </label>

        <Button color="ghost" size="large" icon-only aria-label="Random banner" :disabled="isLoadingRandomBanner" @click="loadRandomBanner"><UiIcon name="Sparkles" :size="20" /></Button>
        <Button v-if="wizard.profile.banner" color="ghost" size="large" icon-only aria-label="Remove banner" @click="removeBanner"><UiIcon name="Trash2" :size="20" /></Button>
      </div>

      <p v-if="randomBannerError" class="error-hint">{{ randomBannerError }}</p>
    </div>

    <!-- Cropper Modal -->
    <div v-if="showCropper" class="cropper-modal">
      <div class="cropper-container">
        <h3>Crop the site banner</h3>

        <div class="cropper-wrapper">
          <Cropper
            ref="cropperRef"
            :src="tempImageUrl!"
            :stencil-props="{ aspectRatio: 3 }"
            class="cropper"
          />
        </div>

        <div class="cropper-actions">
          <button class="btn secondary" @click="cancelCrop">Cancel</button>
          <button class="btn primary" @click="confirmCrop">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-banner h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.banner-upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.banner-preview {
  width: 100%;
  aspect-ratio: 3 / 1;
  border-radius: 12px;
  background: var(--color-border);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 3px dashed var(--color-border);
}

.banner-preview.has-image {
  border-style: solid;
  border-color: var(--color-text);
}

.banner-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.crop-overlay {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.banner-preview.has-image:hover .crop-overlay {
  opacity: 1;
}

@media (hover: none) {
  .crop-overlay {
    opacity: 1;
  }
}

.placeholder {
  font-size: 16px;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 8px;
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

.banner-actions {
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
  max-width: 600px;
}

.cropper-container h3 {
  font-size: 20px;
  margin-bottom: 16px;
}

.cropper-wrapper {
  height: 300px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.cropper {
  height: 100%;
  width: 100%;
}

.cropper-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  justify-content: flex-end;
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
