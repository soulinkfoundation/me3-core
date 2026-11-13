<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import NewsPhoto from "./NewsPhoto.vue";
import NewsStoryRow from "./NewsStoryRow.vue";
import { NEWS_PAGE_TITLES, newsDate, newsEmbedUrl, newsLength, newsPageKinds, type NewsPaper, type NewsRating } from "../../utils/news";

// The paper, opened (me3-6ptk.5): a handful of pages you flick through, with a page turn. Tap the
// edges or the arrows, swipe, or use the arrow keys. A paper has an end, where you can say how it
// was. Stories open at their source; a video plays here only after a tap.
const props = defineProps<{ paper: NewsPaper; nextTime: string }>();
const emit = defineEmits<{ close: []; done: []; settings: []; rate: [rating: NewsRating]; ask: [prompt: string] }>();

const kinds = computed(() => newsPageKinds(props.paper));
const index = ref(0);
const direction = ref<"next" | "prev" | "">("");
const kind = computed(() => kinds.value[index.value]);
const last = computed(() => kinds.value.length - 1);
const playing = ref(false);
const pageEl = ref<HTMLElement | null>(null);
const closeEl = ref<HTMLButtonElement | null>(null);
function go(target: number) {
  if (target < 0 || target > last.value || target === index.value) return;
  direction.value = target > index.value ? "next" : "prev";
  index.value = target;
  playing.value = false;
  void nextTick(() => { if (pageEl.value) pageEl.value.scrollTop = 0; });
}
watch(() => props.paper.id, () => { index.value = 0; direction.value = ""; playing.value = false; });
function keys(event: KeyboardEvent) {
  // The settings sheet opens over the paper and takes the keyboard while it is up.
  if (document.querySelector("dialog[open]")) return;
  if (event.key === "Escape") { event.preventDefault(); emit("close"); }
  else if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); go(index.value + 1); }
  else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); go(index.value - 1); }
}
// A sideways swipe turns the page; an up-and-down one scrolls it.
let touch: { x: number; y: number } | null = null;
function touchStart(event: TouchEvent) { const point = event.touches[0]; touch = point ? { x: point.clientX, y: point.clientY } : null; }
function touchEnd(event: TouchEvent) {
  const point = event.changedTouches[0];
  if (!touch || !point) return;
  const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) go(index.value + (dx < 0 ? 1 : -1));
}
let previousOverflow = "";
onMounted(() => {
  previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  window.addEventListener("keydown", keys);
  void nextTick(() => closeEl.value?.focus());
});
onBeforeUnmount(() => { document.documentElement.style.overflow = previousOverflow; window.removeEventListener("keydown", keys); });

const video = computed(() => props.paper.pages.media?.video ?? null);
const embed = computed(() => video.value ? newsEmbedUrl(video.value) : null);
const videoLength = computed(() => video.value?.minutes ? `${video.value.minutes} min` : "");
const ratings: Array<{ id: NewsRating; emoji: string; label: string }> = [{ id: "fire", emoji: "🔥", label: "Loved it" }, { id: "ok", emoji: "🙂", label: "It was fine" }, { id: "sleepy", emoji: "😴", label: "A bit dull" }];
const endLine = computed(() => {
  const { stories, videos } = props.paper.counts;
  return `${stories} ${stories === 1 ? "story" : "stories"}${videos ? " and a video" : ""}. Tomorrow’s will be ready at ${props.nextTime}.`;
});
</script>

