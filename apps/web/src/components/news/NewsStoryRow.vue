<script setup lang="ts">
import NewsPhoto from "./NewsPhoto.vue";
import type { NewsStory } from "../../utils/news";

// One story in the paper: a serif headline that opens the original, the source's own short
// summary, where it came from, and ME3's note only when it has one. Nothing is rewritten.
defineProps<{ story: NewsStory; picture?: boolean; small?: boolean }>();
const emit = defineEmits<{ ask: [prompt: string] }>();
</script>

<template>
  <div class="news-st" :class="{ 'news-st--small': small }">
    <div v-if="picture" class="news-st__row">
      <span class="news-st__text">
        <a class="news-st__ti" :href="story.url" target="_blank" rel="noopener noreferrer">{{ story.headline }}</a>
        <span v-if="story.summary" class="news-dek">{{ story.summary }}</span>
      </span>
      <NewsPhoto :id="story.id" :src="story.image" :height="72" />
    </div>
    <template v-else>
      <a class="news-st__ti" :href="story.url" target="_blank" rel="noopener noreferrer">{{ story.headline }}</a>
      <span v-if="story.summary && !small" class="news-dek">{{ story.summary }}</span>
    </template>
    <span class="news-src">{{ story.source }}</span>
    <span v-if="story.note" class="news-note">{{ story.note }}</span>
    <button v-if="story.action" type="button" class="news-act" @click="emit('ask', story.action.prompt)">{{ story.action.label }}</button>
  </div>
</template>

<style scoped>
.news-st { display: flex; flex-direction: column; gap: 3px; padding: 12px 0; box-shadow: inset 0 -1px 0 var(--ui-border); }
.news-st:last-child { box-shadow: none; }
.news-st__row { display: grid; grid-template-columns: minmax(0, 1fr) 92px; gap: 12px; }
.news-st__text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.news-st__ti { font-family: ui-serif, 'New York', Georgia, 'Times New Roman', serif; font-size: 17.5px; font-weight: 700; line-height: 1.24; color: var(--ui-text); text-decoration: none; padding: 0; }
.news-st__ti:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
.news-st__ti:focus-visible { outline: 2px solid var(--ui-focus, currentColor); outline-offset: 2px; border-radius: 4px; }
.news-st--small .news-st__ti { font-size: 15.5px; }
.news-act { align-self: flex-start; margin-top: 6px; padding: 7px 12px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font-size: 13.5px; font-weight: 600; cursor: pointer; }
</style>

<style>
/* Shared by every page of the paper. */
.news-dek { font-size: 14.5px; line-height: 1.45; color: var(--ui-text-muted); }
.news-src { font-size: 12.5px; color: var(--ui-text-muted); }
.news-note { font-size: 13.5px; line-height: 1.4; color: var(--ui-text-muted); }
.news-note::before { content: 'ME3 · '; font-weight: 600; }
.news-serif { font-family: ui-serif, 'New York', Georgia, 'Times New Roman', serif; }
</style>
