<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import { RouterLink } from "vue-router";
import { siteThemes } from "@me3-core/site-renderer";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import SocialSlideCanvas from "./SocialSlideCanvas.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useSitesStore } from "../../stores/sites";
import {
  useSocialStore,
  type CarouselTemplate,
  type CarouselTemplateSettings,
  type DriveFile,
  type TextCarousel,
  type TextCarouselSlide,
} from "../../stores/social";
import { resolveWizardSiteAssetUrl } from "../../stores/wizard";
import { uploadDriveFiles } from "../../utils/drive-upload";
import { prepareImage } from "../../utils/media-prep";
import {
  INSTAGRAM_SLIDE_LIMIT,
  fileContentUrl,
  loadCanvasImage,
  loadThemeFonts,
  newSlide,
  renderSlideJpeg,
  siteAccent,
  siteLookFrom,
  type SiteLook,
  type SlideImages,
} from "../../utils/text-carousel";

/**
 * Full-screen editor for Instagram text slides. Templates autosave; "Add to post" renders each
 * slide as a 1080x1350 JPEG, saves it to Files and hands the files to the composer.
 */
const props = defineProps<{
  open: boolean;
  siteId: string;
  siteUsername: string;
  postId: string;
  handle: string;
  caption: string;
}>();
const emit = defineEmits<{
  close: [];
  added: [files: DriveFile[], replaced: string[]];
}>();

const MAX_SLIDES = 20;
const social = useSocialStore();
const sites = useSitesStore();
const { toastFromUnknown } = useAppToast();

const loading = ref(false);
const loadFailed = ref(false);
const adding = ref(false);
const templates = ref<CarouselTemplate[]>([]);
const templateId = ref<string>("");
const slides = ref<TextCarouselSlide[]>([]);
const previousFileIds = ref<string[]>([]);
const look = ref<SiteLook>({ theme: "warm", accentOverride: null, logoUrl: null });
const images = shallowRef<SlideImages>({ logo: null, photos: new Map() });
const tick = ref(0);
const active = ref(0);
const overflow = reactive<Record<string, boolean>>({});
const mobileTab = ref<"edit" | "preview">("edit");
const newTemplateName = ref<string | null>(null);
const uploadingPhoto = ref(false);

const template = computed(() => templates.value.find((item) => item.id === templateId.value) || templates.value[0] || null);
const settings = computed<CarouselTemplateSettings | null>(() => template.value?.settings || null);
const theme = computed(() => siteThemes[look.value.theme]);
const customBackground = computed(() => {
  const background = settings.value?.background;
  return background && background.startsWith("#") ? background : null;
});
const customAccent = computed(() => (settings.value?.accent.startsWith("#") ? settings.value.accent : null));
const lookLink = computed(() => (props.siteUsername ? `/sites/${encodeURIComponent(props.siteUsername)}?edit=publish` : "/sites"));

// --- Loading ---------------------------------------------------------------

watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);

async function load() {
  loading.value = true;
  loadFailed.value = false;
  mobileTab.value = "edit";
  newTemplateName.value = null;
  try {
    const [list, carousel, content] = await Promise.all([
      social.fetchCarouselTemplates(props.siteId),
      social.fetchTextCarousel(props.postId),
      props.siteUsername ? sites.getSiteContent(props.siteUsername) : Promise.resolve(null),
    ]);
    templates.value = list;
    look.value = siteLookFrom(content?.profile, (value) => resolveWizardSiteAssetUrl(value, props.siteUsername));
    applyCarousel(carousel);
    void loadThemeFonts(look.value).then(() => tick.value++);
  } catch (caught) {
    loadFailed.value = true;
    toastFromUnknown(caught, "Couldn't open the slide editor.");
  } finally {
    loading.value = false;
  }
}

function applyCarousel(carousel: TextCarousel | null) {
  templateId.value = carousel?.templateId && templates.value.some((item) => item.id === carousel.templateId)
    ? carousel.templateId
    : templates.value[0]?.id || "";
  slides.value = carousel?.slides.length ? carousel.slides.map((slide) => ({ ...slide })) : [newSlide()];
  previousFileIds.value = carousel?.fileIds || [];
  active.value = 0;
}

