<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "../../api";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import CustomCardFace from "./CustomCardFace.vue";
import { homeCardCall, optimisticHomeCard, readHomeCardRecord, type HomeCardRecord, type HomeCardRequest } from "../../utils/homeCards";

// The card ME3 just built or changed, live in chat: try it here, change it, or add it to Home.
const props = defineProps<{ record: HomeCardRecord; isUpdate: boolean; pinned: boolean }>();
const emit = defineEmits<{ addToHome: []; change: []; ask: [prompt: string]; changed: [record: HomeCardRecord] }>();
const current = ref(props.record);
watch(() => props.record, record => { current.value = record; });
const busy = ref<string[]>([]);
const error = ref("");
async function act(request: HomeCardRequest) {
  if (busy.value.includes(request.key)) return;
  const before = current.value;
  busy.value.push(request.key);
  current.value = optimisticHomeCard(before, request);
  try {
    const call = homeCardCall(before.card.id, request);
    const next = readHomeCardRecord(await api.post(call.path, call.body));
    if (next) { current.value = next; emit("changed", next); }
    error.value = "";
  } catch {
    current.value = before;
    error.value = `Couldn't update ${before.card.name}. Try again.`;
  } finally { busy.value = busy.value.filter(key => key !== request.key); }
}
</script>

<template>
  <div class="cc-preview" data-testid="custom-card-preview">
    <div class="cc-preview__card"><CustomCardFace :record="current" :header="false" :badge="isUpdate ? `v${current.card.version}` : 'Preview'" :busy="busy" @act="act" @ask="prompt => emit('ask', prompt)" /></div>
    <p v-if="error" class="cc-preview__error" role="alert">{{ error }}</p>
    <p v-if="pinned || isUpdate" class="cc-preview__done"><UiIcon name="CircleCheck" :size="18" />{{ isUpdate ? 'Updated on your Home' : 'On your Home' }}</p>
    <div v-else class="cc-preview__actions">
      <Button color="secondary" @click="emit('change')">Change it</Button>
      <Button color="primary" @click="emit('addToHome')">Add to Home</Button>
    </div>
  </div>
</template>

<style scoped>
.cc-preview { display: grid; gap: 10px; max-width: 460px; margin-top: 10px; }
.cc-preview__card { padding-top: 6px; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.cc-preview__error { margin: 0; color: var(--ui-danger, #dc2626); font-size: 13px; }
.cc-preview__done { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: 0; font-size: 14.5px; }
.cc-preview__done :deep(svg) { color: var(--ui-accent-strong); }
.cc-preview__actions { display: flex; gap: 10px; }
.cc-preview__actions > * { flex: 1; }
</style>
