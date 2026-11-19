import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CustomDomain from "./CustomDomain.vue";
import { useSitesStore } from "../stores/sites";

vi.mock("../stores/sites", () => ({
  useSitesStore: vi.fn(),
}));

const sitesStore = {
  getDomainStatus: vi.fn(),
  connectDomain: vi.fn(),
  disconnectDomain: vi.fn(),
  refreshDomainStatus: vi.fn(),
  error: null as string | null,
};

describe("CustomDomain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sitesStore.error = null;
    vi.mocked(useSitesStore).mockReturnValue(
      sitesStore as unknown as ReturnType<typeof useSitesStore>,
    );
    sitesStore.getDomainStatus.mockResolvedValue({
      connected: false,
    });
  });

  it("loads domain status on mount without emitting a change event", async () => {
    const wrapper = mount(CustomDomain, {
      props: {
        username: "testuser",
        showSettingsLink: false,
        profilePublished: true,
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    await flushPromises();

    expect(sitesStore.getDomainStatus).toHaveBeenCalledWith("testuser");
    expect(wrapper.emitted("domainStatusChanged")).toBeUndefined();
  });

  it("uses site language before a selected site is published", async () => {
    const wrapper = mount(CustomDomain, {
      props: {
        username: "studio",
        siteRole: "organization",
        sitePublished: false,
        fallbackUrl: "https://owner.me3.app/site/studio/",
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Publish this site before connecting a custom domain.",
    );
    expect(wrapper.text()).not.toContain("Publish your profile");
    expect(
      wrapper.get(".domain-actions .button.primary").attributes("disabled"),
    ).toBeDefined();
  });

  it("shows the selected site's permanent fallback beside its custom domain", async () => {
    sitesStore.getDomainStatus.mockResolvedValue({
      connected: true,
      domain: "studio.example.com",
      status: "active",
      url: "https://studio.example.com",
    });
    const wrapper = mount(CustomDomain, {
      props: {
        username: "studio",
        siteRole: "organization",
        sitePublished: true,
        fallbackUrl: "https://owner.me3.app/site/studio/",
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("https://owner.me3.app/site/studio/");
  });

  it("explains a disabled embedded domain form", async () => {
    const wrapper = mount(CustomDomain, {
      props: {
        embedded: true,
        username: "studio",
        siteRole: "organization",
        sitePublished: false,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Publish this site before connecting a custom domain.",
    );
    expect(wrapper.get('input[aria-label="Custom domain"]')).toBeTruthy();
    expect(
      wrapper.get('button[type="submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("emits a change event after connecting a domain", async () => {
    sitesStore.connectDomain.mockResolvedValue({
      ok: true,
      domain: "www.example.com",
      status: "pending",
    });

    const wrapper = mount(CustomDomain, {
      props: {
        username: "testuser",
        showSettingsLink: false,
        profilePublished: true,
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    await wrapper.get(".domain-actions .button.primary").trigger("click");
    await wrapper.get("input.domain-input").setValue("www.example.com");
    await wrapper.get("form.domain-input-wrapper").trigger("submit");
    await flushPromises();

    expect(sitesStore.connectDomain).toHaveBeenCalledWith("testuser", "example.com");
    expect(wrapper.emitted("domainStatusChanged")).toHaveLength(1);
  });

  it("prefills the domain input from an onboarding suggestion", async () => {
    const wrapper = mount(CustomDomain, {
      props: {
        username: "testuser",
        showSettingsLink: false,
        profilePublished: true,
        initialDomain: "kieranbutler.com",
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    const input = wrapper.get("input.domain-input").element as HTMLInputElement;
    expect(input.value).toBe("kieranbutler.com");
  });

  it("connects a managed installation through the www hostname", async () => {
    sitesStore.connectDomain.mockResolvedValue({
      ok: true,
      domain: "www.example.com",
      status: "pending",
    });

    const wrapper = mount(CustomDomain, {
      props: {
        username: "testuser",
        managed: true,
        embedded: true,
        showSettingsLink: false,
        profilePublished: true,
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    await wrapper.get("input.domain-input").setValue("www.example.com");
    await wrapper.get("form.domain-input-wrapper").trigger("submit");
    await flushPromises();

    expect(sitesStore.connectDomain).toHaveBeenCalledWith(
      "testuser",
      "www.example.com",
    );
  });

  it("shows only the essential managed DNS instruction and root redirect note", async () => {
    sitesStore.getDomainStatus.mockResolvedValue({
      connected: true,
      domain: "www.example.com",
      status: "pending",
      verification_records: [
        { type: "cname", name: "www.example.com", value: "sites.me3.app" },
      ],
      registrar_guides: [],
      instructions: [],
    });

    const wrapper = mount(CustomDomain, {
      props: {
        username: "testuser",
        managed: true,
        showSettingsLink: false,
        profilePublished: true,
      },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Connect your www address");
    expect(wrapper.text()).toContain(
      "Add this CNAME record, then click Check status.",
    );
    expect(wrapper.text()).toContain(
      "This connects www only; redirect the root domain separately.",
    );
    expect(wrapper.text()).not.toContain("Keep your permanent me3.app address");
  });

  it("connects the suggested domain straight away when asked to", async () => {
    sitesStore.connectDomain.mockResolvedValue({ ok: true });
    mount(CustomDomain, {
      props: { username: "clara", sitePublished: true, embedded: true, managed: true, initialDomain: "clarastudio.com", autoConnect: true },
      global: { stubs: { RouterLink: true } },
    });
    await flushPromises();

    expect(sitesStore.connectDomain).toHaveBeenCalledWith("clara", "www.clarastudio.com");
  });
});
