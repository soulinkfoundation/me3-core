import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "../api";
import { loadChatTour, readChatTour, tourStartIndex, type ChatTour, type TourStatus } from "../utils/chatTour";

// This browser remembers only that a tour is under way, so other pages don't ask Core on every load.
const activeKey = (ownerId: string) => `me3.tour.active.${ownerId || "owner"}`;
function remember(ownerId: string, active: boolean) {
  try { if (active) localStorage.setItem(activeKey(ownerId), "1"); else localStorage.removeItem(activeKey(ownerId)); } catch { /* private window */ }
}
function remembered(ownerId: string) {
  try { return localStorage.getItem(activeKey(ownerId)) === "1"; } catch { return false; }
}

/** Show me around (me3-q6la.5): one tour over the whole app, which keeps its place as the owner moves around. */
export const useTourStore = defineStore("tour", () => {
  const tour = ref<ChatTour | null>(null);
  const index = ref(0);
  const open = ref(false);
  let ownerId = "";
  const step = computed(() => tour.value?.steps[index.value] ?? null);
  const isLast = computed(() => Boolean(tour.value && index.value === tour.value.steps.length - 1));

  async function save(body: { status?: TourStatus; stepId?: string | null; seen?: string }) {
    try { const next = readChatTour(await api.put<ChatTour>("/assistant/tour/progress", body)); if (next) tour.value = next; }
    catch { /* The tour carries on here; the next save tries again. */ }
  }

  /** On app load: reopen a tour the owner hasn't finished or skipped. */
  async function resume(owner: string) {
    ownerId = owner;
    if (!remembered(owner) || open.value) return;
    let next: ChatTour | null = null;
    try { next = await loadChatTour(api.get); } catch { return; }
    if (!next || next.progress.status !== "active") { remember(owner, false); return; }
    tour.value = next; index.value = tourStartIndex(next); open.value = true;
  }

  /** Show me around: false when this Core has no tour, so the caller can ask ME3 instead. */
  async function start(owner: string): Promise<boolean> {
    ownerId = owner;
    let next: ChatTour | null = null;
    try { next = await loadChatTour(api.get); } catch { next = null; }
    if (!next) return false;
    tour.value = next; index.value = tourStartIndex(next); open.value = true;
    remember(owner, true);
    void save({ status: "active", stepId: next.steps[index.value].id });
    return true;
  }

  function go(to: number) {
    if (!tour.value) return;
    index.value = Math.max(0, Math.min(to, tour.value.steps.length - 1));
    void save({ stepId: tour.value.steps[index.value].id });
  }

  function end(status: "finished" | "skipped") {
    open.value = false; remember(ownerId, false);
    void save({ status, stepId: step.value?.id ?? null });
  }

  /** The owner opened a place the tour asked about. */
  function seen(place: "accounts" | "social") {
    if (open.value && tour.value?.steps.some(item => item.id === place && !item.done)) void save({ seen: place });
  }

  /** Something the tour watches changed (Home's cards); read the ticks again. */
  async function refresh() {
    if (!open.value) return;
    try { const next = await loadChatTour(api.get); if (next) tour.value = next; } catch { /* keep the last ticks */ }
  }

  return { tour, index, open, step, isLast, resume, start, go, end, seen, refresh };
});
