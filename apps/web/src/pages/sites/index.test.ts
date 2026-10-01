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
import { useSitesStore, type Site, type SiteQuota } from "../../stores/sites";
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

  it("leads with profile creation while keeping an existing additional site accessible", async () => {
    const additional = siteRecord("studio", "organization");
    const wrapper = await mountDashboard([additional], quotaResponse({
      canCreateProfile: true,
      canCreateAdditionalSite: false,
      remainingAdditionalSites: 1,
    }));

    expect(wrapper.text()).toContain("Create your website");
    expect(wrapper.text()).toContain("@studio");
    expect(wrapper.text()).not.toMatch(/organization sites/i);
    expect(wrapper.find('[aria-label="Add site"]').exists()).toBe(true);
    expect(
      wrapper.findAll("a").some((link) => link.attributes("href") === "/sites/studio"),
    ).toBe(true);

    await wrapper.get('[aria-label="Add site"]').trigger("click");

    const chooser = wrapper.get('[role="dialog"]');
    expect(chooser.get("a.add-site-option").text()).toContain("Website");
    expect(chooser.get("a.add-site-option").attributes("href")).toContain(
      "/create?new=1",
    );
    expect(chooser.get("button.add-site-option").text()).toContain(
      "Create a website first.",
    );
    expect(
      chooser.get("button.add-site-option").attributes("disabled"),
    ).toBeDefined();
  });

  it("renders every persistent site as one minimal clickable card", async () => {
    const profile = siteRecord("owner", "profile", "2026-08-20T10:00:00.000Z");
    const additional = siteRecord("studio", "organization");
    additional.avatar = "./files/avatar.jpg";
    const secondAdditional = siteRecord("community", "organization");
    const wrapper = await mountDashboard(
      [profile, additional, secondAdditional],
      quotaResponse({
        canCreateProfile: false,
        canCreateAdditionalSite: true,
        remainingAdditionalSites: 1,
      }),
    );

    expect(wrapper.text()).toContain("@owner");
    expect(wrapper.text()).toContain("@studio");
    expect(wrapper.text()).toContain("@community");
    expect(wrapper.get('[aria-label="Add site"]').element.tagName).toBe("BUTTON");

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
    const wrapper = await mountDashboard(
      [profile, generated],
      quotaResponse({
        canCreateProfile: false,
        canCreateAdditionalSite: false,
        remainingAdditionalSites: 0,
      }),
    );

    const card = wrapper.get('[aria-label="Continue building @studio with ME3"]');
    expect(card.attributes("href")).toBe(
      "/assistant?mode=site-builder&thread=thread-123",
    );
    expect(wrapper.text()).not.toContain("Landing pages");
  });

  it("offers Profile and Business Site choices from the Add site chooser", async () => {
    const wrapper = await mountDashboard(
      [siteRecord("owner", "profile")],
      quotaResponse({
        canCreateProfile: false,
        canCreateAdditionalSite: true,
        remainingAdditionalSites: 1,
      }),
    );

    await wrapper.get('[aria-label="Add site"]').trigger("click");

    const chooser = wrapper.get('[role="dialog"]');
    expect(chooser.text()).toContain("Website");
    expect(chooser.text()).toContain("Business Site");
    expect(chooser.text()).not.toContain("Create manually");

    const links = chooser.findAll("a");
    const businessSiteLink = links.find((link) =>
      link.text().includes("Business Site"),
    );
    expect(businessSiteLink?.attributes("href")).toContain(
      "/assistant?mode=site-builder",
    );
    expect(businessSiteLink?.attributes("href")).toContain(
      "prompt=Build+me+a+landing+page+site+for+",
    );
    expect(businessSiteLink?.attributes("href")).not.toContain("send=");

    const profileOption = chooser.get("button.add-site-option");
    expect(profileOption.text()).toContain("Website");
    expect(profileOption.text()).toContain(
      "Your current plan’s website limit has been reached.",
    );
    expect(profileOption.attributes("disabled")).toBeDefined();
  });

  it("keeps Add site visible and explains when the Business Site quota is full", async () => {
    const wrapper = await mountDashboard(
      [siteRecord("owner", "profile")],
      quotaResponse({
        canCreateProfile: false,
        canCreateAdditionalSite: false,
        remainingAdditionalSites: 0,
      }),
    );

    expect(wrapper.find('[aria-label="Add site"]').exists()).toBe(true);

    await wrapper.get('[aria-label="Add site"]').trigger("click");

    expect(wrapper.get('[role="dialog"]').text()).toContain(
      "Your current plan’s Business Site limit has been reached.",
    );
  });

  it("keeps both choices visible while site availability is unavailable", async () => {
    const sites = useSitesStore();
    sites.sites = [siteRecord("owner", "profile")];
    sites.ensureSites = vi.fn(async () => undefined) as never;
    sites.fetchSitePages = vi.fn(async () => []) as never;
    sites.getSiteQuota = vi.fn(async () => null) as never;

    const wrapper = mount(SitesPage, mountOptions(router));
    await flushPromises();
    await wrapper.get('[aria-label="Add site"]').trigger("click");

    const chooser = wrapper.get('[role="dialog"]');
    expect(chooser.findAll("button.add-site-option")).toHaveLength(2);
    expect(chooser.text()).toContain(
      "Site availability could not be loaded. Refresh and try again.",
    );
  });

  it("renders cached site cards immediately without loading copy", async () => {
    const sites = useSitesStore();
    sites.sites = [
      siteRecord("owner", "profile", "2026-08-20T10:00:00.000Z"),
    ];
    sites.loaded = true;
    sites.ensureSites = vi.fn(async () => undefined) as never;
    sites.fetchSitePages = vi.fn(async () => []) as never;
    sites.getSiteQuota = vi.fn(
      () => new Promise<SiteQuota | null>(() => undefined),
    ) as never;

    const wrapper = mount(SitesPage, mountOptions(router));
    await flushPromises();

    expect(wrapper.findAll("a.site-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("@owner");
    expect(wrapper.text()).not.toContain("Loading your sites");
  });

  async function mountDashboard(
    records: Site[],
    siteQuota: SiteQuota,
  ) {
    const sites = useSitesStore();
    sites.sites = records;
    sites.ensureSites = vi.fn(async () => undefined) as never;
    sites.fetchSitePages = vi.fn(async () => []) as never;
    sites.getSiteQuota = vi.fn(async () => siteQuota) as never;
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

function quotaResponse(options: {
  canCreateProfile: boolean;
  canCreateAdditionalSite: boolean;
  remainingAdditionalSites: number;
}): SiteQuota {
  const additionalLimit = 1;
  const additionalCurrent = additionalLimit - options.remainingAdditionalSites;
  return {
    current: additionalCurrent + (options.canCreateProfile ? 0 : 1),
    limit: additionalLimit + 1,
    tier: "core",
    profile: {
      current: options.canCreateProfile ? 0 : 1,
      limit: 1,
      remaining: options.canCreateProfile ? 1 : 0,
      can_create: options.canCreateProfile,
    },
    additional_sites: {
      current: additionalCurrent,
      limit: additionalLimit,
      remaining: options.remainingAdditionalSites,
      can_create: options.canCreateAdditionalSite,
    },
    remaining_additional_sites: options.remainingAdditionalSites,
    can_create_profile: options.canCreateProfile,
    can_create_additional_site: options.canCreateAdditionalSite,
    capabilities: {},
    can_create:
      options.canCreateProfile || options.canCreateAdditionalSite,
  };
}
