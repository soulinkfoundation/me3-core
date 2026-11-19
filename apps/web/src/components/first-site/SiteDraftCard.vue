<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { useRouter } from "vue-router";
import { siteThemes } from "@me3-core/site-renderer";
import { API_BASE, api } from "../../api";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";
import type { SiteDraftView } from "../../utils/firstSite";

/**
 * The first site draft (core_sites_starter_draft approval): the real renderer's preview of the
 * unpublished source, Warm/Meadow/Paper looks, Edit in the site editor, and Publish, which approves it.
 */
const props = defineProps<{ draft: SiteDraftView }>();
const emit = defineEmits<{ resolved: [decision: "approved" | "declined"] }>();
const router = useRouter();
const { toastFromUnknown } = useAppToast();
const titleId = useId();
const theme = ref(props.draft.theme);
const html = ref("");
const loading = ref(true);
const busy = ref<"" | "approved" | "declined" | "theme">("");
const host = computed(() => props.draft.publicUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""));
let previewSeq = 0;
// The card shows the site as a phone would, scaled down to the card's width, so it never pans or
// fights the chat's scroll. Tapping it opens the full, scrollable preview.
const PREVIEW_WIDTH = 390;
const previewBox = ref<HTMLElement | null>(null);
const previewScale = ref(0.8);
const fullPreviewOpen = ref(false);
let resizeObserver: ResizeObserver | null = null;

/** The look's own page colour with its accent, from the renderer's themes. */
function swatch(id: string) {
  const colors = (siteThemes as Record<string, { light: { bg: string; accent: string } } | undefined>)[id]?.light;
  return colors ? { background: `linear-gradient(135deg, ${colors.bg} 55%, ${colors.accent} 55%)` } : { background: "var(--ui-surface-muted)" };
}

async function loadPreview(nextTheme = theme.value) {
  const seq = ++previewSeq;
  loading.value = true;
  try {
    const response = await fetch(`${API_BASE}/sites/${encodeURIComponent(props.draft.username)}/draft-preview-html?theme=${encodeURIComponent(nextTheme)}`, { credentials: "include" });
    const body = response.ok && response.status !== 204 ? await response.text() : "";
    if (seq === previewSeq) html.value = body;
  } catch {
    if (seq === previewSeq) html.value = "";
  } finally {
    if (seq === previewSeq) loading.value = false;
  }
}

async function chooseTheme(id: string) {
  if (id === theme.value || busy.value) return;
  const previous = theme.value;
  theme.value = id; busy.value = "theme";
  void loadPreview(id);
  try { await api.put(`/sites/${encodeURIComponent(props.draft.username)}/draft-theme`, { theme: id }); }
  catch (error) { theme.value = previous; void loadPreview(previous); toastFromUnknown(error, "Couldn't change the look"); }
  finally { busy.value = ""; }
}

async function decide(decision: "approved" | "declined") {
  if (busy.value) return;
  busy.value = decision;
  try {
    await api.post(`/assistant/approvals/${encodeURIComponent(props.draft.approvalId)}`, { decision });
    emit("resolved", decision);
  } catch (error) {
    // Never resend on its own: the next load shows whether it went through.
    toastFromUnknown(error, decision === "approved" ? "Couldn't publish your site" : "Couldn't save that");
  } finally { busy.value = ""; }
}

function edit(step: string) {
  void router.push({ path: "/create", query: { site: props.draft.username, step } });
}

// A preview that failed (often a dropped connection) loads again once the app is back.
function retryIfMissing() {
  if (!html.value && !loading.value && document.visibilityState === "visible") void loadPreview();
}

onMounted(() => {
  void loadPreview();
  if (previewBox.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) previewScale.value = entry.contentRect.width / PREVIEW_WIDTH;
    });
    resizeObserver.observe(previewBox.value);
  }
  window.addEventListener("online", retryIfMissing);
  document.addEventListener("visibilitychange", retryIfMissing);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("online", retryIfMissing);
  document.removeEventListener("visibilitychange", retryIfMissing);
});
</script>

