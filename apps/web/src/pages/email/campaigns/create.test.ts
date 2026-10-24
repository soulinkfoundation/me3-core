import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPut = vi.fn();
const apiPost = vi.fn();
const routerPush = vi.fn();
const routerReplace = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let routeQuery: Record<string, string> = { campaign: "campaign-1" };

vi.mock("unplugin-vue-router/runtime", () => ({ definePage: vi.fn() }));
vi.mock("vue-router", () => ({
  RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}));
vi.mock("../../../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
    post: (...args: unknown[]) => apiPost(...args),
    upload: vi.fn(),
  },
}));
vi.mock("../../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastSuccess, toastError, toastFromUnknown: vi.fn() }),
}));
vi.mock("../../../stores/auth", () => ({
  useAuthStore: () => ({ user: { email: "owner@example.com" } }),
}));
vi.mock("../../../stores/sites", () => ({
  useSitesStore: () => ({
    sites: [
      { id: "site-1", username: "kieran" },
      { id: "site-2", username: "mentuition" },
    ],
    ensureSites: vi.fn(),
  }),
}));
vi.mock("../../../components/TiptapEditor.vue", () => ({
  default: {
    name: "TiptapEditor",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: '<div data-test="editor" />',
  },
}));

import CampaignEditorPage from "./create.vue";

const transport = {
  managed: true,
  ready: true,
  reason: null,
  sender: { ref: "sender-1", fromAddress: "campaign@example.com", domain: "example.com" },
  addOn: null,
  instructions: [],
};

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    siteId: "site-1",
    siteUsername: "kieran",
    name: "August update",
    status: "draft",
    audienceFilter: { kind: "all", itemRef: null },
    revision: {
      id: "revision-1",
      subject: "August update",
      previewText: "A short preview",
      replyToAddress: "hello@example.com",
      rendererVersion: "me3.email-renderer.v2",
      document: {
        version: "me3.campaign-document.v1",
        brand: {
          name: "Kieran Studio",
          homeUrl: "https://kieran.example.com/",
          logoUrl: null,
          logoAlignment: "center",
          backgroundColor: "#f4f5f4",
          surfaceColor: "#ffffff",
          textColor: "#18201d",
          accentColor: "#147d64",
        },
        blocks: [{
          id: "intro",
          type: "text",
          paragraphs: [{ style: "body", spans: [{ text: "Hello readers" }] }],
        }],
      },
      renderedHtml: "<p>Hello readers</p>",
      renderedText: "Hello readers",
    },
    ...overrides,
  };
}

const AppDialogStub = {
  props: ["open"],
  template: '<div v-if="open" data-test="dialog"><slot /></div>',
};

function mountEditor() {
  return mount(CampaignEditorPage, {
    attachTo: document.body,
    global: { stubs: { AppDialog: AppDialogStub } },
  });
}

