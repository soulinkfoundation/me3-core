import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import AppTopBar from "./AppTopBar.vue";
import { useTopBarClose } from "../composables/useTopBar";

vi.mock("./AppProfileMenu.vue", () => ({
  default: defineComponent({ props: { showHome: Boolean }, setup: (props) => () => h("button", { class: "avatar", "data-show-home": String(props.showHome) }) }),
}));

const Page = { render: () => h("div") };
const Editor = defineComponent({ setup() { useTopBarClose(() => undefined); return () => h("div"); } });

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/email/campaigns/:id", component: Page, meta: { back: { to: "/email/campaigns", label: "Campaigns" } } },
      { path: "/create", component: Editor },
      { path: "/:pathMatch(.*)*", component: Page },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount({ render: () => [h(AppTopBar), h((router.currentRoute.value.matched[0]?.components?.default ?? Page) as never)] }, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

// Any feature is one click from any other: the avatar menu sits where the X was, and only editors keep an X.
describe("AppTopBar", () => {
  it("shows the avatar menu, without Home, on Home", async () => {
    const wrapper = await mountAt("/assistant");
    expect(wrapper.find(".avatar").attributes("data-show-home")).toBe("false");
    expect(wrapper.find(".app-top-bar__close").exists()).toBe(false);
  });

  it("shows the avatar menu, with Home, on a feature page instead of X", async () => {
    for (const path of ["/journal", "/email", "/people", "/settings/profile"]) {
      const wrapper = await mountAt(path);
      expect(wrapper.find(".avatar").attributes("data-show-home")).toBe("true");
      expect(wrapper.find(".app-top-bar__close").exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it("keeps X on editors: a page with a parent, a page that decides how to leave, the site builder", async () => {
    for (const path of ["/email/campaigns/c1", "/create", "/assistant?mode=site-builder"]) {
      const wrapper = await mountAt(path);
      expect(wrapper.find(".app-top-bar__close").exists()).toBe(true);
      expect(wrapper.find(".avatar").exists()).toBe(false);
      wrapper.unmount();
    }
  });
});