<template>
  <Teleport to="body">
    <div class="news-reader" role="dialog" aria-modal="true" aria-label="News" @touchstart.passive="touchStart" @touchend.passive="touchEnd">
      <div class="news-reader__sheet">
        <div class="news-reader__top">
          <button type="button" aria-label="News settings" @click="emit('settings')"><UiIcon name="Ellipsis" :size="20" /></button>
          <button ref="closeEl" type="button" aria-label="Close" @click="emit('close')"><UiIcon name="X" :size="20" /></button>
        </div>
        <div :key="index" ref="pageEl" class="news-pg" :class="direction ? `news-pg--${direction}` : ''" :aria-label="NEWS_PAGE_TITLES[kind]">
          <template v-if="kind === 'front'">
            <div class="news-mast"><span class="news-mast__nm">News</span><span class="news-mast__ed"><span>{{ newsDate(paper.dateKey, 'long') }}</span><span aria-hidden="true">·</span><span>Ready at {{ paper.time }}</span></span></div>
            <div class="news-lead">
              <NewsPhoto :id="paper.pages.front.lead.id" :src="paper.pages.front.lead.image" :height="180" />
              <a class="news-lead__ti" :href="paper.pages.front.lead.url" target="_blank" rel="noopener noreferrer">{{ paper.pages.front.lead.headline }}</a>
              <p v-if="paper.pages.front.lead.summary" class="news-dek">{{ paper.pages.front.lead.summary }}</p>
              <span class="news-src">{{ paper.pages.front.lead.source }}</span>
              <span v-if="paper.pages.front.lead.note" class="news-note">{{ paper.pages.front.lead.note }}</span>
            </div>
            <div v-if="paper.pages.front.briefs.length" class="news-cols"><NewsStoryRow v-for="story in paper.pages.front.briefs" :key="story.id" :story="story" small /></div>
          </template>

          <template v-else-if="kind === 'work' && paper.pages.work">
            <h2 class="news-pgt">Your work<small>{{ paper.pages.work.topics.join(' · ') }}</small></h2>
            <NewsStoryRow v-for="(story, i) in paper.pages.work.stories" :key="story.id" :story="story" :picture="i === 0 && Boolean(story.image)" @ask="emit('ask', $event)" />
          </template>

          <template v-else-if="kind === 'media' && paper.pages.media">
            <h2 class="news-pgt">Watch &amp; listen<small>Picked for this week</small></h2>
            <template v-if="video">
              <div v-if="playing && embed" class="news-video"><iframe :src="embed" :title="video.headline" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" /></div>
              <component :is="embed ? 'button' : 'a'" v-else class="news-video__poster" v-bind="embed ? { type: 'button' } : { href: video.url, target: '_blank', rel: 'noopener noreferrer' }" :aria-label="`Play ${video.headline}`" @click="embed && (playing = true)">
                <NewsPhoto :id="video.id" :src="video.image" :height="210"><span class="news-video__play"><UiIcon name="Play" :size="22" /></span><span v-if="videoLength" class="news-video__len">{{ videoLength }}</span></NewsPhoto>
              </component>
              <div class="news-video__text"><a class="news-video__ti" :href="video.url" target="_blank" rel="noopener noreferrer">{{ video.headline }}</a><span class="news-src">{{ video.source }}</span><span v-if="video.note" class="news-note">{{ video.note }}</span></div>
            </template>
            <div v-if="paper.pages.media.listen" class="news-box news-listen">
              <UiIcon name="Headphones" :size="24" />
              <span class="news-listen__text"><span class="news-serif news-listen__ti">{{ paper.pages.media.listen.headline }}</span><span class="news-src">{{ [paper.pages.media.listen.source, newsLength(paper.pages.media.listen)].filter(Boolean).join(' · ') }}</span></span>
              <a class="news-listen__go" :href="paper.pages.media.listen.url" target="_blank" rel="noopener noreferrer" :aria-label="`Listen to ${paper.pages.media.listen.headline}`"><UiIcon name="Play" :size="16" /></a>
            </div>
          </template>

          <template v-else-if="kind === 'topics' && paper.pages.topics">
            <h2 class="news-pgt">Your topics<small>{{ paper.pages.topics.stories.map(story => story.tag).filter(Boolean).join(' · ') }}</small></h2>
            <div v-for="story in paper.pages.topics.stories" :key="story.id" class="news-topic">
              <NewsPhoto :id="story.id" :src="story.image" :height="150" />
              <span v-if="story.tag" class="news-tag">{{ story.tag }}</span>
              <a class="news-topic__ti" :href="story.url" target="_blank" rel="noopener noreferrer">{{ story.headline }}</a>
              <span class="news-src">{{ story.source }}</span>
            </div>
          </template>

          <template v-else-if="kind === 'near' && paper.pages.near">
            <h2 class="news-pgt">{{ paper.pages.near.city || 'Near you' }}<small>{{ paper.pages.near.weather ? 'Weather and what’s on near you' : 'What’s on near you' }}</small></h2>
            <div v-if="paper.pages.near.weather" class="news-box news-weather"><span class="news-weather__big" aria-hidden="true">{{ paper.pages.near.weather.emoji }}</span><span class="news-weather__text"><span class="news-serif news-weather__temp">{{ paper.pages.near.weather.temp }}</span><span class="news-src">{{ paper.pages.near.weather.text }}</span></span></div>
            <NewsStoryRow v-if="paper.pages.near.local" :story="paper.pages.near.local" />
            <a v-if="paper.pages.near.good" class="news-box news-good" :href="paper.pages.near.good.url" target="_blank" rel="noopener noreferrer"><span class="news-src">One good thing</span><span class="news-serif news-good__ti">{{ paper.pages.near.good.headline }}</span><span class="news-src">{{ paper.pages.near.good.source }}</span></a>
          </template>

          <div v-else class="news-end">
            <span class="news-end__big" aria-hidden="true">🗞️</span>
            <span class="news-serif news-end__ti">That’s your news.</span>
            <span class="news-dek news-end__dek">{{ endLine }}</span>
            <span class="news-src news-end__ask">How was today’s?</span>
            <div class="news-rate">
              <button v-for="rating in ratings" :key="rating.id" type="button" :class="{ 'is-on': paper.rating === rating.id }" :aria-label="rating.label" :aria-pressed="paper.rating === rating.id" @click="emit('rate', rating.id)">{{ rating.emoji }}</button>
            </div>
            <Button color="neutral" shape="pill" class="news-end__done" @click="emit('done')">Done</Button>
            <span class="news-src">Ask ME3 “more about …” any time.</span>
          </div>
        </div>
        <button v-if="index > 0" type="button" class="news-edge news-edge--l" aria-label="Previous page" tabindex="-1" @click="go(index - 1)" />
        <button v-if="index < last" type="button" class="news-edge news-edge--r" aria-label="Next page" tabindex="-1" @click="go(index + 1)" />
        <div class="news-turn">
          <button type="button" class="news-turn__btn" aria-label="Previous page" :disabled="index === 0" @click="go(index - 1)"><UiIcon name="ChevronLeft" :size="20" /></button>
          <div class="news-dots"><button v-for="(page, i) in kinds" :key="page" type="button" :class="{ 'is-on': i === index }" :aria-label="NEWS_PAGE_TITLES[page]" :aria-current="i === index ? 'page' : undefined" @click="go(i)" /></div>
          <button type="button" class="news-turn__btn" aria-label="Next page" :disabled="index === last" @click="go(index + 1)"><UiIcon name="ChevronRight" :size="20" /></button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.news-reader { position: fixed; inset: 0; z-index: 1200; display: flex; justify-content: center; background: var(--ui-bg); color: var(--ui-text); }
