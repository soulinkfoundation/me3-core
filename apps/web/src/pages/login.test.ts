import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import LoginPage from "./login.vue";

const route = reactive<{ query: Record<string, string> }>({ query: {} });

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("unplugin-vue-router/runtime", () => ({ definePage: () => undefined }));

vi.mock("../api", () => ({
  API_BASE: "/api",
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const managedConfig = {
  deploymentMode: "managed",
  ownerAuthConfigured: true,
  ownerPasswordAuthConfigured: false,
  ownerMe3AuthConfigured: true,
  setupRequired: [],
};

enableAutoUnmount(afterEach);

describe("login page", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    setActivePinia(createPinia());
    route.query = {};
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, href: "", origin: "https://tester.me3.app", hostname: "tester.me3.app" },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  function mountPage() {
    return mount(LoginPage, {
      global: { stubs: { LandingGrids: true, BrandLogo: true, UiIcon: true } },
    });
  }

  it("shows no sign-in copy until the install config has loaded", async () => {
    let resolveConfig: (value: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => (resolveConfig = resolve)) as never);

    const wrapper = mountPage();
    expect(wrapper.text()).not.toContain("Sign in with ME3.app");
    expect(wrapper.text()).not.toContain("Advanced setup");

    resolveConfig(managedConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("open your managed installation");
    expect(wrapper.text()).not.toContain("Advanced setup");
  });

  it("goes straight to ME3.app when opened from the ME3 account page", async () => {
    route.query = { signin: "me3" };
    vi.mocked(api.get).mockResolvedValue(managedConfig as never);
    vi.mocked(api.post).mockResolvedValue({ ok: true, url: "https://me3.app/core/claim?state=s" } as never);

    const wrapper = mountPage();
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/auth/me3/start", expect.any(Object));
    expect(window.location.href).toBe("https://me3.app/core/claim?state=s");
    expect(wrapper.text()).toContain("Opening ME3...");
    expect(wrapper.text()).not.toContain("Sign in with ME3.app");
  });

  it("falls back to the button with an error when the automatic start fails", async () => {
    route.query = { signin: "me3" };
    vi.mocked(api.get).mockResolvedValue(managedConfig as never);
    vi.mocked(api.post).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("Sign in with ME3.app");
    expect(wrapper.text()).toContain("ME3 sign-in is not ready yet");
  });

  it("waits for a click without the flag", async () => {
    vi.mocked(api.get).mockResolvedValue(managedConfig as never);

    const wrapper = mountPage();
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Sign in with ME3.app");
  });
});
