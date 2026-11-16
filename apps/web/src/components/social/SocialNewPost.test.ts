import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { account, capabilities, post, version } from "../../utils/social-posts.fixtures";
import type { SocialAccountRow } from "../../stores/social";

const apiPost = vi.fn();
const apiPatch = vi.fn();
const routerPush = vi.fn();
const toast = vi.fn();

vi.mock("vue-router", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("../../api", () => ({
  API_BASE: "/api",
  ApiError: class extends Error {},
  api: { get: vi.fn(), post: (...args: unknown[]) => apiPost(...args), patch: (...args: unknown[]) => apiPatch(...args), delete: vi.fn() },
}));
const uploadDriveFiles = vi.fn();
vi.mock("../../utils/drive-upload", () => ({ uploadDriveFiles: (...args: unknown[]) => uploadDriveFiles(...args) }));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastError: vi.fn(), toastSuccess: vi.fn(), toastFromUnknown: vi.fn(), toast }),
}));

import SocialNewPost from "./SocialNewPost.vue";

const stubs = { AppDialog: { props: ["open"], template: "<div v-if=\"open\"><slot /></div>" }, FilesMediaPicker: true };
const connected = ["x", "linkedin", "instagram", "facebook", "youtube", "tiktok"].map((platform) => account(platform));

function open(accounts: SocialAccountRow[] = connected) {
  return mount(SocialNewPost, { props: { open: true, accounts, capabilities, siteId: "site-1" }, global: { stubs } });
}

function rows(wrapper: ReturnType<typeof open>) {
  return wrapper.findAll(".new-post__row").map((row) => ({
    name: row.find(".new-post__who .visually-hidden").text(),
    ticked: (row.find("input").element as HTMLInputElement).checked,
    cant: row.classes("is-cant"),
    says: row.find(".new-post__says").text(),
  }));
}

function pick(wrapper: ReturnType<typeof open>, input: number, files: File[]) {
  const element = wrapper.findAll("input[type=file]")[input]!.element as HTMLInputElement;
  Object.defineProperty(element, "files", { value: files, configurable: true });
  return wrapper.findAll("input[type=file]")[input]!.trigger("change");
}

