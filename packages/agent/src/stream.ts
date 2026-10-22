import type { AgentEvent } from "./types";

export type AgentEventForwarder = (event: string, data: Record<string, unknown>) => Promise<void>;

/**
 * Batches model text so the stream is not paced by one persisted write per token.
 *
 * The first text of a burst goes out at once; what arrives during the next
 * `intervalMs` is forwarded as one delta. Every other event flushes the
 * buffered text first, so the persisted order matches what the model produced.
 * A forwarding failure surfaces on the next push or flush, as it did when every
 * delta was awaited.
 */
export function coalesceAgentStreamEvents(forward: AgentEventForwarder, intervalMs = 100) {
  let text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown;
  const queue = (event: string, data: Record<string, unknown>) => {
    chain = chain.then(() => forward(event, data)).catch(error => { failure ??= error; throw error; });
    return chain;
  };
  const flushText = () => {
    if (!text) return;
    const data = { text, source: "model" };
    text = "";
    queue("delta", data).catch(() => {});
  };
  const tick = () => {
    timer = undefined;
    if (!text) return;
    flushText();
    timer = setTimeout(tick, intervalMs);
  };
  return {
    push: async (event: AgentEvent) => {
      if (event.event === "delta" && event.data.source === "model") {
        text += String(event.data.text ?? "");
        if (!timer) {
          flushText();
          timer = setTimeout(tick, intervalMs);
        }
        // A failed write is reported here rather than lost in the timer.
        if (failure) throw failure;
        return;
      }
      if (timer) { clearTimeout(timer); timer = undefined; }
      flushText();
      await queue(event.event, event.data);
    },
    flush: async () => {
      if (timer) { clearTimeout(timer); timer = undefined; }
      flushText();
      await chain;
    },
  };
}
