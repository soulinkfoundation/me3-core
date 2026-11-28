<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import type { NewsTopicChip } from "../../utils/news";
import { newsCanAddTyped, newsPantryAddTyped, newsPantryShelves, newsPantryToggle, newsPantryYours, newsTypedTopic, type NewsPantryItem, type NewsPantryLane } from "../../utils/news-setup";

// The pantry in News setup (me3-6ptk.13): shelves of topics to tap, with a box for anything that
// isn't there. It edits the course's chips in place; the setup sheet saves them with the order.
const props = defineProps<{ lane: NewsPantryLane | null; chips: NewsTopicChip[] }>();
const emit = defineEmits<{ "update:chips": [chips: NewsTopicChip[]]; close: [] }>();
const search = ref("");
const full = ref(false);
watch(() => props.lane, () => { search.value = ""; full.value = false; });
const shelves = computed(() => props.lane ? newsPantryShelves(props.lane, search.value) : []);
const yours = computed(() => props.lane && !search.value ? newsPantryYours(props.lane, props.chips) : []);
const typed = computed(() => newsTypedTopic(search.value));
const canAdd = computed(() => Boolean(props.lane) && newsCanAddTyped(props.lane!, props.chips, search.value));
const isOn = (item: NewsPantryItem) => props.chips.some(chip => chip.word === item.word && chip.on);
function apply(change: { chips: NewsTopicChip[]; full: boolean }) {
  full.value = change.full;
  if (!change.full) emit("update:chips", change.chips);
  return !change.full;
}
function toggle(item: NewsPantryItem) { apply(newsPantryToggle(props.chips, item)); }
function addTyped() { if (typed.value && apply(newsPantryAddTyped(props.chips, search.value))) search.value = ""; }
</script>

<template>
  <AppDialog :open="Boolean(lane)" class="news-kitchen" :aria-label="lane === 'work' ? 'Add to your work' : 'Add what you love'" @close="emit('close')">
    <section class="pantry">
      <h2>{{ lane === 'work' ? 'Add to your work' : 'Add what you love' }}</h2>
      <form class="pantry__search" @submit.prevent="addTyped">
        <UiIcon name="Search" :size="16" />
        <input v-model="search" type="text" maxlength="60" placeholder="Search, or type your own" aria-label="Search topics, or type your own" autocomplete="off" spellcheck="false" data-testid="news-pantry-search" />
      </form>
      <p v-if="full" class="pantry__full" role="alert"><strong>That’s a full plate.</strong> ME3 cooks with up to 12 here. Take one off to add another.</p>
      <div class="pantry__shelves">
        <button v-if="canAdd" type="button" class="pantry__typed" @click="addTyped"><UiIcon name="Plus" :size="16" />Add “{{ typed }}”</button>
        <div v-if="yours.length" class="pantry__shelf">
          <h3>On your menu</h3>
          <div class="pantry__items">
            <button v-for="item in yours" :key="item.word" type="button" class="pantry__item" :class="{ 'is-on': isOn(item) }" :aria-pressed="isOn(item)" @click="toggle(item)"><span aria-hidden="true">{{ item.emoji }}</span>{{ item.label }}</button>
          </div>
        </div>
        <div v-for="shelf in shelves" :key="shelf.title" class="pantry__shelf">
          <h3>{{ shelf.title }}</h3>
          <div class="pantry__items">
            <button v-for="item in shelf.items" :key="item.word" type="button" class="pantry__item" :class="{ 'is-on': isOn(item) }" :aria-pressed="isOn(item)" @click="toggle(item)"><span aria-hidden="true">{{ item.emoji }}</span>{{ item.label }}</button>
          </div>
        </div>
      </div>
      <button type="button" class="kitchen-btn" data-testid="news-pantry-done" @click="emit('close')">Done</button>
    </section>
  </AppDialog>
</template>

<style scoped>
.pantry { display: flex; flex-direction: column; box-sizing: border-box; width: min(460px, 100%); height: min(760px, calc(100dvh - 48px)); padding: 24px 16px 14px; border-radius: 28px; background: var(--k-walls); color: var(--k-ink); box-shadow: var(--ui-shadow-md); }
@media (max-width: 640px) { .pantry { height: 92dvh; border-bottom-left-radius: 0; border-bottom-right-radius: 0; padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)); } }
.pantry h2 { margin: 0 0 14px; font-family: var(--k-display); font-size: 22px; font-weight: 800; text-align: center; }
.pantry__search { display: flex; align-items: center; gap: 8px; flex: none; height: 44px; padding: 0 14px; border-radius: 999px; background: var(--k-surface); box-shadow: inset 0 0 0 1px var(--k-line); color: var(--k-ink-muted); }
.pantry__search:focus-within { box-shadow: inset 0 0 0 2px var(--k-ink); }
.pantry__search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--k-ink); font: inherit; font-size: 16px; box-shadow: none; }
.pantry__full { margin: 10px 0 0; padding: 10px 14px; border-radius: 14px; background: var(--k-muted); font-size: 14px; }
.pantry__shelves { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; align-items: flex-start; gap: 22px; margin: 0 -16px; padding: 14px 16px 20px; }
.pantry__shelf { width: 100%; }
.pantry__shelf h3 { margin: 0 0 10px; font-family: var(--k-hand); font-size: 17px; font-weight: 700; color: var(--k-ink-muted); }
.pantry__items { display: flex; flex-wrap: wrap; gap: 8px; }
.pantry__item, .pantry__typed { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--k-surface); box-shadow: inset 0 0 0 1px var(--k-line); color: var(--k-ink); font: inherit; font-size: 15px; cursor: pointer; }
.pantry__item.is-on { background: var(--k-ink); box-shadow: none; color: var(--k-walls); font-weight: 600; }
.pantry__typed { min-height: 42px; background: var(--k-muted); box-shadow: none; font-weight: 600; }
.pantry :focus-visible { outline: 2px solid var(--k-ink); outline-offset: 2px; }
.pantry__search input:focus-visible { outline: none; }
</style>
