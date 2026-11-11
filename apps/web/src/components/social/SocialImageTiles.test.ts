import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SocialImageTiles from "./SocialImageTiles.vue";

const images = ["a", "b", "c"].map((name) => ({ url: `/${name}.png`, fileId: name, kind: "image" as const }));

describe("SocialImageTiles", () => {
  it("moves a tile with the arrow keys and removes it with Delete", async () => {
    const wrapper = mount(SocialImageTiles, { props: { images }, attachTo: document.body });
    const tiles = wrapper.findAll("[data-tile]");
    expect(tiles[0]!.attributes("aria-label")).toBe("Image 1 of 3. Drag or use arrow keys to move it.");

    await tiles[0]!.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("reorder")![0]![0].map((asset: { fileId: string }) => asset.fileId)).toEqual(["b", "a", "c"]);
    expect(wrapper.text()).toContain("Image moved to position 2 of 3.");

    await wrapper.findAll("[data-tile]")[2]!.trigger("keydown", { key: "Delete" });
    expect(wrapper.emitted("remove")![0]).toEqual([2]);
    wrapper.unmount();
  });

  it("shows no tools when the post is locked", () => {
    const wrapper = mount(SocialImageTiles, { props: { images, locked: true } });
    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.find("[data-tile]").attributes("aria-label")).toBe("Image 1 of 3");
  });
});
