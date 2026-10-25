import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();

vi.mock("unplugin-vue-router/runtime", () => ({ definePage: vi.fn() }));
let routeQuery: Record<string, string> = {};
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: routeQuery }),
  RouterLink: {
    props: ["to"],
    template: '<a :data-to="typeof to === \'string\' ? to : JSON.stringify(to)"><slot /></a>',
  },
}));
vi.mock("../../../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}));

vi.mock("../../../stores/sites", () => ({
  useSitesStore: () => ({
    sites: [{ id: "site-1", username: "willowyoga", site_role: "profile" }],
    ensureSites: vi.fn(async () => undefined),
    getSubscriberCount: vi.fn(async () => 214),
  }),
}));

import CampaignsPage from "./index.vue";

const ConfirmationDialogStub = {
  props: ["open", "title", "message", "confirmLabel", "cancelLabel", "busy", "danger"],
  emits: ["cancel", "confirm"],
  template: `<div v-if="open" data-test="confirm">
    <h2>{{ title }}</h2><p>{{ message }}</p>
    <button data-test="confirm-cancel" @click="$emit('cancel')">{{ cancelLabel }}</button>
    <button data-test="confirm-ok" @click="$emit('confirm')">{{ confirmLabel }}</button>
  </div>`,
};

function campaign(overrides: Record<string, unknown>) {
  return {
    id: "campaign-1",
    siteId: "site-1",
    siteUsername: "willowyoga",
    subject: "Autumn retreat",
    status: "draft",
    scheduledFor: null,
    sentAt: null,
    failureReason: null,
    recipientCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...overrides,
  };
}

let pluginEnabled = true;
let transport: Record<string, unknown>;
let campaigns: Array<ReturnType<typeof campaign>>;

function mountPage() {
  return mount(CampaignsPage, {
    attachTo: document.body,
    global: { stubs: { ConfirmationDialog: ConfirmationDialogStub } },
  });
}

describe("Campaigns page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="app-page-controls"></div>';
    pluginEnabled = true;
    routeQuery = {};
    transport = {
      managed: true,
      ready: true,
      reason: null,
      sender: { fromAddress: "hello@willowyoga.me3.app" },
      addOn: {
        available: true,
        entitled: true,
        status: "active",
        planKey: null,
        allowance: 10_000,
        used: 1_300,
        remaining: 8_700,
        resetAt: "2026-11-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        paidThroughAt: null,
        plans: [{ key: "5k", allowance: 5_000, monthlyPriceUsd: 10, checkoutAvailable: true }],
      },
      instructions: [],
    };
    campaigns = [
      campaign({ id: "draft-1", subject: "Autumn retreat", status: "draft" }),
      campaign({
        id: "scheduled-1",
        subject: "New Saturday class",
        status: "scheduled",
        scheduledFor: "2026-10-25T09:00:00.000Z",
        recipientCount: 214,
      }),
      campaign({
        id: "sent-1",
        subject: "September newsletter",
        status: "sent",
        sentAt: "2026-09-23T09:00:00.000Z",
        recipientCount: 205,
        deliveredCount: 201,
        failedCount: 4,
      }),
    ];
    apiGet.mockImplementation((path: string) => {
      if (path === "/plugins") {
        return Promise.resolve({
          catalogVersion: "test",
          plugins: [{ id: "me3.email-campaigns", enabled: pluginEnabled, status: "installed" }],
        });
      }
      if (path === "/email/campaigns/transport") return Promise.resolve({ transport });
      return Promise.resolve({ campaigns });
    });
  });

  it("is its own page: no mail folders, price plans or plugin wording", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find(".workspace-tabs").exists()).toBe(false);
    expect(wrapper.get("h1").text()).toBe("Campaigns");
    expect(wrapper.text()).not.toMatch(/plugin|Activate|Choose plan|USD|\$/i);
    // Like Tasks: tabs with counts, and the title and + in the app top bar.
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      "Campaigns3",
      "Subscribers214",
    ]);
    const topBar = document.querySelector("#app-page-controls")!;
    expect(topBar.textContent).toContain("Campaigns");
    expect(topBar.querySelector('[aria-label="New campaign"]')?.getAttribute("data-to")).toBe(
      "/email/campaigns/create",
    );
    wrapper.unmount();
  });

  it("shows the allowance as one line", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get(".campaigns-meter").text()).toContain("8,700 of 10,000 sends left · resets");
    wrapper.unmount();
  });

  it("groups campaigns into Needs you, Coming up and Sent, and every row opens", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const groups = wrapper.findAll(".campaigns-group");
    expect(groups.map((group) => group.get("h2").text())).toEqual([
      "Needs you",
      "Coming up",
      "Sent",
    ]);
    const links = wrapper.findAll(".campaign-row__link");
    expect(links.map((link) => link.attributes("data-to"))).toEqual([
      JSON.stringify({ path: "/email/campaigns/create", query: { campaign: "draft-1" } }),
      "/email/campaigns/scheduled-1",
      "/email/campaigns/sent-1",
    ]);
    expect(groups[2]!.text()).toContain("201 delivered · 4 didn't arrive");
    wrapper.unmount();
  });

  it("deletes a draft only after the in-app confirmation", async () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    apiDelete.mockResolvedValue({ ok: true });
    const wrapper = mountPage();
    await flushPromises();

    const deleteButton = wrapper.findAll(".campaign-row__action").find((button) => button.text() === "Delete")!;
    await deleteButton.trigger("click");
    expect(wrapper.get('[data-test="confirm"]').text()).toContain("“Autumn retreat” will be removed.");
    expect(apiDelete).not.toHaveBeenCalled();

    await wrapper.get('[data-test="confirm-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="confirm"]').exists()).toBe(false);

    await deleteButton.trigger("click");
    await wrapper.get('[data-test="confirm-ok"]').trigger("click");
    await flushPromises();

    expect(confirm).not.toHaveBeenCalled();
    expect(apiDelete).toHaveBeenCalledWith("/email/campaigns/draft-1");
    expect(wrapper.text()).not.toContain("Autumn retreat");
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("cancels a scheduled campaign with a labelled button", async () => {
    apiPost.mockResolvedValue({ ok: true });
    const wrapper = mountPage();
    await flushPromises();

    const cancelButton = wrapper.findAll(".campaign-row__action").find((button) => button.text() === "Cancel")!;
    await cancelButton.trigger("click");
    expect(wrapper.get('[data-test="confirm-ok"]').text()).toBe("Cancel campaign");
    await wrapper.get('[data-test="confirm-ok"]').trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns/scheduled-1/cancel");
    wrapper.unmount();
  });

  it("lets a self-hosted owner connect their own sender, without an allowance", async () => {
    transport = {
      managed: false,
      ready: false,
      reason: "sender_not_connected",
      sender: null,
      provider: null,
      addOn: null,
      instructions: [],
    };
    const provider = (id: string, label: string) => ({
      id,
      label,
      configured: false,
      secretLabel: id === "smtp" ? "SMTP password" : "API token",
      config: {
        transport: id === "smtp" ? "smtp" : "rest",
        fromAddress: "",
        fromName: "ME3",
        sendingDomain: "",
        accountId: "",
        messageStream: "",
        smtpHost: "",
        smtpPort: 587,
        smtpSecurity: "starttls",
        smtpUsername: "",
        mailgunRegion: "us",
      },
    });
    const baseGet = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) => {
      if (path === "/email-provider-settings") {
        return Promise.resolve({
          encryptionConfigured: true,
          activeProviderId: "smtp",
          providers: [
            provider("smtp", "SMTP"),
            provider("mailgun", "Mailgun"),
            provider("postmark", "Postmark"),
            provider("cloudflare-email", "Cloudflare Email Service"),
          ],
          futureProviders: [],
        });
      }
      return baseGet(path);
    });
    apiPut.mockImplementation(async () => {
      transport = {
        managed: false,
        ready: true,
        reason: null,
        sender: { ref: "provider:postmark", fromAddress: "news@willowyoga.com", domain: "willowyoga.com" },
        provider: {
          id: "postmark",
          label: "Postmark",
          tracksDelivery: true,
          deliveryEventsUrl: "https://api.willowyoga.com/api/public/campaigns/provider-events/postmark/abc",
        },
        addOn: null,
        instructions: [],
      };
      return {};
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find(".campaigns-meter").exists()).toBe(false);
    expect(wrapper.text()).toContain("Connect a sender");
    expect(wrapper.text()).not.toMatch(/plugin|Activate|sends left|\$/i);

    await wrapper.get('[data-test="sender-provider"]').setValue("postmark");
    await wrapper.get('[data-test="sender-from"]').setValue("news@willowyoga.com");
    await wrapper.get('[data-test="sender-secret"]').setValue("pm-server-token");
    await wrapper.get('[data-test="sender-connect"]').trigger("click");
    await flushPromises();

    expect(apiPut).toHaveBeenCalledWith("/email-provider-settings", {
      activeProviderId: "postmark",
      providers: [expect.objectContaining({
        id: "postmark",
        fromAddress: "news@willowyoga.com",
        apiToken: "pm-server-token",
      })],
    });
    expect(wrapper.text()).not.toContain("Connect a sender");
    expect(wrapper.text()).toContain("Sending through Postmark from news@willowyoga.com");
    expect(wrapper.text()).toContain("/api/public/campaigns/provider-events/postmark/abc");
    wrapper.unmount();
  });

  it("keeps campaigns hidden while the visibility gate is off", async () => {
    pluginEnabled = false;
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("Campaigns isn't available on this account yet.");
    expect(wrapper.text()).not.toMatch(/plugin|Activate/i);
    expect(apiGet).not.toHaveBeenCalledWith("/email/campaigns");
    wrapper.unmount();
  });
});