/** Loads the logo and every photo in use; canvases redraw when they arrive. */
watch(
  () => [
    look.value.logoUrl,
    settings.value?.photoFileId,
    ...slides.value.map((slide) => slide.photoFileId),
  ],
  async () => {
    const wanted = new Set(
      [settings.value?.photoFileId, ...slides.value.map((slide) => slide.photoFileId)].filter((id): id is string => Boolean(id)),
    );
    const photos = new Map(images.value.photos);
    const logo = look.value.logoUrl ? await loadCanvasImage(look.value.logoUrl) : null;
    await Promise.all(
      [...wanted].filter((id) => !photos.has(id)).map(async (id) => {
        const image = await loadCanvasImage(fileContentUrl(id));
        if (image) photos.set(id, image);
      }),
    );
    images.value = { logo, photos };
    tick.value++;
  },
);

// --- Template --------------------------------------------------------------

let saveTimer: number | undefined;
function changeSettings(patch: Partial<CarouselTemplateSettings>) {
  const current = template.value;
  if (!current) return;
  current.settings = { ...current.settings, ...patch };
  window.clearTimeout(saveTimer);
  const id = current.id;
  saveTimer = window.setTimeout(() => void saveTemplate(id), 600);
}

async function saveTemplate(id: string) {
  const current = templates.value.find((item) => item.id === id);
  if (!current) return;
  try {
    await social.updateCarouselTemplate(id, { settings: current.settings });
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't save the template.");
  }
}

function flushTemplate() {
  if (saveTimer === undefined) return;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (template.value) void saveTemplate(template.value.id);
}

function chooseTemplate(value: string) {
  if (value === "__new") {
    newTemplateName.value = `${template.value?.name || "Template"} copy`;
    return;
  }
  flushTemplate();
  templateId.value = value;
}

async function createTemplate() {
  const name = newTemplateName.value?.trim();
  if (!name || !settings.value) return;
  flushTemplate();
  try {
    const created = await social.createCarouselTemplate(props.siteId, name, { ...settings.value });
    templates.value = [...templates.value, created];
    templateId.value = created.id;
    newTemplateName.value = null;
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't create the template.");
  }
}

// --- Photos ----------------------------------------------------------------

const photoInput = ref<HTMLInputElement | null>(null);
/** "template" or a slide id. */
const photoTarget = ref<string | null>(null);

function pickPhoto(target: string) {
  photoTarget.value = target;
  photoInput.value?.click();
}

async function onPhoto(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const target = photoTarget.value;
  if (!file || !target) return;
  uploadingPhoto.value = true;
  try {
    const [uploaded] = await uploadDriveFiles<DriveFile>([await prepareImage(file)], { folderId: null, onConflict: "rename" });
    if (!uploaded) throw new Error("The photo didn't upload.");
    if (target === "template") {
      changeSettings({ background: "photo", photoFileId: uploaded.id });
    } else {
      const slide = slides.value.find((item) => item.id === target);
      if (slide) slide.photoFileId = uploaded.id;
    }
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't add that photo.");
  } finally {
    uploadingPhoto.value = false;
  }
}

function chooseBackground(value: CarouselTemplateSettings["background"]) {
  if (value === "photo" && !settings.value?.photoFileId) {
    pickPhoto("template");
    return;
  }
  changeSettings({ background: value });
}

// --- Slides ----------------------------------------------------------------

const list = ref<HTMLElement | null>(null);

function addSlide() {
  if (slides.value.length >= MAX_SLIDES) return;
  const at = slides.value.length ? active.value + 1 : 0;
  slides.value.splice(at, 0, newSlide());
  active.value = at;
  void nextTick(() => {
    list.value?.querySelectorAll<HTMLTextAreaElement>("textarea.slide-card__main")[at]?.focus();
    goTo(at);
  });
}

function removeSlide(index: number) {
  const [removed] = slides.value.splice(index, 1);
  if (removed) delete overflow[removed.id];
  if (!slides.value.length) slides.value.push(newSlide());
  active.value = Math.max(0, Math.min(active.value, slides.value.length - 1));
}

function select(index: number) {
  if (active.value === index) return;
  active.value = index;
  goTo(index);
}

/** Drag a card to reorder: with a mouse anywhere outside the fields, on touch by the thumbnail. */
let drag: { id: string; y: number; started: boolean } | null = null;
let justDragged = false;
const draggingId = ref<string | null>(null);

