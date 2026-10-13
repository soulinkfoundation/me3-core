<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { gratitudeLines, type GratitudeState, type GratitudeSettings, type Quote } from "../../utils/gratitude";

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const emit = defineEmits<{ unavailable: [] }>();
const { toastFromUnknown } = useAppToast();
const state = ref<GratitudeState | null>(null);
const lines = ref({ gratitude: ["", "", ""], goodThings: ["", "", ""] });
const now = ref(new Date());
const evening = computed(() => Number(new Intl.DateTimeFormat("en-GB", { timeZone: state.value?.timezone || "UTC", hour: "2-digit", hourCycle: "h23" }).format(now.value)) >= 17);
const listKey = computed(() => evening.value ? "goodThings" : "gratitude");
const title = computed(() => evening.value ? "Three good things" : "Gratitude");
const hasToday = computed(() => [...lines.value.gratitude, ...lines.value.goodThings].some(line => line.trim()));
const sheet = ref(false);
const myQuotes = ref(false);
const savedQuotes = ref<Quote[]>([]);
const quoteBusy = ref(false);
const settingBusy = ref(false);
const dirty = new Set<"gratitude" | "goodThings">();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let queue = Promise.resolve();
let disposed = false;
let loadGeneration = 0;

async function load() {
  const generation = ++loadGeneration;
  try {
    const result = await api.get<GratitudeState>("/gratitude");
    if (disposed || generation !== loadGeneration || !result.date) return;
    state.value = result;
    for (const key of ["gratitude", "goodThings"] as const) if (!dirty.has(key)) lines.value[key] = gratitudeLines(result[key]);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && [403, 404].includes(Number(error.status))) emit("unavailable");
    else toastFromUnknown(error, "Couldn't load Gratitude");
  }
}

function edit(index: number, value: string) {
  const key = listKey.value;
  lines.value[key][index] = value; dirty.add(key);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flushLines(); }, 600);
}

function flushLines() {
  clearTimeout(saveTimer);
  if (!state.value || !dirty.size) return queue;
  const date = state.value.date;
  const keys = [...dirty];
  const patch = Object.fromEntries(keys.map(key => [key, [...lines.value[key]]]));
  keys.forEach(key => dirty.delete(key));
  queue = queue.then(async () => {
    try { await api.patch("/gratitude/lines", { date, ...patch }); }
    catch (error) { keys.forEach(key => dirty.add(key)); toastFromUnknown(error, "Couldn't save your lines"); }
  });
  return queue;
}

async function openSheet() {
  myQuotes.value = false; sheet.value = true;
  try { savedQuotes.value = (await api.get<{ quotes: Quote[] }>("/quotes/mine")).quotes; }
  catch (error) { toastFromUnknown(error, "Couldn't load My quotes"); }
}

async function another() {
  if (quoteBusy.value || !state.value) return;
  quoteBusy.value = true;
  try { state.value.quote = (await api.post<{ quote: Quote }>("/quotes/another")).quote; }
  catch (error) { toastFromUnknown(error, "Couldn't load another quote"); }
  finally { quoteBusy.value = false; }
}

async function saveQuote(quote = state.value?.quote) {
  if (!quote || quoteBusy.value) return;
  quoteBusy.value = true;
  try {
    const endpoint = `/quotes/${encodeURIComponent(quote.id)}/save`;
    const result = quote.savedAt ? await api.delete<{ quote: Quote }>(endpoint) : await api.put<{ quote: Quote }>(endpoint);
    if (state.value?.quote?.id === quote.id) state.value.quote = result.quote;
    savedQuotes.value = savedQuotes.value.filter(q => q.id !== quote.id);
    if (result.quote.savedAt) savedQuotes.value.unshift(result.quote);
  } catch (error) { toastFromUnknown(error, "Couldn't save your quote"); }
  finally { quoteBusy.value = false; }
}

async function toggleSetting(key: keyof GratitudeSettings) {
  if (!state.value || settingBusy.value) return;
  settingBusy.value = true;
  const value = !state.value.settings[key];
  try { await api.patch("/gratitude/settings", { [key]: value }); state.value.settings[key] = value; }
  catch (error) { toastFromUnknown(error, "Couldn't change your reminder"); }
  finally { settingBusy.value = false; }
}

function dayLabel(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }); }
function dayLetter(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" }).slice(0, 1); }
function tickWritten(day: { date: string; written: boolean }) { return day.date === state.value?.date ? hasToday.value : day.written; }

watch(() => props.active, active => { if (active) { now.value = new Date(); void queue.then(load); } });
onMounted(() => {
  void load();
  clockTimer = setInterval(() => {
    now.value = new Date();
    if (!props.active || !state.value) return;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: state.value.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now.value);
    if (date !== state.value.date) void flushLines().then(load);
  }, 30_000);
});
onBeforeUnmount(() => { disposed = true; clearInterval(clockTimer); void flushLines(); });
defineExpose({ refresh: load });
</script>

