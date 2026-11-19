import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import WizardDomainSheet from "./WizardDomainSheet.vue";
import { domainToConnect, WIZARD_PUBLISH_KEY } from "../../utils/wizardPublish";

const site = reactive({ id: "site-1", username: "clara", published_at: null as string | null, custom_domain: null as string | null, custom_domain_status: null });
const fetchSites = vi.fn(async () => { site.published_at = "2026-11-19T10:00:00Z"; });

vi.mock("../../api", () => ({ api: { get: vi.fn().mockResolvedValue({ deploymentMode: "managed" }) } }));
vi.mock("../../stores/sites", () => ({ useSitesStore: () => ({ sites: [site], fetchSites }) }));
vi.mock("../../stores/wizard", () => ({ useWizardStore: () => ({ username: "clara" }) }));

const CustomDomainStub = defineComponent({
  props: ["initialDomain", "autoConnect", "sitePublished"],
  setup: (props) => () => h("div", { "data-test": "custom-domain", "data-domain": props.initialDomain, "data-auto": String(props.autoConnect) }),
});
const AppDialogStub = { props: ["open"], template: '<div v-if="open"><slot /></div>' };

function mountSheet(publish: () => Promise<boolean>) {
  const Host = defineComponent({
    setup() {
      provide(WIZARD_PUBLISH_KEY, publish);
      return () => h(WizardDomainSheet, { open: true });
    },
  });
  return mount(Host, { global: { stubs: { AppDialog: AppDialogStub, CustomDomain: CustomDomainStub } } });
}

describe("WizardDomainSheet", () => {
  beforeEach(() => {
    site.published_at = null;
    domainToConnect.value = "";
    fetchSites.mockClear();
  });

  it("publishes a site that isn't live, then connects the typed domain", async () => {
    const publish = vi.fn().mockResolvedValue(true);
    const wrapper = mountSheet(publish);
    await flushPromises();
    expect(wrapper.text()).toContain("Your site needs to be live");

    await wrapper.get("input").setValue("clarastudio.com");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(publish).toHaveBeenCalledOnce();
    expect(fetchSites).toHaveBeenCalled();
    const domain = wrapper.get('[data-test="custom-domain"]');
    expect(domain.attributes("data-domain")).toBe("clarastudio.com");
    expect(domain.attributes("data-auto")).toBe("true");
  });

  it("stays put and says so when publishing fails", async () => {
    const publish = vi.fn().mockResolvedValue(false);
    const wrapper = mountSheet(publish);
    await flushPromises();
    await wrapper.get("input").setValue("clarastudio.com");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find('[data-test="custom-domain"]').exists()).toBe(false);
    expect(wrapper.findComponent(WizardDomainSheet).emitted("close")).toHaveLength(1);
  });
});
