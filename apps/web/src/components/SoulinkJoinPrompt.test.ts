import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SoulinkJoinPrompt from "./SoulinkJoinPrompt.vue";

const AppDialogStub = defineComponent({
  name: "AppDialog",
  props: { open: Boolean },
  emits: ["close"],
  template: '<div v-if="open" data-testid="dialog"><slot /></div>',
});

const SoulinkConnectPanelStub = defineComponent({
  name: "SoulinkConnectPanel",
  emits: ["connection-active"],
  template:
    '<button type="button" data-testid="connect" @click="$emit(\'connection-active\')">Connect assistant</button>',
});

function mountPrompt() {
  return mount(SoulinkJoinPrompt, {
    props: {
      open: false,
      bannerVisible: true,
      soulinkUrl: "https://soulinkfoundation.org",
    },
    global: {
      stubs: {
        AppDialog: AppDialogStub,
        SoulinkConnectPanel: SoulinkConnectPanelStub,
        UiIcon: true,
      },
    },
  });
}

describe("SoulinkJoinPrompt", () => {
  it("keeps the awareness banner to one line and opens the shared dialog", async () => {
    const wrapper = mountPrompt();

    expect(wrapper.get(".soulink-banner").text()).toContain(
      "Meditate, call and chat with conscious communities on Soulink.",
    );

    await wrapper.get(".soulink-banner__link").trigger("click");

    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("continues to Soulink before offering the assistant connection", async () => {
    const wrapper = mountPrompt();
    await wrapper.setProps({ open: true });

    const continueLink = wrapper.get(".soulink-dialog__primary-action");
    expect(continueLink.attributes("href")).toBe("https://soulinkfoundation.org");
    expect(continueLink.attributes("target")).toBe("_blank");

    await continueLink.trigger("click");

    expect(wrapper.emitted("dismissBanner")).toHaveLength(1);
    expect(wrapper.get("#soulink-connect-title").text()).toBe(
      "Connect your ME3 assistant",
    );

    await wrapper.get('[data-testid="connect"]').trigger("click");
    expect(wrapper.emitted("connectionActive")).toHaveLength(1);
  });
});