function onPointerDown(event: PointerEvent, id: string) {
  const target = event.target as HTMLElement;
  if (event.button > 0 || target.closest("textarea, input, button, label")) return;
  if (event.pointerType !== "mouse" && !target.closest(".slide-card__thumb")) return;
  drag = { id, y: event.clientY, started: false };
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(event: PointerEvent) {
  if (!drag) return;
  if (!drag.started) {
    if (Math.abs(event.clientY - drag.y) < 6) return;
    drag.started = true;
    draggingId.value = drag.id;
  }
  event.preventDefault();
  const cards = Array.from(list.value?.querySelectorAll<HTMLElement>(".slide-card") || []);
  const from = slides.value.findIndex((slide) => slide.id === drag?.id);
  let to = cards.findIndex((card) => {
    if (card.dataset.id === drag?.id) return false;
    const box = card.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2;
  });
  if (to === -1) to = cards.length;
  if (to > from) to -= 1;
  if (from === -1 || to === from) return;
  const [moved] = slides.value.splice(from, 1);
  slides.value.splice(to, 0, moved!);
  active.value = to;
}

function onPointerUp() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  if (drag?.started) {
    justDragged = true;
    window.setTimeout(() => {
      justDragged = false;
    }, 0);
    goTo(active.value, true);
  }
  drag = null;
  draggingId.value = null;
}

function onCardClick(index: number) {
  if (!justDragged) select(index);
}

// --- Phone preview ---------------------------------------------------------

const track = ref<HTMLElement | null>(null);
const shown = ref(0);
const captionShort = computed(() => {
  const text = props.caption.trim();
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
});

function goTo(index: number, instant = false) {
  const element = track.value;
  if (!element) return;
  element.scrollTo({ left: index * element.clientWidth, behavior: instant ? "auto" : "smooth" });
}

let scrollTimer: number | undefined;
function onTrackScroll() {
  const element = track.value;
  if (!element) return;
  shown.value = Math.round(element.scrollLeft / Math.max(1, element.clientWidth));
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    if (shown.value !== active.value && slides.value[shown.value]) active.value = shown.value;
  }, 120);
}

let swipe: { x: number; left: number } | null = null;
function onTrackMouseDown(event: MouseEvent) {
  const element = track.value;
  if (!element) return;
  swipe = { x: event.pageX, left: element.scrollLeft };
  element.style.scrollSnapType = "none";
  window.addEventListener("mousemove", onTrackMouseMove);
  window.addEventListener("mouseup", onTrackMouseUp);
}
function onTrackMouseMove(event: MouseEvent) {
  if (swipe && track.value) track.value.scrollLeft = swipe.left - (event.pageX - swipe.x);
}
function onTrackMouseUp(event: MouseEvent) {
  window.removeEventListener("mousemove", onTrackMouseMove);
  window.removeEventListener("mouseup", onTrackMouseUp);
  const element = track.value;
  if (!swipe || !element) return;
  const dx = event.pageX - swipe.x;
  const base = Math.round(swipe.left / Math.max(1, element.clientWidth));
  const to = Math.abs(dx) > 40 ? base + (dx < 0 ? 1 : -1) : base;
  element.style.scrollSnapType = "";
  swipe = null;
  goTo(Math.max(0, Math.min(slides.value.length - 1, to)));
}

watch(mobileTab, (tab) => {
  if (tab === "preview") void nextTick(() => goTo(active.value, true));
});

// --- Output ----------------------------------------------------------------

const filled = computed(() => slides.value.filter((slide) => slide.main.trim() || slide.small.trim()));
const tooMany = computed(() => filled.value.length > INSTAGRAM_SLIDE_LIMIT);

async function addToPost() {
  if (adding.value || !settings.value || !filled.value.length) return;
  adding.value = true;
  flushTemplate();
  try {
    await loadThemeFonts(look.value);
    const stamp = new Date().toISOString().slice(0, 10);
    const files: File[] = [];
    for (const [index, slide] of filled.value.entries()) {
      const blob = await renderSlideJpeg(slide, settings.value, look.value, images.value);
      files.push(new File([blob], `Text slide ${stamp} ${index + 1}.jpg`, { type: "image/jpeg" }));
    }
    const uploaded = await uploadDriveFiles<DriveFile>(files, { folderId: null, onConflict: "rename" });
    const replaced = previousFileIds.value;
    await social.saveTextCarousel(props.postId, {
      templateId: template.value?.id || null,
      slides: slides.value,
      fileIds: uploaded.map((file) => file.id),
    });
    emit("added", uploaded, replaced);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't add the slides.");
  } finally {
    adding.value = false;
  }
}

