import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { account, capabilities, post, version } from "../../utils/social-posts.fixtures";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const routeState = { query: {} as Record<string, string>, params: {} as Record<string, string>, fullPath: "/social" };
const routerReplace = vi.fn();
const routerPush = vi.fn();
const toastError = vi.fn();

vi.mock("unplugin-vue-router/runtime", () => ({ definePage: vi.fn() }));
vi.mock("vue-router", () => ({
  RouterLink: { props: ["to"], template: "<a :data-to=\"to\"><slot /></a>" },
  useRoute: () => routeState,
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
}));
vi.mock("../../api", () => ({
  API_BASE: "/api",
  ApiError: class extends Error {},
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    delete: vi.fn(),
  },
}));

vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastError, toastSuccess: vi.fn(), toastFromUnknown: vi.fn(), toast: vi.fn() }),
}));

import SocialIndex from "./index.vue";
import SocialPost from "./[postId].vue";

const stubs = {
  Teleport: true,
  AppDialog: { props: ["open"], template: "<div v-if=\"open\"><slot /></div>" },
  ConfirmationDialog: true,
};

function serve(responses: Record<string, unknown>) {
  apiGet.mockImplementation((path: string) => {
    const key = Object.keys(responses).find((prefix) => path.startsWith(prefix));
    return key ? Promise.resolve(responses[key]) : Promise.reject(new Error(`Unexpected GET ${path}`));
  });
}

const status = (access: "included" | "locked") => ({
  access,
  plugin: { status: "installed", enabled: true, ready: true, statusLabel: "Installed", platformCapabilities: capabilities },
  hostedOAuth: { configured: true, platforms: ["x", "instagram"] },
});

describe("Social page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    routeState.query = {};
    routeState.params = {};
  });

  it("opens on Scheduled with counts for every tab", async () => {
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x"), account("instagram")] },
      "/social/posts": {
        posts: [
          post([version({ publicationStatus: "scheduled", scheduledFor: "2030-10-30T12:30:00.000Z" })], { id: "scheduled" }),
          post([version()], { id: "draft" }),
          post([version({ publicationStatus: "published", publishedAt: "2026-10-01T09:00:00.000Z" })], { id: "posted" }),
        ],
      },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
      "/social/suggestions": { suggestions: [] },
    });
    const wrapper = mount(SocialIndex, { global: { stubs } });
    await flushPromises();

    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map((tab) => tab.text())).toEqual(["Ideas0", "Drafts1", "Scheduled1", "Posted1"]);
    expect(wrapper.get('[aria-selected="true"]').text()).toContain("Scheduled");
    expect(wrapper.find('[aria-label="Needs attention"]').exists()).toBe(false);
    expect(wrapper.findAll(".social-row--link").map((row) => row.attributes("data-to"))).toEqual(["/social/scheduled"]);

    await tabs[1]!.trigger("click");
    expect(wrapper.findAll(".social-row--link").map((row) => row.attributes("data-to"))).toEqual(["/social/draft"]);
    expect(wrapper.text()).not.toMatch(/Version|Publication|Source/);
  });

  it("says in plain words why an account didn't connect", async () => {
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [] },
      "/social/posts": { posts: [] },
      "/sites": { sites: [] },
      "/social/suggestions": { suggestions: [] },
    });
    routeState.query = { social_error: "x_config" };
    mount(SocialIndex, { global: { stubs } });
    await flushPromises();

    expect(toastError).toHaveBeenCalledWith("X isn't available to connect yet. ME3 needs to finish setting it up.");
    expect(routerReplace).toHaveBeenCalledWith({ query: {} });
  });

  it("shows Needs attention when an account with scheduled posts is disconnected", async () => {
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("instagram", "expired")] },
      "/social/posts": { posts: [post([version({ platform: "instagram", publicationStatus: "scheduled" })])] },
      "/sites": { sites: [] },
      "/social/suggestions": { suggestions: [] },
    });
    const wrapper = mount(SocialIndex, { global: { stubs } });
    await flushPromises();

    expect(wrapper.get('[aria-label="Needs attention"]').text()).toContain("Instagram disconnected. 1 post paused.");
    expect(wrapper.text()).toContain("Paused until Instagram reconnects");
  });

  it("shows the Business page with plans to a Starter owner on web", async () => {
    serve({ "/social/status": status("locked") });
    const wrapper = mount(SocialIndex, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain("Included in Business");
    expect(wrapper.text()).toContain("See plans");
    expect(apiGet).not.toHaveBeenCalledWith("/social/posts");
  });
});

describe("Social review", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    routeState.query = {};
    routeState.params = { postId: "post-1" };
  });

  it("names the effect on the buttons and returns a scheduled post to Drafts after an edit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const scheduled = post([
      version({ id: "x-1", publicationStatus: "scheduled", scheduledFor: "2030-10-31T12:30:00.000Z", approvalStatus: "approved" }),
    ]);
    const reverted = post([version({ id: "x-1", bodyText: "Studio open day, edited.", approvalStatus: "draft" })]);
    let current = scheduled;
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x")] },
      "/social/posts/post-1": { get post() { return current; } },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation(() => {
      current = reverted;
      return Promise.resolve({ version: reverted.versions[0] });
    });
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain("Scheduled for");
    expect(wrapper.text()).toContain("Cancel schedule");

    await wrapper.get("textarea").setValue("Studio open day, edited.");
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    vi.useRealTimers();

    expect(apiPatch).toHaveBeenCalledWith("/social/versions/x-1", { bodyText: "Studio open day, edited." });
    const buttons = wrapper.findAll("button").map((button) => button.text());
    expect(buttons).toContain("Post now");
    expect(buttons.some((label) => /^Schedule 1 post for /.test(label))).toBe(true);
    expect(buttons.some((label) => /Approve/.test(label))).toBe(false);
  });
});
