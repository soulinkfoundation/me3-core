<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import Button from "../Button.vue";
import { homeCardIdeas, homeCardRequestText, ideaIsBusiness, type HomeCardIdea } from "../../utils/homeCards";

// Add to Home → Custom card: say what to see on Home, or pick an idea. ME3 builds it in chat and shows a
// preview first. Ideas come from the sources this plan's cards may show, so a free ME3 isn't offered money cards.
const props = defineProps<{ sources?: string[] }>();
const emit = defineEmits<{ make: [request: string] }>();
const request = ref("");
const field = ref<HTMLTextAreaElement | null>(null);
const ideas = computed(() => homeCardIdeas(props.sources));
function submit() {
  const text = homeCardRequestText(request.value);
  if (text) emit("make", text);
}
// Ideas that end in a space wait for the owner to finish the sentence.
function pick(idea: HomeCardIdea) {
  request.value = idea.ask;
  if (!idea.ask.endsWith(" ")) { submit(); return; }
  void nextTick(() => { const input = field.value; if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
}
defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <div class="cc-start">
    <p class="cc-start__intro">Say what you want to see on Home. ME3 builds it from your own data and shows you a preview first.</p>
    <textarea ref="field" v-model="request" class="cc-start__field" rows="2" placeholder="Show me…" aria-label="Describe your card" @keydown.enter.exact.prevent="submit" />
    <h3 class="cc-start__label">Ideas</h3>
    <div class="cc-start__ideas">
      <button v-for="idea in ideas" :key="idea.text" type="button" class="cc-start__idea" @click="pick(idea)">
        <span class="cc-start__emoji" aria-hidden="true">{{ idea.emoji }}</span>
        <span class="cc-start__text">{{ idea.text }}</span>
        <span v-if="ideaIsBusiness(idea)" class="cc-start__tag">Business</span>
      </button>
    </div>
    <Button color="primary" :disabled="!request.trim()" @click="submit">Make it</Button>
  </div>
</template>

<style scoped>
.cc-start { display: grid; gap: 14px; margin-top: 12px; }
.cc-start__intro { margin: 0; color: var(--ui-text-muted); font-size: 14px; }
.cc-start__field { width: 100%; min-height: 52px; padding: 14px 18px; border: 0; border-radius: 18px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); color: var(--ui-text); font: inherit; font-size: 15px; resize: vertical; box-sizing: border-box; }
.cc-start__field:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.cc-start__label { margin: 0; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; }
.cc-start__ideas { display: grid; gap: 8px; }
.cc-start__idea { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 14px; border: 0; border-radius: 16px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); color: var(--ui-text); font: inherit; text-align: left; cursor: pointer; }
.cc-start__idea:hover { background: var(--ui-surface-muted); }
.cc-start__idea:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.cc-start__emoji { width: 26px; font-size: 20px; text-align: center; }
.cc-start__text { flex: 1; font-size: 14.5px; font-weight: 600; }
.cc-start__tag { padding: 2px 8px; border-radius: 999px; background: var(--ui-accent-soft); color: var(--ui-accent-strong); font-size: 11px; font-weight: 600; }
</style>