function close() {
  flushTemplate();
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.open && !adding.value && newTemplateName.value === null) close();
}
watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  flushTemplate();
  onPointerUp();
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("mousemove", onTrackMouseMove);
  window.removeEventListener("mouseup", onTrackMouseUp);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="carousel-editor" role="dialog" aria-modal="true" aria-labelledby="carousel-editor-title" :data-tab="mobileTab">
      <header class="carousel-editor__top">
        <Button color="ghost" shape="soft" size="small" :disabled="adding" @click="close">Cancel</Button>
        <h1 id="carousel-editor-title">Text slides</h1>
        <span class="carousel-editor__spacer" />
        <Button color="primary" shape="pill" :disabled="adding || loading || !filled.length" @click="addToPost">
          {{ adding ? "Adding…" : "Add to post" }}
        </Button>
      </header>

      <p v-if="loading" class="carousel-editor__state">Loading…</p>
      <div v-else-if="loadFailed" class="carousel-editor__state">
        <p>Couldn't open the slide editor.</p>
        <Button color="ghost" shape="soft" @click="load">Try again</Button>
      </div>

      <main v-else-if="settings" class="carousel-editor__layout">
        <!-- Template -->
        <section class="carousel-editor__template card" aria-label="Template">
          <h2>Template</h2>
          <p class="hint">Changes save to the template automatically.</p>
          <select
            :value="template?.id"
            aria-label="Template"
            class="field"
            @change="chooseTemplate(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.name }}</option>
            <option value="__new">+ New template…</option>
          </select>
          <form v-if="newTemplateName !== null" class="row" @submit.prevent="createTemplate">
            <input v-model="newTemplateName" class="field" type="text" aria-label="New template name" maxlength="60" placeholder="Template name">
            <Button size="small" type="submit">Create</Button>
            <Button size="small" color="ghost" shape="soft" type="button" @click="newTemplateName = null">Cancel</Button>
          </form>
          <div class="brand-note">
            <img v-if="look.logoUrl" :src="look.logoUrl" alt="">
            <span>Uses your site's look: {{ theme.name }} theme{{ look.logoUrl ? ", logo" : "" }}. <RouterLink :to="lookLink">Change in Site → Look</RouterLink></span>
          </div>

          <div class="template-body">
            <div>
              <p class="label">Background <span class="muted">· any slide can use its own photo</span></p>
              <div class="swatches">
                <span class="swatch-wrap">
                  <button type="button" class="swatch" :class="{ on: settings.background === 'site-light' }" :style="{ background: theme.light.bg }" aria-label="Site background" @click="chooseBackground('site-light')" />Site
                </span>
                <span class="swatch-wrap">
                  <button type="button" class="swatch" :class="{ on: settings.background === 'site-dark' }" :style="{ background: theme.dark.bg }" aria-label="Site dark background" @click="chooseBackground('site-dark')" />Site dark
                </span>
                <span class="swatch-wrap">
                  <label class="swatch swatch--custom" :class="{ on: customBackground }" :style="customBackground ? { background: customBackground } : undefined" title="Pick any colour">
                    <input type="color" aria-label="Custom background colour" :value="customBackground || '#e8dccb'" @input="changeSettings({ background: ($event.target as HTMLInputElement).value as `#${string}` })">
                  </label>Custom
                </span>
                <span class="swatch-wrap">
                  <button
                    type="button"
                    class="swatch swatch--photo"
                    :class="{ on: settings.background === 'photo' }"
                    :style="settings.photoFileId ? { backgroundImage: `url('${fileContentUrl(settings.photoFileId)}')` } : undefined"
                    aria-label="Use a photo"
                    :disabled="uploadingPhoto"
                    @click="chooseBackground('photo')"
                  ><UiIcon v-if="!settings.photoFileId" name="Plus" :size="15" /></button>Photo
                </span>
              </div>
              <div v-if="settings.background === 'photo'" class="row">
                <span class="muted small">Darken photo</span>
                <input type="range" min="0" max="80" :value="settings.dim" aria-label="Darken photo" @input="changeSettings({ dim: Number(($event.target as HTMLInputElement).value) })">
                <button type="button" class="linkbtn" :disabled="uploadingPhoto" @click="pickPhoto('template')">Change</button>
              </div>

              <p class="label">Font</p>
              <div class="row wrap">
                <div class="seg" role="group" aria-label="Font">
                  <button v-for="option in (['site', 'serif', 'sans'] as const)" :key="option" type="button" :class="{ on: settings.font === option }" :aria-pressed="settings.font === option" @click="changeSettings({ font: option })">{{ option === "site" ? "Site" : option === "serif" ? "Serif" : "Sans" }}</button>
                </div>
                <div class="seg" role="group" aria-label="Weight">
                  <button v-for="option in (['regular', 'bold'] as const)" :key="option" type="button" :class="{ on: settings.weight === option }" :aria-pressed="settings.weight === option" @click="changeSettings({ weight: option })">{{ option === "regular" ? "Regular" : "Bold" }}</button>
                </div>
              </div>

              <p class="label">Text position</p>
              <div class="row wrap">
                <div class="seg" role="group" aria-label="Text position">
                  <button v-for="option in (['top', 'middle', 'bottom'] as const)" :key="option" type="button" :class="{ on: settings.position === option }" :aria-pressed="settings.position === option" @click="changeSettings({ position: option })">{{ option[0]!.toUpperCase() + option.slice(1) }}</button>
                </div>
                <div class="seg" role="group" aria-label="Alignment">
                  <button v-for="option in (['left', 'center'] as const)" :key="option" type="button" :class="{ on: settings.align === option }" :aria-pressed="settings.align === option" @click="changeSettings({ align: option })">{{ option === "left" ? "Left" : "Centre" }}</button>
                </div>
              </div>
            </div>
            <div>
              <p class="label">Bottom corners</p>
              <div class="corners">
                <label><span class="muted small">Left</span><input class="field" type="text" maxlength="80" placeholder="e.g. your name" :value="settings.cornerLeft" @input="changeSettings({ cornerLeft: ($event.target as HTMLInputElement).value })"></label>
                <label><span class="muted small">Right</span><input class="field" type="text" maxlength="80" placeholder="e.g. Swipe →" :value="settings.cornerRight" @input="changeSettings({ cornerRight: ($event.target as HTMLInputElement).value })"></label>
                <label v-if="look.logoUrl" class="toggle"><input type="checkbox" :checked="settings.logo" @change="changeSettings({ logo: ($event.target as HTMLInputElement).checked })"> Show logo</label>
              </div>
              <p class="label">Accent line</p>
              <label class="toggle"><input type="checkbox" :checked="settings.rule" @change="changeSettings({ rule: ($event.target as HTMLInputElement).checked })"> Short line above text</label>
              <div class="swatches swatches--accent">
                <span class="swatch-wrap">
                  <button type="button" class="swatch" :class="{ on: settings.accent === 'site' }" :style="{ background: siteAccent(look, 'light') }" aria-label="Site accent" @click="changeSettings({ accent: 'site' })" />Site
                </span>
                <span class="swatch-wrap">
                  <label class="swatch swatch--custom" :class="{ on: customAccent }" :style="customAccent ? { background: customAccent } : undefined">
                    <input type="color" aria-label="Custom accent colour" :value="customAccent || siteAccent(look, 'light')" @input="changeSettings({ accent: ($event.target as HTMLInputElement).value as `#${string}` })">
                  </label>Custom
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- Slides -->
        <section class="carousel-editor__slides" aria-label="Slides">
          <h2>Slides</h2>
          <p class="hint">Main text alone shows large. Add small text to get a headline with a paragraph.</p>
          <ol ref="list" class="slide-list">
            <li
              v-for="(slide, index) in slides"
              :key="slide.id"
              class="slide-card"
              :class="{ active: index === active, dragging: draggingId === slide.id }"
              :data-id="slide.id"
              @pointerdown="onPointerDown($event, slide.id)"
              @click="onCardClick(index)"
              @focusin="select(index)"
            >
              <div class="slide-card__thumb" title="Drag to reorder">
                <SocialSlideCanvas
                  :slide="slide"
                  :settings="settings"
                  :look="look"
                  :images="images"
                  :tick="tick"
                  :width="140"
                  @overflow="overflow[slide.id] = $event"
                />
              </div>
              <div class="slide-card__fields">
                <textarea v-model="slide.main" class="slide-card__main" rows="2" maxlength="1000" placeholder="Main text" :aria-label="`Main text, slide ${index + 1}`" />
                <textarea v-model="slide.small" class="slide-card__small" rows="2" maxlength="2000" placeholder="Small text (optional)" :aria-label="`Small text, slide ${index + 1}`" />
                <div class="slide-card__meta">
                  <span v-if="overflow[slide.id]" class="pill pill--warn">Too long for one slide</span>
                  <template v-if="slide.photoFileId">
                    <span class="slide-photo">
                      <img :src="fileContentUrl(slide.photoFileId)" alt="">
                      <button type="button" class="linkbtn" :disabled="uploadingPhoto" @click.stop="pickPhoto(slide.id)">Change photo</button>
                      <button type="button" class="iconbtn" aria-label="Remove this slide's photo" title="Back to the template background" @click.stop="slide.photoFileId = null"><UiIcon name="X" :size="14" /></button>
                    </span>
                  </template>
                  <template v-else>
                    <button type="button" class="linkbtn" :disabled="uploadingPhoto" @click.stop="pickPhoto(slide.id)">+ Photo for this slide</button>
                    <label class="toggle"><input v-model="slide.swap" type="checkbox"> Swap colours</label>
                  </template>
                </div>
              </div>
              <button type="button" class="slide-card__delete" :aria-label="`Delete slide ${index + 1}`" title="Delete slide" @click.stop="removeSlide(index)">
                <UiIcon name="X" :size="14" />
              </button>
            </li>
          </ol>
          <button type="button" class="add-slide" :disabled="slides.length >= MAX_SLIDES" @click="addSlide">+ Add slide</button>
          <p v-if="tooMany" class="hint warn">Instagram shows up to {{ INSTAGRAM_SLIDE_LIMIT }} slides in one post.</p>
        </section>

        <!-- Preview -->
        <section class="carousel-editor__preview" aria-label="Preview">
          <div class="phone">
            <div class="screen">
              <div class="ig-head">
                <span class="ig-avatar">{{ (handle || "?").replace(/^@/, "").slice(0, 1).toUpperCase() }}</span>
                <b>{{ handle.replace(/^@/, "") || "you" }}</b>
              </div>
              <div class="ig-carousel">
                <div ref="track" class="ig-track" @scroll="onTrackScroll" @mousedown.prevent="onTrackMouseDown">
                  <div v-for="slide in slides" :key="slide.id" class="ig-slide">
                    <SocialSlideCanvas :slide="slide" :settings="settings" :look="look" :images="images" :tick="tick" :width="336" />
                  </div>
                </div>
                <span class="ig-counter">{{ Math.min(shown + 1, slides.length) }}/{{ slides.length }}</span>
              </div>
              <div class="ig-dots" aria-hidden="true">
                <i v-for="(slide, index) in slides" :key="slide.id" :class="{ on: index === shown }" />
              </div>
              <p class="ig-caption"><b>{{ handle.replace(/^@/, "") || "you" }}</b> {{ captionShort }}</p>
            </div>
          </div>
          <div class="preview-tools">
            <button type="button" class="iconbtn" aria-label="Previous slide" @click="goTo(Math.max(0, shown - 1))"><UiIcon name="ChevronLeft" :size="16" /></button>
            <span class="muted small">Swipe or drag the slides</span>
            <button type="button" class="iconbtn" aria-label="Next slide" @click="goTo(Math.min(slides.length - 1, shown + 1))"><UiIcon name="ChevronRight" :size="16" /></button>
          </div>
        </section>
      </main>

      <div class="carousel-editor__tabs seg" role="tablist" aria-label="Edit or preview">
        <button type="button" role="tab" :class="{ on: mobileTab === 'edit' }" :aria-selected="mobileTab === 'edit'" @click="mobileTab = 'edit'">Edit</button>
        <button type="button" role="tab" :class="{ on: mobileTab === 'preview' }" :aria-selected="mobileTab === 'preview'" @click="mobileTab = 'preview'">Preview</button>
      </div>
      <input ref="photoInput" hidden type="file" accept="image/*" @change="onPhoto">
    </div>
  </Teleport>
