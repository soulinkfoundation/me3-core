<script setup lang="ts">
import Button from "../Button.vue";
import NewsPhoto from "../news/NewsPhoto.vue";
import { newsMetaLine, type NewsToday } from "../../utils/news";

// The News card body on Home (me3-6ptk.5): the intro until News is set up, then the front page
// folded in a normal card. Once read the card is just its header line, so there is no body.
defineProps<{ today: NewsToday; building?: boolean }>();
const emit = defineEmits<{ setup: []; open: [] }>();
</script>

<template>
  <section v-if="!today.setUp" class="news-intro" aria-label="News">
    <span class="news-intro__big" aria-hidden="true">🗞️</span>
    <h3>Your news, ready when you wake up</h3>
    <p>ME3 picks the news that matters for your work and the topics you love, and has it ready every morning.</p>
    <Button color="neutral" shape="pill" @click="emit('setup')">Set it up with ME3</Button>
  </section>
  <div v-else-if="today.paper && !today.paper.readAt" class="news-card">
    <button type="button" class="news-fold" @click="emit('open')">
      <span class="news-fold__text"><span class="news-fold__ti">{{ today.paper.pages.front.lead.headline }}</span><span class="news-src">{{ today.paper.pages.front.lead.source }}</span></span>
      <NewsPhoto :id="today.paper.pages.front.lead.id" :src="today.paper.pages.front.lead.image" :height="84" />
    </button>
    <span class="news-card__meta">{{ newsMetaLine(today.paper) }}</span>
    <Button color="neutral" shape="pill" @click="emit('open')">Read your news</Button>
  </div>
  <p v-else-if="building" class="news-card__meta" role="status">Getting today’s news ready…</p>
</template>

<style scoped>
.news-intro { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0 6px; text-align: center; }
.news-intro__big { font-size: 64px; line-height: 1; margin: 4px 0; }
.news-intro h3 { margin: 0; font-size: 20px; font-weight: 650; }
.news-intro p { margin: 0; max-width: 290px; font-size: 14.5px; line-height: 1.45; color: var(--ui-text-muted); }
.news-intro :deep(.me3-btn) { align-self: stretch; margin-top: 6px; }
.news-card { display: flex; flex-direction: column; gap: 10px; }
.news-card :deep(.me3-btn) { align-self: stretch; }
.news-fold { display: grid; grid-template-columns: minmax(0, 1fr) 104px; gap: 12px; align-items: start; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.news-fold:hover { background: none; }
.news-fold:focus-visible { outline: 2px solid var(--ui-focus, currentColor); outline-offset: 4px; border-radius: 8px; }
.news-fold__text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.news-fold__ti { font-family: ui-serif, 'New York', Georgia, serif; font-size: 19px; font-weight: 700; line-height: 1.2; }
.news-card__meta { margin: 0; font-size: 13px; color: var(--ui-text-muted); }
</style>
