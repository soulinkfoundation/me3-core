import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

function stubPhone(ua: string, narrow = true) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("max-width") ? narrow : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

async function mountBanner(enabled = true) {
  vi.resetModules();
  const { default: GetTheAppBanner } = await import("./GetTheAppBanner.vue");
  const wrapper = mount(GetTheAppBanner, { props: { enabled } });
  await nextTick();
  return wrapper;
}

describe("GetTheAppBanner", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("has-get-the-app-banner");
  });

  it("sends iPhone browsers to the App Store and makes room above the top bar", async () => {
    stubPhone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130");
    const wrapper = await mountBanner();
    expect(wrapper.get(".get-the-app__cta").attributes("href")).toBe("https://apps.apple.com/app/me3/id6787900414");
    expect(document.documentElement.classList.contains("has-get-the-app-banner")).toBe(true);
  });

  it("sends Android phones to Google Play", async () => {
    stubPhone("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36");
    const wrapper = await mountBanner();
    expect(wrapper.get(".get-the-app__cta").attributes("href")).toContain("play.google.com");
  });

  it("stays hidden on desktop and outside the app shell", async () => {
    stubPhone("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)", false);
    expect((await mountBanner()).find(".get-the-app").exists()).toBe(false);
    stubPhone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    expect((await mountBanner(false)).find(".get-the-app").exists()).toBe(false);
  });

  it("hides for a week after Not now", async () => {
    stubPhone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    const wrapper = await mountBanner();
    await wrapper.get('button[aria-label="Not now"]').trigger("click");
    expect(wrapper.find(".get-the-app").exists()).toBe(false);
    expect(document.documentElement.classList.contains("has-get-the-app-banner")).toBe(false);
    expect((await mountBanner()).find(".get-the-app").exists()).toBe(false);
  });
});
