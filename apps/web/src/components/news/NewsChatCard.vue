<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import NewsFollow from "./NewsFollow.vue";
import NewsTopics from "./NewsTopics.vue";
import { useNewsFollow } from "../../composables/useNewsFollow";
import { useNewsSettings } from "../../composables/useNewsSettings";
import { readFollowPicks } from "../../utils/news-follow";
import { NEWS_TIME_CHOICES, type NewsChatCard } from "../../utils/news";

// What ME3's news tools draw under a reply (me3-6ptk.2): during setup the topic chips and who the
// owner follows, then the time choices, then "Read it now"; later, a button to open today's paper. Chips save as they are
// tapped, and choosing a time switches News on; the buttons also answer ME3 in the owner's words.
const props = defineProps<{ card: NewsChatCard; busy?: boolean; latest?: boolean }>();
const emit = defineEmits<{ say: [text: string]; time: [time: string]; read: [] }>();
const { settings, load, patch, toggle, addTopic } = useNewsSettings();
// After the topics, "Who do you follow?" in the same card; its Done saves the picks and answers ME3,
// which then asks for a time.
const following = ref(false);
const follow = useNewsFollow();
function lookGood() { following.value = true; void follow.load(readFollowPicks(settings.value?.follows)); }
async function followDone() {
  if (await patch({ follows: follow.follows.value })) emit("say", follow.follows.value.length ? "That's who I follow" : "Skip that for now");
}
onMounted(() => { if (props.card.kind === "topics") void load(); });
const time = ref(NEWS_TIME_CHOICES.includes(props.card.time) ? props.card.time : "06:45");
const times = computed(() => [...new Set([...NEWS_TIME_CHOICES, time.value])].sort());
const done = computed(() => [
  ...(props.card.considered ? [`Read ${props.card.considered} stories from today`] : []),
  `Picked ${props.card.stories} for you`,
  `Laid out ${props.card.pages} pages`,
]);
</script>

<template>
  <div class="news-chat">
    <template v-if="card.kind === 'topics'">
      <section v-if="settings && !following" class="news-chat__card news-chat__card--topics" aria-label="Topics">
        <NewsTopics :settings="settings" @toggle="toggle" @add="addTopic" />
      </section>
      <Button v-if="latest && !following" color="neutral" shape="pill" :disabled="busy || !settings" @click="lookGood">Looks good</Button>
      <template v-if="following">
        <section class="news-chat__card news-chat__card--topics" aria-label="Who do you follow?">
          <h4 class="news-chat__title">Who do you follow?</h4>
          <NewsFollow :state="follow" />
        </section>
        <div v-if="latest" class="news-chat__actions">
          <Button color="neutral" shape="pill" :disabled="busy" @click="followDone">{{ follow.follows.value.length ? `Done · ${follow.follows.value.length} ${follow.follows.value.length === 1 ? 'voice' : 'voices'}` : 'Skip for now' }}</Button>
          <button type="button" class="news-chat__back" @click="following = false">Back to topics</button>
        </div>
      </template>
    </template>
    <template v-else-if="card.kind === 'time'">
      <section class="news-chat__card" aria-label="Time">
        <div class="news-chat__chips"><button v-for="choice in times" :key="choice" type="button" class="news-chat__chip" :class="{ 'is-on': time === choice }" :aria-pressed="time === choice" @click="time = choice">{{ choice }}</button></div>
        <span class="news-chat__hint">I’ll let you know when it’s ready. Weekends an hour later.</span>
      </section>
      <Button v-if="latest" color="neutral" shape="pill" :disabled="busy" @click="emit('time', time)">Done</Button>
    </template>
    <template v-else>
      <ul v-if="card.kind === 'ready'" class="news-chat__done"><li v-for="line in done" :key="line"><UiIcon name="Check" :size="14" />{{ line }}</li></ul>
      <Button color="neutral" shape="pill" @click="emit('read')">{{ card.kind === 'ready' ? 'Read it now' : 'Read your news' }}</Button>
    </template>
  </div>
</template>

<style scoped>
.news-chat { display: flex; flex-direction: column; gap: 10px; width: min(560px, 100%); }
.news-chat :deep(.me3-btn) { align-self: flex-start; }
.news-chat__card { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.news-chat__card--topics { padding: 4px 16px; }
.news-chat__title { margin: 10px 0 0; font-size: 15px; font-weight: 600; }
.news-chat__actions { display: flex; align-items: center; gap: 14px; }
.news-chat__back { min-height: 0; padding: 0; border: 0; background: none; color: var(--ui-text-muted); font: inherit; font-size: 14px; cursor: pointer; }
.news-chat__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.news-chat__chip { min-height: 0; padding: 6px 11px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font-size: 14px; font-weight: 400; cursor: pointer; }
.news-chat__chip.is-on { background: transparent; box-shadow: inset 0 0 0 1.4px var(--ui-text); font-weight: 600; }
.news-chat__hint { font-size: 13px; color: var(--ui-text-muted); }
.news-chat__done { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; font-size: 14px; color: var(--ui-text-muted); }
.news-chat__done li { display: flex; align-items: center; gap: 6px; }
</style>
