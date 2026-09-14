import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { useWizardStore } from "../../stores/wizard";
import WizardGoals from "./WizardGoals.vue";

vi.mock("../../api", () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

const toastHarness = vi.hoisted(() => ({
  success: vi.fn(),
}));

vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastSuccess: toastHarness.success }),
}));

describe("WizardGoals", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      settings: {
        goals: [{ id: "goal-1", title: "Publish four videos", status: "active" }],
      },
    });
    vi.mocked(api.patch).mockResolvedValue({
      settings: {
        goals: [{ id: "goal-1", title: "Publish five videos", status: "active" }],
      },
    });
  });

  it("keeps organization goals in the selected site draft", async () => {
    const wizard = useWizardStore();
    wizard.activateDraftContext({
      siteId: "site-studio",
      username: "studio",
      role: "organization",
    });
    wizard.updateProfile({
      business: {
        ...wizard.profile.business,
        goals: [
          { id: "goal-studio", title: "Open the studio", status: "active" },
        ],
      },
    });

    const wrapper = mount(WizardGoals, {
      global: {
        stubs: {
          Button: { template: '<button type="button"><slot /></button>' },
          UiIcon: { template: '<span aria-hidden="true" />' },
        },
      },
    });
    await flushPromises();

    expect(wrapper.get(".section-desc").text()).toBe(
      "Keep the outcomes this site is working towards here.",
    );
    const input = wrapper.get(".goal-input");
    expect((input.element as HTMLInputElement).value).toBe("Open the studio");
    await input.setValue("Launch the studio");
    await input.trigger("change");
    await flushPromises();

    expect(api.get).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(wizard.profile.business.goals).toEqual([
      { id: "goal-studio", title: "Launch the studio", status: "active" },
    ]);
    expect(toastHarness.success).toHaveBeenCalledWith("Site goals saved");
  });
});