describe("New post", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("asks what you want to post, naming the accounts each option reaches", () => {
    const wrapper = open();
    expect(wrapper.find("h2").text()).toBe("What do you want to post?");
    expect(wrapper.findAll(".new-post__option").map((option) => option.attributes("aria-label"))).toEqual([
      "Text only. Reaches X, LinkedIn and Facebook.",
      "Images. Reaches X, LinkedIn, Instagram and Facebook.",
      "Video. Reaches X, LinkedIn, Instagram, YouTube and TikTok.",
    ]);
  });

  it("ticks the accounts that can take text and gives the others their reason", async () => {
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[0]!.trigger("click");
    expect(rows(wrapper)).toEqual([
      { name: "X, mayastudio", ticked: true, cant: false, says: "Text post" },
      { name: "LinkedIn, mayastudio", ticked: true, cant: false, says: "Text post" },
      { name: "Instagram, mayastudio", ticked: false, cant: true, says: "Needs an image or video" },
      { name: "Facebook, mayastudio", ticked: true, cant: false, says: "Post on your Page" },
      { name: "YouTube, mayastudio", ticked: false, cant: true, says: "Video only" },
      { name: "TikTok, mayastudio", ticked: false, cant: true, says: "Video only" },
    ]);
    // A row that can't take the post stays focusable, but its tick doesn't change.
    await wrapper.findAll(".new-post__row input")[2]!.trigger("click");
    expect(rows(wrapper)[2]!.ticked).toBe(false);
    expect(wrapper.find("button[type=submit]").text()).toBe("Review 3 posts");
  });

  it("says what each account gets from six images, and keeps hand-changed ticks across a switch", async () => {
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[1]!.trigger("click");
    await pick(wrapper, 0, Array.from({ length: 6 }, (_, index) => new File(["x"], `p${index}.jpg`, { type: "image/jpeg" })));
    expect(rows(wrapper).map((row) => row.says)).toEqual(["First 4 of 6 images", "6 images", "Carousel of 6", "6 images", "Video only", "Video only"]);
    await wrapper.findAll(".new-post__row input")[1]!.trigger("click");
    expect(rows(wrapper)[1]!.ticked).toBe(false);

    await wrapper.findAll(".new-post__switch button")[0]!.trigger("click");
    expect(toast).toHaveBeenCalledWith("Removed 6 items.", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
    expect(rows(wrapper)[1]!.ticked).toBe(false);
    toast.mock.calls[0]![1].action.onClick();
    await flushPromises();
    expect(wrapper.findAll(".new-post__media li")).toHaveLength(6);
    expect(wrapper.findAll(".new-post__switch button")[1]!.attributes("aria-pressed")).toBe("true");
  });

  it("lets images lead when they came first, with a swap on X", async () => {
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[1]!.trigger("click");
    await pick(wrapper, 0, [new File(["x"], "a.jpg", { type: "image/jpeg" }), new File(["x"], "b.jpg", { type: "image/jpeg" })]);
    await pick(wrapper, 1, [new File(["x"], "clip.mp4", { type: "video/mp4" })]);
    expect(rows(wrapper).map((row) => [row.says, row.ticked])).toEqual([
      ["2 images, not the video", true],
      ["2 images, not the video", true],
      ["Carousel: 2 images and the video", true],
      ["2 images", true],
      ["Would get just the video", false],
      ["Would get just the video", false],
    ]);
    await wrapper.findAll(".new-post__row")[0]!.find(".new-post__action").trigger("click");
    expect(rows(wrapper)[0]!.says).toBe("The video, not the images");
  });

  it("tells two accounts on one platform apart and ticks only one of them", async () => {
    const second = { ...account("x"), id: "account-x-2", handle: "mayaworks", displayName: "Maya Works" };
    const wrapper = open([account("x"), second, account("linkedin")]);
    await wrapper.findAll(".new-post__option")[0]!.trigger("click");
    expect(wrapper.findAll(".new-post__name").map((name) => name.text())).toEqual(["@mayastudio", "@mayaworks"]);
    expect(rows(wrapper).map((row) => row.ticked)).toEqual([true, false, true]);
    await wrapper.findAll(".new-post__row input")[1]!.trigger("click");
    expect(rows(wrapper).map((row) => row.ticked)).toEqual([false, true, true]);
  });

  it("names the tightest caption limit and never blocks going over it", async () => {
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[0]!.trigger("click");
    await wrapper.find("textarea").setValue("a".repeat(67));
    expect(wrapper.find(".new-post__count").text()).toBe("213 left for X");
    await wrapper.find("textarea").setValue("a".repeat(300));
    expect(wrapper.find(".new-post__count").text()).toBe("20 over for X. The X version will need a thread or shortening on the next screen.");
    expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
  });

  it("creates one version per ticked account with what its row said", async () => {
    apiPost.mockResolvedValue({ post: post([version({ id: "vx", platform: "x" }), version({ id: "vi", platform: "instagram" })], { id: "post-1" }) });
    apiPatch.mockResolvedValue({ version: version() });
    uploadDriveFiles.mockImplementation(async ([file]: File[]) => [{ id: `file-${file.name}`, filename: file.name, mimeType: file.type, size: 1 }]);
    const wrapper = open([account("x"), account("instagram")]);
    await wrapper.findAll(".new-post__option")[1]!.trigger("click");
    await pick(wrapper, 0, Array.from({ length: 5 }, (_, index) => new File(["x"], `p${index}.jpg`, { type: "image/jpeg" })));
    await wrapper.find("textarea").setValue("Market day.");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(apiPost).toHaveBeenCalledWith("/social/posts", expect.objectContaining({
      versions: [
        { platform: "x", targetAccountId: "account-x", bodyText: "Market day." },
        { platform: "instagram", targetAccountId: "account-instagram", bodyText: "Market day." },
      ],
    }));
    const manifests = apiPatch.mock.calls.map(([, body]) => (body as { assetManifest: Array<{ filename: string }> }).assetManifest.map((asset) => asset.filename));
    expect(manifests).toEqual([["p0.jpg", "p1.jpg", "p2.jpg", "p3.jpg"], ["p0.jpg", "p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg"]]);
    expect(routerPush).toHaveBeenCalledWith("/social/post-1");
  });

  it("lists only connected accounts and offers to connect another", async () => {
    const wrapper = open([account("x"), account("tiktok", "revoked")]);
    await wrapper.findAll(".new-post__option")[2]!.trigger("click");
    expect(rows(wrapper).map((row) => row.name)).toEqual(["X, mayastudio"]);
    await wrapper.find(".new-post__quiet").trigger("click");
    expect(wrapper.emitted("connect")).toHaveLength(1);
  });
});
