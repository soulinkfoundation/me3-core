<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import NewsPhoto from "./NewsPhoto.vue";
import NewsStoryRow from "./NewsStoryRow.vue";
import { NEWS_PAGE_TITLES, newsDate, newsEmbedUrl, newsLength, newsPageKinds, newsSharedLine, type NewsPaper, type NewsRating } from "../../utils/news";

// The paper, opened (me3-6ptk.5): a handful of pages you flick through, with a page turn. Swipe,
// tap the edges or the dots, or use the arrow keys; with a mouse there are arrows too. The page's
// name sits in the top bar, so the page starts with its stories. A paper has an end, where you can
// say how it was. Anywhere on a story opens it at its source; a video plays here only after a tap.
const props = defineProps<{ paper: NewsPaper; nextTime: string }>();
const emit = defineEmits<{ close: []; done: []; settings: []; rate: [rating: NewsRating]; ask: [prompt: string] }>();

const kinds = computed(() => newsPageKinds(props.paper));
const index = ref(0);
const direction = ref<"next" | "prev" | "">("");
const kind = computed(() => kinds.value[index.value]);
const last = computed(() => kinds.value.length - 1);
/** The video playing in place, by story id. One at a time; it stops when the page turns. */
const playing = ref<string | null>(null);
const listening = ref(false);
const pageEl = ref<HTMLElement | null>(null);
const closeEl = ref<HTMLButtonElement | null>(null);
function go(target: number) {
  if (target < 0 || target > last.value || target === index.value) return;
  direction.value = target > index.value ? "next" : "prev";
  index.value = target;
  playing.value = null; listening.value = false;
  void nextTick(() => { if (pageEl.value) pageEl.value.scrollTop = 0; });
}
watch(() => props.paper.id, () => { index.value = 0; direction.value = ""; playing.value = null; listening.value = false; });
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

// The video ME3 picked, then up to two more. Each plays here after a tap when it has a player.
const videos = computed(() => {
  const media = props.paper.pages.media;
  return [media?.video, ...(media?.more || [])].filter((story): story is NonNullable<typeof story> => Boolean(story)).map(story => ({ story, embed: newsEmbedUrl(story), length: story.minutes ? `${story.minutes} min` : "" }));
});
function play(id: string) { listening.value = false; playing.value = id; }
function listen() { playing.value = null; listening.value = true; }
// The top bar names the page: "News" and the date on the front, the section and what is in it after.
const title = computed(() => kind.value === "front" || kind.value === "end" ? "News" : kind.value === "near" ? props.paper.pages.near?.city || NEWS_PAGE_TITLES.near : NEWS_PAGE_TITLES[kind.value]);
const subtitle = computed(() => {
  const pages = props.paper.pages;
  if (kind.value === "front") return `${newsDate(props.paper.dateKey, "long")} · Ready at ${props.paper.time}`;
  if (kind.value === "work") return pages.work?.topics.join(" · ") || "";
  if (kind.value === "media") return "Picked for this week";
  if (kind.value === "topics") return pages.topics?.stories.map(story => story.tag).filter(Boolean).join(" · ") || "";
  if (kind.value === "near") return pages.near?.weather ? "Weather and what’s on near you" : "What’s on near you";
  return "";
});
const ratings: Array<{ id: NewsRating; emoji: string; label: string }> = [{ id: "fire", emoji: "🔥", label: "Loved it" }, { id: "ok", emoji: "🙂", label: "It was fine" }, { id: "sleepy", emoji: "😴", label: "A bit dull" }];
const endLine = computed(() => {
  const { stories, videos } = props.paper.counts;
  return `${stories} ${stories === 1 ? "story" : "stories"}${videos === 1 ? " and a video" : videos > 1 ? ` and ${videos} videos` : ""}. Tomorrow’s will be ready at ${props.nextTime}.`;
});
</script>

