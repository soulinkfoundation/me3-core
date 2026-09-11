import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailPage from "./email.vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";
import { mailboxCacheScope, useMailboxCacheStore } from "../stores/mailbox";

vi.mock("../api", () => ({
  API_BASE: "/api",
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

const toastApi = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../composables/useAppToast", () => ({
  useAppToast: () => ({
    toastFromUnknown: vi.fn(),
    toastSuccess: vi.fn(),
    toast: toastApi,
  }),
}));

const routerReplace = vi.fn();
const routerPush = vi.fn();
let routeTab = "sent";
let routePath = "/email";
let routeMessage = "";

vi.mock("vue-router", () => ({
  RouterView: {
    template: '<div data-email-child-route="true" />',
  },
  useRoute: () => ({
    path: routePath,
    query: { tab: routeTab, ...(routeMessage ? { message: routeMessage } : {}) },
  }),
  useRouter: () => ({
    replace: routerReplace,
    push: routerPush,
  }),
}));

const sentMessage = {
  id: "sent-1",
  direction: "outbound",
  kind: "email",
  status: "sent",
  threadKey: "thread-1",
  fromAddress: "hey@example.com",
  fromName: "Kieran",
  toAddress: "kim@example.com",
  subject: "ME3",
  body: "Hi Kim",
  htmlBody: null,
  preview: "Hi Kim",
  folder: "sent",
  readAt: "2026-07-03T09:00:00Z",
  unread: false,
  agentSummary: null,
  agentLabels: [],
  metadata: {},
  unsubscribeAction: null,
  createdBy: "owner",
  approvedByUserId: "owner",
  approvedAt: "2026-07-03T09:00:00Z",
  sentAt: "2026-07-03T09:00:00Z",
  createdAt: "2026-07-03T09:00:00Z",
};

enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());

function threadSummaryFor(
  message: {
    id: string;
    threadKey: string | null;
    subject: string;
    direction: string;
    fromAddress: string | null;
    toAddress: string | null;
    preview: string;
    unread: boolean;
    metadata: { attachmentCount?: number };
    createdAt: string;
  } = sentMessage,
) {
  return {
    id: message.threadKey || message.id,
    subject: message.subject,
    participants: [
      message.direction === "inbound"
        ? message.fromAddress || "Unknown sender"
        : message.toAddress || "Unknown recipient",
    ],
    latestSnippet: message.preview,
    latestMessageId: message.id,
    messageCount: 1,
    unreadCount: message.unread ? 1 : 0,
    attachmentCount: message.metadata?.attachmentCount || 0,
    lastActivity: message.createdAt,
  };
}

function emptyContactSummary() {
  const outreach = Object.fromEntries(
    [
      "new",
      "drafted",
      "sent",
      "replied",
      "booked",
      "converted",
      "not_interested",
      "no_response",
    ].map((key) => [key, 0]),
  );
  return {
    total: 0,
    clients: 0,
    prospects: 0,
    contacts: 0,
    active: 0,
    dormant: 0,
    archived: 0,
    needsFollowUp: 0,
    outreach,
  };
}

