import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SiteBookingReminders from "./SiteBookingReminders.vue";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), toastFromUnknown: vi.fn() }));
vi.mock("../../api", () => ({ api: { get: mocks.get, patch: mocks.patch } }));
vi.mock("../../composables/useAppToast", () => ({ useAppToast: () => ({ toastFromUnknown: mocks.toastFromUnknown }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ enabled: false }); });

describe("site booking reminder switch", () => {
  it("loads the saved state and persists an owner toggle", async () => {
    mocks.patch.mockResolvedValue({ enabled: true });
    const wrapper = mount(SiteBookingReminders, { props: { siteId: "site-1" } });
    await flushPromises();
    expect(mocks.get).toHaveBeenCalledWith("/sites/site-1/booking-reminders");
    const checkbox = wrapper.get('input[type="checkbox"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(false);
    await checkbox.setValue(true);
    await flushPromises();
    expect(mocks.patch).toHaveBeenCalledWith("/sites/site-1/booking-reminders", { enabled: true });
    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
  });

  it("restores the saved value and reports a failed save", async () => {
    mocks.patch.mockRejectedValue(new Error("Offline"));
    const wrapper = mount(SiteBookingReminders, { props: { siteId: "site-1" } });
    await flushPromises();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await flushPromises();
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
    expect(mocks.toastFromUnknown).toHaveBeenCalled();
  });

  it("ignores a stale response after switching sites", async () => {
    let resolveOld!: (value: { enabled: boolean }) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const wrapper = mount(SiteBookingReminders, { props: { siteId: "site-old" } });
    await wrapper.setProps({ siteId: "site-new" });
    await flushPromises();
    resolveOld({ enabled: true });
    await flushPromises();
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
  });
});