</template>

<style scoped>
.carousel-editor { position: fixed; inset: 0; z-index: 1000; overflow: auto; background: var(--ui-bg); color: var(--ui-text); }
.carousel-editor__top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.carousel-editor__top h1 { margin: 0; font-size: 16px; font-weight: 600; }
.carousel-editor__spacer { flex: 1; }
.carousel-editor__state { display: grid; justify-items: center; gap: 12px; padding: 64px 16px; color: var(--ui-text-muted); }
.carousel-editor__layout { display: grid; grid-template-columns: 300px minmax(0, 1fr) 380px; grid-template-areas: "tpl slides phone"; gap: 20px; align-items: start; max-width: 1480px; margin: 0 auto; padding: 20px; }
.carousel-editor__template { grid-area: tpl; }
.carousel-editor__slides { grid-area: slides; min-width: 0; }
.carousel-editor__preview { grid-area: phone; position: sticky; top: 78px; }
.card { padding: 18px; border-radius: var(--ui-radius-lg, 18px); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
h2 { margin: 0; font-size: 15px; font-weight: 600; }
.hint { margin: 4px 0 12px; color: var(--ui-text-muted); font-size: 12.5px; }
.hint.warn { margin-top: 10px; color: var(--ui-danger); }
.muted { color: var(--ui-text-muted); font-weight: 400; }
.small { font-size: 12.5px; }
.label { margin: 14px 0 6px; font-size: 13px; font-weight: 500; }
.field { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm, 8px); background: var(--ui-surface); color: inherit; font: inherit; }
.field:focus { outline: none; border-color: var(--ui-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 18%, transparent); }
select.field { font-weight: 600; }
.row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.row.wrap { flex-wrap: wrap; }
.row input[type="range"] { flex: 1; accent-color: var(--ui-primary); }
.seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.seg button { padding: 5px 12px; border: 0; border-radius: 999px; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.seg button.on { background: var(--ui-primary); color: var(--ui-primary-contrast, #fff); }
.swatches { display: flex; flex-wrap: wrap; gap: 10px; }
.swatches--accent { margin-top: 8px; }
.swatch-wrap { display: grid; justify-items: center; gap: 3px; color: var(--ui-text-muted); font-size: 11px; }
.swatch { position: relative; display: grid; place-items: center; width: 30px; height: 30px; overflow: hidden; padding: 0; border: 2px solid transparent; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .12); background-position: center; background-size: cover; color: var(--ui-text-muted); cursor: pointer; }
.swatch.on { border-color: var(--ui-primary); outline: 2px solid var(--ui-surface); outline-offset: -4px; }
.swatch--custom { background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); }
.swatch--custom input { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; opacity: 0; cursor: pointer; }
.swatch--photo { background-color: var(--ui-surface-muted); }
.corners { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.corners label { display: grid; gap: 4px; }
.toggle { display: inline-flex !important; align-items: center; gap: 6px; color: var(--ui-text-muted); font-size: 13px; cursor: pointer; user-select: none; }
.toggle input { accent-color: var(--ui-primary); }
.brand-note { display: flex; align-items: center; gap: 10px; margin: 12px 0 2px; padding: 10px 12px; border-radius: var(--ui-radius-md, 12px); background: var(--ui-surface-muted); color: var(--ui-text-muted); font-size: 12.5px; }
.brand-note img { flex: none; width: 28px; height: 28px; object-fit: contain; }
.brand-note a { color: var(--ui-primary); font-weight: 500; text-decoration: none; }
.linkbtn { padding: 0; border: 0; background: none; color: var(--ui-primary); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.iconbtn { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.iconbtn:hover { background: var(--ui-surface-muted); color: var(--ui-text); }

.slide-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.slide-card { position: relative; display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 16px; padding: 14px; border: 2px solid transparent; border-radius: var(--ui-radius-lg, 18px); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); cursor: grab; }
.slide-card.active { border-color: var(--ui-primary); }
.slide-card.dragging { z-index: 2; box-shadow: var(--ui-shadow-md); cursor: grabbing; transform: scale(1.01); }
.slide-card__thumb { touch-action: none; overflow: hidden; border-radius: 8px; box-shadow: 0 0 0 1px rgba(0, 0, 0, .08); align-self: start; }
.slide-card__fields textarea { box-sizing: border-box; display: block; width: 100%; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm, 8px); background: var(--ui-surface); color: inherit; font: inherit; resize: vertical; cursor: text; field-sizing: content; }
.slide-card__fields textarea:focus { outline: none; border-color: var(--ui-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 18%, transparent); }
.slide-card__main { min-height: 92px; padding: 10px 12px; font-size: 17px !important; font-weight: 600; line-height: 1.35; }
.slide-card__small { min-height: 84px; margin-top: 10px; padding: 10px 12px; font-size: 15px !important; line-height: 1.45; }
.slide-card__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 12.5px; }
.slide-card__delete { position: absolute; top: -10px; right: -10px; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: var(--ui-surface); box-shadow: var(--ui-shadow-md); color: var(--ui-text-muted); opacity: 0; transition: opacity .12s; cursor: pointer; }
.slide-card:hover .slide-card__delete, .slide-card:focus-within .slide-card__delete { opacity: 1; }
.slide-card__delete:hover { color: var(--ui-danger); }
@media (hover: none) { .slide-card__delete { opacity: 1; } }
.pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; font-size: 12px; }
.pill--warn { background: color-mix(in srgb, var(--ui-danger) 12%, transparent); color: var(--ui-danger); }
.slide-photo { display: inline-flex; align-items: center; gap: 8px; }
.slide-photo img { width: 28px; height: 35px; border-radius: 4px; object-fit: cover; }
.add-slide { width: 100%; margin-top: 12px; padding: 14px; border: 1.5px dashed var(--ui-border-strong, var(--ui-border)); border-radius: var(--ui-radius-lg, 18px); background: transparent; color: var(--ui-text-muted); font: inherit; font-weight: 500; cursor: pointer; }
.add-slide:hover:not(:disabled) { border-color: var(--ui-primary); color: var(--ui-primary); }
.add-slide:disabled { opacity: .5; cursor: default; }

