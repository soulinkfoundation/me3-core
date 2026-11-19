import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWizardStore } from "../../stores/wizard";
import WizardLook from "./WizardLook.vue";

const toastHarness = vi.hoisted(() => ({ error: vi.fn() }));
const apiHarness = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("../../api", () => ({ api: apiHarness, API_BASE: "/api", ApiError: class extends Error {} }));

vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastError: toastHarness.error }),
}));

function chooseFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

async function waitForReader() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

describe("WizardLook logo", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    apiHarness.get.mockRejectedValue(new Error("offline"));
  });

  it("adds and removes a site logo", async () => {
    const wizard = useWizardStore();
    const wrapper = mount(WizardLook, { global: { stubs: { AppDialog: true, RouterLink: true } } });
    const file = new File(["logo"], "logo.png", { type: "image/png" });

    chooseFile(wrapper.get<HTMLInputElement>('input[aria-label="Choose site logo"]').element, file);
    await vi.waitFor(() => expect(wizard.profile.logo).not.toBeNull());

    expect((wizard.profile.logoBlob as File).name).toBe("logo.png");
    expect(wizard.profile.logo).toMatch(/^data:image\/png;base64,/);
    expect(wrapper.text()).toContain("Change logo");

    const remove = wrapper.findAll("button").find((button) => button.text() === "Remove");
    await remove!.trigger("click");
    expect(wizard.profile.logo).toBeNull();
    expect(wizard.profile.logoBlob).toBeNull();
  });

  it("rejects files that are too large", async () => {
    const wizard = useWizardStore();
    const wrapper = mount(WizardLook, { global: { stubs: { AppDialog: true, RouterLink: true } } });
    const file = new File([new Uint8Array(2_000_000)], "logo.png", { type: "image/png" });

    chooseFile(wrapper.get<HTMLInputElement>('input[aria-label="Choose site logo"]').element, file);
    await waitForReader();

    expect(wizard.profile.logo).toBeNull();
    expect(toastHarness.error).toHaveBeenCalledWith("That logo is too large. Choose an image under 1.9 MB.");
  });
});

describe("WizardLook badge", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("shows the owner's badge choice and saves a change", async () => {
    apiHarness.get.mockImplementation(async (path: string) => {
      if (path === "/site-badge") return { preference: "shown", automaticallyShown: false };
      throw new Error("offline");
    });
    apiHarness.put.mockResolvedValue({ preference: "hidden", automaticallyShown: false });
    const wrapper = mount(WizardLook, { global: { stubs: { AppDialog: true, RouterLink: true } } });
    await flushPromises();

    const badge = wrapper.get('[role="switch"][aria-label="Show the Made with ME3 badge"]');
    expect(badge.attributes("aria-checked")).toBe("true");
    await badge.trigger("click");
    await flushPromises();
    expect(apiHarness.put).toHaveBeenCalledWith("/site-badge", { preference: "hidden" });
    expect(badge.attributes("aria-checked")).toBe("false");
  });

  it("hides the switch when the badge setting can't be read", async () => {
    apiHarness.get.mockRejectedValue(new Error("offline"));
    const wrapper = mount(WizardLook, { global: { stubs: { AppDialog: true, RouterLink: true } } });
    await flushPromises();
    expect(wrapper.find('[aria-label="Show the Made with ME3 badge"]').exists()).toBe(false);
  });
});