.news-reader__sheet { position: relative; display: flex; flex-direction: column; width: min(620px, 100%); height: 100%; perspective: 1400px; overflow: hidden; }
.news-reader__top { position: absolute; top: calc(8px + env(safe-area-inset-top, 0px)); right: 8px; z-index: 4; display: flex; gap: 2px; }
.news-reader__top button { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text); cursor: pointer; }
.news-reader__top button:hover { background: var(--ui-surface-muted); }
.news-pg { flex: 1; overflow-y: auto; padding: calc(56px + env(safe-area-inset-top, 0px)) 20px 120px; transform-origin: left center; backface-visibility: hidden; background: var(--ui-bg); }
.news-pg--next { animation: news-flip-next .55s cubic-bezier(.3, .7, .2, 1) both; }
.news-pg--prev { animation: news-flip-prev .55s cubic-bezier(.3, .7, .2, 1) both; }
@keyframes news-flip-next { 0% { transform: rotateY(-75deg); opacity: .2; box-shadow: 30px 0 40px rgba(0, 0, 0, .2); } 100% { transform: none; opacity: 1; box-shadow: none; } }
@keyframes news-flip-prev { 0% { transform-origin: right center; transform: rotateY(75deg); opacity: .2; } 100% { transform-origin: right center; transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .news-pg--next, .news-pg--prev { animation: none; } }
.news-edge { position: absolute; top: 110px; bottom: 110px; width: 34px; z-index: 3; padding: 0; border: 0; background: none; cursor: pointer; }
.news-edge:hover { background: none; }
.news-edge--l { left: 0; }
.news-edge--r { right: 0; }
.news-turn { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; display: flex; align-items: center; gap: 10px; padding: 10px 18px calc(18px + env(safe-area-inset-bottom, 0px)); background: var(--ui-bg); box-shadow: 0 -1px 0 var(--ui-border); }
.news-turn__btn { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--ui-surface-muted); color: var(--ui-text); cursor: pointer; }
.news-turn__btn:disabled { opacity: .3; cursor: default; }
.news-dots { flex: 1; display: flex; justify-content: center; gap: 6px; }
.news-dots button { width: 7px; height: 7px; min-height: 0; padding: 0; border: 0; border-radius: 50%; background: var(--news-rule); cursor: pointer; }
.news-dots button.is-on { width: 20px; border-radius: 999px; background: var(--ui-text); }

