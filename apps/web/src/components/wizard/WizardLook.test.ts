import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWizardStore } from "../../stores/wizard";
import WizardLook from "./WizardLook.vue";

const toastHarness = vi.hoisted(() => ({ error: vi.fn() }));

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
  });

  it("adds and removes a site logo", async () => {
    const wizard = useWizardStore();
    const wrapper = mount(WizardLook, { global: { stubs: { AppDialog: true } } });
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
    const wrapper = mount(WizardLook, { global: { stubs: { AppDialog: true } } });
    const file = new File([new Uint8Array(2_000_000)], "logo.png", { type: "image/png" });

    chooseFile(wrapper.get<HTMLInputElement>('input[aria-label="Choose site logo"]').element, file);
    await waitForReader();

    expect(wizard.profile.logo).toBeNull();
    expect(toastHarness.error).toHaveBeenCalledWith("That logo is too large. Choose an image under 1.9 MB.");
  });

  it("leaves organization logos to the Logo step", () => {
    const wizard = useWizardStore();
    wizard.siteRole = "organization";
    const wrapper = mount(WizardLook, { global: { stubs: { AppDialog: true } } });

    expect(wrapper.find('input[aria-label="Choose site logo"]').exists()).toBe(false);
  });
});
