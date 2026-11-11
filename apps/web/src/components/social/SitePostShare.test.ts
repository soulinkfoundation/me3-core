import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilities, post, version } from "../../utils/social-posts.fixtures";

const apiGet = vi.fn();
const apiPost = vi.fn();
const routerPush = vi.fn();

vi.mock("vue-router", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("../../api", () => ({
  API_BASE: "/api",
  ApiError: class extends Error {},
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastError: vi.fn(), toastSuccess: vi.fn(), toastFromUnknown: vi.fn(), toast: vi.fn() }),
}));

import SitePostShare from "./SitePostShare.vue";

const status = (access: "included" | "locked") => ({
  access,
  plugin: { status: "installed", enabled: true, ready: true, statusLabel: "Installed", platformCapabilities: capabilities },
  hostedOAuth: { configured: true, platforms: [] },
});

function serve(share: unknown, access: "included" | "locked" = "included") {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith("/social/status")) return Promise.resolve(status(access));
    if (path.startsWith("/sites")) return Promise.resolve({ sites: [{ id: "site-1", username: "kieran", site_role: "profile" }] });
    if (path.startsWith("/social/site-posts/share")) return Promise.resolve({ post: share });
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
}

describe("SitePostShare", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("starts sharing a live post and opens it in Social", async () => {
    serve(null);
    apiPost.mockResolvedValue({ post: post([version()], { id: "shared-1" }), created: true });
    const wrapper = mount(SitePostShare, { props: { username: "kieran", slug: "write-before", live: true } });
    await flushPromises();

    expect(apiGet).toHaveBeenCalledWith("/social/site-posts/share?siteId=site-1&slug=write-before");
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(apiPost).toHaveBeenCalledWith("/social/site-posts/share", { siteId: "site-1", slug: "write-before" });
    expect(routerPush).toHaveBeenCalledWith("/social/shared-1");
  });

  it("shows where an existing share went and reopens it without creating another", async () => {
    serve(post([version({ platform: "linkedin", publicationStatus: "published" })], { id: "shared-1" }));
    const wrapper = mount(SitePostShare, { props: { username: "kieran", slug: "write-before", live: true } });
    await flushPromises();

    expect(wrapper.text()).toContain("Shared to LinkedIn");
    expect(wrapper.get("button").text()).toBe("Open in Social");
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(apiPost).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/social/shared-1");
  });

  it("stays hidden for drafts and when Social isn't included", async () => {
    serve(null);
    const draft = mount(SitePostShare, { props: { username: "kieran", slug: "draft", live: false } });
    await flushPromises();
    expect(draft.find("button").exists()).toBe(false);

    serve(null, "locked");
    const locked = mount(SitePostShare, { props: { username: "kieran", slug: "live", live: true } });
    await flushPromises();
    expect(locked.find("button").exists()).toBe(false);
  });
});
