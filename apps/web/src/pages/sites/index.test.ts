import {
  enableAutoUnmount,
  flushPromises,
  mount,
} from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import {
  createMemoryHistory,
  createRouter,
  type Router,
} from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSitesStore, type Site } from "../../stores/sites";
import { api } from "../../api";
import SitesPage from "./index.vue";

vi.mock("../../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

enableAutoUnmount(afterEach);

describe("Sites dashboard", () => {
  let router: Router;

  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(null);
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/sites", component: { template: "<div />" } },
        { path: "/sites/:username", component: { template: "<div />" } },
        { path: "/create", component: { template: "<div />" } },
        { path: "/account", component: { template: "<div />" } },
        { path: "/assistant", component: { template: "<div />" } },
      ],
    });
    await router.push("/sites");
    await router.isReady();
  });

  it("leads with website creation while keeping an older site accessible", async () => {
    const wrapper = await mountDashboard([siteRecord("studio", "organization")]);

    expect(wrapper.text()).toContain("Create your website");
    expect(wrapper.text()).toContain("Older sites");
    expect(wrapper.text()).toContain("@studio");
    expect(
      wrapper.findAll("a").some((link) => link.attributes("href") === "/sites/studio"),
    ).toBe(true);
  });

  it("offers no way to add another site", async () => {
    const wrapper = await mountDashboard([siteRecord("owner", "profile")]);

    expect(wrapper.find('[aria-label="Add site"]').exists()).toBe(false);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/business site|older sites/i);
  });

  it("renders every persistent site as one minimal clickable card", async () => {
    const profile = siteRecord("owner", "profile", "2026-08-20T10:00:00.000Z");
    const additional = siteRecord("studio", "organization");
    additional.avatar = "./files/avatar.jpg";
    const secondAdditional = siteRecord("community", "organization");
    const wrapper = await mountDashboard([profile, additional, secondAdditional]);

    expect(wrapper.text()).toContain("@owner");
    expect(wrapper.text()).toContain("@studio");
    expect(wrapper.text()).toContain("@community");

    const cards = wrapper.findAll("a.site-card");
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.attributes("href"))).toEqual([
      "/sites/owner",
      "/sites/studio",
      "/sites/community",
    ]);
    expect(cards[0].text()).toBe("@ownerPublished");
    expect(cards[1].text()).toBe("@studioDraft");
    expect(cards[2].text()).toBe("@communityDraft");
    expect(cards[0].find(".brand-logo-stub").exists()).toBe(true);
    expect(cards[1].get("img.site-card__avatar").attributes("src")).toBe(
      "/preview/studio/files/avatar.jpg",
    );
    expect(cards[2].find(".site-card__icon").exists()).toBe(true);
  });

  it("resumes an agent-built site in its builder conversation", async () => {
    const profile = siteRecord("owner", "profile");
    const generated = siteRecord("studio", "organization");
    generated.template_id = "agent-landing-page";
    generated.builder_thread_id = "thread-123";
    const wrapper = await mountDashboard([profile, generated]);

    const card = wrapper.get('[aria-label="Continue building @studio with ME3"]');
    expect(card.attributes("href")).toBe(
      "/assistant?mode=site-builder&thread=thread-123",
    );
    expect(wrapper.text()).not.toContain("Landing pages");
  });

  it("renders cached site cards immediately without loading copy", async () => {
    const sites = useSitesStore();
    sites.sites = [
      siteRecord("owner", "profile", "2026-08-20T10:00:00.000Z"),
    ];
    sites.loaded = true;
    sites.ensureSites = vi.fn(async () => undefined) as never;
    sites.fetchSitePages = vi.fn(async () => []) as never;

    const wrapper = mount(SitesPage, mountOptions(router));
    await flushPromises();

    expect(wrapper.findAll("a.site-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("@owner");
    expect(wrapper.text()).not.toContain("Loading your sites");
  });

  async function mountDashboard(
    records: Site[],
  ) {
    const sites = useSitesStore();
    sites.sites = records;
    sites.ensureSites = vi.fn(async () => undefined) as never;
    sites.fetchSitePages = vi.fn(async () => []) as never;
    const wrapper = mount(SitesPage, mountOptions(router));
    await flushPromises();
    return wrapper;
  }
});

function mountOptions(router: Router) {
  return {
    global: {
      plugins: [router],
      stubs: {
        // The page bar teleports into the app shell, which this mount does not render.
        AppPageBar: { props: ["title"], template: '<div><h1><slot name="title">{{ title }}</slot></h1><slot name="actions" /></div>' },
        AppDialog: {
          props: ["open"],
          emits: ["close"],
          template: '<div v-if="open" role="dialog"><slot /></div>',
        },
        BrandLogo: { template: '<span class="brand-logo-stub" />' },
        UiIcon: { template: '<span class="ui-icon-stub" />' },
      },
    },
  };
}

function siteRecord(
  username: string,
  siteRole: "profile" | "organization",
  publishedAt: string | null = null,
): Site {
  return {
    id: `site-${username}`,
    username,
    user_id: "owner",
    site_type: "profile",
    site_role: siteRole,
    custom_domain: null,
    custom_domain_status: null,
    created_at: "2026-08-20T09:00:00.000Z",
    updated_at: "2026-08-20T09:00:00.000Z",
    published_at: publishedAt,
  };
}

