<script setup lang="ts">
import { computed, ref } from "vue";
import UiIcon from "../UiIcon.vue";
import { compressImage, resizeImage } from "@/utils/imageCompression";
import { useAppToast } from "../../composables/useAppToast";
import type { WizardOfferDetails, WizardOfferLocation } from "../../stores/wizard";

// Matches product photos so a few offer photos still fit in the saved draft.
const MAX_PHOTO_BYTES = 700 * 1024;

const props = defineProps<{
  idPrefix: string;
  details: WizardOfferDetails;
  defaultButtonLabel: string;
  /** Mode to show selected when the offer has no location yet, e.g. online for a call with a video link. */
  impliedMode?: WizardOfferLocation["mode"];
}>();
const emit = defineEmits<{ update: [updates: Partial<WizardOfferDetails>] }>();
const { toastFromUnknown } = useAppToast();
const fileInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);

const modes: Array<{ value: WizardOfferLocation["mode"]; label: string }> = [
  { value: "in_person", label: "In person" },
  { value: "online", label: "Online" },
  { value: "phone", label: "Phone" },
];

const mode = computed(() => props.details.location?.mode || props.impliedMode);

const place = computed({
  get: () => props.details.location?.place || "",
  set: (value: string) => emit("update", { location: { mode: "in_person", place: value } }),
});

const buttonLabel = computed({
  get: () => props.details.buttonLabel || "",
  set: (value: string) => emit("update", { buttonLabel: value.trim() ? value : undefined }),
});

function selectMode(value: WizardOfferLocation["mode"]) {
  const current = props.details.location;
  emit("update", { location: { mode: value, place: value === "in_person" ? current?.place || "" : "" } });
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function onPhotoSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file) return;
  busy.value = true;
  try {
    const resized = await resizeImage(file, 1600);
    const compressed = await compressImage(resized.blob, MAX_PHOTO_BYTES);
    emit("update", { image: { id: crypto.randomUUID(), src: await toDataUrl(compressed.blob) } });
  } catch (error) {
    toastFromUnknown(error, "Couldn’t add that photo");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="offer-details">
    <div class="form-group">
      <span :id="`${idPrefix}-photo-label`" class="offer-details-label">Photo <span class="optional-label">(optional)</span></span>
      <div v-if="details.image" class="offer-photo">
        <img :src="details.image.src" alt="Offer photo" />
        <div class="offer-photo-actions">
          <button type="button" :disabled="busy" @click="fileInput?.click()">Change</button>
          <button type="button" @click="emit('update', { image: undefined })">Remove</button>
        </div>
      </div>
      <button
        v-else
        type="button"
        class="offer-photo-add"
        :aria-labelledby="`${idPrefix}-photo-label`"
        :disabled="busy"
        @click="fileInput?.click()"
      >
        <UiIcon name="Image" :size="18" aria-hidden="true" />
        <span>{{ busy ? "Adding photo…" : "Add a photo" }}</span>
      </button>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="visually-hidden" tabindex="-1" @change="onPhotoSelected" />
    </div>

    <div class="form-group">
      <span :id="`${idPrefix}-where-label`" class="offer-details-label">Where</span>
      <div class="offer-where" role="group" :aria-labelledby="`${idPrefix}-where-label`">
        <button
          v-for="option in modes"
          :key="option.value"
          type="button"
          :aria-pressed="mode === option.value"
          :class="{ active: mode === option.value }"
          @click="selectMode(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <template v-if="mode === 'in_person'">
        <label class="visually-hidden" :for="`${idPrefix}-place`">Place</label>
        <input
          :id="`${idPrefix}-place`"
          v-model="place"
          type="text"
          maxlength="120"
          placeholder="e.g. Clifton studio, Bristol"
        />
        <p class="form-hint">Shown on your site. A venue and town is enough.</p>
      </template>
      <slot v-if="mode === 'online'" name="online" />
    </div>

    <div class="form-group">
      <label :for="`${idPrefix}-button`">Button wording <span class="optional-label">(optional)</span></label>
      <input
        :id="`${idPrefix}-button`"
        v-model="buttonLabel"
        type="text"
        maxlength="40"
        :placeholder="defaultButtonLabel"
      />
    </div>
  </div>
</template>

<style scoped>
.offer-details {
  display: grid;
  gap: 4px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 500;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  font-size: 14px;
}

.form-hint {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.offer-details-label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.offer-photo {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.offer-photo img {
  width: 120px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--ui-radius-sm, 8px);
}

.offer-photo-actions {
  display: flex;
  gap: 8px;
}

.offer-photo-actions button,
.offer-photo-add,
.offer-where button {
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.offer-photo-add {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.offer-where {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.offer-where button.active {
  background: var(--ui-primary);
  color: var(--ui-primary-contrast);
}

.offer-photo-actions button:focus-visible,
.offer-photo-add:focus-visible,
.offer-where button:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}

.optional-label {
  color: var(--ui-text-muted);
  font-weight: 400;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
