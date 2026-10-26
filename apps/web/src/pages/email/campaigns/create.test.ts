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
      rendererVersion: "me3.email-renderer.v3",
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
          mailingAddress: "PO Box 12, Dublin 2",
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
      "Look",
      "Preview",
    ]);
    expect(wrapper.text()).toContain("Kieran Studio <campaign@example.com>");
    wrapper.unmount();
  });

  it("shows who it goes to and who is left out", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    const to = wrapper.findAll(".campaign-side-block")[0]!;
    expect(to.text()).toContain("42 subscribers of @kieran");
    expect(to.get(".campaign-side-block__left-out").text()).toBe(
      "5 left out: 3 unsubscribed and 2 bounced.",
    );
    wrapper.unmount();
  });

  it("changes the sender name and reply-to from the From sheet and saves them", async () => {
    vi.useFakeTimers();
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper.findAll(".campaign-side-block__change")[1]!.trigger("click");
    const inputs = wrapper.findAll('[data-test="dialog"] input');
    await inputs[0]!.setValue("Kieran Butler");
    expect(wrapper.get('[data-test="dialog"]').text()).toContain("Send replies to owner@example.com");
    await inputs[1]!.setValue(false);
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

  it("saves the footer mailing address from the From sheet", async () => {
    vi.useFakeTimers();
    const wrapper = mountEditor();
    await flushPromises();

    expect(wrapper.findAll(".campaign-side-block")[1]!.text()).toContain("PO Box 12, Dublin 2");
    await wrapper.findAll(".campaign-side-block__change")[1]!.trigger("click");
    await wrapper.get('[data-test="dialog"] textarea').setValue("Unit 4\nMain Street\nCork");
    await wrapper.get('[data-test="dialog"] form').trigger("submit");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(apiPut).toHaveBeenLastCalledWith(
      "/email/campaigns/campaign-1",
      expect.objectContaining({
        document: expect.objectContaining({
          brand: expect.objectContaining({ mailingAddress: "Unit 4, Main Street, Cork" }),
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

    const panel = wrapper.get(".campaign-approval");
    expect(panel.text()).toContain("42 subscribers of @kieran");
    const send = panel.findAll("button").find((button) => button.text() === "Send to 42 people")!;
    await send.trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns/campaign-1/send", {
      revisionId: "revision-1",
      recipientCount: 42,
      scheduledFor: null,
    });
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
      audienceFilter: { kind: "all", itemRef: null, notSentBy: null },
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

  it("keeps a send-again draft limited to people the first campaign missed", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/email/campaigns/transport") return Promise.resolve({ transport });
      if (path.startsWith("/email/campaigns/audience-items")) return Promise.resolve({ items: [] });
      if (path.endsWith("/review")) {
        return Promise.resolve({ audience: { eligibleCount: 4, excludedCount: 0, exclusionCounts: {} }, transport });
      }
      if (path === "/email/campaigns/campaign-sent") {
        return Promise.resolve({ campaign: makeCampaign({ id: "campaign-sent", status: "sent", revision: { ...makeCampaign().revision, subject: "September newsletter" } }) });
      }
      return Promise.resolve({
        campaign: makeCampaign({ audienceFilter: { kind: "all", itemRef: null, notSentBy: "campaign-sent" } }),
      });
    });
    vi.useFakeTimers();
    const wrapper = mountEditor();
    await flushPromises();

    expect(wrapper.findAll(".campaign-side-block")[0]!.text()).toContain(
      "Only people who didn't get “September newsletter”",
    );
    await wrapper.get(".campaign-field--subject input").setValue("September newsletter (again)");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(apiPut).toHaveBeenLastCalledWith(
      "/email/campaigns/campaign-1",
      expect.objectContaining({ audienceFilter: { kind: "all", itemRef: null, notSentBy: "campaign-sent" } }),
    );
    wrapper.unmount();
    vi.useRealTimers();
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

  it("lists who will get it and who is left out", async () => {
    const original = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path.endsWith("/recipients")
        ? Promise.resolve({
          eligibleCount: 1,
          excludedCount: 1,
          eligible: [{ email: "sam@example.com", name: "Sam Rivers" }],
          excluded: [{ email: "old@example.com", reason: "unsubscribed" }],
        })
        : original(path),
    );
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper.findAll(".campaign-side-block__change")[0]!.trigger("click");
    await wrapper.get(".campaign-recipients__toggle").trigger("click");
    await flushPromises();

    const list = wrapper.get(".campaign-recipients");
    expect(apiGet).toHaveBeenCalledWith("/email/campaigns/campaign-1/recipients");
    expect(list.text()).toContain("sam@example.comSam Rivers");
    expect(list.text()).toContain("Left out");
    expect(list.text()).toContain("old@example.comunsubscribed");
    wrapper.unmount();
  });

  it("recounts when the list changes", async () => {
    const wrapper = mountEditor();
    await flushPromises();
    apiGet.mockClear();

    await wrapper.findAll(".campaign-side-block__change")[0]!.trigger("click");
    const sheet = wrapper.get('[data-test="dialog"]');
    expect(sheet.text()).toContain("42 people will get it. 5 left out: 3 unsubscribed and 2 bounced.");
    await sheet.get("select").setValue("site-2");
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
  it("names the owner's own provider in From, and offers to connect one when self-hosted", async () => {
    let selfHosted: Record<string, unknown> = {
      managed: false,
      ready: false,
      reason: "sender_not_connected",
      sender: null,
      provider: null,
      addOn: null,
      instructions: [],
    };
    const baseGet = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) => {
      if (path === "/email/campaigns/transport") return Promise.resolve({ transport: selfHosted });
      if (path === "/email-provider-settings") {
        return Promise.resolve({ encryptionConfigured: true, activeProviderId: "smtp", providers: [], futureProviders: [] });
      }
      if (path.endsWith("/review")) {
        return Promise.resolve({
          audience: { eligibleCount: 42, excludedCount: 0, exclusionCounts: {} },
          transport: selfHosted,
        });
      }
      return baseGet(path);
    });
    const notReady = mountEditor();
    await flushPromises();
    await notReady.findAll(".campaign-side-block__change")[1]!.trigger("click");
    expect(notReady.get('[data-test="dialog"]').text()).toContain("Connect a sender");
    notReady.unmount();

    selfHosted = {
      ...selfHosted,
      ready: true,
      reason: null,
      sender: { ref: "provider:postmark", fromAddress: "news@owner.test", domain: "owner.test" },
      provider: { id: "postmark", label: "Postmark", tracksDelivery: true, deliveryEventsUrl: null },
    };
    const ready = mountEditor();
    await flushPromises();
    expect(ready.get('[aria-labelledby="campaign-from-title"]').text())
      .toContain("Sends through Postmark from news@owner.test");
    expect(ready.text()).not.toMatch(/sends left/i);
    ready.unmount();
  });

  describe("templates and brand (me3-bli3.2.12)", () => {
    const branding = {
      logoRef: "./files/logo.webp",
      logoUrl: "https://kieran.example.com/files/logo.webp",
      emailLogoUrl: "https://kieran.example.com/files/email-logo.png?v=abc",
      emailLogoWidth: 180,
      emailLogoHeight: 48,
      accentColor: "#3d7a5c",
      backgroundColor: "#f4f5f4",
      textColor: "#18201d",
    };
    const layouts = [{
      id: "event",
      name: "Event or offer",
      description: "When, where, price and a button",
      subject: "Coming up at Kieran",
      html: "<html></html>",
      blocks: [
        { id: "event-intro", type: "text", paragraphs: [{ style: "heading1", spans: [{ text: "Name of the event or offer" }] }] },
        { id: "event-photo", type: "photo-slot" },
        { id: "event-details", type: "text", paragraphs: [{ style: "bullet", spans: [{ text: "Price", marks: ["bold"] }, { text: " · Cost, or Free" }] }] },
      ],
    }];

    function withBrand(next: (path: string) => unknown) {
      const fallback = apiGet.getMockImplementation()!;
      apiGet.mockImplementation((path: string) => {
        if (path === "/sites/kieran/branding") return Promise.resolve({ branding });
        if (path.startsWith("/email/campaigns/layouts")) return Promise.resolve({ layouts });
        const result = next(path);
        return result === undefined ? fallback(path) : Promise.resolve(result);
      });
    }

    it("saves the Site's email logo and colour instead of dropping the logo", async () => {
      withBrand(() => undefined);
      const wrapper = mountEditor();
      await flushPromises();

      const saved = apiPut.mock.calls.at(-1)?.[1] as { document: { brand: Record<string, unknown> } };
      expect(saved.document.brand).toMatchObject({
        logoUrl: "https://kieran.example.com/files/email-logo.png?v=abc",
        logoWidth: 180,
        logoHeight: 48,
        accentColor: "#3d7a5c",
        name: "Kieran Studio",
      });
      const look = wrapper.findAll(".campaign-side-block")[2]!;
      expect(look.text()).toContain("Logo and colour from your Site");
      expect(look.get("img").attributes("src")).toBe(branding.emailLogoUrl);
      expect(look.get("a").attributes("target")).toBe("_blank");
      wrapper.unmount();
    });

    it("offers layouts and a past email while the body is empty, and a layout fills it", async () => {
      routeQuery = {};
      withBrand(() => undefined);
      const wrapper = mountEditor();
      await flushPromises();

      const tiles = wrapper.findAll(".campaign-start__tile");
      expect(tiles.map((tile) => tile.get(".campaign-start__name").text())).toEqual(["Event or offer", "A past email"]);
      await tiles[0]!.trigger("click");
      await flushPromises();

      expect((wrapper.get(".campaign-field--subject input").element as HTMLInputElement).value).toBe("Coming up at Kieran");
      const body = wrapper.getComponent({ name: "TiptapEditor" }).props("modelValue") as string;
      expect(body).toContain("<h1>Name of the event or offer</h1>");
      expect(body).toContain('alt="Photo slot"');
      expect(wrapper.find(".campaign-start").exists()).toBe(false);
      wrapper.unmount();
    });

    it("starts from a past email by copying it for all subscribers", async () => {
      routeQuery = {};
      withBrand((path) =>
        path === "/email/campaigns"
          ? {
            campaigns: [
              { id: "old-draft", status: "draft", subject: "Draft", previewText: "", sentAt: null, scheduledFor: null, updatedAt: "2026-10-01T00:00:00Z" },
              { id: "sept", status: "sent", subject: "September news", previewText: "", sentAt: "2026-09-12T09:00:00Z", scheduledFor: null, updatedAt: "2026-09-12T09:00:00Z" },
            ],
          }
          : undefined,
      );
      apiPost.mockResolvedValue({ campaign: makeCampaign({ id: "copy-1" }) });
      const wrapper = mountEditor();
      await flushPromises();

      await wrapper.findAll(".campaign-start__tile").at(-1)!.trigger("click");
      await flushPromises();
      const rows = wrapper.findAll(".campaign-past__list button");
      expect(rows.map((row) => row.get(".campaign-past__subject").text())).toEqual(["September news"]);
      await rows[0]!.trigger("click");
      await flushPromises();

      expect(apiPost).toHaveBeenCalledWith("/email/campaigns/sept/duplicate", { allSubscribers: true });
      expect(routerReplace).toHaveBeenCalledWith({ path: "/email/campaigns/create", query: { campaign: "copy-1" } });
      wrapper.unmount();
    });

    it("won't send while starter text is left, but still sends a test", async () => {
      withBrand(() => undefined);
      apiPost.mockResolvedValue({ test: { status: "accepted" } });
      const wrapper = mountEditor();
      await flushPromises();
      wrapper.getComponent({ name: "TiptapEditor" }).vm.$emit(
        "update:modelValue",
        "<h1>Autumn retreat</h1><ul><li><strong>Price</strong> · Cost, or Free</li></ul>",
      );
      await flushPromises();

      await wrapper.findAll("button").find((button) => button.text() === "Review and send")!.trigger("click");
      await flushPromises();
      const panel = wrapper.get(".campaign-approval");
      expect(panel.text()).toContain("Replace the starter text “Cost, or Free” first.");
      expect(panel.text()).toContain("1 thing to fix");
      const send = panel.findAll("button").find((button) => button.text().startsWith("Send to"))!;
      expect(send.attributes("disabled")).toBeDefined();
      const test = panel.findAll("button").find((button) => button.text() === "Send test")!;
      expect(test.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    });
  });
});
