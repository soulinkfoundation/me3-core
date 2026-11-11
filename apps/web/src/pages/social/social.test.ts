import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { account, capabilities, post, version } from "../../utils/social-posts.fixtures";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
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
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}));

const uploadDriveFiles = vi.fn();
vi.mock("../../utils/drive-upload", () => ({ uploadDriveFiles: (...args: unknown[]) => uploadDriveFiles(...args) }));

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
    });
    const wrapper = mount(SocialIndex, { global: { stubs } });
    await flushPromises();

    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map((tab) => tab.text())).toEqual(["Drafts1", "Scheduled1", "Posted1"]);
    expect(wrapper.get('[aria-selected="true"]').text()).toContain("Scheduled");
    expect(wrapper.find('[aria-label="Needs attention"]').exists()).toBe(false);
    expect(wrapper.findAll(".social-row--link").map((row) => row.attributes("data-to"))).toEqual(["/social/scheduled"]);

    await tabs[0]!.trigger("click");
    expect(wrapper.findAll(".social-row--link").map((row) => row.attributes("data-to"))).toEqual(["/social/draft"]);
    expect(wrapper.text()).not.toMatch(/Version|Publication|Source/);
  });

  it("says in plain words why an account didn't connect", async () => {
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [] },
      "/social/posts": { posts: [] },
      "/sites": { sites: [] },
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

  it("adds YouTube to a post as a Short that needs a title and a video", async () => {
    const withShort = post([
      version({ id: "x-1" }),
      version({ id: "yt-1", platform: "youtube", format: "short_video", title: "Studio open day on Saturday.", bodyText: "Studio open day on Saturday." }),
    ]);
    let current = post([version({ id: "x-1" })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x"), account("youtube")] },
      "/social/posts/post-1": { get post() { return current; } },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPost.mockImplementation(() => {
      current = withShort;
      return Promise.resolve({ post: withShort });
    });
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    const add = wrapper.findAll(".post-tabs__add");
    expect(add.map((button) => button.text())).toEqual(["YouTube"]);
    await add[0]!.trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/social/posts/post-1/versions", {
      platform: "youtube",
      targetAccountId: "account-youtube",
      bodyText: "Studio open day on Saturday.",
      format: "short_video",
      title: "Studio open day on Saturday.",
    });
    expect(wrapper.find(".post-tabs__add").exists()).toBe(false);
    expect(wrapper.find('input[type="file"][accept="video/*"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("YouTube Shorts needs a video.");
  });

  it("posts to the ready platforms and names the ones it skips", async () => {
    const both = post([
      version({ id: "x-1" }),
      version({ id: "yt-1", platform: "youtube", format: "short_video", title: "Open day" }),
    ]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x"), account("youtube")] },
      "/social/posts/post-1": { post: both },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((path: string) => Promise.resolve({ version: both.versions.find((item) => path.endsWith(item.id)) }));
    apiPost.mockResolvedValue({ publication: {} });
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain("Skipping YouTube (YouTube Shorts needs a video).");
    const postNow = wrapper.findAll("button").find((button) => button.text() === "Post now")!;
    expect(postNow.attributes("disabled")).toBeUndefined();
    const schedule = wrapper.findAll("button").find((button) => /^Schedule 1 post/.test(button.text()))!;
    expect(schedule.attributes("disabled")).toBeUndefined();

    await postNow.trigger("click");
    await flushPromises();
    const published = apiPost.mock.calls.map(([path]) => path).filter((path) => String(path).endsWith("/publish"));
    expect(published).toEqual(["/social/versions/x-1/publish"]);
  });

  it("removes a platform from the post after confirming", async () => {
    const both = post([
      version({ id: "x-1" }),
      version({ id: "yt-1", platform: "youtube", format: "short_video", title: "Open day" }),
    ]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x"), account("youtube")] },
      "/social/posts/post-1": { post: both },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiDelete.mockResolvedValue({ post: post([version({ id: "x-1" })]) });
    const wrapper = mount(SocialPost, {
      global: {
        stubs: {
          ...stubs,
          ConfirmationDialog: { props: ["open", "title"], emits: ["confirm"], template: "<div v-if=\"open\" class=\"confirm\">{{ title }}<button class=\"confirm-yes\" @click=\"$emit('confirm')\">OK</button></div>" },
        },
      },
    });
    await flushPromises();

    const tabs = wrapper.findAll('[role="tab"]');
    await tabs[1]!.trigger("click");
    await wrapper.get(".post-remove").trigger("click");
    expect(wrapper.get(".confirm").text()).toContain("Remove YouTube from this post?");
    await wrapper.get(".confirm-yes").trigger("click");
    await flushPromises();

    expect(apiDelete).toHaveBeenCalledWith("/social/versions/yt-1");
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain("YouTube Shorts needs a video.");
    // Only one platform left: nothing to remove.
    expect(wrapper.find(".post-remove").exists()).toBe(false);
  });

  it("offers a video on platforms whose capabilities take one", async () => {
    const withMov = post([
      version({ id: "x-1", assetManifest: [{ url: "/api/files/f1/content", fileId: "f1", filename: "IMG_0001.MOV", kind: "video", mimeType: "video/quicktime", byteLength: 1000, altText: "", assetIndex: 0 }] }),
      version({ id: "ig-1", platform: "instagram" }),
    ]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x"), account("instagram")] },
      "/social/posts/post-1": { post: withMov },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain("IMG_0001.MOV");
    expect(wrapper.text()).toContain("X takes MP4 video, and this is a MOV (iPhone) file.");
    const adds = wrapper.findAll(".post-images__add").map((button) => button.text());
    expect(adds).toEqual(["Replace video", "From Files"]);

    // Instagram mixes photos and videos in one carousel, and can make text slides.
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    expect(wrapper.findAll(".post-images__add").map((button) => button.text())).toEqual(["Add your own images", "Make text slides", "Add a video", "From Files"]);
  });

  it("replaces an image with its cropped copy", async () => {
    const original = { url: "/api/files/f1/content", fileId: "f1", filename: "launch.png", kind: "image" as const, mimeType: "image/png", altText: "Launch", assetIndex: 0 };
    const current = post([version({ id: "x-1", assetManifest: [original] })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((_path: string, body: { assetManifest: unknown }) => Promise.resolve({ version: { ...current.versions[0], ...body } }));
    uploadDriveFiles.mockResolvedValue([{ id: "f2", filename: "launch-cropped.png", mimeType: "image/png", size: 900 }]);
    const wrapper = mount(SocialPost, {
      global: {
        stubs: {
          ...stubs,
          SocialImageCropper: { name: "SocialImageCropper", props: ["open", "platform"], emits: ["save"], template: "<div v-if=\"open\" class=\"cropper-stub\" :data-platform=\"platform\" />" },
        },
      },
    });
    await flushPromises();

    await wrapper.get('[aria-label="Crop image 1"]').trigger("click");
    const cropper = wrapper.get(".cropper-stub");
    expect(cropper.attributes("data-platform")).toBe("x");
    const file = new File(["x"], "launch-cropped.png", { type: "image/png" });
    wrapper.findComponent({ name: "SocialImageCropper" }).vm.$emit("save", file);
    await flushPromises();

    expect(uploadDriveFiles).toHaveBeenCalledWith([file], { folderId: null, onConflict: "rename" });
    expect(apiPatch).toHaveBeenCalledWith("/social/versions/x-1", {
      assetManifest: [expect.objectContaining({ fileId: "f2", url: "/api/files/f2/content", altText: "Launch", assetIndex: 0 })],
    });
    expect(wrapper.find(".cropper-stub").exists()).toBe(false);
  });

  it("attaches dropped and pasted files to the platform", async () => {
    const current = post([version({ id: "x-1" })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((_path: string, body: object) => Promise.resolve({ version: { ...current.versions[0], ...body } }));
    uploadDriveFiles.mockResolvedValueOnce([{ id: "f1", filename: "shot.png", mimeType: "image/png", size: 10 }]);
    uploadDriveFiles.mockResolvedValueOnce([{ id: "v1", filename: "clip.mp4", mimeType: "video/mp4", size: 99 }]);
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    const shot = new File(["x"], "shot.png", { type: "image/png" });
    await wrapper.get("textarea").trigger("paste", { clipboardData: { files: [shot] } });
    await flushPromises();
    expect(uploadDriveFiles).toHaveBeenLastCalledWith([shot], { folderId: null, onConflict: "rename" });
    expect(apiPatch).toHaveBeenLastCalledWith("/social/versions/x-1", { assetManifest: [expect.objectContaining({ fileId: "f1", kind: "image" })] });

    const clip = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await wrapper.get(".post-editor__main").trigger("drop", { dataTransfer: { types: ["Files"], files: [clip] } });
    await flushPromises();
    expect(apiPatch).toHaveBeenLastCalledWith("/social/versions/x-1", { assetManifest: [expect.objectContaining({ fileId: "v1", kind: "video" })] });
  });

  it("duplicates a post with its text and media, and offers Try again after a failure", async () => {
    const image = { url: "/api/files/f1/content", fileId: "f1", kind: "image" as const, mimeType: "image/png", altText: "", assetIndex: 0 };
    const current = post([
      version({ id: "x-1", assetManifest: [image] }),
      version({ id: "li-1", platform: "linkedin", publicationStatus: "failed", failureClass: "rejected", errorMessage: "LinkedIn said no." }),
    ]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x"), account("linkedin")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPost.mockResolvedValue({ post: post([version({ id: "x-2" })], { id: "post-2" }) });
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    expect(wrapper.findAll("button").some((button) => button.text() === "Try again")).toBe(true);
    await wrapper.findAll("button").find((button) => button.text() === "Duplicate")!.trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/social/posts", expect.objectContaining({
      siteId: "site-1",
      sourceType: "pasted",
      versions: [
        expect.objectContaining({ platform: "x", bodyText: "Studio open day on Saturday.", assetManifest: [image] }),
        expect.objectContaining({ platform: "linkedin" }),
      ],
    }));
    expect(routerPush).toHaveBeenCalledWith("/social/post-2");
  });

  it("saves alt text to the same image on every draft platform", async () => {
    const image = { url: "/api/files/f1/content", fileId: "f1", kind: "image" as const, mimeType: "image/png", altText: "", assetIndex: 0 };
    const current = post([
      version({ id: "x-1", assetManifest: [image] }),
      version({ id: "li-1", platform: "linkedin", assetManifest: [image] }),
    ]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x"), account("linkedin")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((path: string, body: object) => Promise.resolve({ version: { ...current.versions.find((item) => path.endsWith(item.id)), ...body } }));
    const wrapper = mount(SocialPost, {
      global: {
        stubs: {
          ...stubs,
          SocialAltTextDialog: { name: "SocialAltTextDialog", props: ["open"], emits: ["save"], template: "<div v-if=\"open\" class=\"alt-stub\" />" },
        },
      },
    });
    await flushPromises();

    await wrapper.get('[aria-label="Add alt text to image 1"]').trigger("click");
    expect(wrapper.find(".alt-stub").exists()).toBe(true);
    wrapper.findComponent({ name: "SocialAltTextDialog" }).vm.$emit("save", "A green launch banner.");
    await flushPromises();

    for (const id of ["x-1", "li-1"]) {
      expect(apiPatch).toHaveBeenCalledWith(`/social/versions/${id}`, { assetManifest: [expect.objectContaining({ fileId: "f1", altText: "A green launch banner." })] });
    }
    expect(wrapper.get('[aria-label="Edit alt text for image 1"]').text()).toBe("ALT ✓");
  });

  it("adds a video to an Instagram carousel instead of replacing the photos", async () => {
    const photo = { url: "/api/files/p1/content", fileId: "p1", kind: "image" as const, mimeType: "image/jpeg", altText: "", assetIndex: 0 };
    const current = post([version({ id: "ig-1", platform: "instagram", assetManifest: [photo] })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("instagram")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((_path: string, body: object) => Promise.resolve({ version: { ...current.versions[0], ...body } }));
    uploadDriveFiles.mockResolvedValueOnce([{ id: "v1", filename: "clip.mov", mimeType: "video/quicktime", size: 99 }]);
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    const clip = new File(["x"], "clip.mov", { type: "video/quicktime" });
    await wrapper.get(".post-editor__main").trigger("drop", { dataTransfer: { types: ["Files"], files: [clip] } });
    await flushPromises();
    expect(apiPatch).toHaveBeenLastCalledWith("/social/versions/ig-1", {
      assetManifest: [expect.objectContaining({ fileId: "p1", assetIndex: 0 }), expect.objectContaining({ fileId: "v1", kind: "video", assetIndex: 1 })],
    });
    expect(wrapper.findAll("[data-tile]").map((tile) => tile.attributes("aria-label")?.split(".")[0])).toEqual(["Image 1 of 2", "Video 2 of 2"]);
  });

  it("turns long X text into a thread, or shortens it with an undo", async () => {
    const long = `${"We launched ME3 today. ".repeat(8).trim()} ${"It runs your site and email. ".repeat(4).trim()}`;
    let current = post([version({ id: "x-1", bodyText: long })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x")] },
      "/social/posts/post-1": { get post() { return current; } },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((_path: string, body: Record<string, unknown>) => {
      current = post([{ ...current.versions[0]!, ...body } as never]);
      return Promise.resolve({ version: current.versions[0] });
    });
    apiPost.mockResolvedValue({ text: "We launched ME3 today. Try it." });
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    const button = (label: string) => wrapper.findAll("button").find((item) => item.text() === label)!;
    await button("Turn into a thread").trigger("click");
    await flushPromises();
    const saved = apiPatch.mock.calls.at(-1)![1] as { bodyText: string; publishingSettings: unknown };
    expect(saved.publishingSettings).toEqual({ post: { thread: true } });
    expect(saved.bodyText.split("\n\n---\n\n").length).toBeGreaterThan(1);
    expect(wrapper.text()).toContain("Thread of");

    await button("Make it one post").trigger("click");
    await flushPromises();
    expect(apiPatch.mock.calls.at(-1)![1]).toMatchObject({ publishingSettings: {} });

    await button("Shorten for X").trigger("click");
    await flushPromises();
    expect(apiPost).toHaveBeenCalledWith("/social/shorten", { text: expect.any(String), limit: 280 });
    expect(apiPatch.mock.calls.at(-1)![1]).toEqual({ bodyText: "We launched ME3 today. Try it." });
    await button("Undo").trigger("click");
    await flushPromises();
    expect((apiPatch.mock.calls.at(-1)![1] as { bodyText: string }).bodyText.length).toBeGreaterThan(280);
  });

  it("moves the link into a first comment saved on the platform", async () => {
    const current = post([version({ id: "li-1", platform: "linkedin", bodyText: "Read about the launch https://me3.app/launch" })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("linkedin")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((_path: string, body: object) => Promise.resolve({ version: { ...current.versions[0], ...body } }));
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    await wrapper.findAll("button").find((item) => item.text() === "Move the link to the first comment")!.trigger("click");
    await flushPromises();
    expect(apiPatch).toHaveBeenLastCalledWith("/social/versions/li-1", {
      bodyText: "Read about the launch",
      publishingSettings: { post: { firstComment: "https://me3.app/launch" } },
    });
    expect((wrapper.get("#post-comment-li-1").element as HTMLTextAreaElement).value).toBe("https://me3.app/launch");
  });

  it("saves a platform's own handle for a mention and previews it", async () => {
    const current = post([version({ id: "x-1", bodyText: "Built with @ME3 today." })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("x")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((_path: string, body: object) => Promise.resolve({ version: { ...current.versions[0], ...body } }));
    const wrapper = mount(SocialPost, { global: { stubs } });
    await flushPromises();

    await wrapper.findAll("button").find((item) => item.text().startsWith("Mentions and hashtags"))!.trigger("click");
    await wrapper.get('[aria-label="@ME3 on X"]').setValue("@me3_app");
    await wrapper.get('[aria-label="@ME3 on X"]').trigger("change");
    await flushPromises();
    expect(apiPatch).toHaveBeenLastCalledWith("/social/versions/x-1", { publishingSettings: { post: { mentions: { "@ME3": "@me3_app" } } } });
    expect(wrapper.get(".preview__text").text()).toBe("Built with @me3_app today.");
  });

  it("saves a chosen cover frame on an Instagram video", async () => {
    const clip = { url: "/api/files/v1/content", fileId: "v1", kind: "video" as const, mimeType: "video/mp4", filename: "launch.mp4", altText: "", assetIndex: 0 };
    const current = post([version({ id: "ig-1", platform: "instagram", assetManifest: [clip] })]);
    serve({
      "/social/status": status("included"),
      "/social/accounts": { accounts: [account("instagram")] },
      "/social/posts/post-1": { post: current },
      "/social/posts": { posts: [] },
      "/sites": { sites: [{ id: "site-1", site_role: "profile" }] },
    });
    apiPatch.mockImplementation((_path: string, body: object) => Promise.resolve({ version: { ...current.versions[0], ...body } }));
    const wrapper = mount(SocialPost, {
      global: { stubs: { ...stubs, SocialVideoEditor: { name: "SocialVideoEditor", props: ["open", "coverFrame"], emits: ["save"], template: "<div v-if=\"open\" class=\"video-stub\" :data-cover=\"coverFrame\" />" } } },
    });
    await flushPromises();

    await wrapper.get('[aria-label="Edit video 1"]').trigger("click");
    expect(wrapper.get(".video-stub").attributes("data-cover")).toBe("true");
    wrapper.findComponent({ name: "SocialVideoEditor" }).vm.$emit("save", { file: null, range: null, coverTimeMs: 2500 });
    await flushPromises();
    expect(apiPatch).toHaveBeenLastCalledWith("/social/versions/ig-1", { assetManifest: [expect.objectContaining({ fileId: "v1", coverTimeMs: 2500 })] });
    expect(wrapper.find(".video-stub").exists()).toBe(false);
  });
});

