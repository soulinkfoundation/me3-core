import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useWizardStore } from "../stores/wizard";
import GeneratedSitePreview from "./GeneratedSitePreview.vue";

describe("GeneratedSitePreview", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    useWizardStore().profile.visibility = "public";
  });

  it("renders unsaved wizard state with the production site renderer", async () => {
    const wizard = useWizardStore();
    wizard.profile.name = "Preview Person";
    wizard.profile.handle = "preview-person";
    wizard.profile.bio = "An unsaved generated preview.";
    wizard.username = "preview-person";
    wizard.profile.avatar = "/preview/preview-person/files/avatar.jpg";
    wizard.profile.banner = "/preview/preview-person/files/banner.jpg";

    const wrapper = mount(GeneratedSitePreview);
    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toBe("Generating preview…");

    await flushPromises();

    const frame = wrapper.get("iframe");
    const html = frame.attributes("srcdoc");
    expect(frame.attributes("sandbox")).toBe("allow-scripts");
    expect(html).toContain("Preview Person");
    expect(html).toContain("An unsaved generated preview.");
    expect(html).toContain('<base href="/preview/preview-person/">');
    expect(html).toContain('src="./files/avatar.jpg"');
    expect(html).toContain('src="./files/banner.jpg"');
    expect(html).toContain("me3-preview-navigation");
  });

  it("resolves nested preview pages from their generated directory", async () => {
    const wizard = useWizardStore();
    wizard.profile.name = "Preview Person";
    wizard.profile.handle = "preview-person";
    wizard.profile.avatar = "/preview/preview-person/files/avatar.jpg";
    wizard.username = "preview-person";
    wizard.blogEnabled = true;
    const post = wizard.addPost("Nested preview post");
    if (post) post.draft = false;

    const wrapper = mount(GeneratedSitePreview, {
      props: { activeView: "blog" },
    });
    await flushPromises();

    const html = wrapper.get("iframe").attributes("srcdoc");
    expect(html).toContain('<base href="/preview/preview-person/blog/">');
    expect(html).toContain('src="../files/avatar.jpg"');
  });

  it("uses the site logo for preview icons before the avatar fallback", async () => {
    const wizard = useWizardStore();
    wizard.profile.name = "Preview Person";
    wizard.profile.handle = "preview-person";
    wizard.profile.logo = "/preview/preview-person/files/logo.png";
    wizard.profile.avatar = "/preview/preview-person/files/avatar.jpg";
    wizard.username = "preview-person";

    const wrapper = mount(GeneratedSitePreview);
    await flushPromises();

    const html = wrapper.get("iframe").attributes("srcdoc");
    expect(html).toContain('<link rel="icon" href="./files/logo.png">');
    expect(html).not.toContain('<link rel="icon" href="./files/avatar.jpg">');
  });
});