<template>
  <section class="gratitude-content" :aria-label="title">
    <header class="gratitude-header">
      <button type="button" class="gratitude-title" :aria-label="`${title} quote and reminders`" @click="openSheet"><span aria-hidden="true">{{ evening ? '🌙' : '🌅' }}</span>{{ title }}</button>
      <div class="gratitude-week" aria-label="Last 7 days">
        <span v-for="day in state?.days || []" :key="day.date" class="gratitude-day" :class="{ 'is-today': day.date === state?.date, 'is-written': tickWritten(day) }" :aria-label="`${dayLabel(day.date)}: ${tickWritten(day) ? 'Written' : 'Nothing written'}`">
          <span aria-hidden="true">{{ dayLetter(day.date) }}</span><i aria-hidden="true"><UiIcon v-if="tickWritten(day)" name="Check" :size="10" /></i>
        </span>
      </div>
    </header>
    <button v-if="!evening && state?.quote" type="button" class="gratitude-quote" aria-label="Today's quote" @click="openSheet"><span class="quote-text">“{{ state.quote.text }}”</span><span v-if="state.quote.author" class="quote-author">— {{ state.quote.author }}</span></button>
    <div class="gratitude-lines">
      <label v-for="(_, index) in lines[listKey]" :key="`${listKey}:${index}`" class="gratitude-line"><span aria-hidden="true">{{ index + 1 }}</span><input :value="lines[listKey][index]" :aria-label="`${evening ? 'Good thing' : 'Grateful for'} ${index + 1}`" maxlength="1000" :disabled="!state" @input="edit(index, ($event.target as HTMLInputElement).value)" @blur="flushLines" /></label>
    </div>
    <AppDialog :open="sheet" class="gratitude-dialog" :aria-label="myQuotes ? 'My quotes' : `Today's quote`" close-on-backdrop @close="sheet = false">
      <section class="gratitude-sheet">
        <span class="gratitude-grabber" aria-hidden="true" />
        <header><Button v-if="myQuotes" color="ghost" icon-only aria-label="Back to today's quote" @click="myQuotes = false"><UiIcon name="ArrowLeft" :size="20" /></Button><span v-else class="header-spacer" /><h2>{{ myQuotes ? 'My quotes' : "Today's quote" }}</h2><Button color="ghost" icon-only aria-label="Close quote sheet" @click="sheet = false"><UiIcon name="X" :size="20" /></Button></header>
        <div class="gratitude-sheet-scroll">
          <template v-if="myQuotes">
            <div v-for="quote in savedQuotes" :key="quote.id" class="saved-quote"><div><p class="quote-text">“{{ quote.text }}”</p><p class="quote-author">{{ quote.author ? `— ${quote.author}` : '' }}{{ quote.source ? `, ${quote.source}` : '' }}</p></div><Button color="ghost" icon-only :disabled="quoteBusy" :aria-label="`Unsave quote${quote.author ? ` by ${quote.author}` : ''}`" @click="saveQuote(quote)"><UiIcon name="X" :size="18" /></Button></div>
            <p v-if="!savedQuotes.length" class="quotes-empty">No saved quotes yet.</p>
          </template>
          <template v-else>
            <div v-if="state?.quote" class="sheet-quote"><p class="quote-text">“{{ state.quote.text }}”</p><p class="quote-author">{{ state.quote.author ? `— ${state.quote.author}` : '' }}{{ state.quote.source ? `, ${state.quote.source}` : '' }}</p></div>
            <div class="quote-actions">
              <Button color="secondary" :disabled="quoteBusy" @click="another"><template #icon><UiIcon name="Shuffle" :size="18" /></template>Another</Button>
              <Button color="primary" :disabled="quoteBusy || !state?.quote" :aria-pressed="!!state?.quote?.savedAt" @click="saveQuote()"><template #icon><UiIcon :name="state?.quote?.savedAt ? 'Check' : 'Bookmark'" :size="18" /></template>{{ state?.quote?.savedAt ? 'Saved' : 'Save' }}</Button>
            </div>
            <button type="button" class="quote-setting quote-list-link" @click="myQuotes = true"><UiIcon name="Bookmark" :size="18" /><span>My quotes</span><span class="quote-count">{{ savedQuotes.length }}</span><UiIcon name="ChevronRight" :size="18" /></button>
            <div class="quote-setting"><UiIcon name="Sun" :size="18" /><span>Quote in morning briefing</span><button type="button" class="quote-switch" role="switch" aria-label="Quote in morning briefing" :aria-checked="state?.settings.quoteInBriefing || false" :disabled="settingBusy || !state" @click="toggleSetting('quoteInBriefing')"><i /></button></div>
            <div class="quote-setting"><UiIcon name="Moon" :size="18" /><span>Three good things <small>21:00</small></span><button type="button" class="quote-switch" role="switch" aria-label="Three good things at 21:00" :aria-checked="state?.settings.eveningReminder || false" :disabled="settingBusy || !state" @click="toggleSetting('eveningReminder')"><i /></button></div>
          </template>
        </div>
      </section>
    </AppDialog>
  </section>
