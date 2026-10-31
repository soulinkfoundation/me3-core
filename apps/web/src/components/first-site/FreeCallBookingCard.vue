<script setup lang="ts">
import { ref, useId } from "vue";
import { api } from "../../api";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";
import type { FreeCallView } from "../../utils/firstSite";

/** Booking someone's free call (core_scheduling_book_free_call approval): the exact slot, then Book it. */
const props = defineProps<{ call: FreeCallView }>();
const emit = defineEmits<{ resolved: [decision: "approved" | "declined"] }>();
const { toastFromUnknown } = useAppToast();
const titleId = useId();
const busy = ref<"" | "approved" | "declined">("");

async function decide(decision: "approved" | "declined") {
  if (busy.value) return;
  busy.value = decision;
  try {
    await api.post(`/assistant/approvals/${encodeURIComponent(props.call.approvalId)}`, { decision });
    emit("resolved", decision);
  } catch (error) {
    toastFromUnknown(error, "Couldn't save that");
  } finally { busy.value = ""; }
}
</script>

<template>
  <section class="free-call" :aria-labelledby="titleId" data-testid="free-call-card">
    <div class="free-call__head">
      <span class="free-call__mark" aria-hidden="true"><UiIcon name="CalendarCheck" :size="18" /></span>
      <span class="free-call__stack">
        <h3 :id="titleId" class="free-call__title">{{ call.title }} with {{ call.with }}</h3>
        <span class="free-call__sub">{{ call.slotLabel }}<template v-if="call.durationMinutes"> · {{ call.durationMinutes }} min</template></span>
      </span>
    </div>
    <p v-if="call.howItWorks" class="free-call__fine">{{ call.howItWorks }}</p>
    <div class="free-call__btns">
      <Button color="ghost" shape="soft" :disabled="busy !== ''" @click="decide('declined')">{{ busy === 'declined' ? 'Saving…' : 'Not now' }}</Button>
      <Button class="free-call__primary" color="primary" shape="soft" :disabled="busy !== ''" @click="decide('approved')">{{ busy === 'approved' ? 'Booking…' : 'Book it' }}</Button>
    </div>
  </section>
</template>

<style scoped>
.free-call { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: min(560px, 100%); padding: 16px; border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.free-call__head { display: flex; align-items: center; gap: 12px; }
.free-call__mark { display: grid; place-items: center; flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; background: var(--ui-accent-soft); color: var(--ui-accent); }
.free-call__stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.free-call__title { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.free-call__sub { color: var(--ui-text-muted); font-size: 14px; }
.free-call__fine { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.free-call__btns { display: flex; gap: 8px; }
.free-call__btns :deep(.me3-btn) { min-height: 44px; }
.free-call__primary { flex: 1; }
</style>
