<script setup lang="ts">
import { computed, ref } from "vue";
import UiIcon from "../UiIcon.vue";
import { blockTitle, counterSubtitle, counterValue, habitSubtitle, initials, showsInitials, todayIndex, type HomeCardBlock, type HomeCardBlockState, type HomeCardRecord, type HomeCardRequest } from "../../utils/homeCards";

// A custom card's face (catalog me3/cards/v1), drawn the same on Home and in the chat preview: one row per block.
// Data blocks show the install's state exactly as sent, including "Part of ME3 Starter and Business".
const props = withDefaults(defineProps<{ record: HomeCardRecord; busy?: string[]; header?: boolean; badge?: string }>(), { busy: () => [], header: true, badge: "" });
const emit = defineEmits<{ act: [request: HomeCardRequest]; ask: [prompt: string]; open: [] }>();
const today = computed(() => todayIndex(props.record.state.date));
const state = (block: HomeCardBlock, type = block.type): HomeCardBlockState => props.record.state.blocks[block.key || ""] ?? { type };
const isBusy = (block: HomeCardBlock) => props.busy.includes(block.key || "");
const drafts = ref<Record<string, string>>({});
function noteValue(block: HomeCardBlock) { const key = block.key || ""; return drafts.value[key] ?? (typeof state(block).today === "string" ? state(block).today as string : ""); }
function saveNote(block: HomeCardBlock) {
  const key = block.key || "";
  const draft = drafts.value[key];
  if (draft === undefined) return;
  const current = typeof state(block).today === "string" ? state(block).today : "";
  if (draft.trim() !== current) emit("act", { action: "set", key, value: draft });
  const { [key]: _done, ...rest } = drafts.value; drafts.value = rest;
}
const weekLabel = (week: (boolean | null)[]) => `This week: ${week.filter(day => day === true).length} of ${week.filter(day => day !== null).length} days`;
const ticked = (block: HomeCardBlock) => state(block).today === true;
function goalPct(block: HomeCardBlock) { const goal = state(block).goal ?? block.goal; return goal ? Math.min(100, (counterValue(block, state(block)) / goal) * 100) : null; }
const daysTop = (values: number[]) => Math.max(1, ...values);
</script>

