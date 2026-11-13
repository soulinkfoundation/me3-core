<script setup lang="ts">
import { nextTick, ref } from "vue";
import UiIcon from "../UiIcon.vue";
import type { NewsSettings } from "../../utils/news";

// The topic chips (me3-6ptk.2): "For your work" first, then "Just for you", then where the owner
// is. Tap a chip to switch it on or off, or add one. Topics are all the owner picks; no sources.
defineProps<{ settings: NewsSettings; workHint?: string }>();
const emit = defineEmits<{ toggle: [group: "work" | "mine", word: string]; add: [group: "work" | "mine", label: string] }>();
const adding = ref<"work" | "mine" | null>(null);
const draft = ref("");
const input = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
function startAdd(group: "work" | "mine") {
  adding.value = group; draft.value = "";
  void nextTick(() => (Array.isArray(input.value) ? input.value[0] : input.value)?.focus());
}
function commit() {
  const text = draft.value.trim();
  if (adding.value && text) emit("add", adding.value, text);
  adding.value = null; draft.value = "";
}
const groups = [{ id: "work" as const, emoji: "💼", title: "For your work" }, { id: "mine" as const, emoji: "💛", title: "Just for you" }];
</script>

<template>
  <div class="news-topics">
    <div v-for="group in groups" :key="group.id" class="news-tg">
      <h4><span aria-hidden="true">{{ group.emoji }}</span>{{ group.title }}<span v-if="group.id === 'work' && workHint" class="news-tg__sub">{{ workHint }}</span></h4>
      <div class="news-chips">
        <button v-for="chip in settings[group.id]" :key="chip.word" type="button" class="news-chip" :class="{ 'is-on': chip.on }" :aria-pressed="chip.on" @click="emit('toggle', group.id, chip.word)">{{ chip.label }}</button>
        <form v-if="adding === group.id" class="news-chip news-chip--input" @submit.prevent="commit">
          <input ref="input" v-model="draft" type="text" maxlength="40" :aria-label="`Add a topic to ${group.title}`" placeholder="Add a topic" enterkeyhint="done" @blur="commit" @keydown.esc.stop.prevent="adding = null" />
        </form>
        <button v-else type="button" class="news-chip news-chip--add" @click="startAdd(group.id)"><UiIcon name="Plus" :size="14" />Add</button>
      </div>
    </div>
    <div class="news-tg">
      <h4><span aria-hidden="true">📍</span>Near you</h4>
      <span class="news-tg__city">{{ settings.city || 'Tell ME3 your town for local news and weather' }}</span>
    </div>
  </div>
</template>

<style scoped>
.news-topics { display: flex; flex-direction: column; }
.news-tg { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; box-shadow: inset 0 -1px 0 var(--ui-border); }
.news-tg:last-child { box-shadow: none; }
.news-tg h4 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; font-weight: 600; color: var(--ui-text-muted); }
.news-tg__sub { margin-left: auto; font-weight: 400; }
.news-tg__city { font-size: 15px; }
.news-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.news-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 0; padding: 6px 11px; border: 0; border-radius: 999px; background: var(--ui-surface-muted); color: var(--ui-text); font-size: 14px; font-weight: 400; cursor: pointer; }
.news-chip.is-on { background: transparent; box-shadow: inset 0 0 0 1.4px var(--ui-text); font-weight: 600; }
.news-chip--add { background: transparent; box-shadow: inset 0 0 0 1.2px var(--ui-border-strong); color: var(--ui-text-muted); }
.news-chip--input { margin: 0; padding: 0 11px; background: transparent; box-shadow: inset 0 0 0 1.4px var(--ui-text); cursor: text; }
.news-chip--input input { width: 120px; padding: 6px 0; border: 0; outline: 0; background: transparent; color: var(--ui-text); font: inherit; box-shadow: none; }
</style>
