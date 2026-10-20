<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import { useAppToast } from "../composables/useAppToast";
import type { AgentChatMemoryReview } from "../utils/agentChat";

// A sensitive fact ME3 held back this turn. It only reaches the agent once the owner says yes;
// "Don't" archives it and automatic memory never proposes it again.
const props = defineProps<{ review: AgentChatMemoryReview }>();
const { toastFromUnknown } = useAppToast();
const status = ref(props.review.status);
const busy = ref(false);

async function decide(remember: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    const path = `/mission-control/memory/${encodeURIComponent(props.review.id)}`;
    if (remember) await api.post(`${path}/approve`, {});
    else await api.delete(path);
    status.value = remember ? "remembered" : "declined";
  } catch (err) {
    toastFromUnknown(err, remember ? "Couldn't remember that" : "Couldn't forget that");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <aside class="memory-review" role="group" aria-label="Remember this?">
    <strong>Remember this?</strong>
    <span class="memory-review__body">{{ review.displayBody || review.body }}</span>
    <div v-if="status === 'pending'" class="memory-review__actions">
      <button type="button" class="memory-review__remember" :disabled="busy" @click="decide(true)">Remember</button>
      <button type="button" class="memory-review__decline" :disabled="busy" @click="decide(false)">Don't</button>
    </div>
    <span v-else class="memory-review__status" role="status">{{ status === "remembered" ? "Remembered" : "Won't remember this" }}</span>
  </aside>
</template>

<style scoped>
.memory-review {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.45;
}
.memory-review strong { color: var(--ui-text); font-weight: 600; }
.memory-review__body { color: var(--ui-text); }
.memory-review__actions { display: flex; gap: 4px; margin: 2px 0 0 -8px; }
.memory-review__actions button {
  min-height: 36px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  padding: 6px 8px;
  background: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.memory-review__remember { color: var(--ui-accent); }
.memory-review__decline { color: var(--ui-text-muted); }
.memory-review__actions button:hover:not(:disabled) { background: var(--ui-surface); }
.memory-review__actions button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.memory-review__actions button:disabled { cursor: default; opacity: .6; }
.memory-review__status { font-weight: 500; }
</style>
