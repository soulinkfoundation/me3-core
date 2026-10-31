<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../api";
import UiIcon from "../UiIcon.vue";
import SiteDraftCard from "./SiteDraftCard.vue";
import SiteLiveCard from "./SiteLiveCard.vue";
import FreeCallBookingCard from "./FreeCallBookingCard.vue";
import {
  FREE_CALL_TOOL, SITE_DRAFT_TOOL, freeCallView, latestFor, siteDraftView,
  type FirstSiteApproval,
} from "../../utils/firstSite";

/**
 * The first-site steps for the open Chat thread, one at a time: the draft card while the draft
 * waits, the live card once published, and a free call booking while it waits or just after.
 * A step drops away once the owner sends their next message.
 */
const props = defineProps<{ threadId: string | null; refreshKey?: number; lastUserMessageAt?: string | null; busy?: boolean }>();
const emit = defineEmits<{ decided: []; showMe: [searchQuery: string]; findSomeone: [] }>();

const approvals = ref<FirstSiteApproval[]>([]);
let loadSeq = 0;

async function load() {
  const threadId = props.threadId, seq = ++loadSeq;
  if (!threadId) { approvals.value = []; return; }
  try {
    const { approvals: list } = await api.get<{ approvals: FirstSiteApproval[] }>("/assistant/approvals");
    if (seq !== loadSeq) return;
    approvals.value = (list || []).filter(approval => approval.threadId === threadId && [SITE_DRAFT_TOOL, FREE_CALL_TOOL].includes(approval.actionId || ""));
  } catch {
    if (seq === loadSeq) approvals.value = [];
  }
}

/** Still the newest thing in the thread: nothing the owner sent since it was decided. */
function current(approval: FirstSiteApproval) {
  const at = approval.resolvedAt || approval.requestedAt || "";
  return !props.lastUserMessageAt || !at || Date.parse(at) >= Date.parse(props.lastUserMessageAt);
}

const site = computed(() => latestFor(approvals.value, SITE_DRAFT_TOOL, props.threadId)[0] || null);
const draft = computed(() => site.value?.status === "pending" ? siteDraftView(site.value) : null);
const live = computed(() => site.value?.status === "approved" && current(site.value) ? siteDraftView(site.value) : null);
const call = computed(() => latestFor(approvals.value, FREE_CALL_TOOL, props.threadId)[0] || null);
const pendingCall = computed(() => call.value?.status === "pending" ? freeCallView(call.value) : null);
const bookedCall = computed(() => call.value?.status === "approved" && current(call.value) ? freeCallView(call.value) : null);

function resolved() {
  void load();
  emit("decided");
}

watch(() => [props.threadId, props.refreshKey], load, { immediate: true });
defineExpose({ load });
</script>

<template>
  <div v-if="draft || live || pendingCall || bookedCall" class="chat-first-site" aria-label="Your website">
    <SiteDraftCard v-if="draft" :key="draft.approvalId" :draft="draft" @resolved="resolved" />
    <SiteLiveCard v-else-if="live" :name="live.name" :public-url="live.publicUrl" :busy="busy"
      @show-me="emit('showMe', live.searchQuery)" @find-someone="emit('findSomeone')" />
    <FreeCallBookingCard v-if="pendingCall" :key="pendingCall.approvalId" :call="pendingCall" @resolved="resolved" />
    <div v-else-if="bookedCall" class="chat-first-site__pill" role="status">
      <UiIcon name="CalendarCheck" :size="16" class="chat-first-site__mark" />
      <span>Booked: {{ bookedCall.title }} with {{ bookedCall.with }}<template v-if="bookedCall.slotLabel">, {{ bookedCall.slotLabel }}</template></span>
    </div>
  </div>
</template>

<style scoped>
.chat-first-site { display: flex; flex-direction: column; gap: 10px; width: min(560px, 100%); }
.chat-first-site__pill { display: flex; align-items: center; gap: 10px; align-self: flex-start; max-width: 100%; min-height: 44px; padding: 6px 14px; box-sizing: border-box; border-radius: 999px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); font-size: 14px; }
.chat-first-site__pill > span { overflow-wrap: anywhere; }
.chat-first-site__mark { flex: 0 0 auto; color: var(--ui-accent); }
</style>
