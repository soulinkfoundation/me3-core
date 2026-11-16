import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTikTokChoices, type TikTokPostChoices } from "../../utils/tiktok-post";

const apiGet = vi.fn();
vi.mock("../../api", () => ({
  API_BASE: "/api",
  ApiError: class extends Error {},
  api: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import SocialTikTokSettings from "./SocialTikTokSettings.vue";

const creator = {
  avatarUrl: null,
  username: "maya",
  nickname: "Maya",
  privacyLevelOptions: ["SELF_ONLY", "FOLLOWER_OF_CREATOR"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoPostDurationSeconds: 600,
};

async function panel(choices: TikTokPostChoices = emptyTikTokChoices()) {
  apiGet.mockResolvedValue({ creatorInfo: creator });
  const wrapper = mount(SocialTikTokSettings, {
    props: { accountId: "tt", video: null, choices, "onUpdate:choices": (next: TikTokPostChoices) => wrapper.setProps({ choices: next }) },
  });
  await flushPromises();
  return wrapper;
}

describe("TikTok settings (me3-vque)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("starts with nothing chosen, offers only this account's privacy levels and marks it required", async () => {
    const wrapper = await panel();
    const select = wrapper.find("select");
    expect((select.element as HTMLSelectElement).value).toBe("");
    expect(select.attributes("aria-required")).toBe("true");
    expect(wrapper.find(".tiktok__field").text()).toContain("Who can see it");
    expect(wrapper.findAll("option").map((option) => option.text())).toEqual(["Choose who can see it", "Only me", "Followers"]);
    expect(wrapper.find(".tiktok__count").text()).toBe("1 to choose");
    expect(wrapper.text()).toContain("videos up to 10:00 on this account");
  });

  it("starts Comment, Duet and Stitch unticked and says why one is off", async () => {
    const wrapper = await panel();
    const boxes = wrapper.findAll(".tiktok__group").at(0)!.findAll("input");
    expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([false, false, false]);
    expect(boxes.map((box) => (box.element as HTMLInputElement).disabled)).toEqual([false, true, false]);
    const why = wrapper.find(`#${boxes[1]!.attributes("aria-describedby")}`);
    expect(why.text()).toBe("Duets are off in your TikTok settings.");
  });

  it("counts what's left to choose and is never collapsed", async () => {
    const wrapper = await panel({ ...emptyTikTokChoices(), privacyLevel: "SELF_ONLY", disclose: true });
    expect(wrapper.find(".tiktok__count").text()).toBe("1 to choose");
    await wrapper.setProps({ choices: { ...emptyTikTokChoices(), privacyLevel: "SELF_ONLY", disclose: true, yourBrand: true } });
    expect(wrapper.find(".tiktok__count").exists()).toBe(false);
    expect(wrapper.find("details").exists()).toBe(false);
    // The consent line lives beside Post on the post screen, not in the panel.
    expect(wrapper.text()).not.toContain("By posting");
  });
});