.phone { width: 360px; max-width: 100%; box-sizing: border-box; margin: 0 auto; padding: 12px; border-radius: 46px; background: #000; box-shadow: var(--ui-shadow-md); }
.screen { overflow: hidden; padding-top: 18px; border-radius: 36px; background: #fff; color: #000; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; }
.ig-head { display: flex; align-items: center; gap: 9px; padding: 9px 12px; font-size: 13px; }
.ig-avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #229874; box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px #d62976; color: #fff; font-size: 13px; font-weight: 700; }
.ig-carousel { position: relative; }
.ig-track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; cursor: grab; }
.ig-track::-webkit-scrollbar { display: none; }
.ig-slide { flex: 0 0 100%; scroll-snap-align: start; }
.ig-counter { position: absolute; top: 12px; right: 12px; padding: 3px 8px; border-radius: 999px; background: rgba(18, 18, 18, .72); color: #fff; font-size: 12px; font-weight: 600; pointer-events: none; }
.ig-dots { display: flex; justify-content: center; gap: 4px; padding: 10px 0 4px; }
.ig-dots i { display: block; width: 6px; height: 6px; border-radius: 50%; background: #c7c7c7; }
.ig-dots i.on { background: #0095f6; }
.ig-caption { margin: 0; padding: 4px 12px 18px; font-size: 13px; white-space: pre-wrap; }
.preview-tools { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 14px; }
.carousel-editor__tabs { display: none; }

@media (max-width: 1240px) {
  .carousel-editor__layout { grid-template-columns: minmax(0, 1fr) 380px; grid-template-areas: "tpl phone" "slides phone"; }
  .template-body { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }
}
@media (max-width: 860px) {
  .carousel-editor__top { padding: 12px 16px; }
  .carousel-editor__layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: "tpl" "slides" "phone"; gap: 16px; padding: 12px 16px 88px; }
  .template-body { display: block; }
  .carousel-editor__preview { position: static; }
  .carousel-editor[data-tab="edit"] .carousel-editor__preview { display: none; }
  .carousel-editor[data-tab="preview"] .carousel-editor__template,
  .carousel-editor[data-tab="preview"] .carousel-editor__slides { display: none; }
  .carousel-editor__tabs { position: fixed; bottom: 16px; left: 50%; z-index: 10; display: flex; transform: translateX(-50%); background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
  .slide-card { grid-template-columns: 88px minmax(0, 1fr); gap: 12px; }
  .slide-card__delete { top: -8px; right: -8px; }
}
</style>
