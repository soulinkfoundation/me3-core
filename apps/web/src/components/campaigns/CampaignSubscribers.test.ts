import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  sites: [
    { id: "site-1", username: "willowyoga", site_role: "profile", published_at: "2026-01-01" },
    { id: "site-2", username: "retreats", site_role: "organization", published_at: "2026-01-01" },
  ],
  error: null as string | null,
  ensureSites: vi.fn(),
  getSubscribers: vi.fn(),
  addSubscriber: vi.fn(),
  importSubscribers: vi.fn(),
  deleteSubscriber: vi.fn(),
  exportSubscribers: vi.fn(),
};
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("../../stores/sites", () => ({ useSitesStore: () => store }));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastSuccess, toastError }),
}));

import CampaignSubscribers from "./CampaignSubscribers.vue";

const AppDialogStub = { props: ["open"], template: '<div v-if="open" data-test="sheet"><slot /></div>' };
const ConfirmationDialogStub = {
  props: ["open", "message"],
  emits: ["confirm", "cancel"],
  template: '<div v-if="open" data-test="confirm">{{ message }}<button data-test="confirm-ok" @click="$emit(\'confirm\')">Remove</button></div>',
};

function subscriber(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    email: `person${id}@example.com`,
    first_name: null,
    last_name: null,
    source: "form",
    subscribed_at: "2026-10-01 09:00:00",
    marketing_status: "marketable",
    delivery_status: "deliverable",
    ...overrides,
  };
}

function mountList(props: Record<string, unknown> = {}) {
  return mount(CampaignSubscribers, {
    props,
    global: { stubs: { AppDialog: AppDialogStub, ConfirmationDialog: ConfirmationDialogStub } },
  });
}

describe("Campaign subscribers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.getSubscribers.mockResolvedValue({
      subscribers: [
        subscriber(1, { first_name: "Sam", last_name: "Rivers" }),
        subscriber(2, { marketing_status: "pending" }),
        subscriber(3, { delivery_status: "bounced" }),
      ],
      pagination: { page: 1, limit: 50, total: 3, pages: 1 },
    });
  });

  it("lists the profile site's subscribers with whether each can be emailed", async () => {
    const wrapper = mountList();
    await flushPromises();

    expect(store.getSubscribers).toHaveBeenCalledWith("willowyoga", 1, 50);
    expect(wrapper.text()).toContain("3 subscribers");
    expect(wrapper.findAll(".campaign-pill").map((pill) => pill.text())).toEqual([
      "Subscribed",
      "Can't email yet",
      "Bounced",
    ]);
    expect(wrapper.find(".campaign-subscriber__detail").text()).toContain("Sam Rivers · Joined");
  });

  it("opens the site the Site page linked to", async () => {
    mountList({ initialSite: "retreats" });
    await flushPromises();

    expect(store.getSubscribers).toHaveBeenCalledWith("retreats", 1, 50);
  });

  it("only marks added people as emailable when the owner ticks the consent statement", async () => {
    store.addSubscriber.mockResolvedValue({ ok: true, resubscribed: false });
    const wrapper = mountList();
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text() === "Add")!.trigger("click");
    const sheet = wrapper.get('[data-test="sheet"]');
    expect(sheet.text()).toContain("I confirm these people asked to receive marketing email from this site.");
    expect(sheet.text()).toContain("Without this they're saved but won't get campaigns.");
    await sheet.get('input[type="email"]').setValue("new@example.com");
    await sheet.get('input[type="checkbox"]').setValue(true);
    await sheet.get("form").trigger("submit");
    await flushPromises();

    expect(store.addSubscriber).toHaveBeenCalledWith("willowyoga", "new@example.com", undefined, undefined, true);
    expect(toastSuccess).toHaveBeenCalledWith("new@example.com added.");
    expect(wrapper.find('[data-test="sheet"]').exists()).toBe(false);
  });

  it("imports a CSV without consent unless it is ticked", async () => {
    store.importSubscribers.mockResolvedValue({ imported: 120, skipped: 4, total: 124 });
    const wrapper = mountList();
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text() === "Import CSV")!.trigger("click");
    const sheet = wrapper.get('[data-test="sheet"]');
    const file = new File(["email\na@example.com"], "list.csv", { type: "text/csv" });
    const input = sheet.get('input[type="file"]');
    Object.defineProperty(input.element, "files", { value: [file] });
    await input.trigger("change");
    await sheet.get("form").trigger("submit");
    await flushPromises();

    expect(store.importSubscribers).toHaveBeenCalledWith("willowyoga", file, false);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Added 120 · 4 skipped (already on the list or no valid email).",
    );
  });

  it("removes a subscriber after an in-app confirmation", async () => {
    store.deleteSubscriber.mockResolvedValue(true);
    const wrapper = mountList();
    await flushPromises();

    await wrapper.get('[aria-label="Remove person2@example.com"]').trigger("click");
    expect(wrapper.get('[data-test="confirm"]').text()).toContain("person2@example.com will be taken off the list");
    await wrapper.get('[data-test="confirm-ok"]').trigger("click");
    await flushPromises();

    expect(store.deleteSubscriber).toHaveBeenCalledWith("willowyoga", 2);
    expect(wrapper.text()).not.toContain("person2@example.com");
    expect(wrapper.text()).toContain("2 subscribers");
  });
});