<template>
  <section class="site-draft" :aria-labelledby="titleId" data-testid="site-draft-card">
    <div class="site-draft__head">
      <span class="site-draft__stack">
        <h3 :id="titleId" class="site-draft__title">Your website draft</h3>
        <span class="site-draft__sub">{{ draft.name }}<template v-if="host"> · {{ host }}</template></span>
      </span>
    </div>
    <div ref="previewBox" class="site-draft__preview" :aria-busy="loading">
      <button v-if="html" type="button" class="site-draft__frame" aria-label="Open the full preview" @click="fullPreviewOpen = true">
        <iframe :srcdoc="html" title="Website draft preview" sandbox="allow-same-origin" loading="lazy" tabindex="-1"
          :style="{ width: `${PREVIEW_WIDTH}px`, height: `${100 / previewScale}%`, transform: `scale(${previewScale})` }" />
      </button>
      <div v-else class="site-draft__placeholder">
        <p>{{ loading ? "Loading your preview…" : "The preview didn't load." }}</p>
        <Button v-if="!loading" color="ghost" shape="soft" size="compact" @click="loadPreview()">Try again</Button>
      </div>
    </div>
    <div v-if="draft.themes.length > 1" class="site-draft__looks" role="radiogroup" aria-label="Look">
      <button v-for="option in draft.themes" :key="option.id" type="button" role="radio" class="site-draft__look"
        :aria-checked="theme === option.id" :disabled="busy !== '' && busy !== 'theme'" @click="chooseTheme(option.id)">
        <span class="site-draft__swatch" :style="swatch(option.id)" aria-hidden="true" />
        {{ option.name }}
      </button>
    </div>
    <p v-if="draft.howItWorks" class="site-draft__fine">{{ draft.howItWorks }}</p>
    <div class="site-draft__btns">
      <Button v-if="!draft.hasPhoto" color="ghost" shape="soft" :disabled="busy !== ''" @click="edit('avatar')"><UiIcon name="UserRound" :size="18" />Add photo</Button>
      <Button color="ghost" shape="soft" :disabled="busy !== ''" @click="edit('basics')"><UiIcon name="Pencil" :size="18" />Edit</Button>
      <Button class="site-draft__primary" color="primary" shape="soft" :disabled="busy !== ''" @click="decide('approved')">{{ busy === 'approved' ? 'Publishing…' : 'Publish' }}</Button>
    </div>
    <AppDialog :open="fullPreviewOpen" aria-label="Website draft preview" close-on-backdrop @close="fullPreviewOpen = false">
      <section class="site-draft__dialog">
        <header><h2>Preview</h2><button type="button" aria-label="Close preview" @click="fullPreviewOpen = false"><UiIcon name="X" :size="20" /></button></header>
        <iframe :srcdoc="html" title="Full website draft preview" sandbox="allow-same-origin" />
      </section>
    </AppDialog>
  </section>
</template>

<style scoped>
.site-draft { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; width: min(560px, 100%); padding: 16px; border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.site-draft__head { display: flex; align-items: center; gap: 12px; }
.site-draft__stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.site-draft__title { margin: 0; font-size: 16px; font-weight: 600; }
.site-draft__sub { color: var(--ui-text-muted); font-size: 14px; overflow-wrap: anywhere; }
.site-draft__preview { position: relative; height: 420px; overflow: hidden; border-radius: var(--ui-radius-md); background: var(--ui-surface-muted); box-shadow: var(--ui-shadow-sm); }
.site-draft__frame { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: #fff; cursor: zoom-in; }
/* Drawn at phone width and scaled down; it takes no touches, so swipes scroll the chat. */
.site-draft__frame iframe { display: block; border: 0; background: #fff; transform-origin: 0 0; pointer-events: none; }
.site-draft__placeholder { display: grid; place-content: center; justify-items: center; gap: 8px; height: 100%; padding: 16px; box-sizing: border-box; color: var(--ui-text-muted); font-size: 14px; text-align: center; }
.site-draft__placeholder p { margin: 0; }
.site-draft__dialog { display: flex; flex-direction: column; width: min(480px, 100%); height: min(85dvh, 860px); margin: auto; padding: 12px; box-sizing: border-box; border-radius: 24px; background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.site-draft__dialog header { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 8px 8px; }
.site-draft__dialog h2 { margin: 0; font-size: 18px; font-weight: 600; }
.site-draft__dialog header button { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text); cursor: pointer; }
.site-draft__dialog iframe { flex: 1; width: 100%; border: 0; border-radius: 16px; background: #fff; }
.site-draft__looks { display: flex; flex-wrap: wrap; gap: 8px; }
.site-draft__look { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 12px 0 6px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 14px; cursor: pointer; }
.site-draft__look[aria-checked="true"] { background: var(--ui-accent-soft); box-shadow: inset 0 0 0 2px var(--ui-accent); font-weight: 600; }
.site-draft__swatch { width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); }
.site-draft__fine { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.site-draft__btns { display: flex; flex-wrap: wrap; gap: 8px; }
.site-draft__btns :deep(.me3-btn) { min-height: 44px; }
.site-draft__btns :deep(svg) { margin-right: 6px; }
.site-draft__primary { flex: 1; min-width: 120px; }
@media (max-width: 520px) { .site-draft__preview { height: 340px; } }
</style>
