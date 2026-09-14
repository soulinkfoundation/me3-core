import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GoalsDialog from "./GoalsDialog.vue";
import { api } from "../../api";

vi.mock("../../api", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
const toast = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastFromUnknown: vi.fn() }));
vi.mock("../../composables/useAppToast", () => ({ useAppToast: () => toast }));
const mountDialog = () => mount(GoalsDialog, { global: { stubs: {
  AppDialog: { template: '<div role="dialog"><slot /></div>' },
  UiIcon: true,
} } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ goals: [{ id: "existing", title: "Walk daily", status: "active" }] });
  vi.mocked(api.patch).mockResolvedValue({});
});

describe("Goals dialog", () => {
  it("edits, completes and adds goals through the focused endpoint", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.get('.goal-title').setValue('Walk every day');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('button').trigger('click'); // Close cancels without saving.
    expect(api.patch).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(b => b.text().includes('Add goal'))!.trigger('click');
    await wrapper.findAll('.goal-title')[1].setValue('Read more');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith('/tasks/goals', { goals: [
      { id:'existing', title:'Walk every day', status:'completed' },
      { id:expect.any(String), title:'Read more', status:'active' },
    ] });
    wrapper.unmount();
  });
  it("keeps entered goals when saving fails and supports retry", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.get('.goal-title').setValue('Keep this draft');
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('Offline'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect((wrapper.get('.goal-title').element as HTMLInputElement).value).toBe('Keep this draft');
    expect(toast.toastFromUnknown).toHaveBeenCalled();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
  it("cannot overwrite stored goals after a failed load", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Offline'));
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(api.patch).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
