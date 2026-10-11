import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
const routerPush = vi.fn();

vi.mock("unplugin-vue-router/runtime", () => ({ definePage: vi.fn() }));
vi.mock("vue-router", () => ({
  RouterLink: {
    props: ["to"],
    template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
  },
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: routerPush }),
}));
vi.mock("../../../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}));

import CampaignsPage from "./index.vue";

describe("campaign list", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="app-page-controls"></div>';
    apiGet.mockImplementation((path: string) => {
      if (path === "/plugins") {
        return Promise.resolve({
          catalogVersion: "test",
          plugins: [{
            id: "me3.email-campaigns",
            name: "Email Campaigns",
            enabled: true,
            status: "installed",
          }],
        });
      }
      if (path === "/email/campaigns/transport") {
        return Promise.resolve({
          transport: {
            managed: true,
            ready: false,
            reason: "sender_not_ready",
            sender: null,
            addOn: {
              available: true,
              entitled: false,
              status: "inactive",
              planKey: null,
              allowance: 0,
              used: 0,
              remaining: 0,
              resetAt: "2026-09-01T00:00:00.000Z",
              cancelAtPeriodEnd: false,
              paidThroughAt: null,
              plans: [
                { key: "5k", allowance: 5_000, monthlyPriceUsd: 10, checkoutAvailable: true },
                {
                  key: "10k",
                  allowance: 10_000,
                  monthlyPriceUsd: 15,
                  checkoutAvailable: true,
                },
                {
                  key: "20k",
                  allowance: 20_000,
                  monthlyPriceUsd: 25,
                  checkoutAvailable: true,
                },
              ],
            },
            instructions: [],
          },
        });
      }
      if (path.startsWith("/mailbox/messages?")) {
        return Promise.resolve({
          messages: [],
          total: path.includes("unread=1") ? 2 : 1,
          limit: 0,
          offset: 0,
        });
      }
      return Promise.resolve({
        campaigns: [{
          id: "campaign-1",
          siteId: "site-1",
          siteUsername: "mentuition",
          subject: "Test",
          status: "draft",
          scheduledFor: null,
          sentAt: null,
          failureReason: null,
          recipientCount: 0,
          deliveredCount: 0,
          failedCount: 0,
          updatedAt: "2026-08-27T13:16:00.000Z",
        }],
      });
    });
  });

  it("prompts for plugin activation before loading campaign data", async () => {
    apiGet.mockResolvedValueOnce({
      catalogVersion: "test",
      plugins: [{
        id: "me3.email-campaigns",
        name: "Email Campaigns",
        enabled: false,
        status: "available",
      }],
    });

    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain("Activate Email Campaigns");
    expect(apiGet).toHaveBeenCalledWith("/plugins");
    wrapper.unmount();
  });

  it("does not show ME3 billing plans on self-hosted installations", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/plugins") {
        return Promise.resolve({
          catalogVersion: "test",
          plugins: [{ id: "me3.email-campaigns", enabled: true, status: "installed" }],
        });
      }
      if (path === "/email/campaigns/transport") {
        return Promise.resolve({
          transport: {
            managed: false,
            ready: false,
            reason: "managed_installation_required",
            sender: null,
            addOn: null,
            instructions: ["Connect an owner-supplied provider before sending."],
          },
        });
      }
      return Promise.resolve({ campaigns: [] });
    });

    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain("Configure delivery for this self-hosted installation");
    expect(wrapper.text()).not.toContain("Choose your monthly email capacity");
    expect(wrapper.text()).not.toContain("USD / month");
    wrapper.unmount();
  });

  it("allows managed draft creation before the sender is ready", async () => {
    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();

    const controls = document.querySelector(".campaigns-mobile-nav")!;
    expect(controls.querySelector('[aria-label="Create campaign"]')).not.toBeNull();
    expect(controls.textContent).toContain("Search campaigns");
    expect(wrapper.findAll(".workspace-tabs__tab")[0].text()).toContain("Campaigns");
    expect(wrapper.findAll(".workspace-tabs__count").map((badge) => badge.text())).toEqual([
      "2",
      "1",
    ]);
    expect(wrapper.text()).toContain(
      "Hosted by ME3 includes 500 deliveries per calendar month.",
    );
    expect(wrapper.text()).not.toContain("Optional managed delivery");

    wrapper.unmount();
  });

  it("shows included usage and upgrades without a paid billing portal", async () => {
    const original = apiGet.getMockImplementation()!;
    apiGet.mockImplementation(async (path: string) => {
      const result = await original(path);
      if (path === "/email/campaigns/transport") {
        Object.assign(result.transport.addOn, { entitled: true, status: "active", allowance: 500, used: 10, remaining: 490 });
      }
      return result;
    });
    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.text()).toContain("490 deliveries remaining");
    expect(wrapper.text()).toContain("10 of 500 used");
    expect(wrapper.text()).toContain("Set up campaign sender");
    expect(wrapper.text()).toContain("Choose plan");
    expect(wrapper.text()).not.toContain("Manage capacity");
    wrapper.unmount();
  });

  it("makes the draft card clickable without a separate edit icon", async () => {
    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();

    const card = wrapper.get(".campaign-card");
    expect(card.get("h2").text()).toBe("Test - @mentuition");
    expect(card.get(".status-pill").text()).toBe("Draft");
    expect(card.text()).not.toContain("Not sent yet");
    expect(card.text()).not.toContain("Continue");
    expect(card.get(".campaign-card__link").attributes("aria-label")).toBe(
      "Open Test for @mentuition",
    );
    expect(card.find('[title="Edit campaign"]').exists()).toBe(false);
    expect(card.text()).not.toContain("Delete");
    expect(card.get('[aria-label="Delete Test"]').attributes("title")).toBe("Delete campaign");

    wrapper.unmount();
  });

  it("filters campaigns by subject and site", async () => {
    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();

    const search = document.querySelector<HTMLInputElement>("#campaign-search-input-top")!;
    search.value = "kieran";
    search.dispatchEvent(new Event("input"));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("No matching campaigns");

    search.value = "mentuition";
    search.dispatchEvent(new Event("input"));
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".campaign-card h2").text()).toBe("Test - @mentuition");

    wrapper.unmount();
  });

  it("only marks the selected billing plan as busy", async () => {
    apiPost.mockReturnValue(new Promise(() => undefined));
    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();

    const buttons = wrapper.findAll(".capacity-option button");
    await buttons[0]!.trigger("click");
    await flushPromises();

    expect(buttons.map((button) => button.attributes("disabled") !== undefined)).toEqual([
      true,
      false,
      false,
    ]);

    wrapper.unmount();
  });

  it("deletes a campaign after confirmation", async () => {
    apiDelete.mockResolvedValue({ ok: true, campaignId: "campaign-1" });
    const confirmation = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmation);
    const wrapper = mount(CampaignsPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.get(".campaign-card__actions button").trigger("click");
    await flushPromises();

    expect(confirmation).toHaveBeenCalledWith(
      "Delete “Test” draft? Its content will be permanently removed.",
    );
    expect(apiDelete).toHaveBeenCalledWith("/email/campaigns/campaign-1");
    expect(wrapper.find(".campaign-card").exists()).toBe(false);

    wrapper.unmount();
    vi.unstubAllGlobals();
  });
});
