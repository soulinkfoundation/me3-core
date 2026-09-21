import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import WizardBasics from "./WizardBasics.vue";
import InlineRichTextEditor from "./BookingOfferDescriptionEditor.vue";
import { useWizardStore } from "../../stores/wizard";

describe("WizardBasics profile visibility", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("configures a 320-character limit for the short bio editor", () => {
    const wrapper = mount(WizardBasics);

    expect(wrapper.findComponent(InlineRichTextEditor).props("maxCharacters")).toBe(320);
    expect(wrapper.get(".char-count").text()).toBe("0/320");
  });

  it("shows one checkbox with the recorded copy for profiles", async () => {
    const wrapper = mount(WizardBasics);
    const visibility = wrapper.get(".visibility-group");
    const checkbox = visibility.get('input[type="checkbox"]');

    expect(visibility.get("legend").text()).toBe("Profile visibility");
    expect(visibility.get("label").text()).toBe("Make my profile public");
    expect(visibility.findAll('input[type="checkbox"]')).toHaveLength(1);
    expect((checkbox.element as HTMLInputElement).checked).toBe(false);

    await checkbox.setValue(true);
    expect(useWizardStore().profile.visibility).toBe("public");
  });

  it("does not show the profile setting for organization sites", () => {
    const wizard = useWizardStore();
    wizard.setSiteRole("organization");

    const wrapper = mount(WizardBasics);
    expect(wrapper.find(".visibility-group").exists()).toBe(false);
    expect(wrapper.get('label[for="name"]').text()).toBe("Name *");
    expect(wrapper.get('label[for="handle"]').text()).toBe("Site address *");
    expect(wrapper.find(".handle-prefix").exists()).toBe(false);
    expect(wrapper.get(".handle-help").text()).toContain(
      "Used in this site's web address",
    );
  });
});
