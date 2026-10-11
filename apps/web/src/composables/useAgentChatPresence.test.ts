import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useAgentChatPresence } from "./useAgentChatPresence";

vi.mock("../api", () => ({ api: { put: vi.fn(async () => ({ ok: true })) } }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

// Failure modes: hidden tabs suppress notifications, old chats remain watched,
// or a late renewal overwrites the departure sent when the component unmounts.
describe("foreground Chat presence", () => {
  it("renews only visible Chat and releases its lease on hide and unmount", async () => {
    let visible = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible as DocumentVisibilityState);
    vi.useFakeTimers();
    const thread = ref<string | null>("thread"); const watching = ref(true);
    const view = mount(defineComponent({ setup() { useAgentChatPresence(thread, watching); return () => h("div"); } }));
    await flushPromises(); expect(api.put).toHaveBeenLastCalledWith("/assistant/threads/thread/presence", expect.objectContaining({ watching: true }), { keepalive: true });
    await vi.advanceTimersByTimeAsync(20_000); expect(api.put).toHaveBeenCalledTimes(2);
    visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(api.put).toHaveBeenLastCalledWith("/assistant/threads/thread/presence", expect.objectContaining({ watching: false }), { keepalive: true });
    watching.value = false; await flushPromises();
    view.unmount(); await flushPromises();
  });

  it("releases the previous conversation before watching another", async () => {
    const thread = ref<string | null>("first"); const watching = ref(true);
    const view = mount(defineComponent({ setup() { useAgentChatPresence(thread, watching); return () => h("div"); } }));
    await flushPromises(); thread.value = "second"; await flushPromises();
    const calls = vi.mocked(api.put).mock.calls;
    expect(calls.slice(1).map(([path, body]) => [path, (body as { watching: boolean }).watching])).toEqual([
      ["/assistant/threads/first/presence", false], ["/assistant/threads/second/presence", true],
    ]);
    view.unmount(); await flushPromises();
    expect(api.put).toHaveBeenLastCalledWith("/assistant/threads/second/presence", expect.objectContaining({ watching: false }), { keepalive: true });
  });
});
