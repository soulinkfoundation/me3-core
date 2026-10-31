<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RESERVED_SITE_PAGE_SLUGS } from "@me3-core/site-renderer";
import AppSwitch from "../AppSwitch.vue";
import UiIcon from "../UiIcon.vue";
import { compressImage, resizeImage } from "@/utils/imageCompression";
import { useAppToast } from "../../composables/useAppToast";
import { normalizeOfferPageSlug, type WizardOfferDetails, type WizardOfferLocation } from "../../stores/wizard";

// Matches product photos so a few offer photos still fit in the saved draft.
const MAX_PHOTO_BYTES = 700 * 1024;

const props = defineProps<{
  idPrefix: string;
  details: WizardOfferDetails;
  defaultButtonLabel: string;
  /** Mode to show selected when the offer has no location yet, e.g. online for a call with a video link. */
  impliedMode?: WizardOfferLocation["mode"];
  /** Offer title, used for the page path when the owner switches the page on. */
  title: string;
  /** Business plan: the offer can have its own page. */
  pageAccess: boolean;
  /** Paths other offers already use. */
  takenPageSlugs: string[];
  /** Site pages (Pages step) an offer can point at instead of a generated page. */
  sitePageSlugs: string[];
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

const slugDraft = ref(props.details.pageSlug || "");
watch(() => props.details.pageSlug, (value) => { slugDraft.value = value || ""; });

const pageProblem = computed(() => {
  const slug = props.details.pageSlug;
  if (!slug) return "";
  if (RESERVED_SITE_PAGE_SLUGS.has(slug)) return `/${slug} is used by ME3. Choose another path.`;
  if (props.takenPageSlugs.includes(slug)) return `Another offer already uses /${slug}.`;
  return "";
});

function setOwnPage(on: boolean) {
  if (!on) {
    emit("update", { pageSlug: undefined });
    return;
  }
  const base = normalizeOfferPageSlug(props.title) || "offer";
  let slug = base;
  for (let n = 2; RESERVED_SITE_PAGE_SLUGS.has(slug) || props.takenPageSlugs.includes(slug); n += 1) slug = `${base}-${n}`;
  emit("update", { pageSlug: slug });
}

function commitSlug() {
  const slug = normalizeOfferPageSlug(slugDraft.value);
  if (!slug) {
    slugDraft.value = props.details.pageSlug || "";
    return;
  }
  slugDraft.value = slug;
  if (slug !== props.details.pageSlug) emit("update", { pageSlug: slug });
}

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

    <div class="form-group offer-own-page">
      <div class="offer-own-page-head">
        <span :id="`${idPrefix}-page-label`" class="offer-details-label">
          Own page
          <span v-if="!pageAccess" class="offer-plan-badge">Business</span>
        </span>
        <AppSwitch
          v-if="pageAccess"
          :model-value="Boolean(details.pageSlug)"
          label="Give this offer its own page"
          @update:model-value="setOwnPage"
        />
      </div>
      <template v-if="pageAccess && details.pageSlug">
        <div class="offer-page-path">
          <span aria-hidden="true">/</span>
          <label class="visually-hidden" :for="`${idPrefix}-page`">Page path</label>
          <input
            :id="`${idPrefix}-page`"
            v-model="slugDraft"
            type="text"
            maxlength="60"
            autocapitalize="off"
            spellcheck="false"
            :aria-invalid="Boolean(pageProblem)"
            :aria-describedby="`${idPrefix}-page-hint`"
            @blur="commitSlug"
            @keydown.enter.prevent="commitSlug"
          />
        </div>
        <p :id="`${idPrefix}-page-hint`" class="form-hint" :class="{ 'form-error': pageProblem }">
          {{
            pageProblem ||
            (sitePageSlugs.includes(details.pageSlug)
              ? `Links to your page /${details.pageSlug} from the Pages step.`
              : "ME3 builds the page from these details when you publish. Share the link anywhere.")
          }}
        </p>
      </template>
      <p v-else-if="!pageAccess" class="form-hint">
        On the Business plan, each offer can have a page of its own to share in your bio, an ad or an email.
      </p>
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

.offer-own-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.offer-own-page-head .offer-details-label {
  margin: 0;
}

.offer-plan-badge {
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .03em;
  text-transform: uppercase;
}

.offer-page-path {
  display: flex;
  align-items: center;
  gap: 4px;
}

.offer-page-path span {
  color: var(--ui-text-muted);
  font-size: 14px;
}

.offer-page-path input {
  flex: 1;
  min-width: 0;
}

.form-error {
  color: var(--ui-danger);
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
