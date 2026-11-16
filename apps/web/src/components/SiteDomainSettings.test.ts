import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSitesStore, type Site } from "../stores/sites";

const apiGet = vi.fn();
let query: Record<string, string> = {};

vi.mock("vue-router", () => ({ useRoute: () => ({ query }), RouterLink: { props: ["to"], template: "<a><slot /></a>" } }));
vi.mock("../api", () => ({
  API_BASE: "/api",
  ApiError: class extends Error {},
  api: { get: (...args: unknown[]) => apiGet(...args), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import SiteDomainSettings from "./SiteDomainSettings.vue";

function site(username: string, role: "profile" | "organization", domain: string | null = null): Site {
  return {
    id: `site-${username}`,
    username,
    user_id: "owner",
    site_role: role,
    custom_domain: domain,
    custom_domain_status: domain ? "active" : null,
    created_at: "2026-08-20T09:00:00.000Z",
    updated_at: "2026-08-24T09:00:00.000Z",
    published_at: "2026-08-24T09:00:00.000Z",
  };
}

function mountSettings(sites: Site[]) {
  const store = useSitesStore();
  store.sites = sites;
  store.ensureSites = vi.fn(async () => undefined) as never;
  return mount(SiteDomainSettings, {
    global: { stubs: { CustomDomain: true, ConfirmationDialog: true, RouterLink: true } },
  });
}

describe("SiteDomainSettings", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    query = {};
    apiGet.mockImplementation((path: string) =>
      path === "/config" ? Promise.resolve({ deploymentMode: "managed" }) : Promise.reject(new Error("unexpected")),
    );
  });

  it("lists your website first, then older sites, with each address", async () => {
    const wrapper = mountSettings([site("studio", "organization"), site("kieran", "profile", "www.kieranbutler.com")]);
    await flushPromises();
    const rows = wrapper.findAll(".site-domains__text").map((row) => row.text());
    expect(rows).toEqual(["@kieranwww.kieranbutler.com", "@studioDefault ME3 address"]);
    expect(wrapper.text()).not.toContain("Made with ME3 badge");
  });

  it("opens domain setup in place, and offers delete only for older sites", async () => {
    const wrapper = mountSettings([site("kieran", "profile"), site("studio", "organization")]);
    await flushPromises();
    expect(wrapper.find("custom-domain-stub").exists()).toBe(false);

    const [profileToggle, olderToggle] = wrapper.findAll("button").filter((b) => b.text() === "Set up domain");
    await profileToggle.trigger("click");
    expect(wrapper.find("custom-domain-stub").attributes("username")).toBe("kieran");
    expect(wrapper.text()).not.toContain("Delete site");

    await olderToggle.trigger("click");
    expect(wrapper.find("custom-domain-stub").attributes("username")).toBe("studio");
    expect(wrapper.text()).toContain("Delete site");
  });

  it("opens the site named in the link", async () => {
    query = { site: "studio" };
    const wrapper = mountSettings([site("kieran", "profile"), site("studio", "organization")]);
    await flushPromises();
    expect(wrapper.find("custom-domain-stub").attributes("username")).toBe("studio");
  });

  it("points to the editor when there is no website yet", async () => {
    const wrapper = mountSettings([]);
    await flushPromises();
    expect(wrapper.text()).toContain("You don't have a website yet.");
  });
});
