import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { api } from "../api";

export function useAgentChatPresence(threadId: Ref<string | null>, watching: Ref<boolean>) {
  const clientId = crypto.randomUUID();
  let reportedThread: string | null = null;
  let mounted = false;
  let leaving = false;
  let heartbeat: ReturnType<typeof setInterval>;
  let pending = Promise.resolve();

  function report() {
    const target = threadId.value;
    const visible = mounted && !leaving && watching.value && document.visibilityState === "visible";
    // Preserve event order when a renewal is still in flight as the owner leaves.
    pending = pending.then(async () => {
      if (reportedThread && (reportedThread !== target || !visible)) {
        await api.put(`/assistant/threads/${encodeURIComponent(reportedThread)}/presence`, { clientId, watching: false }, { keepalive: true }).catch(() => undefined);
        reportedThread = null;
      }
      if (target && visible) {
        reportedThread = target;
        await api.put(`/assistant/threads/${encodeURIComponent(target)}/presence`, { clientId, watching: true }, { keepalive: true }).catch(() => undefined);
      }
    });
  }
  function pageHide() { leaving = true; report(); }
  function pageShow() { leaving = false; report(); }
  watch([threadId, watching], report);
  onMounted(() => {
    mounted = true;
    document.addEventListener("visibilitychange", report);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    heartbeat = setInterval(report, 20_000);
    report();
  });
  onBeforeUnmount(() => {
    mounted = false;
    clearInterval(heartbeat);
    document.removeEventListener("visibilitychange", report);
    window.removeEventListener("pagehide", pageHide);
    window.removeEventListener("pageshow", pageShow);
    report();
  });
}
