<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiIcon from "../UiIcon.vue";
import type { SocialMediaAsset } from "../../stores/social";
import { foldFor, foldIndex, networkLabel, socialNetwork } from "../../utils/social-posts";

/**
 * A close-enough picture of the post in each feed: where the caption sits against the media,
 * and where the feed cuts it behind "see more". Not a pixel copy of any platform.
 */
const props = defineProps<{
  platform: string;
  text: string;
  media: SocialMediaAsset[];
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  title?: string | null;
  /** X thread posts, in order; the media goes on the first. */
  thread?: string[] | null;
}>();

const network = computed(() => socialNetwork(props.platform));
const expanded = ref(false);
const slide = ref(0);
watch(() => [props.platform, props.text], () => (expanded.value = false));
watch(() => props.media.length, () => (slide.value = 0));

const fold = computed(() => foldIndex(props.platform, props.text));
const foldLabel = computed(() => foldFor(props.platform)?.label || "more");
const shownText = computed(() => (fold.value !== null && !expanded.value ? props.text.slice(0, fold.value) : props.text));
const initial = computed(() => (props.name.replace(/^@/, "").trim()[0] || "?").toUpperCase());
const handleLabel = computed(() => (props.handle ? (props.handle.startsWith("@") ? props.handle : `@${props.handle}`) : ""));
const docAsset = computed(() => props.media.find((asset) => asset.kind === "document") || null);
const current = computed(() => props.media[Math.min(slide.value, props.media.length - 1)] || null);
const xGrid = computed(() => props.media.slice(0, 4));
</script>

<template>
  <article class="preview" :class="`preview--${network || 'other'}`" :aria-label="`${networkLabel(platform)} preview`">
    <header class="preview__who">
      <img v-if="avatarUrl" class="preview__avatar" :src="avatarUrl" alt="">
      <span v-else class="preview__avatar preview__avatar--blank" aria-hidden="true">{{ initial }}</span>
      <span class="preview__names">
        <b>{{ name }}</b>
        <small v-if="network === 'x' && handleLabel">{{ handleLabel }} · now</small>
        <small v-else-if="network === 'linkedin'">now · <UiIcon name="Globe" :size="11" /></small>
        <small v-else-if="network === 'facebook'">Just now · <UiIcon name="Globe" :size="11" /></small>
      </span>
    </header>

    <!-- X, LinkedIn and Facebook put the text above the media. -->
    <p v-if="network === 'x' && thread?.length" class="preview__text">{{ thread[0] }}</p>
    <p v-else-if="network !== 'instagram' && network !== 'youtube' && text" class="preview__text">
      {{ shownText }}<button v-if="fold !== null && !expanded" type="button" class="preview__more" @click="expanded = true">{{ foldLabel }}</button>
    </p>

    <template v-if="network === 'x'">
      <div v-if="media.length" class="preview__x-media" :class="`preview__x-media--${Math.min(media.length, 4)}`">
        <template v-for="(asset, index) in xGrid" :key="index">
          <video v-if="asset.kind === 'video'" :src="asset.url" muted playsinline preload="metadata" />
          <img v-else :src="asset.url" :alt="asset.altText || ''">
        </template>
      </div>
      <template v-if="thread && thread.length > 1">
        <div v-for="(part, index) in thread.slice(1)" :key="index" class="preview__reply">
          <img v-if="avatarUrl" class="preview__avatar preview__avatar--small" :src="avatarUrl" alt="">
          <span v-else class="preview__avatar preview__avatar--small preview__avatar--blank" aria-hidden="true">{{ initial }}</span>
          <div>
            <small class="preview__reply-who"><b>{{ name }}</b> {{ handleLabel }} · {{ index + 2 }}/{{ thread.length }}</small>
            <p>{{ part }}</p>
          </div>
        </div>
      </template>
      <footer class="preview__actions" aria-hidden="true">
        <UiIcon name="MessageCircle" :size="15" /><UiIcon name="RefreshCw" :size="15" /><UiIcon name="Heart" :size="15" /><UiIcon name="Activity" :size="15" />
      </footer>
    </template>

    <template v-else-if="network === 'youtube'">
      <div class="preview__short">
        <video v-if="media[0]" :src="media[0].url" muted playsinline preload="metadata" />
        <span v-else class="preview__empty">Add a video</span>
        <b v-if="title" class="preview__short-title">{{ title }}</b>
      </div>
    </template>

    <template v-else>
      <div v-if="docAsset" class="preview__doc">
        <UiIcon name="FileText" :size="28" />
        <b>{{ (docAsset.altText || docAsset.filename || "Document").replace(/\.pdf$/i, "") }}</b>
        <small>PDF · swipe through the pages</small>
      </div>
      <div v-else-if="current" class="preview__media" :class="{ 'preview__media--square': network === 'instagram' }">
        <video v-if="current.kind === 'video'" :src="current.url" muted playsinline preload="metadata" />
        <img v-else :src="current.url" :alt="current.altText || ''">
        <template v-if="media.length > 1">
          <span class="preview__count">{{ slide + 1 }}/{{ media.length }}</span>
          <button v-if="slide > 0" type="button" class="preview__nav preview__nav--prev" aria-label="Previous image" @click="slide -= 1">
            <UiIcon name="ChevronLeft" :size="16" />
          </button>
          <button v-if="slide < media.length - 1" type="button" class="preview__nav preview__nav--next" aria-label="Next image" @click="slide += 1">
            <UiIcon name="ChevronRight" :size="16" />
          </button>
        </template>
      </div>
      <div v-else-if="network === 'instagram'" class="preview__media preview__media--square preview__empty">Add an image or a video</div>

      <footer class="preview__actions" aria-hidden="true">
        <template v-if="network === 'instagram'">
          <UiIcon name="Heart" :size="17" /><UiIcon name="MessageCircle" :size="17" /><UiIcon name="Send" :size="17" />
          <span v-if="media.length > 1" class="preview__dots">
            <i v-for="(_, index) in media" :key="index" :class="{ on: index === slide }" />
          </span>
        </template>
        <template v-else>
          <UiIcon name="Heart" :size="15" /> <span>Like</span>
          <UiIcon name="MessageCircle" :size="15" /> <span>Comment</span>
          <UiIcon name="Share2" :size="15" /> <span>Share</span>
        </template>
      </footer>

      <!-- Instagram puts the caption under the media, after the handle. -->
      <p v-if="network === 'instagram' && text" class="preview__text preview__text--caption">
        <b>{{ handle?.replace(/^@/, "") || name }}</b> {{ shownText }}<button v-if="fold !== null && !expanded" type="button" class="preview__more" @click="expanded = true">{{ foldLabel }}</button>
      </p>
    </template>
  </article>