.news-mast { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 2px 0 8px; margin-bottom: 12px; box-shadow: inset 0 -3px 0 -2px var(--ui-text), inset 0 -6px 0 -4px var(--ui-text); }
.news-mast__nm { font-family: ui-serif, 'New York', Georgia, serif; font-size: 38px; font-weight: 800; letter-spacing: -.02em; line-height: 1; }
.news-mast__ed { display: flex; gap: 6px; font-size: 12px; color: var(--ui-text-muted); }
.news-pgt { margin: 4px 0 10px; padding-bottom: 6px; font-family: ui-serif, 'New York', Georgia, serif; font-size: 30px; font-weight: 800; letter-spacing: -.015em; line-height: 1.05; box-shadow: inset 0 -2px 0 var(--ui-text); }
.news-pgt small { display: block; margin-top: 4px; font-family: -apple-system, system-ui, sans-serif; font-size: 12.5px; font-weight: 400; letter-spacing: 0; color: var(--ui-text-muted); }
.news-lead { display: flex; flex-direction: column; gap: 3px; }
.news-lead .news-photo { margin-bottom: 8px; }
.news-lead__ti { font-family: ui-serif, 'New York', Georgia, serif; font-size: 25px; font-weight: 800; line-height: 1.12; letter-spacing: -.015em; color: var(--ui-text); text-decoration: none; padding: 0; }
.news-lead__ti:hover, .news-topic__ti:hover, .news-video__ti:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
.news-lead .news-dek { margin: 5px 0 3px; }
.news-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; margin-top: 12px; padding-top: 10px; box-shadow: inset 0 1px 0 var(--ui-text); }
.news-cols :deep(.news-st) { box-shadow: none; }
.news-cols :deep(.news-st:nth-child(2)) { padding-left: 14px; box-shadow: inset 1px 0 0 var(--ui-border); }
.news-box { padding: 12px 14px; border-radius: 14px; background: var(--ui-surface-muted); margin-top: 12px; }
.news-video { position: relative; height: 0; padding-bottom: 56.25%; border-radius: 6px; overflow: hidden; background: #000; }
.news-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.news-video__poster { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; text-decoration: none; }
.news-video__poster:hover { background: none; }
.news-video__play { position: relative; display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: rgba(0, 0, 0, .62); color: #fff; }
.news-video__len { position: absolute; right: 8px; bottom: 8px; padding: 3px 8px; border-radius: 999px; background: rgba(0, 0, 0, .66); color: #fff; font-size: 12px; font-weight: 600; }
.news-video__text { display: flex; flex-direction: column; gap: 3px; padding: 10px 0 12px; }
.news-video__ti { font-family: ui-serif, 'New York', Georgia, serif; font-size: 20px; font-weight: 700; line-height: 1.24; color: var(--ui-text); text-decoration: none; padding: 0; }
.news-listen { display: flex; align-items: center; gap: 12px; }
.news-listen__text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.news-listen__ti { font-size: 16px; font-weight: 700; }
.news-listen__go { display: flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; padding: 0; border-radius: 50%; background: var(--ui-surface); color: var(--ui-text); }
.news-topic { display: flex; flex-direction: column; gap: 3px; padding: 12px 0; box-shadow: inset 0 -1px 0 var(--ui-border); }
.news-topic:last-child { box-shadow: none; }
.news-tag { align-self: flex-start; margin-top: 8px; padding: 2px 8px; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-size: 12px; }
.news-topic__ti { font-family: ui-serif, 'New York', Georgia, serif; font-size: 17.5px; font-weight: 700; line-height: 1.24; color: var(--ui-text); text-decoration: none; padding: 0; }
.news-weather { display: flex; align-items: center; gap: 12px; }
.news-weather__big { font-size: 40px; line-height: 1; }
.news-weather__text { display: flex; flex-direction: column; gap: 2px; }
.news-weather__temp { font-size: 28px; font-weight: 800; }
.news-good { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; color: var(--ui-text); text-decoration: none; }
.news-good:hover { background: var(--ui-surface-muted); }
.news-good__ti { font-size: 18px; font-weight: 700; line-height: 1.3; }
.news-end { display: flex; flex-direction: column; align-items: center; gap: 10px; padding-top: 30px; text-align: center; }
.news-end__big { font-size: 48px; line-height: 1; }
.news-end__ti { font-size: 30px; font-weight: 800; line-height: 1.1; }
.news-end__dek { max-width: 280px; }
.news-end__ask { margin-top: 10px; }
.news-rate { display: flex; gap: 10px; }
.news-rate button { width: 64px; height: 64px; padding: 0; border: 0; border-radius: 50%; background: var(--ui-surface-muted); font-size: 30px; cursor: pointer; }
.news-rate button.is-on { box-shadow: inset 0 0 0 2px var(--ui-text); }
.news-end__done { align-self: stretch; margin-top: 18px; }
</style>
