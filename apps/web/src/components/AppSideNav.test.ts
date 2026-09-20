import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { invalidatePluginAccess } from "../utils/pluginAccess";
import AppSideNav from "./AppSideNav.vue";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
  },
}));

const routeComponent = {
  render: () => h("div"),
};

async function mountSideNav(
  plugins: Array<{ id: string; status: string; enabled: boolean }>,
  props: Record<string, never> = {},
  navigationFeatures: Array<{ id: string; visible: boolean }> = [
    { id: "assistant", visible: true },
    { id: "journal", visible: true },
    { id: "tasks", visible: true },
    { id: "email", visible: true },
    { id: "files", visible: true },
    { id: "social", visible: true },
    { id: "accounts", visible: true },
  ],
) {
  vi.mocked(api.get).mockImplementation((endpoint: string) =>
    Promise.resolve(endpoint === "/navigation-features" ? { features: navigationFeatures } : { plugins }),
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

  const wrapper = mount(AppSideNav, {
    props,
    global: {
      plugins: [router],
    },
  });
  await flushPromises();
  return wrapper;
}

describe("AppSideNav optional plugin links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePluginAccess();
  });

  it("shows Socials and Accounts when both plugins are enabled", async () => {
    const wrapper = await mountSideNav([
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

  it("uses the approved navigation order, Tasks destination, and dog-head image", async () => {
    const wrapper = await mountSideNav([
      { id: "me3.journal", status: "installed", enabled: true },
      { id: "me3.calendar", status: "installed", enabled: true },
      { id: "me3.mission-control", status: "installed", enabled: true },
      { id: "me3.social-publishing", status: "installed", enabled: true },
      { id: "me3.accounts", status: "installed", enabled: true },
    ]);

    expect(
      wrapper
        .findAll("nav .app-side-nav__row")
        .map((link) => link.attributes("aria-label")),
    ).toEqual([
      "Assistant",
      "Calendar",
      "Journal",
      "Tasks",
      "Email",
      "Sites",
      "Files",
      "Socials",
      "Accounts",
      "Settings",
    ]);
    expect(wrapper.get('[aria-label="Tasks"]').attributes("href")).toBe(
      "/tasks",
    );
    expect(
      wrapper.get('[aria-label="Assistant"] img').attributes("src"),
    ).toBe("/me3-dog-head-emoji-smooth.png");
    wrapper.unmount();
  });

  it("keeps Soulink out of side navigation", async () => {
    const wrapper = await mountSideNav([]);

    expect(wrapper.find('[aria-label="Join Soulink"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Open Soulink chats"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("hides Socials and Accounts when both plugins are disabled", async () => {
    const wrapper = await mountSideNav([
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
    const wrapper = await mountSideNav([
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

    for (const label of ["Assistant", "Journal", "Tasks", "Email", "Files", "Socials"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(false);
    }
    expect(wrapper.find('[aria-label="Accounts"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