</template>

<style scoped>
.preview { display: grid; overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); color: var(--ui-text); font-size: 13.5px; }
.preview__who { display: flex; align-items: center; gap: 9px; padding: 11px 12px 8px; }
.preview__avatar { flex: none; width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.preview__avatar--blank { display: grid; place-items: center; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-weight: 650; }
.preview__names { display: grid; min-width: 0; line-height: 1.25; }
.preview__names b { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.preview__names small { display: inline-flex; align-items: center; gap: 3px; color: var(--ui-text-muted); font-size: 12px; }
.preview__text { margin: 0; padding: 0 12px 10px; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.45; }
.preview__text--caption { padding-top: 2px; }
.preview__more { padding: 0 0 0 4px; border: 0; background: none; color: var(--ui-text-muted); font: inherit; font-weight: 600; cursor: pointer; }
.preview__more:hover { color: var(--ui-text); text-decoration: underline; }

.preview__media { position: relative; display: grid; background: #000; aspect-ratio: auto; }
.preview__media img, .preview__media video { display: block; width: 100%; max-height: 420px; object-fit: contain; }
.preview__media--square { aspect-ratio: 4 / 5; }
.preview__media--square img, .preview__media--square video { height: 100%; max-height: none; object-fit: cover; }
.preview__empty { display: grid; place-items: center; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-size: 12.5px; }
.preview__count { position: absolute; top: 8px; right: 8px; padding: 2px 7px; border-radius: 999px; background: rgba(0, 0, 0, .6); color: #fff; font-size: 11px; font-variant-numeric: tabular-nums; }
.preview__nav { position: absolute; top: 50%; display: grid; place-items: center; width: 26px; height: 26px; margin-top: -13px; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .85); color: #111; cursor: pointer; }
.preview__nav--prev { left: 8px; }
.preview__nav--next { right: 8px; }

/* X: media in a rounded frame inside the post, under the text. */
.preview--x .preview__text { padding-left: 55px; }
.preview__x-media { display: grid; gap: 2px; margin: 0 12px 4px 55px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 14px; }
.preview__x-media--2, .preview__x-media--4 { grid-template-columns: 1fr 1fr; aspect-ratio: 16 / 9; }
.preview__x-media--3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; aspect-ratio: 16 / 9; }
.preview__x-media--3 > :first-child { grid-row: span 2; }
.preview__x-media img, .preview__x-media video { display: block; width: 100%; height: 100%; min-height: 0; object-fit: cover; }
.preview__x-media--1 img, .preview__x-media--1 video { max-height: 360px; }
.preview--x .preview__actions { justify-content: space-between; padding-left: 55px; padding-right: 28px; }

.preview__reply { position: relative; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 9px; padding: 8px 12px 0; }
.preview__reply::before { position: absolute; top: -6px; left: 28px; width: 2px; height: 14px; background: var(--ui-border-strong); content: ""; }
.preview__reply p { margin: 2px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.45; }
.preview__reply-who { color: var(--ui-text-muted); font-size: 12px; }
.preview__reply-who b { color: var(--ui-text); }
.preview__avatar--small { width: 34px; height: 34px; }
.preview__actions { display: flex; align-items: center; gap: 6px 12px; padding: 9px 12px; color: var(--ui-text-muted); font-size: 12px; }
.preview--linkedin .preview__actions, .preview--facebook .preview__actions { justify-content: space-around; border-top: 1px solid var(--ui-border); }
.preview--instagram .preview__actions { position: relative; gap: 14px; color: var(--ui-text); }
.preview__dots { position: absolute; left: 50%; display: inline-flex; gap: 4px; transform: translateX(-50%); }
.preview__dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-border-strong); }
.preview__dots i.on { background: var(--ui-primary); }

.preview__doc { display: grid; justify-items: center; gap: 4px; padding: 36px 16px; background: var(--ui-surface-muted); color: var(--ui-text-muted); text-align: center; }
.preview__doc b { color: var(--ui-text); }
.preview__doc small { font-size: 12px; }
.preview__short { position: relative; display: grid; width: 60%; margin: 0 auto 12px; overflow: hidden; border-radius: var(--ui-radius-md); background: #000; aspect-ratio: 9 / 16; }
.preview__short video { width: 100%; height: 100%; object-fit: cover; }
.preview__short-title { position: absolute; right: 10px; bottom: 10px; left: 10px; color: #fff; font-size: 12.5px; text-shadow: 0 1px 3px rgba(0, 0, 0, .7); }
</style>
