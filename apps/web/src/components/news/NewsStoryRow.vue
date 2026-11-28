<script setup lang="ts">
import NewsPhoto from "./NewsPhoto.vue";
import { newsFeelingTag, newsSharedLine, type NewsStory } from "../../utils/news";

// One story in the paper: a serif headline, the source's own short summary, where it came from,
// and ME3's note only when it has one. Anywhere on the story opens the original. Nothing is rewritten.
defineProps<{ story: NewsStory; picture?: boolean; small?: boolean }>();
const emit = defineEmits<{ ask: [prompt: string] }>();
</script>

<template>
  <div class="news-st" :class="{ 'news-st--small': small }">
    <a class="news-st__open" :href="story.url" target="_blank" rel="noopener noreferrer">
      <span v-if="picture" class="news-st__row">
        <span class="news-st__text">
          <span class="news-st__ti">{{ story.headline }}</span>
          <span v-if="story.summary" class="news-dek">{{ story.summary }}</span>
        </span>
        <NewsPhoto :id="story.id" :src="story.image" :height="72" />
      </span>
      <template v-else>
        <NewsPhoto v-if="small && story.image" :id="story.id" :src="story.image" :height="96" class="news-st__pic" />
        <span class="news-st__ti">{{ story.headline }}</span>
        <span v-if="story.summary && !small" class="news-dek">{{ story.summary }}</span>
      </template>
      <span class="news-meta"><span class="news-src news-by">{{ story.source }}</span><span v-if="story.feeling" class="news-feel">{{ newsFeelingTag(story) }}</span></span>
      <span v-if="newsSharedLine(story)" class="news-src news-shared">{{ newsSharedLine(story) }}</span>
    </a>
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
.news-st__open { display: flex; flex-direction: column; gap: 3px; padding: 0; color: var(--ui-text); text-decoration: none; }
.news-st__open:hover { background: transparent; }
.news-st__open:hover .news-st__ti { text-decoration: underline; text-underline-offset: 3px; }
.news-st__open:focus-visible { outline: 2px solid var(--ui-focus, currentColor); outline-offset: 2px; border-radius: 4px; }
.news-st--small .news-st__ti { font-size: 15.5px; }
.news-st__pic { margin-bottom: 6px; }
/* A taste of the story, not the story: three lines, then the source has it. */
.news-st .news-dek { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.news-act { align-self: flex-start; margin-top: 6px; padding: 7px 12px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font-size: 13.5px; font-weight: 600; cursor: pointer; }
</style>

<style>
/* Shared by every page of the paper. */
.news-dek { font-size: 14.5px; line-height: 1.45; color: var(--ui-text-muted); }
.news-src { font-size: 12.5px; color: var(--ui-text-muted); }
.news-shared { font-weight: 600; }
/* Who wrote it, set like a newspaper byline. */
.news-by { margin-top: 3px; font-size: 11px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; color: color-mix(in srgb, var(--ui-text) 72%, transparent); }
.news-note { margin-top: 4px; padding-left: 10px; font-size: 13.5px; line-height: 1.4; color: var(--ui-text-muted); box-shadow: inset 2px 0 0 var(--ui-accent); }
.news-note::before { content: 'ME3 · '; font-weight: 650; color: var(--ui-accent-strong, var(--ui-accent)); }
/* The byline, then the feeling the story serves as a small tag. */
.news-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.news-feel { padding: 1px 7px; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-size: 11px; white-space: nowrap; }
.news-serif { font-family: ui-serif, 'New York', Georgia, 'Times New Roman', serif; }
</style>
