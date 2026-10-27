<script setup lang="ts">
import { ref } from "vue";
import UiIcon from "../UiIcon.vue";
import { compressImage, resizeImage } from "@/utils/imageCompression";
import { useAppToast } from "../../composables/useAppToast";
import type { WizardProductPhoto } from "../../stores/wizard";

const MAX_PHOTOS = 8;
// Small enough that a few photos fit in the saved draft.
const MAX_PHOTO_BYTES = 700 * 1024;

const props = defineProps<{ modelValue?: WizardProductPhoto[] }>();
const emit = defineEmits<{ "update:modelValue": [value: WizardProductPhoto[]] }>();
const { toastFromUnknown } = useAppToast();
const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);

function photos() {
  return props.modelValue || [];
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function onSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files || []).slice(0, MAX_PHOTOS - photos().length);
  target.value = "";
  if (!files.length) return;
  busy.value = true;
  try {
    const added: WizardProductPhoto[] = [];
    for (const file of files) {
      const resized = await resizeImage(file, 1600);
      const compressed = await compressImage(resized.blob, MAX_PHOTO_BYTES);
      added.push({ id: crypto.randomUUID(), src: await toDataUrl(compressed.blob) });
    }
    emit("update:modelValue", [...photos(), ...added]);
  } catch (error) {
    toastFromUnknown(error, "Couldn’t add that photo");
  } finally {
    busy.value = false;
  }
}

function remove(index: number) {
  emit("update:modelValue", photos().filter((_, i) => i !== index));
}

function makeCover(index: number) {
  const next = [...photos()];
  const [photo] = next.splice(index, 1);
  emit("update:modelValue", [photo, ...next]);
}
</script>

<template>
  <div class="product-photos">
    <span class="product-photos-label" id="product-photos-label">Photos</span>
    <ul class="product-photos-list" aria-labelledby="product-photos-label">
      <li v-for="(photo, index) in photos()" :key="photo.id" class="product-photo">
        <img :src="photo.src" :alt="index === 0 ? 'Cover photo' : `Photo ${index + 1}`" />
        <span v-if="index === 0" class="product-photo-cover">Cover</span>
        <button v-else type="button" class="product-photo-action product-photo-action--start" :aria-label="`Make photo ${index + 1} the cover`" title="Make cover" @click="makeCover(index)">
          <UiIcon name="Star" :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="product-photo-action" :aria-label="`Remove photo ${index + 1}`" title="Remove" @click="remove(index)">
          <UiIcon name="X" :size="14" aria-hidden="true" />
        </button>
      </li>
      <li v-if="photos().length < MAX_PHOTOS">
        <button type="button" class="product-photo-add" :disabled="busy" @click="input?.click()">
          <UiIcon name="Plus" :size="20" aria-hidden="true" />
          <span class="visually-hidden">{{ busy ? "Adding photos…" : "Add photos" }}</span>
        </button>
      </li>
    </ul>
    <input ref="input" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple tabindex="-1" aria-hidden="true" @change="onSelected" />
    <p class="product-photos-hint">The first photo is the cover in your shop.</p>
  </div>
</template>

<style scoped>
.product-photos { display: grid; gap: 8px; }
.product-photos-label { font-weight: 600; }
.product-photos-list { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
.product-photo { position: relative; width: 72px; height: 72px; border-radius: var(--ui-radius-sm, 8px); overflow: hidden; background: var(--ui-surface-muted); }
.product-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.product-photo-cover { position: absolute; left: 4px; bottom: 4px; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--ui-surface); color: var(--ui-text); }
.product-photo-action { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: var(--ui-surface); color: var(--ui-text); cursor: pointer; box-shadow: var(--ui-shadow-sm); }
.product-photo-action--start { right: auto; left: 4px; }
.product-photo-action:focus-visible, .product-photo-add:focus-visible { outline: 3px solid var(--ui-focus); outline-offset: 2px; }
.product-photo-add { width: 72px; height: 72px; display: grid; place-items: center; border: 1.5px dashed var(--ui-border-strong, var(--ui-border)); border-radius: var(--ui-radius-sm, 8px); background: none; color: var(--ui-text-muted); cursor: pointer; }
.product-photo-add:disabled { cursor: progress; opacity: .6; }
.product-photos-hint { margin: 0; font-size: .85rem; color: var(--ui-text-muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
