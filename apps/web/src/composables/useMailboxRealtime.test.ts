import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type MailboxEventHandlers } from "../api";
import { useAuthStore } from "../stores/auth";
import {
  mailboxCacheScope,
  useMailboxCacheStore,
  type MailboxListRequest,
} from "../stores/mailbox";
import { useMailboxRealtime } from "./useMailboxRealtime";

vi.mock("../api", () => ({
  API_BASE: "/api",
  api: {
    get: vi.fn(),
    subscribeMailboxEvents: vi.fn(),
  },
}));

const inbox: MailboxListRequest = {
  folder: "inbox",
  direction: "all",
  limit: 50,
  offset: 0,
};

describe("useMailboxRealtime", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ total: 1 });
  });

  it("connects only for the authenticated owner and refreshes after events and reconnects", async () => {
    const close = vi.fn();
    vi.mocked(api.subscribeMailboxEvents).mockReturnValue({ close });
    const Harness = defineComponent({
      setup() {
        useMailboxRealtime();
        return () => h("div");
      },
    });
    const auth = useAuthStore();
    const mailbox = useMailboxCacheStore();
    const ownerScope = mailboxCacheScope("owner");
    const otherScope = mailboxCacheScope("other");
    const wrapper = mount(Harness);

    expect(api.subscribeMailboxEvents).not.toHaveBeenCalled();

    auth.setSession({
      id: "owner",
      email: "owner@example.com",
      name: "Owner",
      username: "owner",
      timezone: null,
      locale: "en-US",
      localeSource: "inferred",
    });
    await flushPromises();
    expect(api.subscribeMailboxEvents).toHaveBeenCalledOnce();
    const handlers = vi.mocked(api.subscribeMailboxEvents).mock.calls[0]![0] as MailboxEventHandlers;

    mailbox.setList(ownerScope, inbox, { messages: ["owner-message"], total: 1 });
    mailbox.setList(otherScope, inbox, { messages: ["other-message"], total: 1 });
    handlers.onMessageReceived({
      type: "mailbox.message_received",
      mailboxId: "mailbox-1",
      messageId: "message-1",
      receivedAt: "2026-09-03T09:00:00.000Z",
    });
    await flushPromises();

    expect(mailbox.getList(ownerScope, inbox)).toBeNull();
    expect(mailbox.getList<string>(otherScope, inbox)?.messages).toEqual([
      "other-message",
    ]);
    expect(api.get).toHaveBeenCalledTimes(3);

    mailbox.setList(ownerScope, inbox, { messages: ["stale-after-loss"], total: 1 });
    vi.mocked(api.get).mockClear();
    handlers.onReconnect();
    await flushPromises();

    expect(mailbox.getList(ownerScope, inbox)).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(3);

    wrapper.unmount();
    expect(close).toHaveBeenCalledOnce();
  });
});
