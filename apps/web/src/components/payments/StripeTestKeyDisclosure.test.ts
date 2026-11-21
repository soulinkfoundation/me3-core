import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock("../../api", () => ({ API_BASE: "/api", ApiError: class extends Error {}, api }));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastFromUnknown: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }),
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }), RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } }));

import GettingPaidSheet from "./GettingPaidSheet.vue";
import StripeTestKeyDisclosure from "./StripeTestKeyDisclosure.vue";

const hostedStripe = { configured: false, connected: false, managedAvailable: true, directKeySetupAllowed: true, directKeyTestOnly: true, directConfigured: false, connectionStatus: "not_connected" };

describe("Stripe test key", () => {
  beforeEach(() => { api.put.mockReset(); api.get.mockReset(); });

  it("is folded away and only saves a key that starts with sk_test_", async () => {
    const wrapper = mount(StripeTestKeyDisclosure);
    expect(wrapper.find("details").attributes("open")).toBeUndefined();
    expect(wrapper.find("summary").text()).toBe("Use a Stripe test key");
    const save = () => wrapper.findAll("button").find((button) => button.text() === "Save")!;
    await wrapper.find("input").setValue("sk_live_abcdefghijkl");
    expect(save().attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Test keys start with sk_test_.");
    api.put.mockResolvedValue({ stripe: { configured: true } });
    await wrapper.find("input").setValue("sk_test_abcdefghijkl");
    await save().trigger("click");
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith("/commerce/settings", { stripeSecretKey: "sk_test_abcdefghijkl" });
    expect(wrapper.emitted("saved")).toHaveLength(1);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("");
  });

  it("shows in the Getting paid sheet on hosted ME3 until card payments are ready", async () => {
    api.get.mockResolvedValue({ stripe: hostedStripe });
    const notReady = mount(GettingPaidSheet, { props: { open: true }, global: { stubs: { AppDialog: { template: "<div><slot /></div>" } } } });
    await flushPromises();
    expect(notReady.text()).toContain("Use a Stripe test key");
    notReady.unmount();
  });
});
