<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { initials, type NewsYouTubeChannel } from "../../utils/news-follow";

// The owner's YouTube subscriptions, to pick from (me3-6ptk.11). The list lives only here while they
// pick; nothing is saved until the picked channels are added as follows.
const props = defineProps<{ channels: NewsYouTubeChannel[] | null; following: Set<string>; room: number }>();
const emit = defineEmits<{ add: [picked: NewsYouTubeChannel[]]; close: [] }>();
const picked = ref<Set<string>>(new Set());
const search = ref("");
const full = ref(false);
watch(() => props.channels, () => { picked.value = new Set(); search.value = ""; full.value = false; });
// A followed channel's feed names its id, whichever form of feed Soup gave.
const followed = (channel: NewsYouTubeChannel) => [...props.following].some(feed => feed.includes(channel.id));
const shown = computed(() => {
  const query = search.value.trim().toLowerCase();
  return (props.channels || []).filter(channel => !query || channel.title.toLowerCase().includes(query));
});
function flip(channel: NewsYouTubeChannel) {
  if (followed(channel)) return;
  const next = new Set(picked.value);
  if (next.has(channel.id)) next.delete(channel.id);
  else if (next.size >= props.room) { full.value = true; return; }
  else next.add(channel.id);
  full.value = false;
  picked.value = next;
}
function add() { emit("add", (props.channels || []).filter(channel => picked.value.has(channel.id))); }
</script>

<template>
  <AppDialog :open="Boolean(channels)" aria-label="Your YouTube subscriptions" @close="emit('close')">
    <section class="yt-pick">
      <header>
        <h2>Your YouTube</h2>
        <button type="button" aria-label="Close" @click="emit('close')"><UiIcon name="X" :size="20" /></button>
      </header>
      <p class="yt-pick__sub">Pick the channels ME3 should reach for. Only the ones you pick are kept.</p>
      <label v-if="(channels || []).length > 8" class="yt-pick__search">
        <UiIcon name="Search" :size="16" />
        <input v-model="search" type="search" placeholder="Search your channels" aria-label="Search your channels" />
      </label>
      <p v-if="full" class="yt-pick__note" role="status">You can follow up to 30 voices. Untick some to add others.</p>
      <ul class="yt-pick__list">
        <li v-for="channel in shown" :key="channel.id">
          <button type="button" class="yt-pick__row" :aria-pressed="picked.has(channel.id) || followed(channel)" :disabled="followed(channel)" @click="flip(channel)">
            <img v-if="channel.image" :src="channel.image" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <span v-else class="yt-pick__initials" aria-hidden="true">{{ initials(channel.title) }}</span>
            <span class="yt-pick__name">{{ channel.title }}</span>
            <span v-if="followed(channel)" class="yt-pick__following">Following</span>
            <span v-else class="yt-pick__box" :class="{ 'is-on': picked.has(channel.id) }"><UiIcon v-if="picked.has(channel.id)" name="Check" :size="14" /></span>
          </button>
        </li>
      </ul>
      <Button color="neutral" shape="pill" :disabled="!picked.size" @click="add">{{ picked.size ? `Add ${picked.size}` : 'Add' }}</Button>
    </section>
  </AppDialog>
</template>

<style scoped>
.yt-pick { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: min(480px, 100%); max-height: 86dvh; padding: 12px 16px 18px; border-radius: 28px; background: var(--ui-bg); box-shadow: var(--ui-shadow-md); }
@media (max-width: 640px) { .yt-pick { border-bottom-left-radius: 0; border-bottom-right-radius: 0; padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px)); } }
.yt-pick header { display: flex; align-items: center; justify-content: space-between; }
.yt-pick h2 { margin: 0; font-size: 17px; }
.yt-pick header button { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--ui-surface); color: var(--ui-text); cursor: pointer; }
.yt-pick__sub, .yt-pick__note { margin: 0; font-size: 14px; color: var(--ui-text-muted); }
.yt-pick__search { display: flex; align-items: center; gap: 8px; padding: 0 14px; height: 40px; border-radius: 999px; background: var(--ui-surface); box-shadow: inset 0 0 0 1px var(--ui-border); color: var(--ui-text-muted); }
.yt-pick__search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ui-text); font: inherit; box-shadow: none; }
.yt-pick__list { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 0; list-style: none; }
.yt-pick__row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 0; padding: 8px 4px; border: 0; background: transparent; color: var(--ui-text); font: inherit; text-align: left; cursor: pointer; }
.yt-pick__row:disabled { cursor: default; }
.yt-pick__row img, .yt-pick__initials { flex: none; width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: var(--ui-surface-muted); }
.yt-pick__initials { display: grid; place-items: center; font-size: 14px; font-weight: 600; }
.yt-pick__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.yt-pick__following { font-size: 13px; color: var(--ui-text-muted); }
.yt-pick__box { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--ui-border-strong); }
.yt-pick__box.is-on { background: var(--ui-text); color: var(--ui-bg); box-shadow: none; }
.yt-pick :deep(.me3-btn) { align-self: stretch; justify-content: center; }
</style>