describe("campaign editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeQuery = { campaign: "campaign-1" };
    apiGet.mockImplementation((path: string) => {
      if (path === "/email/campaigns/transport") return Promise.resolve({ transport });
      if (path.startsWith("/email/campaigns/audience-items")) return Promise.resolve({ items: [] });
      if (path.endsWith("/review")) {
        return Promise.resolve({
          audience: {
            eligibleCount: 42,
            excludedCount: 5,
            exclusionCounts: { unsubscribed: 3, bounced: 2, duplicate: 0 },
          },
          transport,
        });
      }
      return Promise.resolve({ campaign: makeCampaign() });
    });
    apiPut.mockImplementation((_path: string, body: Record<string, unknown>) =>
      Promise.resolve({ campaign: makeCampaign({ name: body.name }) }),
    );
  });

  it("is one page: subject, preview line and body with To, From and Preview beside them", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    expect(wrapper.find(".progress-bar").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Exit");
    expect(wrapper.get(".campaign-editor-bar__back").attributes("href")).toBe("/email/campaigns");
    const fields = wrapper.findAll(".campaign-editor__main input");
    expect(fields.map((field) => (field.element as HTMLInputElement).value)).toEqual([
      "August update",
      "A short preview",
    ]);
    expect(wrapper.find('[data-test="editor"]').exists()).toBe(true);
    expect(wrapper.findAll(".campaign-side-block h2").map((heading) => heading.text())).toEqual([
      "To",
      "From",
      "Preview",
    ]);
    expect(wrapper.text()).toContain("Kieran Studio <campaign@example.com>");
    wrapper.unmount();
  });

  it("shows who it goes to and who is left out", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    const to = wrapper.findAll(".campaign-side-block")[0]!;
    expect(to.text()).toContain("42 subscribers");
    expect(to.findAll(".campaign-side-block__reasons li").map((item) => item.text())).toEqual([
      "3 unsubscribed · left out",
      "2 bounced · left out",
    ]);
    wrapper.unmount();
  });

  it("changes the sender name and reply-to from the From sheet and saves them", async () => {
    vi.useFakeTimers();
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper.get(".campaign-side-block__change").trigger("click");
    const inputs = wrapper.findAll('[data-test="dialog"] input');
    await inputs[0]!.setValue("Kieran Butler");
    await inputs[1]!.setValue("");
    await wrapper.get('[data-test="dialog"] form').trigger("submit");
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Replies aren't collected");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(apiPut).toHaveBeenLastCalledWith(
      "/email/campaigns/campaign-1",
      expect.objectContaining({
        replyToAddress: null,
        document: expect.objectContaining({
          brand: expect.objectContaining({ name: "Kieran Butler" }),
        }),
      }),
    );
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("opens the send controls inline and names what the button does", async () => {
    apiPost.mockResolvedValue({ ok: true });
    const wrapper = mountEditor();
    await flushPromises();

    const reviewButton = wrapper.findAll("button").find((button) => button.text() === "Review and send")!;
    await reviewButton.trigger("click");
    await flushPromises();

    const panel = wrapper.get(".campaign-send");
    expect(panel.text()).toContain("42 subscribers of @kieran");
    const send = panel.findAll("button").find((button) => button.text() === "Send to 42 people")!;
    await send.trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns/campaign-1/send", { scheduledFor: null });
    expect(routerPush).toHaveBeenCalledWith("/email/campaigns");
    wrapper.unmount();
  });

  it("sends a test from the top bar", async () => {
    apiPost.mockResolvedValue({ test: { status: "accepted" } });
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text() === "Send test")!.trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns/campaign-1/test");
    expect(toastSuccess).toHaveBeenCalledWith("Test sent to owner@example.com.");
    wrapper.unmount();
  });

  it("only saves a new campaign once the owner has written something", async () => {
    routeQuery = {};
    apiPost.mockResolvedValue({ campaign: makeCampaign({ id: "campaign-new", name: "Untitled campaign" }) });
    const wrapper = mountEditor();
    await flushPromises();

    expect(apiPost).not.toHaveBeenCalled();
    expect(wrapper.findAll(".campaign-side-block")[1]!.text()).toContain("Kieran");

    await wrapper.get(".campaign-field--subject input").setValue("Autumn retreat");
    await wrapper.findAll("button").find((button) => button.text() === "Review and send")!.trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns", {
      siteId: "site-1",
      audienceFilter: { kind: "all", itemRef: null },
    });
    expect(routerReplace).toHaveBeenCalledWith({
      path: "/email/campaigns/create",
      query: { campaign: "campaign-new" },
    });
    expect(apiPut).toHaveBeenCalledWith(
      "/email/campaigns/campaign-new",
      expect.objectContaining({ subject: "Autumn retreat" }),
    );
    wrapper.unmount();
  });

  it("does not save an empty new campaign when the editor tidies its blank body", async () => {
    routeQuery = {};
    vi.useFakeTimers();
    const wrapper = mountEditor();
    await flushPromises();

    wrapper.getComponent({ name: "TiptapEditor" }).vm.$emit("update:modelValue", "<p><br></p>");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(apiPost).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("recounts when the list changes", async () => {
    const wrapper = mountEditor();
    await flushPromises();
    apiGet.mockClear();

    await wrapper.get(".campaign-side-field select").setValue("site-2");
    await flushPromises();

    expect(apiPut).toHaveBeenLastCalledWith(
      "/email/campaigns/campaign-1",
      expect.objectContaining({ siteId: "site-2" }),
    );
    expect(apiGet).toHaveBeenCalledWith("/email/campaigns/campaign-1/review");
    wrapper.unmount();
  });

  it("sends a campaign that already went out to its own page", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/email/campaigns/transport") return Promise.resolve({ transport });
      return Promise.resolve({ campaign: makeCampaign({ status: "sent" }) });
    });
    const wrapper = mountEditor();
    await flushPromises();

    expect(routerReplace).toHaveBeenCalledWith("/email/campaigns/campaign-1");
    wrapper.unmount();
  });
});
