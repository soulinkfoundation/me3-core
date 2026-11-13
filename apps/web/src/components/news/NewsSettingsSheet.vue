<script setup lang="ts">
import { watch } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import NewsTopics from "./NewsTopics.vue";
import { useNewsSettings } from "../../composables/useNewsSettings";
import { NEWS_TIME_CHOICES } from "../../utils/news";

// News settings (me3-6ptk.2): topics, a time and whether to be told. No source picker.
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const { settings, load, patch, toggle, addTopic } = useNewsSettings();
watch(() => props.open, open => { if (open) void load(); }, { immediate: true });
const changed = async (work: Promise<boolean> | undefined) => { if (await work) emit("changed"); };
function timeChoices(current: string) { return [...new Set([...NEWS_TIME_CHOICES, current])].sort(); }
</script>

<template>
  <AppDialog :open="open" aria-label="News settings" @close="emit('close')">
    <section class="news-settings">
      <header><span class="news-settings__spacer" /><h2><span aria-hidden="true">🗞️</span> News</h2><button type="button" aria-label="Close" @click="emit('close')"><UiIcon name="X" :size="20" /></button></header>
      <template v-if="settings">
        <div class="news-settings__list news-settings__list--topics">
          <NewsTopics :settings="settings" work-hint="from your projects" @toggle="(group, word) => changed(toggle(group, word))" @add="(group, label) => changed(addTopic(group, label))" />
        </div>
        <div class="news-settings__list">
          <label class="news-settings__row">
            <UiIcon name="Sunrise" :size="18" />
            <span class="news-settings__text"><span>Ready at {{ settings.time }}</span><span class="news-settings__sub">{{ settings.weekendOffsetMinutes ? 'Weekends an hour later' : 'Every day' }}</span></span>
            <select :value="settings.time" aria-label="Ready at" @change="changed(patch({ time: ($event.target as HTMLSelectElement).value }))"><option v-for="time in timeChoices(settings.time)" :key="time" :value="time">{{ time }}</option></select>
          </label>
          <div class="news-settings__row">
            <UiIcon name="Bell" :size="18" />
            <span class="news-settings__text"><span>Let me know when it’s ready</span><span class="news-settings__sub">One notification each morning</span></span>
            <button type="button" class="news-switch" role="switch" aria-label="Let me know when it’s ready" :aria-checked="settings.notify" @click="changed(patch({ notify: !settings.notify }, { notify: !settings.notify }))" />
          </div>
        </div>
      </template>
      <p v-else class="news-settings__sub" role="status">Loading…</p>
    </section>
  </AppDialog>
</template>

<style scoped>
.news-settings { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; width: min(520px, 100%); max-height: 88dvh; overflow: auto; padding: 12px 16px 20px; border-radius: 28px; background: var(--ui-bg); box-shadow: var(--ui-shadow-md); }
@media (max-width: 640px) { .news-settings { border-bottom-left-radius: 0; border-bottom-right-radius: 0; padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)); } }
.news-settings header { display: flex; align-items: center; }
.news-settings header h2 { flex: 1; margin: 0; text-align: center; font-size: 16px; font-weight: 700; }
.news-settings header button, .news-settings__spacer { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; }
.news-settings header button { border: 0; border-radius: 50%; background: var(--ui-surface); color: var(--ui-text); cursor: pointer; }
.news-settings__list { border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.news-settings__list--topics { padding: 0 16px; }
.news-settings__row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; box-shadow: inset 0 -1px 0 var(--ui-border); }
.news-settings__row:last-child { box-shadow: none; }
.news-settings__text { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: 15px; }
.news-settings__sub { font-size: 13px; color: var(--ui-text-muted); }
.news-settings__row select { padding: 6px 8px; border: 0; border-radius: 10px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 14px; }
.news-switch { position: relative; flex: none; width: 46px; height: 28px; min-height: 0; padding: 0; border: 0; border-radius: 999px; background: var(--ui-border-strong); cursor: pointer; transition: background .15s; }
.news-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform .15s; }
.news-switch[aria-checked="true"] { background: var(--ui-text); }
.news-switch[aria-checked="true"]::after { transform: translateX(18px); background: var(--ui-bg); }
@media (prefers-reduced-motion: reduce) { .news-switch, .news-switch::after { transition: none; } }
</style>