<template>
  <div class="cc" :data-card="record.card.id">
    <header v-if="header" class="cc__header">
      <button type="button" class="cc__title" :aria-label="`Open ${record.card.name}`" @click="emit('open')"><span class="cc__emoji" aria-hidden="true">{{ record.card.emoji }}</span><span>{{ record.card.name }}</span></button>
      <span v-if="badge" class="cc__badge">{{ badge }}</span>
      <span v-else-if="record.state.total > 0" class="cc__detail">{{ record.state.done }} of {{ record.state.total }} today</span>
      <slot name="controls" />
    </header>
    <div v-else-if="badge" class="cc__header cc__header--plain"><span class="cc__title"><span class="cc__emoji" aria-hidden="true">{{ record.card.emoji }}</span><span>{{ record.card.name }}</span></span><span class="cc__badge">{{ badge }}</span></div>
    <slot name="menu" />
    <div class="cc__body">
      <template v-for="(block, index) in record.card.blocks" :key="block.key || `text${index}`">
        <div v-if="block.type === 'habit'" class="cc__row">
          <button type="button" class="cc__tick" :class="{ 'is-on': ticked(block) }" :aria-pressed="ticked(block)" :aria-label="block.label || block.key" :disabled="isBusy(block)" @click="emit('act', { action: 'tick', key: block.key!, on: !ticked(block) })"><i><UiIcon name="Check" :size="14" /></i></button>
          <span class="cc__text"><strong>{{ blockTitle(block) }}</strong><small>{{ habitSubtitle(state(block)) }}</small></span>
          <span class="cc__week" role="img" :aria-label="weekLabel(state(block).week || [])"><i v-for="(day, dayIndex) in (state(block).week || Array(7).fill(null)).slice(0, 7)" :key="dayIndex" :class="{ 'is-on': day === true, 'is-off': day === false, 'is-today': dayIndex === today }" /></span>
        </div>
        <div v-else-if="block.type === 'counter'" class="cc__counter">
          <div class="cc__row">
            <span v-if="block.emoji" class="cc__lead" aria-hidden="true">{{ block.emoji }}</span>
            <span class="cc__text"><strong>{{ block.label || block.key }}</strong><small :class="{ 'is-done': state(block).done }">{{ counterSubtitle(block, state(block)) }}</small></span>
            <button type="button" class="cc__round" :aria-label="`Less ${block.label || block.key}`" :disabled="isBusy(block) || counterValue(block, state(block)) <= 0" @click="emit('act', { action: 'add', key: block.key!, by: -(block.step ?? 1) })"><UiIcon name="Minus" :size="16" /></button>
            <button type="button" class="cc__round" :aria-label="`More ${block.label || block.key}`" :disabled="isBusy(block)" @click="emit('act', { action: 'add', key: block.key!, by: block.step ?? 1 })"><UiIcon name="Plus" :size="16" /></button>
          </div>
          <span v-if="goalPct(block) !== null" class="cc__bar cc__bar--thin" :class="{ 'is-indented': block.emoji }" aria-hidden="true"><i :style="{ width: `${goalPct(block)}%` }" /></span>
        </div>
        <label v-else-if="block.type === 'note'" class="cc__row cc__note">
          <span v-if="block.emoji" class="cc__lead" aria-hidden="true">{{ block.emoji }}</span>
          <input type="text" :value="noteValue(block)" :placeholder="block.placeholder || block.label || block.key" :aria-label="block.label || block.key" maxlength="200" @input="drafts[block.key || ''] = ($event.target as HTMLInputElement).value" @blur="saveNote(block)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()">
        </label>
        <div v-else-if="block.type === 'stat'" class="cc__stat"><strong :class="{ 'is-late': state(block).tone === 'late' }">{{ state(block).value ?? '–' }}</strong><span>{{ state(block).label }}</span></div>
        <div v-else-if="block.type === 'progress'" class="cc__progress" role="progressbar" :aria-label="state(block).label || 'Progress'" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(Math.max(0, Math.min(100, state(block).pct ?? 0)))">
          <span class="cc__bar"><i :style="{ width: `${Math.max(0, Math.min(100, state(block).pct ?? 0))}%` }" /></span>
          <small>{{ state(block).label }}</small>
        </div>
        <div v-else-if="block.type === 'days'" class="cc__days" role="img" :aria-label="`This week: ${(state(block).values || []).reduce((sum, value) => sum + value, 0)} bookings`">
          <span v-for="(value, dayIndex) in (state(block).values || Array(7).fill(0)).slice(0, 7)" :key="dayIndex" class="cc__day" :class="{ 'is-today': dayIndex === state(block).today, 'is-past': typeof state(block).today === 'number' && dayIndex < (state(block).today as number) }">
            <span class="cc__day-bar"><i :style="{ height: `${Math.max(3, 44 * value / daysTop(state(block).values || [0]))}px` }" /></span>
            <small>{{ (state(block).labels || ['M', 'T', 'W', 'T', 'F', 'S', 'S'])[dayIndex] }}</small>
          </span>
        </div>
        <template v-else-if="block.type === 'list'">
          <p v-if="!(state(block).rows || []).length" class="cc__row cc__empty"><UiIcon name="Check" :size="14" class="cc__empty-icon" />{{ state(block).empty || 'Nothing here yet.' }}</p>
          <ul v-else class="cc__list">
            <li v-for="row in state(block).rows" :key="row.id" class="cc__row">
              <button v-if="row.check" type="button" class="cc__tick cc__tick--small" :class="{ 'is-on': row.check.on }" :aria-pressed="row.check.on" :aria-label="row.title" :disabled="isBusy(block)" @click="emit('act', { action: 'task.done', key: block.key!, on: !row.check.on, taskId: row.check.taskId })"><i><UiIcon name="Check" :size="12" /></i></button>
              <span v-else-if="showsInitials(block)" class="cc__initials" aria-hidden="true">{{ initials(row.title) }}</span>
              <span class="cc__text"><strong :class="{ 'is-checked': row.check?.on }">{{ row.title }}</strong><small v-if="row.sub" :class="{ 'is-late': row.tone === 'late' }">{{ row.sub }}</small></span>
              <span v-if="row.value" class="cc__value">{{ row.value }}</span>
            </li>
          </ul>
        </template>
        <button v-else-if="block.type === 'action'" type="button" class="cc__action" title="Asks ME3 in chat" @click="emit('ask', block.prompt || block.label || '')">{{ block.label || 'Ask ME3' }}</button>
        <p v-else-if="block.type === 'text'" class="cc__row cc__plain">{{ block.text }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cc { position: relative; }
.cc__header { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0 18px; }
.cc__header--plain { padding-bottom: 4px; }
.cc__title { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 40px; padding: 0; border: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; font-weight: 600; white-space: nowrap; cursor: pointer; }
button.cc__title:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
.cc__emoji, .cc__lead { font-size: 20px; line-height: 1; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
.cc__lead { display: grid; place-items: center; flex: none; width: 30px; }
.cc__detail { color: var(--ui-text-muted); font-size: 12px; white-space: nowrap; }
.cc__badge { padding: 3px 8px; border-radius: 999px; background: var(--ui-accent-soft); color: var(--ui-accent-strong); font-size: 12px; font-weight: 600; white-space: nowrap; }
.cc__body { padding: 0 18px 16px; font-size: 15px; line-height: 1.4; }
.cc__row { display: flex; align-items: center; gap: 12px; min-height: 50px; margin: 0; }
.cc__text { display: grid; flex: 1; gap: 2px; min-width: 0; }
.cc__text strong { overflow: hidden; font-size: 14.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.cc__text strong.is-checked { color: var(--ui-text-muted); text-decoration: line-through; }
.cc__text small { overflow: hidden; color: var(--ui-text-muted); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.cc__text small.is-done { color: var(--ui-accent-strong); }
.is-late { color: var(--ui-warning, #c2410c) !important; }
button { cursor: pointer; font: inherit; color: var(--ui-text); background: transparent; border: 0; }
button:disabled { cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.cc__tick { display: grid; place-items: center; flex: none; width: 44px; height: 44px; margin-left: -7px; padding: 0; border-radius: 50%; }
.cc__tick i { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--ui-surface-muted); color: color-mix(in srgb, var(--ui-text) 30%, transparent); transition: background-color 200ms ease, color 200ms ease; }
.cc__tick--small i { width: 26px; height: 26px; }
.cc__tick.is-on i { background: var(--ui-accent); color: var(--ui-accent-contrast, #fff); }
.cc__tick:disabled i { opacity: .6; }
.cc__week { display: flex; gap: 4px; flex: none; }
.cc__week i { width: 8px; height: 8px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--ui-border); }
.cc__week i.is-on { background: var(--ui-accent); box-shadow: none; }
.cc__week i.is-off { background: var(--ui-surface-muted); box-shadow: none; }
.cc__week i.is-today { outline: 1.5px solid color-mix(in srgb, var(--ui-accent) 50%, transparent); outline-offset: 2px; }
.cc__round { display: grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border-radius: 50%; background: var(--ui-surface-muted); }
.cc__round:hover:not(:disabled) { background: color-mix(in srgb, var(--ui-text) 10%, var(--ui-surface-muted)); }
.cc__round:disabled { opacity: .4; }
.cc__counter { display: grid; gap: 2px; padding-bottom: 4px; }
.cc__bar { display: block; height: 8px; border-radius: 999px; background: var(--ui-surface-muted); overflow: hidden; }
.cc__bar i { display: block; height: 100%; border-radius: inherit; background: var(--ui-accent); transition: width 250ms ease; }
.cc__bar--thin { height: 4px; }
.cc__bar.is-indented { margin-left: 42px; }
.cc__note input { flex: 1; min-width: 0; min-height: 40px; padding: 0 12px; border: 0; border-radius: 12px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; font-size: 14.5px; }
.cc__stat { display: flex; align-items: baseline; gap: 8px; min-height: 48px; padding: 4px 0; }
.cc__stat strong { font-size: 34px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.cc__stat span { color: var(--ui-text-muted); font-size: 14px; }
.cc__progress { display: grid; gap: 6px; padding: 6px 0; }
.cc__progress small { color: var(--ui-text-muted); font-size: 12.5px; }
.cc__days { display: flex; align-items: flex-end; gap: 6px; padding: 6px 0; }
.cc__day { display: grid; flex: 1; gap: 4px; justify-items: center; }
.cc__day-bar { display: flex; align-items: flex-end; width: 100%; height: 44px; }
.cc__day-bar i { display: block; width: 100%; border-radius: 6px; background: var(--ui-accent-soft); }
.cc__day.is-today .cc__day-bar i { background: var(--ui-accent); }
.cc__day.is-past .cc__day-bar i { opacity: .55; }
.cc__day small { color: var(--ui-text-muted); font-size: 11px; font-weight: 600; }
.cc__day.is-today small { color: var(--ui-text); }
.cc__list { margin: 0; padding: 0; list-style: none; }
.cc__list li { min-height: 48px; }
.cc__list li + li { border-top: 1px solid var(--ui-border); }
.cc__initials { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 50%; background: var(--ui-surface-muted); font-size: 12px; font-weight: 700; }
.cc__value { flex: none; font-size: 14.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cc__empty { min-height: 44px; gap: 10px; color: var(--ui-text-muted); font-size: 14px; }
.cc__empty-icon { color: var(--ui-accent-strong); }
.cc__plain { min-height: 32px; color: var(--ui-text-muted); font-size: 14px; }
.cc__action { width: 100%; min-height: 44px; margin-top: 6px; padding: 0 16px; border-radius: 999px; background: var(--ui-surface-muted); font-size: 14.5px; font-weight: 600; }
.cc__action:hover { background: color-mix(in srgb, var(--ui-text) 10%, var(--ui-surface-muted)); }
@media (prefers-reduced-motion: reduce) { .cc__tick i, .cc__bar i { transition: none; } }
</style>
