<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import type { SocialMediaAsset } from "../../stores/social";

/** Alt text for one image, with an editable AI draft. Sent to every platform that takes it. */
const ALT_LIMIT = 1_000;

const props = defineProps<{
  open: boolean;
  image: SocialMediaAsset | null;
  /** Makes the AI draft; receives a small JPEG data URL. */
  draft: (image: string) => Promise<string>;
}>();
const emit = defineEmits<{ close: []; save: [altText: string] }>();

const titleId = `alt-title-${useId()}`;
const text = ref("");
const drafting = ref(false);
const draftError = ref("");
const length = computed(() => Array.from(text.value).length);

watch(
  () => [props.open, props.image] as const,
  ([open, image]) => {
    if (!open) return;
    text.value = image?.altText || "";
    draftError.value = "";
  },
  { immediate: true },
);

/** A copy no wider than 768px keeps the request small. */
async function smallCopy(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Couldn't load the image.");
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't read the image.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

async function makeDraft() {
  if (!props.image || drafting.value) return;
  drafting.value = true;
  draftError.value = "";
  try {
    text.value = await props.draft(await smallCopy(props.image.url));
  } catch (caught) {
    draftError.value = caught instanceof Error && caught.message ? caught.message : "ME3 couldn't describe this image.";
  } finally {
    drafting.value = false;
  }
}

function save() {
  if (length.value > ALT_LIMIT) return;
  emit("save", text.value.trim());
}
</script>

<template>
  <AppDialog :open="open" :labelled-by="titleId" @close="emit('close')">
    <form class="alt" @submit.prevent="save">
      <header class="alt__head">
        <h2 :id="titleId">Alt text</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="18" />
        </Button>
      </header>
      <img v-if="image" class="alt__image" :src="image.url" alt="">
      <label class="alt__label" :for="`${titleId}-field`">Describe the image for people who can't see it</label>
      <textarea
        :id="`${titleId}-field`"
        v-model="text"
        class="alt__field"
        :class="{ 'is-over': length > ALT_LIMIT }"
        rows="4"
        placeholder="What's in the picture, and any words it shows."
      />
      <div class="alt__foot">
        <button type="button" class="alt__draft" :disabled="drafting || !image" @click="makeDraft">
          <UiIcon name="Sparkles" :size="14" /> {{ drafting ? "Drafting…" : text.trim() ? "Redraft with ME3" : "Draft with ME3" }}
        </button>
        <span class="alt__count" :class="{ 'is-over': length > ALT_LIMIT }">{{ length }}/{{ ALT_LIMIT }}</span>
      </div>
      <p v-if="draftError" class="alt__error" role="alert">{{ draftError }}</p>
      <p class="alt__note">Used on X, LinkedIn, Instagram, and Facebook. Applies to this image on every platform.</p>
      <footer class="alt__actions">
        <Button color="ghost" shape="pill" size="compact" @click="emit('close')">Cancel</Button>
        <Button color="primary" shape="pill" size="compact" type="submit" :disabled="length > ALT_LIMIT">Save</Button>
      </footer>
    </form>
  </AppDialog>
</template>

<style scoped>
.alt {
  box-sizing: border-box;
  display: grid;
  gap: 10px;
  width: min(480px, calc(100vw - 32px));
  padding: 14px 18px 16px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
  color: var(--ui-text);
}
.alt__head { display: flex; align-items: center; justify-content: space-between; }
.alt__head h2 { margin: 0; font-size: 17px; font-weight: 650; }
.alt__image { justify-self: center; max-width: 100%; max-height: 220px; border-radius: var(--ui-radius-sm); object-fit: contain; }
.alt__label { color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.alt__field {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: 14px/1.5 var(--font-sans);
  resize: vertical;
}
.alt__field:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 1px; }
.alt__field.is-over { border-color: var(--ui-danger); }
.alt__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.alt__draft { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; background: none; color: var(--ui-text-muted); font: 500 13px var(--font-sans); cursor: pointer; }
.alt__draft:hover:not(:disabled) { color: var(--ui-text); text-decoration: underline; }
.alt__count { color: var(--ui-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.alt__count.is-over, .alt__error { color: var(--ui-danger); }
.alt__error, .alt__note { margin: 0; font-size: 12.5px; }
.alt__note { color: var(--ui-text-muted); }
.alt__actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 640px) { .alt { width: 100vw; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; } }
</style>