<template>
  <Teleport to="body">
    <div class="news-reader" role="dialog" aria-modal="true" aria-label="News" @touchstart.passive="touchStart" @touchend.passive="touchEnd">
      <div class="news-reader__sheet">
        <div class="news-reader__top">
          <button type="button" aria-label="News settings" @click="emit('settings')"><UiIcon name="Ellipsis" :size="20" /></button>
          <h2 class="news-reader__title">{{ title }}<small v-if="subtitle">{{ subtitle }}</small></h2>
          <button ref="closeEl" type="button" aria-label="Close" @click="emit('close')"><UiIcon name="X" :size="20" /></button>
        </div>
        <div :key="index" ref="pageEl" class="news-pg" :class="direction ? `news-pg--${direction}` : ''" :aria-label="NEWS_PAGE_TITLES[kind]">
          <template v-if="kind === 'front'">
            <div class="news-lead">
              <a class="news-open" :href="paper.pages.front.lead.url" target="_blank" rel="noopener noreferrer">
                <NewsPhoto :id="paper.pages.front.lead.id" :src="paper.pages.front.lead.image" :height="200" />
                <span class="news-lead__ti">{{ paper.pages.front.lead.headline }}</span>
                <span v-if="paper.pages.front.lead.summary" class="news-dek news-lead__dek">{{ paper.pages.front.lead.summary }}</span>
                <span class="news-src news-by">{{ paper.pages.front.lead.source }}</span>
                <span v-if="newsSharedLine(paper.pages.front.lead)" class="news-src news-shared">{{ newsSharedLine(paper.pages.front.lead) }}</span>
              </a>
              <span v-if="paper.pages.front.lead.note" class="news-note">{{ paper.pages.front.lead.note }}</span>
            </div>
            <div v-if="paper.pages.front.briefs.length" class="news-cols"><NewsStoryRow v-for="story in paper.pages.front.briefs" :key="story.id" :story="story" small /></div>
          </template>

          <template v-else-if="kind === 'work' && paper.pages.work">
            <NewsStoryRow v-for="(story, i) in paper.pages.work.stories" :key="story.id" :story="story" :picture="i === 0 && Boolean(story.image)" @ask="emit('ask', $event)" />
          </template>

          <template v-else-if="kind === 'media' && paper.pages.media">
            <div v-for="(item, n) in videos" :key="item.story.id" class="news-watch" :class="{ 'news-watch--more': n > 0 }">
              <div v-if="playing === item.story.id && item.embed" class="news-video"><iframe :src="item.embed" :title="item.story.headline" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" /></div>
              <component :is="item.embed ? 'button' : 'a'" v-else class="news-video__poster" v-bind="item.embed ? { type: 'button' } : { href: item.story.url, target: '_blank', rel: 'noopener noreferrer' }" :aria-label="`Play ${item.story.headline}`" @click="item.embed && play(item.story.id)">
                <NewsPhoto :id="item.story.id" :src="item.story.image" :height="n === 0 ? 210 : 170" ratio="16 / 9"><span class="news-video__play"><UiIcon name="Play" :size="22" /></span><span v-if="item.length" class="news-video__len">{{ item.length }}</span></NewsPhoto>
              </component>
              <div class="news-video__text"><a class="news-video__ti" :class="{ 'news-video__ti--more': n > 0 }" :href="item.story.url" target="_blank" rel="noopener noreferrer">{{ item.story.headline }}</a><span class="news-src news-by">{{ item.story.source }}</span><span v-if="item.story.note" class="news-note">{{ item.story.note }}</span></div>
            </div>
            <template v-if="paper.pages.media.listen">
              <!-- With its own audio file a listen plays here; otherwise it opens at its source. -->
              <div v-if="paper.pages.media.listen.audioUrl" class="news-box news-listen-box">
                <button type="button" class="news-listen" :aria-label="`Listen to ${paper.pages.media.listen.headline}`" :aria-expanded="listening" @click="listen">
                  <UiIcon name="Headphones" :size="24" />
                  <span class="news-listen__text"><span class="news-serif news-listen__ti">{{ paper.pages.media.listen.headline }}</span><span class="news-src">{{ [paper.pages.media.listen.source, newsLength(paper.pages.media.listen)].filter(Boolean).join(' · ') }}</span></span>
                  <span v-if="!listening" class="news-listen__go" aria-hidden="true"><UiIcon name="Play" :size="16" /></span>
                </button>
                <audio v-if="listening" class="news-listen__audio" :src="paper.pages.media.listen.audioUrl" controls autoplay preload="none" />
              </div>
              <a v-else class="news-box news-listen" :href="paper.pages.media.listen.url" target="_blank" rel="noopener noreferrer" :aria-label="`Listen to ${paper.pages.media.listen.headline}`">
                <UiIcon name="Headphones" :size="24" />
                <span class="news-listen__text"><span class="news-serif news-listen__ti">{{ paper.pages.media.listen.headline }}</span><span class="news-src">{{ [paper.pages.media.listen.source, newsLength(paper.pages.media.listen)].filter(Boolean).join(' · ') }}</span></span>
                <span class="news-listen__go" aria-hidden="true"><UiIcon name="Play" :size="16" /></span>
              </a>
            </template>
          </template>

          <template v-else-if="kind === 'topics' && paper.pages.topics">
            <a v-for="story in paper.pages.topics.stories" :key="story.id" class="news-topic news-open" :href="story.url" target="_blank" rel="noopener noreferrer">
              <NewsPhoto :id="story.id" :src="story.image" :height="170" />
              <span v-if="story.tag" class="news-tag">{{ story.tag }}</span>
              <span class="news-topic__ti">{{ story.headline }}</span>
              <span class="news-src news-by">{{ story.source }}</span>
              <span v-if="newsSharedLine(story)" class="news-src news-shared">{{ newsSharedLine(story) }}</span>
            </a>
          </template>

          <template v-else-if="kind === 'near' && paper.pages.near">
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
.news-reader__top { flex: none; display: flex; align-items: flex-start; gap: 4px; margin: 0 20px; padding: calc(8px + env(safe-area-inset-top, 0px)) 0 8px; box-shadow: inset 0 -2px 0 var(--ui-text); }
.news-reader__top button:first-child { margin-left: -10px; }
.news-reader__top button:last-child { margin-right: -10px; }
.news-reader__title { flex: 1; min-width: 0; margin: 0; text-align: center; font-family: ui-serif, 'New York', Georgia, serif; font-size: 22px; font-weight: 800; letter-spacing: -.015em; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-top: 8px; }
.news-reader__title small { display: block; margin-top: 6px; font-family: -apple-system, system-ui, sans-serif; font-size: 12px; font-weight: 400; letter-spacing: 0; color: var(--ui-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.news-reader__top button { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text); cursor: pointer; }
.news-reader__top button:hover { background: var(--ui-surface-muted); }
.news-pg { flex: 1; overflow-y: auto; padding: 14px 20px 84px; transform-origin: left center; backface-visibility: hidden; background: var(--ui-bg); }
.news-pg--next { animation: news-flip-next .55s cubic-bezier(.3, .7, .2, 1) both; }
.news-pg--prev { animation: news-flip-prev .55s cubic-bezier(.3, .7, .2, 1) both; }
@keyframes news-flip-next { 0% { transform: rotateY(-75deg); opacity: .2; box-shadow: 30px 0 40px rgba(0, 0, 0, .2); } 100% { transform: none; opacity: 1; box-shadow: none; } }
@keyframes news-flip-prev { 0% { transform-origin: right center; transform: rotateY(75deg); opacity: .2; } 100% { transform-origin: right center; transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .news-pg--next, .news-pg--prev { animation: none; } }
.news-edge { position: absolute; top: 110px; bottom: 110px; width: 34px; z-index: 3; padding: 0; border: 0; background: none; cursor: pointer; }
.news-edge:hover { background: none; }
.news-edge--l { left: 0; }
.news-edge--r { right: 0; }
/* Just the page dots, floating over the page. Arrows join them only where there is a mouse to click them. */
.news-turn { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 0 18px calc(12px + env(safe-area-inset-bottom, 0px)); pointer-events: none; }
.news-turn > * { pointer-events: auto; }
.news-turn__btn { display: none; }
@media (hover: hover) and (pointer: fine) { .news-turn__btn { display: flex; } }
.news-turn__btn { align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--ui-surface-muted); color: var(--ui-text); cursor: pointer; }
.news-turn__btn:disabled { opacity: .3; cursor: default; }
.news-dots { display: flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 999px; background: color-mix(in srgb, var(--ui-surface-muted) 78%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.news-dots button { width: 7px; height: 7px; min-height: 0; padding: 0; border: 0; border-radius: 50%; background: color-mix(in srgb, var(--ui-text) 28%, transparent); cursor: pointer; }
.news-dots button.is-on { width: 20px; border-radius: 999px; background: var(--ui-text); }

/* A whole story is one link: picture, headline and summary all open it. */
.news-open { display: flex; flex-direction: column; gap: 3px; padding: 0; color: var(--ui-text); text-decoration: none; }
.news-open:hover { background: transparent; }
.news-open:hover .news-lead__ti, .news-open:hover .news-topic__ti { text-decoration: underline; text-underline-offset: 3px; }
.news-open:focus-visible { outline: 2px solid var(--ui-focus, currentColor); outline-offset: 4px; border-radius: 6px; }
.news-lead { display: flex; flex-direction: column; gap: 3px; }
.news-lead .news-photo { margin-bottom: 8px; }
.news-lead__ti { font-family: ui-serif, 'New York', Georgia, serif; font-size: 25px; font-weight: 800; line-height: 1.12; letter-spacing: -.015em; color: var(--ui-text); text-decoration: none; padding: 0; }
.news-video__ti:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
.news-lead__dek { margin: 5px 0 3px; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.news-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; margin-top: 12px; padding-top: 10px; box-shadow: inset 0 1px 0 var(--ui-text); }
.news-cols :deep(.news-st) { box-shadow: none; }
.news-cols :deep(.news-st:nth-child(even)) { padding-left: 14px; box-shadow: inset 1px 0 0 var(--ui-border); }
.news-cols :deep(.news-st:nth-child(n + 3)) { border-top: 1px solid var(--ui-border); }
.news-box { padding: 12px 14px; border-radius: 14px; background: var(--ui-surface-muted); margin-top: 12px; }
.news-video { position: relative; height: 0; padding-bottom: 56.25%; border-radius: 6px; overflow: hidden; background: #000; }
.news-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.news-video__poster { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; text-decoration: none; }
.news-video__poster:hover { background: none; }
.news-video__play { position: relative; display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: rgba(0, 0, 0, .62); color: #fff; }
.news-video__len { position: absolute; right: 8px; bottom: 8px; padding: 3px 8px; border-radius: 999px; background: rgba(0, 0, 0, .66); color: #fff; font-size: 12px; font-weight: 600; }
.news-video__text { display: flex; flex-direction: column; gap: 3px; padding: 10px 0 12px; }
.news-video__ti { font-family: ui-serif, 'New York', Georgia, serif; font-size: 20px; font-weight: 700; line-height: 1.24; color: var(--ui-text); text-decoration: none; padding: 0; }
.news-watch--more { padding-top: 12px; box-shadow: inset 0 1px 0 var(--ui-border); }
.news-video__ti--more { font-size: 17.5px; }
.news-listen { display: flex; align-items: center; gap: 12px; color: var(--ui-text); text-decoration: none; }
.news-listen-box { display: flex; flex-direction: column; gap: 10px; }
button.news-listen { width: 100%; padding: 0; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; }
.news-listen__audio { width: 100%; height: 40px; }
.news-listen:hover { background: var(--ui-surface-muted); }
.news-listen__text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.news-listen__ti { font-size: 16px; font-weight: 700; }
.news-listen__go { display: flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; padding: 0; border-radius: 50%; background: var(--ui-surface); color: var(--ui-text); }
.news-topic { padding: 12px 0; box-shadow: inset 0 -1px 0 var(--ui-border); }
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