</template>

<style scoped>
.gratitude-content { padding: 10px 18px 16px; color: var(--ui-text); }
.gratitude-header { display: flex; align-items: center; gap: 8px; min-height: 40px; position: relative; margin-bottom: 8px; }
.gratitude-title { display: flex; align-items: center; gap: 8px; padding: 0; font: inherit; font-size: 15px; font-weight: 600; color: inherit; background: transparent; border: 0; min-height: 44px; text-align: left; }
.gratitude-title > span { font-size: 20px; }
.gratitude-week { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
.gratitude-day { display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--ui-text-muted); font-size: 9px; font-weight: 600; }
.gratitude-day i { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1.4px var(--ui-border); }
.gratitude-day.is-written i { background: var(--ui-surface-muted); box-shadow: none; }
.gratitude-day.is-today i { box-shadow: inset 0 0 0 1.4px var(--ui-text-muted); }
.gratitude-quote { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; padding: 14px 18px; border: 0; border-radius: 16px; background: var(--ui-surface-muted); color: inherit; text-align: center; font: inherit; cursor: pointer; }
.quote-text { font-family: var(--font-serif, ui-serif, 'New York', Georgia, serif); font-size: 16px; line-height: 1.45; margin: 0; }
.quote-author { font-size: 13px; color: var(--ui-text-muted); margin: 4px 0 0; }
.gratitude-lines { margin-top: 8px; }
.gratitude-line { display: flex; align-items: center; gap: 10px; min-height: 44px; box-shadow: inset 0 -1px 0 var(--ui-border); }
.gratitude-line:last-child { box-shadow: none; }
.gratitude-line > span { width: 20px; flex-shrink: 0; font-size: 13px; font-weight: 700; color: var(--ui-text-muted); text-align: center; }
.gratitude-line input { flex: 1; min-width: 0; min-height: 44px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 15px; border-radius: 4px; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
button:disabled { cursor: default; opacity: .5; }
:global(.gratitude-dialog[open]) { align-items: end; padding: 0; }
.gratitude-sheet { box-sizing: border-box; display: flex; flex-direction: column; width: min(560px, 100%); height: 55dvh; max-height: 600px; min-height: 320px; padding: 8px 18px max(18px, env(safe-area-inset-bottom)); background: var(--ui-surface); border-radius: 28px 28px 0 0; box-shadow: var(--ui-shadow-md); }
.gratitude-grabber { width: 34px; height: 4px; flex-shrink: 0; margin: 0 auto 4px; background: var(--ui-border-strong); border-radius: 4px; }
.gratitude-sheet header { display: flex; align-items: center; gap: 8px; }
.gratitude-sheet h2 { flex: 1; text-align: center; font-size: 17px; font-weight: 600; margin: 0; }
.header-spacer { width: 44px; }
.gratitude-sheet-scroll { overflow-y: auto; padding: 8px 0 0; }
.sheet-quote { text-align: center; padding: 0 6px 16px; }
.sheet-quote .quote-text { font-size: 19px; line-height: 1.4; }
.quote-actions { display: flex; gap: 10px; margin-bottom: 12px; }
.quote-actions > * { flex: 1; }
.quote-setting { display: flex; align-items: center; gap: 12px; min-height: 56px; width: 100%; color: var(--ui-text); background: transparent; border: 0; font: inherit; font-size: 15px; padding: 4px 0; text-align: left; box-sizing: border-box; }
.quote-setting > span:first-of-type { flex: 1; }
.quote-setting small { display: block; font-size: 13px; color: var(--ui-text-muted); }
.quote-count { font-size: 13px; color: var(--ui-text-muted); }
.quote-switch { width: 50px; height: 44px; flex-shrink: 0; padding: 7px 0; border: 0; background: transparent; position: relative; }
.quote-switch::before { content: ''; position: absolute; inset: 7px 0; border-radius: 18px; background: var(--ui-border-strong); }
.quote-switch i { position: relative; display: block; width: 26px; height: 26px; border-radius: 50%; background: var(--ui-surface); margin-left: 2px; }
.quote-switch[aria-checked='true']::before { background: var(--ui-primary); }
.quote-switch[aria-checked='true'] i { margin-left: 22px; background: var(--ui-primary-contrast); }
.saved-quote { display: flex; align-items: start; gap: 8px; padding: 12px 0; box-shadow: inset 0 -1px 0 var(--ui-border); }
.saved-quote > div { flex: 1; }
.saved-quote .quote-text { font-size: 15px; }
.quotes-empty { color: var(--ui-text-muted); text-align: center; font-size: 14px; }
@media (max-width: 360px) { .gratitude-week { gap: 2px; } .gratitude-title { gap: 6px; font-size: 14px; } }
</style>
