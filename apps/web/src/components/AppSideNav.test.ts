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
  props: {
    showSoulink?: boolean;
    soulinkConnected?: boolean;
    soulinkHref?: string;
  } = {},
) {
  vi.mocked(api.get).mockResolvedValue({ plugins });
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
      "Join Soulink",
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

  it("opens the Soulink join flow until the assistant connection is active", async () => {
    const wrapper = await mountSideNav([]);

    await wrapper.get('[aria-label="Join Soulink"]').trigger("click");

    expect(wrapper.emitted("openSoulink")).toHaveLength(1);
    wrapper.unmount();
  });

  it("hides Soulink navigation for connected owners", async () => {
    const wrapper = await mountSideNav([], {
      soulinkConnected: true,
      soulinkHref: "https://soulinkfoundation.org/chats",
    });

    expect(wrapper.find('[aria-label="Open Soulink chats"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Join Soulink"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps Soulink out of unlinked self-hosted navigation", async () => {
    const wrapper = await mountSideNav([], { showSoulink: false });

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
});