function mailboxResponseFor(endpoint: string) {
  if (endpoint === "/mailbox" || endpoint === "/mailbox?include_activity=0") {
    return { mailbox: { aliasAddress: "hey@example.com" }, sources: [] };
  }
  if (endpoint === "/telegram/status") {
    return {
      available: true,
      configured: false,
      botUsername: null,
      startUrl: null,
      connection: null,
      recentEvents: [],
    };
  }
  if (endpoint === "/email-provider-settings") {
    return { activeProviderId: "", providers: [] };
  }
  if (endpoint === "/contacts") {
    return { contacts: [], summary: emptyContactSummary() };
  }
  if (endpoint.startsWith("/mailbox/threads?")) {
    const params = new URLSearchParams(endpoint.split("?")[1] || "");
    const threads =
      params.get("folder") === "sent" ? [threadSummaryFor()] : [];
    return { threads, nextCursor: null };
  }
  if (endpoint === "/mailbox/threads/thread-1") {
    return { thread: threadSummaryFor(), messages: [sentMessage] };
  }
  if (endpoint.startsWith("/mailbox/messages?")) {
    const params = new URLSearchParams(endpoint.split("?")[1] || "");
    const limit = Number(params.get("limit") || 50);
    const folder = params.get("folder");
    const messages = folder === "sent" && limit > 0 ? [sentMessage] : [];
    return { messages, total: messages.length, limit, offset: 0 };
  }
  throw new Error(`Unexpected GET ${endpoint}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function mountEmailPage(attachTo?: Element) {
  return mount(EmailPage, {
    attachTo,
    global: {
      stubs: {
        RouterLink: true,
        WorkspaceTabs: {
          emits: ["change", "update:modelValue"],
          template: `
            <nav>
              <button
                v-for="tab in tabs"
                :key="tab.id"
                :data-folder="tab.id"
                @click="$emit('change', tab.id)"
              >{{ tab.label }}</button>
            </nav>
          `,
          props: ["tabs", "modelValue"],
        },
      },
    },
  });
}

describe("EmailPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    routeTab = "sent";
    routePath = "/email";
    routeMessage = "";
    document.body.innerHTML = '<div id="app-side-nav-mobile-page-controls"></div>';
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(min-width: 641px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.mocked(api.get).mockImplementation(async (endpoint) =>
      mailboxResponseFor(endpoint),
    );
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    vi.mocked(api.put).mockResolvedValue({ ok: true });
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
  });

  it("opens an email selected by an Accounts source link", async () => {
    routeMessage = "sent-1";
    const wrapper = mountEmailPage();
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/mailbox/threads/thread-1");
    expect(wrapper.text()).toContain("Hi Kim");
  });

  it("defers app-shell mobile controls until their target is mounted", async () => {
    document.body.innerHTML = "";
    const ShellHarness = defineComponent({
      setup() {
        return () =>
          h("div", [
            h("div", { id: "app-side-nav-mobile-page-controls" }),
            h(EmailPage),
          ]);
      },
    });

    const wrapper = mount(ShellHarness, { attachTo: document.body });
    await flushPromises();

    expect(
      document.querySelector(
        "#app-side-nav-mobile-page-controls #mail-search-input-mobile-nav",
      ),
    ).not.toBeNull();
    expect(wrapper.text()).toContain("ME3");
  });

  it("renders Campaigns as a mailbox tab and routes to its nested page", async () => {
    const wrapper = mountEmailPage();
    await flushPromises();

    const campaigns = wrapper.get('[data-folder="campaigns"]');
    expect(campaigns.text()).toBe("Campaigns");
    await campaigns.trigger("click");

    expect(routerPush).toHaveBeenCalledWith("/email/campaigns");
  });

  it("keeps every mailbox folder in one tab list at mobile widths", async () => {
    const wrapper = mountEmailPage();
    await flushPromises();

    expect(
      wrapper.findAll("[data-folder]").map((tab) => tab.attributes("data-folder")),
    ).toEqual([
      "campaigns",
      "inbox",
      "drafts",
      "sent",
      "archive",
      "trash",
      "contacts",
    ]);
    expect(wrapper.text()).not.toContain("More");
  });

  it("renders a nested Campaigns route instead of leaving the inbox visible", async () => {
    routePath = "/email/campaigns";

    const wrapper = mountEmailPage();
    await flushPromises();

    expect(wrapper.find('[data-email-child-route="true"]').exists()).toBe(true);
    expect(wrapper.find(".mail-workspace").exists()).toBe(false);
  });

  it("renders the mobile Compose action as an icon-only button", async () => {
    mountEmailPage();
    await flushPromises();

    const compose = document.querySelector(
      ".mail-mobile-compose-btn",
    ) as HTMLElement;
    expect(compose.classList.contains("me3-btn--icon-only")).toBe(true);
    expect(compose.getAttribute("aria-label")).toBe("Compose");
    expect(compose.textContent?.trim()).toBe("");
  });

  it("reveals the empty list after bulk trash removes the open message", async () => {
    const wrapper = mountEmailPage();
    await flushPromises();

    await wrapper.get(".conversation-item").trigger("click");
    await wrapper.get('input[aria-label="Select ME3"]').setValue(true);
    await wrapper.get(".bulk-mail-actions .me3-btn--danger").trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/mailbox/threads/thread-1/move", {
      folder: "trash",
      fromFolder: "sent",
    });
    expect(wrapper.get(".conversation-list").classes()).not.toContain(
      "conversation-list--mobile-hidden",
    );
    expect(wrapper.text()).toContain("No sent messages yet.");
  });

  it("removes a message before its archive request completes", async () => {
    const archive = deferred<{ ok: boolean }>();
    vi.mocked(api.post).mockImplementation(() => archive.promise);
    const wrapper = mountEmailPage();
    await flushPromises();

    await wrapper.get(".conversation-item").trigger("click");
    await wrapper.get('input[aria-label="Select ME3"]').setValue(true);
    await wrapper.get(".bulk-mail-actions .me3-btn--outline").trigger("click");

    expect(api.post).toHaveBeenCalledWith("/mailbox/threads/thread-1/move", {
      folder: "archive",
      fromFolder: "sent",
    });
    expect(wrapper.text()).toContain("No sent messages yet.");

    archive.resolve({ ok: true });
    await flushPromises();
  });

  it("does not show an empty mailbox before the first list request succeeds", async () => {
    const initialList = deferred<{ threads: unknown[]; nextCursor: null }>();
    vi.mocked(api.get).mockImplementation((endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?") && endpoint.includes("folder=sent")) {
        return initialList.promise;
      }
      return Promise.resolve(mailboxResponseFor(endpoint));
    });

    const wrapper = mountEmailPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain("No sent messages yet.");

    initialList.resolve({ threads: [], nextCursor: null });
    await flushPromises();

    expect(wrapper.text()).toContain("No sent messages yet.");
  });

  it("refreshes the visible inbox after its owner-scoped cache is invalidated", async () => {
    routeTab = "inbox";
    useAuthStore().setSession({
      id: "owner",
      email: "owner@example.com",
      name: "Owner",
      username: "owner",
      timezone: null,
      locale: "en-US",
      localeSource: "inferred",
    });
    mountEmailPage();
    await flushPromises();
    vi.mocked(api.get).mockClear();

    useMailboxCacheStore().invalidateFolder(
      mailboxCacheScope("owner"),
      "inbox",
    );
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/mailbox\/threads\?.*folder=inbox/),
    );
  });

  it("renders a cached folder immediately while revalidating it", async () => {
    const first = mountEmailPage();
    await flushPromises();
    first.unmount();

    const revalidation = deferred<ReturnType<typeof mailboxResponseFor>>();
    vi.mocked(api.get).mockImplementation((endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?") && endpoint.includes("folder=sent")) {
        return revalidation.promise;
      }
      return Promise.resolve(mailboxResponseFor(endpoint));
    });

    const second = mountEmailPage();
    await flushPromises();

    expect(second.find(".conversation-item").exists()).toBe(true);
    expect(second.text()).not.toContain("Loading messages...");

    revalidation.resolve({ threads: [threadSummaryFor()], nextCursor: null });
    await flushPromises();
  });

  it("keeps the current folder when an earlier request finishes late", async () => {
    const sent = deferred<ReturnType<typeof mailboxResponseFor>>();
    const archiveMessage = {
      ...sentMessage,
      id: "archive-1",
      folder: "archive",
      toAddress: "archive@example.com",
    };
    vi.mocked(api.get).mockImplementation((endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?") && endpoint.includes("folder=sent")) {
        return sent.promise;
      }
      if (endpoint.startsWith("/mailbox/threads?") && endpoint.includes("folder=archive")) {
        return Promise.resolve({
          threads: [threadSummaryFor(archiveMessage)],
          nextCursor: null,
        });
      }
      return Promise.resolve(mailboxResponseFor(endpoint));
    });

    const wrapper = mountEmailPage();
    await wrapper.get('[data-folder="archive"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("archive@example.com");
    sent.resolve({ threads: [threadSummaryFor()], nextCursor: null });
    await flushPromises();

    expect(wrapper.text()).toContain("archive@example.com");
    expect(wrapper.text()).not.toContain("kim@example.com");
  });

  it("restores a message if an optimistic trash request fails", async () => {
    const post = deferred<{ ok: boolean }>();
    vi.mocked(api.post).mockImplementation(() => post.promise);
    const wrapper = mountEmailPage();
    await flushPromises();

    await wrapper.get(".conversation-item").trigger("click");
    await wrapper.get('input[aria-label="Select ME3"]').setValue(true);
    await wrapper.get(".bulk-mail-actions .me3-btn--danger").trigger("click");

    expect(wrapper.text()).toContain("No sent messages yet.");
    post.reject(new Error("Trash failed"));
    await flushPromises();

    expect(wrapper.find(".conversation-item").exists()).toBe(true);
    expect(wrapper.text()).toContain(
      "Some conversations could not be moved. The folder was refreshed.",
    );
  });

  it("reconciles the folder after a partially successful bulk move", async () => {
    const first = {
      ...sentMessage,
      id: "sent-1",
      threadKey: "thread-1",
      subject: "First",
    };
    const second = {
      ...sentMessage,
      id: "sent-2",
      threadKey: "thread-2",
      subject: "Second",
    };
    let serverMessages = [first, second];
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        return {
          threads:
            params.get("folder") === "sent"
              ? serverMessages.map(threadSummaryFor)
              : [],
          nextCursor: null,
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const visible =
          params.get("folder") === "sent" &&
          Number(params.get("limit") || 50) > 0
            ? serverMessages
            : [];
        return {
          messages: visible,
          total: visible.length,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });
    vi.mocked(api.post).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/threads/thread-1/move") {
        serverMessages = [second];
        return { ok: true };
      }
      if (endpoint === "/mailbox/threads/thread-2/move") {
        throw new Error("Move failed");
      }
      return { ok: true };
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper
      .get('input[aria-label="Select all conversations on this page"]')
      .setValue(true);
    await wrapper.get(".bulk-mail-actions .me3-btn--outline").trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("First");
    expect(wrapper.text()).toContain("Second");
    expect(wrapper.text()).toContain(
      "Some conversations could not be moved. The folder was refreshed.",
    );
    expect(toastApi.success).toHaveBeenCalledWith(
      "Conversation archived.",
      expect.objectContaining({ action: expect.any(Object) }),
    );
  });

  it("marks unread mail only after the user explicitly opens it", async () => {
    routeTab = "inbox";
    const unreadMessage = {
      ...sentMessage,
      id: "inbox-1",
      threadKey: "thread-inbox",
      direction: "inbound",
      status: "received",
      folder: "inbox",
      fromAddress: "kim@example.com",
      toAddress: "hey@example.com",
      readAt: null,
      unread: true,
    };
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        return {
          threads:
            params.get("folder") === "inbox"
              ? [threadSummaryFor(unreadMessage)]
              : [],
          nextCursor: null,
        };
      }
      if (endpoint === "/mailbox/threads/thread-inbox") {
        return {
          thread: threadSummaryFor(unreadMessage),
          messages: [unreadMessage],
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const showMessage =
          params.get("folder") === "inbox" &&
          Number(params.get("limit") || 50) > 0;
        return {
          messages: showMessage ? [unreadMessage] : [],
          total: showMessage ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();

    expect(api.post).not.toHaveBeenCalledWith(
      "/mailbox/threads/thread-inbox/read",
      { read: true },
    );

    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/mailbox/threads/thread-inbox/read", {
      read: true,
    });
  });

  it("applies a delayed read result to the conversation that requested it", async () => {
    routeTab = "inbox";
    const first = {
      ...sentMessage,
      id: "inbox-1",
      threadKey: "thread-inbox-1",
      subject: "First unread",
      direction: "inbound",
      status: "received",
      folder: "inbox",
      readAt: null,
      unread: true,
    };
    const second = {
      ...first,
      id: "inbox-2",
      threadKey: "thread-inbox-2",
      subject: "Second unread",
    };
    const firstRead = deferred<{ ok: boolean }>();
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        return {
          threads:
            params.get("folder") === "inbox"
              ? [
                  threadSummaryFor(first),
                  { ...threadSummaryFor(second), unreadCount: 2 },
                ]
              : [],
          nextCursor: null,
        };
      }
      if (endpoint === "/mailbox/threads/thread-inbox-1") {
        return { thread: threadSummaryFor(first), messages: [first] };
      }
      if (endpoint === "/mailbox/threads/thread-inbox-2") {
        return {
          thread: { ...threadSummaryFor(second), unreadCount: 2 },
          messages: [second],
        };
      }
      return mailboxResponseFor(endpoint);
    });
    vi.mocked(api.post).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/threads/thread-inbox-1/read") {
        return firstRead.promise;
      }
      if (endpoint === "/mailbox/threads/thread-inbox-2/read") {
        throw new Error("Read failed");
      }
      return { ok: true };
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    const rows = wrapper.findAll(".conversation-open");
    await rows[0].trigger("click");
    await flushPromises();
    await rows[1].trigger("click");
    await flushPromises();

    firstRead.resolve({ ok: true });
    await flushPromises();

    const secondRow = wrapper
      .findAll(".conversation-item")
      .find((row) => row.text().includes("Second unread"));
    expect(secondRow?.text()).toContain("2 unread");
  });

  it("keeps and reuses a saved draft when sending fails", async () => {
    let approvalAttempts = 0;
    const draft = {
      ...sentMessage,
      id: "draft-1",
      kind: "draft",
      status: "pending_approval",
      folder: "drafts",
      sentAt: null,
    };
    vi.mocked(api.post).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/drafts") return { draft };
      if (endpoint === "/mailbox/drafts/draft-1/approve") {
        approvalAttempts += 1;
        if (approvalAttempts === 1) throw new Error("Provider unavailable");
        return { ok: true };
      }
      return { ok: true };
    });
    vi.mocked(api.put).mockResolvedValue({ draft });
    mountEmailPage();
    await flushPromises();

    (document.querySelector(".mail-mobile-compose-btn") as HTMLElement).click();
    await flushPromises();

    const setValue = (selector: string, value: string) => {
      const input = document.querySelector(selector) as
        | HTMLInputElement
        | HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setValue("#compose-to", "kim@example.com");
    setValue("#compose-subject", "Hello");
    setValue(".compose-field--body textarea", "Hi Kim");
    await flushPromises();

    (
      document.querySelector(
        ".compose-modal__actions .me3-btn--primary",
      ) as HTMLElement
    ).click();
    await flushPromises();

    expect(document.body.textContent).toContain(
      "Draft saved, but sending failed. Provider unavailable",
    );

    (
      document.querySelector(
        ".compose-modal__actions .me3-btn--primary",
      ) as HTMLElement
    ).click();
    await flushPromises();

    expect(
      vi.mocked(api.post).mock.calls.filter(
        ([endpoint]) => endpoint === "/mailbox/drafts",
      ),
    ).toHaveLength(1);
    expect(api.put).not.toHaveBeenCalled();
    expect(approvalAttempts).toBe(2);
  });

  it("keeps an in-flight draft visible without exposing conflicting actions", async () => {
    routeTab = "drafts";
    const sendingDraft = {
      ...sentMessage,
      id: "draft-sending",
      kind: "draft",
      status: "approved",
      folder: "drafts",
      sentAt: null,
    };
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const showMessage =
          params.get("folder") === "drafts" &&
          params.get("status")?.includes("approved") &&
          Number(params.get("limit") || 50) > 0;
        return {
          messages: showMessage ? [sendingDraft] : [],
          total: showMessage ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();

    expect(wrapper.text()).toContain("Sending");
    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();
    expect(wrapper.find(".message-card__actions").exists()).toBe(false);
    expect(wrapper.get('button[aria-label="Archive"]').attributes("disabled")).toBeDefined();
  });

  it("blocks remote email content until the user allows it", async () => {
    const richMessage = {
      ...sentMessage,
      htmlBody: '<p>Hello</p><img src="https://tracker.example/pixel.png">',
    };
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        return {
          threads:
            params.get("folder") === "sent"
              ? [threadSummaryFor(richMessage)]
              : [],
          nextCursor: null,
        };
      }
      if (endpoint === "/mailbox/threads/thread-1") {
        return {
          thread: threadSummaryFor(richMessage),
          messages: [richMessage],
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const showMessage =
          params.get("folder") === "sent" &&
          Number(params.get("limit") || 50) > 0;
        return {
          messages: showMessage ? [richMessage] : [],
          total: showMessage ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });
    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();

    const frame = wrapper.get(".message-html-frame")
      .element as HTMLIFrameElement;
    expect(frame.srcdoc).toContain("img-src data: blob:");
    expect(wrapper.text()).toContain(
      "External content is blocked for your privacy.",
    );

    await wrapper.get(".external-content-notice button").trigger("click");
    await flushPromises();

    expect(frame.srcdoc).toContain("img-src https: http: data: blob:");
  });

  it("uses an opaque cursor and renders thread cues without loading bodies", async () => {
    const secondMessage = {
      ...sentMessage,
      id: "sent-2",
      threadKey: "thread-2",
      toAddress: "alex@example.com",
      subject: "Second page",
    };
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        if (params.get("cursor") === "opaque-next") {
          return {
            threads: [threadSummaryFor(secondMessage)],
            nextCursor: null,
          };
        }
        return {
          threads: [
            {
              ...threadSummaryFor(),
              participants: ["hey@example.com", "kim@example.com"],
              messageCount: 3,
              unreadCount: 2,
              attachmentCount: 1,
            },
          ],
          nextCursor: "opaque-next",
        };
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();

    expect(wrapper.text()).toContain("3");
    expect(wrapper.text()).toContain("2 unread");
    expect(wrapper.get(".conversation-item__meta").text()).toBe(
      "kim@example.com",
    );
    expect(api.get).not.toHaveBeenCalledWith("/mailbox/threads/thread-1");

    const conversationList = wrapper.get(".conversation-list")
      .element as HTMLElement;
    conversationList.scrollTop = 147;
    await wrapper.get('button[aria-label="Next page"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Second page");
    expect(conversationList.scrollTop).toBe(0);
    expect(api.get).toHaveBeenCalledWith(
      "/mailbox/threads?folder=sent&limit=50&cursor=opaque-next",
    );

    conversationList.scrollTop = 31;
    await wrapper.get('button[aria-label="Previous page"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("ME3");
    expect(conversationList.scrollTop).toBe(147);
  });

  it("restores the cached page cursor while its refresh is pending", async () => {
    const secondMessage = {
      ...sentMessage,
      id: "sent-2",
      threadKey: "thread-2",
      subject: "Second page",
    };
    const firstPageRefresh = deferred<{
      threads: ReturnType<typeof threadSummaryFor>[];
      nextCursor: string;
    }>();
    let firstPageRequests = 0;
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        if (params.get("cursor") === "opaque-next") {
          return {
            threads: [threadSummaryFor(secondMessage)],
            nextCursor: null,
          };
        }
        firstPageRequests += 1;
        if (firstPageRequests > 1) return firstPageRefresh.promise;
        return {
          threads: [threadSummaryFor()],
          nextCursor: "opaque-next",
        };
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper.get('button[aria-label="Next page"]').trigger("click");
    await flushPromises();
    await wrapper.get('button[aria-label="Previous page"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("ME3");
    expect(
      wrapper.get('button[aria-label="Next page"]').attributes("disabled"),
    ).toBeUndefined();

    firstPageRefresh.resolve({
      threads: [threadSummaryFor()],
      nextCursor: "opaque-next",
    });
    await flushPromises();
  });

  it("does not expose or register mailbox keyboard shortcuts", async () => {
    const wrapper = mountEmailPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain("Shortcuts");
    await wrapper.get('input[aria-label="Select ME3"]').setValue(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    await flushPromises();

    expect(wrapper.get(".conversation-open").attributes("aria-current")).toBeUndefined();
    expect(api.post).not.toHaveBeenCalledWith(
      "/mailbox/threads/thread-1/move",
      { folder: "archive", fromFolder: "sent" },
    );
  });

  it("falls back to the message list on older Core versions", async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/mailbox/threads?")) {
        throw Object.assign(new Error("Not found"), { status: 404 });
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();

    expect(wrapper.text()).toContain("kim@example.com");
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining("/mailbox/messages?folder=sent"),
    );
  });

  it("adopts and polls an approved draft after an ambiguous send response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T09:00:00Z"));
    routeTab = "drafts";
    const draft = {
      ...sentMessage,
      id: "draft-ambiguous",
      kind: "draft",
      status: "pending_approval",
      folder: "drafts",
      sentAt: null,
    };
    const approved = {
      ...draft,
      status: "approved",
      approvedAt: "2026-07-16T09:00:00Z",
    };
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/messages/draft-ambiguous") {
        return { message: approved };
      }
      if (endpoint === "/mailbox/drafts/draft-ambiguous/delivery-status") {
        return {
          delivery: {
            id: draft.id,
            state: "sending",
            checkedAt: "2026-07-16T09:00:01Z",
            unknownAfter: "2026-07-16T09:05:00Z",
            canMarkSent: false,
            canRetryAnyway: false,
          },
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const visible =
          params.get("folder") === "drafts" &&
          Number(params.get("limit") || 50) > 0;
        return {
          messages: visible ? [draft] : [],
          total: visible ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });
    vi.mocked(api.post).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/drafts/draft-ambiguous/approve") {
        throw Object.assign(new Error("Delivery could not be confirmed"), {
          status: 502,
        });
      }
      return { ok: true };
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();
    await wrapper.get(".message-card__actions .me3-btn--primary").trigger("click");
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/mailbox/messages/draft-ambiguous");
    expect(api.get).toHaveBeenCalledWith(
      "/mailbox/drafts/draft-ambiguous/delivery-status",
    );
    expect(wrapper.text()).toContain("Sending");
    expect(wrapper.find(".message-card__actions").exists()).toBe(false);
  });

  it("starts the new delivery window after an ambiguous retry-anyway response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T09:00:00Z"));
    routeTab = "drafts";
    const draft = {
      ...sentMessage,
      id: "draft-retried",
      kind: "draft",
      status: "approved",
      folder: "drafts",
      approvedAt: "2026-07-16T08:00:00Z",
      sentAt: null,
    };
    const retried = {
      ...draft,
      approvedAt: "2026-07-16T09:00:00Z",
    };
    let statusChecks = 0;
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/messages/draft-retried") {
        return { message: retried };
      }
      if (endpoint === "/mailbox/drafts/draft-retried/delivery-status") {
        statusChecks += 1;
        return {
          delivery: {
            id: draft.id,
            state: statusChecks === 1 ? "delivery_unknown" : "sending",
            checkedAt: "2026-07-16T09:00:01Z",
            unknownAfter:
              statusChecks === 1
                ? "2026-07-16T08:05:00Z"
                : "2026-07-16T09:05:00Z",
            canMarkSent: statusChecks === 1,
            canRetryAnyway: statusChecks === 1,
          },
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const visible =
          params.get("folder") === "drafts" &&
          Number(params.get("limit") || 50) > 0;
        return {
          messages: visible ? [draft] : [],
          total: visible ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });
    vi.mocked(api.post).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/drafts/draft-retried/retry-anyway") {
        throw Object.assign(new Error("Delivery could not be confirmed"), {
          status: 502,
        });
      }
      return { ok: true };
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();
    const retry = wrapper
      .findAll(".delivery-unconfirmed button")
      .find((button) => button.text() === "Retry anyway");
    await retry!.trigger("click");
    const confirm = wrapper
      .findAll(".delivery-unconfirmed button")
      .find((button) => button.text() === "Confirm retry");
    await confirm!.trigger("click");
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/mailbox/messages/draft-retried");
    expect(statusChecks).toBe(2);
    expect(wrapper.text()).toContain("Sending");
    expect(wrapper.text()).not.toContain("Delivery could not be confirmed");
  });

  it("refreshes the Drafts list when delivery reconciliation becomes terminal", async () => {
    routeTab = "drafts";
    const draft = {
      ...sentMessage,
      id: "draft-reconciled",
      kind: "draft",
      status: "approved",
      folder: "drafts",
      sentAt: null,
    };
    const sent = {
      ...draft,
      kind: "email",
      status: "sent",
      folder: "sent",
      sentAt: "2026-07-16T09:00:00Z",
    };
    let draftListLoads = 0;
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/messages/draft-reconciled") {
        return { message: sent };
      }
      if (endpoint === "/mailbox/drafts/draft-reconciled/delivery-status") {
        return {
          delivery: {
            id: draft.id,
            state: "sent",
            checkedAt: "2026-07-16T09:00:01Z",
            unknownAfter: null,
            canMarkSent: false,
            canRetryAnyway: false,
          },
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const isDraftList =
          params.get("folder") === "drafts" &&
          Number(params.get("limit") || 50) > 0;
        if (isDraftList) draftListLoads += 1;
        const visible = isDraftList && draftListLoads === 1;
        return {
          messages: visible ? [draft] : [],
          total: visible ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/mailbox/messages/draft-reconciled");
    expect(draftListLoads).toBe(2);
    expect(wrapper.text()).toContain("No drafts awaiting action");
    expect(wrapper.text()).not.toContain("Sending");
  });

  it("shows explicit recovery for delivery-unknown drafts without resending", async () => {
    routeTab = "drafts";
    const draft = {
      ...sentMessage,
      id: "draft-unknown",
      kind: "draft",
      status: "approved",
      folder: "drafts",
      sentAt: null,
    };
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/drafts/draft-unknown/delivery-status") {
        return {
          delivery: {
            id: draft.id,
            state: "delivery_unknown",
            checkedAt: "2026-07-16T09:10:00Z",
            unknownAfter: "2026-07-16T09:05:00Z",
            canMarkSent: true,
            canRetryAnyway: true,
          },
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const visible =
          params.get("folder") === "drafts" &&
          Number(params.get("limit") || 50) > 0;
        return {
          messages: visible ? [draft] : [],
          total: visible ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Delivery could not be confirmed");
    expect(wrapper.text()).toContain("Retry anyway");

    await wrapper.get(".delivery-unconfirmed .me3-btn--outline").trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      "/mailbox/drafts/draft-unknown/mark-sent",
    );
    expect(api.post).not.toHaveBeenCalledWith(
      "/mailbox/drafts/draft-unknown/retry-anyway",
    );
  });

  it("refreshes a sending draft once when its confirmation window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T09:00:00Z"));
    routeTab = "drafts";
    const draft = {
      ...sentMessage,
      id: "draft-waiting",
      kind: "draft",
      status: "approved",
      folder: "drafts",
      sentAt: null,
    };
    let statusChecks = 0;
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint === "/mailbox/drafts/draft-waiting/delivery-status") {
        statusChecks += 1;
        return {
          delivery: {
            id: draft.id,
            state: statusChecks === 1 ? "sending" : "delivery_unknown",
            checkedAt: new Date().toISOString(),
            unknownAfter: "2026-07-16T09:00:01Z",
            canMarkSent: statusChecks > 1,
            canRetryAnyway: statusChecks > 1,
          },
        };
      }
      if (endpoint.startsWith("/mailbox/messages?")) {
        const params = new URLSearchParams(endpoint.split("?")[1] || "");
        const visible =
          params.get("folder") === "drafts" &&
          Number(params.get("limit") || 50) > 0;
        return {
          messages: visible ? [draft] : [],
          total: visible ? 1 : 0,
          limit: Number(params.get("limit") || 50),
          offset: 0,
        };
      }
      return mailboxResponseFor(endpoint);
    });

    const wrapper = mountEmailPage();
    await flushPromises();
    await wrapper.get(".conversation-open").trigger("click");
    await flushPromises();

    expect(statusChecks).toBe(1);
    expect(wrapper.text()).not.toContain("Delivery could not be confirmed");

    await vi.advanceTimersByTimeAsync(1_250);
    await flushPromises();

    expect(statusChecks).toBe(2);
    expect(wrapper.text()).toContain("Delivery could not be confirmed");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(statusChecks).toBe(2);
  });
});
