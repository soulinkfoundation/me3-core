<script setup lang="ts">
import { computed, ref } from "vue";
import UiIcon from "../UiIcon.vue";
import NewsYouTubePick from "./NewsYouTubePick.vue";
import { initials, type NewsFollowCard, type NewsMedium } from "../../utils/news-follow";
import type { useNewsFollow } from "../../composables/useNewsFollow";

// "Who do you follow?" (me3-6ptk.10, .11): pick faces, add someone else by name or link, or bring
// in YouTube subscriptions. The caller owns the state (useNewsFollow) and saves the picks.
const props = defineProps<{ state: ReturnType<typeof useNewsFollow> }>();
const media: Array<{ id: NewsMedium | null; label: string }> = [{ id: null, label: "All" }, { id: "listen", label: "Listen" }, { id: "read", label: "Read" }, { id: "watch", label: "Watch" }];
const medium = ref<NewsMedium | null>(null);
const own = ref("");
const shown = computed(() => props.state.list.value.filter(card => !medium.value || card.medium === medium.value));
const picked = computed(() => new Set(props.state.follows.value.map(follow => follow.id)));
const followingFeeds = computed(() => new Set(props.state.follows.value.map(follow => follow.feed)));
const icon = (card: NewsFollowCard) => card.medium === "listen" ? "Headphones" : card.medium === "watch" ? "Play" : "BookOpen";
async function addOwn() { if (await props.state.addOwn(own.value)) { own.value = ""; medium.value = null; } }
async function addYouTube(channels: Parameters<typeof props.state.addYouTube>[0]) { await props.state.addYouTube(channels); medium.value = null; }
</script>

<template>
  <div class="news-follow">
    <p class="news-follow__lead">Pick the voices you trust. ME3 reaches for them first when it cooks your paper.</p>
    <div class="news-follow__media" role="group" aria-label="Show">
      <button v-for="entry in media" :key="entry.label" type="button" class="news-follow__medium" :class="{ 'is-on': medium === entry.id }" :aria-pressed="medium === entry.id" @click="medium = entry.id">{{ entry.label }}</button>
    </div>
    <form class="news-follow__field" @submit.prevent="addOwn">
      <UiIcon name="Search" :size="16" />
      <input v-model="own" type="text" maxlength="300" placeholder="Someone else? A name, @handle or link" aria-label="Add someone else by name, @handle or link" autocomplete="off" autocapitalize="off" spellcheck="false" />
      <span v-if="state.ownBusy.value" class="news-follow__spinner" aria-label="Looking that up" />
      <button v-else-if="own.trim()" type="submit" class="news-follow__add">Add</button>
    </form>
    <p v-if="state.ownNote.value" class="news-follow__note" role="status">{{ state.ownNote.value }}</p>
    <button type="button" class="news-follow__field news-follow__youtube" @click="state.connectYouTube()">
      <UiIcon name="Youtube" :size="18" />
      <span>Bring in your YouTube subscriptions</span>
      <span v-if="state.youtubeBusy.value" class="news-follow__spinner" aria-label="Waiting for YouTube" />
      <UiIcon v-else name="ChevronRight" :size="16" />
    </button>
    <p v-if="state.youtubeNote.value" class="news-follow__note" role="status">{{ state.youtubeNote.value }}</p>
    <p v-if="state.loading.value && !state.list.value.length" class="news-follow__note" role="status">Loading voices…</p>
    <p v-else-if="state.failed.value && !state.list.value.length" class="news-follow__note">
      The Human Soup’s list of voices isn’t ready just now. You can add them later.
      <button type="button" class="news-follow__retry" @click="state.load(state.follows.value)">Try again</button>
    </p>
    <ul v-else class="news-follow__faces">
      <li v-for="card in shown" :key="card.id">
        <button type="button" class="news-face" :class="{ 'is-on': picked.has(card.id), 'is-dim': picked.size && !picked.has(card.id) }" :aria-pressed="picked.has(card.id)" :aria-label="card.note ? `${card.name}. ${card.note}` : card.name" @click="state.toggle(card)">
          <span class="news-face__photo">
            <img v-if="card.image" :src="card.image" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <span v-else aria-hidden="true">{{ initials(card.name) }}</span>
            <span v-if="picked.has(card.id)" class="news-face__tick" aria-hidden="true"><UiIcon name="Check" :size="12" /></span>
          </span>
          <span class="news-face__name">{{ card.name }}</span>
          <UiIcon :name="icon(card)" :size="12" />
        </button>
      </li>
    </ul>
    <NewsYouTubePick :channels="state.youtubeChannels.value" :following="followingFeeds" :room="state.room.value" @add="addYouTube" @close="state.youtubeChannels.value = null" />
  </div>
</template>

<style scoped>
.news-follow { display: flex; flex-direction: column; gap: 10px; padding: 12px 0; }
.news-follow__lead, .news-follow__note { margin: 0; font-size: 14px; color: var(--ui-text-muted); }
.news-follow__note { padding-left: 14px; font-size: 13px; }
.news-follow__media { display: flex; flex-wrap: wrap; gap: 6px; }
.news-follow__medium { min-height: 0; padding: 6px 13px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font-size: 14px; cursor: pointer; }
.news-follow__medium.is-on { background: var(--ui-text); color: var(--ui-bg); font-weight: 600; }
.news-follow__field { display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; height: 44px; margin: 0; padding: 0 14px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text-muted); font: inherit; }
.news-follow__field input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; box-shadow: none; }
.news-follow__add, .news-follow__retry { min-height: 0; padding: 0; border: 0; background: none; color: var(--ui-text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.news-follow__youtube { cursor: pointer; text-align: left; }
.news-follow__youtube > span:first-of-type { flex: 1; color: var(--ui-text); font-size: 15px; font-weight: 600; }
.news-follow__youtube :deep(svg:first-child) { color: #db1c1c; }
.news-follow__spinner { flex: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--ui-border-strong); border-top-color: var(--ui-text); animation: news-follow-spin .8s linear infinite; }
@keyframes news-follow-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .news-follow__spinner { animation-duration: 2.4s; } }
.news-follow__faces { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 16px 6px; margin: 4px 0 0; padding: 0; list-style: none; }
.news-face { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 100%; min-height: 0; padding: 0; border: 0; background: none; color: var(--ui-text-muted); font: inherit; cursor: pointer; }
.news-face__photo { position: relative; display: grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; background: var(--ui-surface-muted); box-shadow: inset 0 0 0 1px var(--ui-border); color: var(--ui-text); font-size: 17px; font-weight: 600; }
.news-face__photo img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.news-face.is-on .news-face__photo { box-shadow: 0 0 0 3px var(--ui-text); }
.news-face.is-dim .news-face__photo { opacity: .75; }
.news-face__tick { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--ui-text); color: var(--ui-bg); box-shadow: 0 0 0 2px var(--ui-bg); }
.news-face__name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--ui-text); font-size: 12px; line-height: 1.3; text-align: center; }
.news-face.is-on .news-face__name { font-weight: 600; }
</style>
