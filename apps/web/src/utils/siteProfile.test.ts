import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import { cloneSiteProfile, withoutCurrentSiteImage } from "./siteProfile";

describe("cloneSiteProfile", () => {
  it("clones a reactive profile with nested reactive data", () => {
    const profile = reactive({
      name: "Kieran",
      links: reactive({ website: "https://example.com" }),
      pages: reactive([{ slug: "about", title: "About" }]),
    });

    const clone = cloneSiteProfile(profile);

    expect(clone).not.toBe(profile);
    expect(clone.links).not.toBe(profile.links);
    expect(clone.pages).not.toBe(profile.pages);
    clone.pages[0].title = "Updated";
    expect(profile.pages[0].title).toBe("About");
  });
});

describe("withoutCurrentSiteImage", () => {
  it("removes a custom logo while keeping the avatar and other profile data", () => {
    const profile = reactive({ logo: "./logo.png", avatar: "./avatar.jpg", name: "Kieran" });
    const next = withoutCurrentSiteImage(profile);

    expect(next).toEqual({ avatar: "./avatar.jpg", name: "Kieran" });
    expect(profile.logo).toBe("./logo.png");
  });

  it("removes the avatar when there is no custom logo", () => {
    const profile = reactive({ avatar: "./avatar.jpg", name: "Kieran" });
    const next = withoutCurrentSiteImage(profile);

    expect(next).toEqual({ name: "Kieran" });
    expect(profile.avatar).toBe("./avatar.jpg");
  });
});
