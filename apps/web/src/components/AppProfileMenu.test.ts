import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { createPinia } from "pinia";
import { useAuthStore } from "../stores/auth";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { invalidatePluginAccess } from "../utils/pluginAccess";
import AppProfileMenu from "./AppProfileMenu.vue";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
  },
}));

const routeComponent = {
  render: () => h("div"),
};

async function mountProfileMenu(
  plugins: Array<{ id: string; status: string; enabled: boolean }>,
  props: Record<string, never> = {},
  navigationFeatures: Array<{ id: string; visible: boolean }> = [
    { id: "assistant", visible: true },
    { id: "calendar", visible: true },
    { id: "journal", visible: true },
    { id: "wheel-of-life", visible: false },
    { id: "tasks", visible: true },
    { id: "email", visible: true },
    { id: "files", visible: true },
    { id: "social", visible: true },
    { id: "accounts", visible: true },
  ],
) {
  vi.mocked(api.get).mockImplementation((endpoint: string) =>
    Promise.resolve(endpoint === "/navigation-features" ? { features: navigationFeatures } : endpoint === "/sites" ? { sites: [] } : { plugins }),
  );
  invalidatePluginAccess();

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/:pathMatch(.*)*",
        component: routeComponent,
      },
    ],
  });
  await router.push("/assistant");
  await router.isReady();

  const pinia = createPinia();
  useAuthStore(pinia).setSession({ id: "owner", name: "Demo Owner", username: "demo", email: null, timezone: null, locale: "en-US", localeSource: "inferred" });
  const wrapper = mount(AppProfileMenu, {
    props,
    global: {
      plugins: [router, pinia],
      stubs: { Teleport: true },
    },
  });
  await flushPromises();
  await wrapper.get(".profile-trigger").trigger("click");
  await flushPromises();
  return wrapper;
}

describe("AppProfileMenu optional plugin links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePluginAccess();
  });

  it("shows Socials and Accounts when both plugins are enabled", async () => {
    const wrapper = await mountProfileMenu([
      {
        id: "me3.social-publishing",
        status: "installed",
        enabled: true,
      },
      {
        id: "me3.accounts",
        status: "installed",
        enabled: true,
      },
    ]);

    expect(wrapper.find('[aria-label="Socials"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Accounts"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("retains the drawer destinations using emoji and Settings rows", async () => {
    const wrapper = await mountProfileMenu([
      { id: "me3.journal", status: "installed", enabled: true },
      { id: "me3.calendar", status: "installed", enabled: true },
      { id: "me3.mission-control", status: "installed", enabled: true },
      { id: "me3.social-publishing", status: "installed", enabled: true },
      { id: "me3.accounts", status: "installed", enabled: true },
    ]);

    expect(
      wrapper
        .findAll("nav .profile-menu__row")
        .map((link) => link.attributes("aria-label")),
    ).toEqual([
      "Calendar",
      "People",
      "Email",
      "Writing",
      "Tasks",
      "Files",
      "Socials",
      "Accounts",
      "Website",
      "Chat",
    ]);
    const websiteLink = wrapper.get('[aria-label="Website"]');
    expect(websiteLink.text()).toContain("Website");
    expect(websiteLink.attributes("href")).toBe("/sites");
    expect(wrapper.get('[aria-label="Tasks"]').attributes("href")).toBe(
      "/tasks",
    );
    expect(wrapper.find('nav img').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Settings"]').attributes("href")).toBe("/settings");
    wrapper.unmount();
  });

  it("keeps Soulink out of side navigation", async () => {
    const wrapper = await mountProfileMenu([]);

    expect(wrapper.find('[aria-label="Join Soulink"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Open Soulink chats"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("hides Calendar when its navigation feature is disabled", async () => {
    const wrapper = await mountProfileMenu(
      [{ id: "me3.calendar", status: "installed", enabled: true }],
      {},
      [
        { id: "assistant", visible: true },
        { id: "calendar", visible: false },
      ],
    );

    expect(wrapper.find('[aria-label="Calendar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows Wheel of Life only when its navigation feature is enabled", async () => {
    const wrapper = await mountProfileMenu(
      [],
      {},
      [
        { id: "assistant", visible: true },
        { id: "calendar", visible: true },
        { id: "journal", visible: true },
        { id: "wheel-of-life", visible: true },
        { id: "tasks", visible: true },
        { id: "email", visible: true },
        { id: "files", visible: true },
        { id: "social", visible: true },
        { id: "accounts", visible: true },
      ],
    );

    const link = wrapper.get('[aria-label="Wheel of Life"]');
    expect(link.attributes("href")).toBe("/wheel-of-life");
    expect(link.find(".profile-menu__emoji").text()).toBe("🛞");
    wrapper.unmount();
  });

  it("hides Socials and Accounts when both plugins are disabled", async () => {
    const wrapper = await mountProfileMenu([
      {
        id: "me3.social-publishing",
        status: "installed",
        enabled: false,
      },
      {
        id: "me3.accounts",
        status: "installed",
        enabled: false,
      },
    ]);

    expect(wrapper.find('[aria-label="Socials"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Accounts"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("hides configurable workspaces while keeping enabled Accounts available", async () => {
    const wrapper = await mountProfileMenu([
      { id: "me3.journal", status: "installed", enabled: true },
      { id: "me3.mission-control", status: "installed", enabled: true },
      { id: "me3.social-publishing", status: "installed", enabled: true },
      { id: "me3.accounts", status: "installed", enabled: true },
    ], {}, [
      { id: "assistant", visible: false },
      { id: "journal", visible: false },
      { id: "tasks", visible: false },
      { id: "email", visible: false },
      { id: "files", visible: false },
      { id: "social", visible: false },
      { id: "accounts", visible: false },
    ]);

    for (const label of ["Chat", "Writing", "Tasks", "Email", "Files"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(false);
    }
    expect(wrapper.find('[aria-label="Accounts"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Socials"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
