import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { account, capabilities, post, version } from "../../utils/social-posts.fixtures";
import type { SocialAccountRow } from "../../stores/social";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const routerPush = vi.fn();
const toast = vi.fn();

vi.mock("vue-router", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("../../api", () => ({
  API_BASE: "/api",
  ApiError: class extends Error {},
  api: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args), patch: (...args: unknown[]) => apiPatch(...args), delete: vi.fn() },
}));
const uploadDriveFiles = vi.fn();
vi.mock("../../utils/drive-upload", () => ({ uploadDriveFiles: (...args: unknown[]) => uploadDriveFiles(...args) }));
const readVideoInfo = vi.fn();
vi.mock("../../utils/video-info", () => ({ readVideoInfo: (...args: unknown[]) => readVideoInfo(...args) }));
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
  return wrapper.findAll(".new-post__account").map((row) => ({
    name: row.attributes("aria-label"),
    ticked: row.attributes("aria-pressed") === "true",
    cant: row.classes("is-cant"),
    says: row.attributes("data-tip"),
  }));
}

/** Chooses accounts by their place in the row. */
async function choose(wrapper: ReturnType<typeof open>, ...indexes: number[]) {
  for (const index of indexes) await wrapper.findAll(".new-post__account")[index]!.trigger("click");
}

function note(wrapper: ReturnType<typeof open>, network: string) {
  return wrapper.findAll(".new-post__notes li").find((item) => item.find(".new-post__note-who").text() === network)!;
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
    apiGet.mockRejectedValue(new Error("offline"));
    readVideoInfo.mockResolvedValue({ durationSeconds: null, width: null, height: null });
  });

  it("asks what you want to post, naming the accounts each option reaches", () => {
    const wrapper = open();
    expect(wrapper.find("h2").text()).toBe("What do you want to post?");
    expect(wrapper.findAll(".new-post__option").map((option) => option.attributes("aria-label"))).toEqual([
      "Text only. Reaches X, LinkedIn and Facebook.",
      "Images. Reaches X, LinkedIn, Instagram and Facebook.",
      "Video. Reaches X, LinkedIn, Instagram, Facebook, YouTube and TikTok.",
    ]);
  });

  it("goes straight to writing without opening a file picker", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[1]!.trigger("click");
    await wrapper.findAll(".new-post__switch button")[2]!.trigger("click");
    expect(click).not.toHaveBeenCalled();
    expect(wrapper.findAll(".new-post__attach").map((button) => button.text())).toEqual(["Add a video", "Add images", "From Files"]);
    click.mockRestore();
  });

  it("chooses nothing for the owner and gives each account what it gets, or why not", async () => {
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[0]!.trigger("click");
    expect(rows(wrapper)).toEqual([
      { name: "X, mayastudio", ticked: false, cant: false, says: "Text post" },
      { name: "LinkedIn, mayastudio", ticked: false, cant: false, says: "Text post" },
      { name: "Instagram, mayastudio", ticked: false, cant: true, says: "Needs an image or video" },
      { name: "Facebook, mayastudio", ticked: false, cant: false, says: "Post on your Page" },
      { name: "YouTube, mayastudio", ticked: false, cant: true, says: "Video only" },
      { name: "TikTok, mayastudio", ticked: false, cant: true, says: "Video only" },
    ]);
    expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeDefined();
    await choose(wrapper, 0, 1, 3);
    // An account that can't take the post stays unchosen when tapped.
    await choose(wrapper, 2);
    expect(rows(wrapper).map((row) => row.ticked)).toEqual([true, true, false, true, false, false]);
    expect(wrapper.find("button[type=submit]").text()).toBe("Review 3 posts");
    // Everything that can be connected is, so there's no link to connect another.
    expect(wrapper.find(".new-post__quiet").exists()).toBe(false);
  });

  it("says what each account gets from six images, and keeps hand-changed ticks across a switch", async () => {
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[1]!.trigger("click");
    await pick(wrapper, 0, Array.from({ length: 6 }, (_, index) => new File(["x"], `p${index}.jpg`, { type: "image/jpeg" })));
    expect(rows(wrapper).map((row) => row.says)).toEqual(["First 4 of 6 images", "6 images", "Carousel of 6", "6 images", "Video only", "Video only"]);
    await choose(wrapper, 0, 1);
    await choose(wrapper, 1);
    expect(rows(wrapper).map((row) => row.ticked).slice(0, 2)).toEqual([true, false]);

    await wrapper.findAll(".new-post__switch button")[0]!.trigger("click");
    expect(toast).toHaveBeenCalledWith("Removed 6 items.", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
    expect(rows(wrapper).map((row) => row.ticked).slice(0, 2)).toEqual([true, false]);
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
    expect(rows(wrapper).map((row) => [row.says, row.cant])).toEqual([
      ["2 images, not the video", false],
      ["2 images, not the video", false],
      ["Carousel: 2 images and the video", false],
      ["2 images", false],
      ["Would get just the video", false],
      ["Would get just the video", false],
    ]);
    await note(wrapper, "X").find(".new-post__action").trigger("click");
    expect(rows(wrapper)[0]!.says).toBe("The video, not the images");
  });

  it("tells two accounts on one platform apart and ticks only one of them", async () => {
    const second = { ...account("x"), id: "account-x-2", handle: "mayaworks", displayName: "Maya Works" };
    const wrapper = open([account("x"), second, account("linkedin")]);
    await wrapper.findAll(".new-post__option")[0]!.trigger("click");
    expect(wrapper.findAll(".new-post__name").map((name) => name.text())).toEqual(["@mayastudio", "@mayaworks"]);
    await choose(wrapper, 0, 2);
    expect(rows(wrapper).map((row) => row.ticked)).toEqual([true, false, true]);
    await choose(wrapper, 1);
    expect(rows(wrapper).map((row) => row.ticked)).toEqual([false, true, true]);
  });

  it("names the tightest caption limit and never blocks going over it", async () => {
    const wrapper = open();
    await wrapper.findAll(".new-post__option")[0]!.trigger("click");
    await choose(wrapper, 0, 1, 3);
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
    await choose(wrapper, 0, 1);
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

  describe("a video's length and shape (me3-ic0c)", () => {
    const vertical = (durationSeconds: number) => ({ durationSeconds, width: 1080, height: 1920 });
    const clip = (name = "clip.mp4") => new File(["x"], name, { type: "video/mp4" });
    let objectUrls = 0;
    beforeEach(() => {
      objectUrls = 0;
      URL.createObjectURL = vi.fn(() => `blob:${objectUrls++}`);
    });

    it("dims an account the video is too long for and offers a shorter cut for that account only", async () => {
      readVideoInfo.mockImplementation(async (src: string) => (src === "blob:0" ? vertical(1260) : vertical(95)));
      apiPost.mockResolvedValue({ post: post([version({ id: "vx", platform: "x" }), version({ id: "vl", platform: "linkedin" })], { id: "post-2" }) });
      apiPatch.mockResolvedValue({ version: version() });
      uploadDriveFiles.mockImplementation(async ([file]: File[]) => [{ id: `file-${file.name}`, filename: file.name, mimeType: file.type, size: 1 }]);
      const wrapper = open([account("x"), account("linkedin"), account("youtube")]);
      await wrapper.findAll(".new-post__option")[2]!.trigger("click");
      await pick(wrapper, 1, [clip("long.mp4")]);
      await flushPromises();
      await choose(wrapper, 0, 1, 2);
      expect(rows(wrapper)).toEqual([
        { name: "X, mayastudio", ticked: false, cant: true, says: "Too long: X takes up to 20:00" },
        { name: "LinkedIn, mayastudio", ticked: true, cant: false, says: "Video" },
        { name: "YouTube, mayastudio", ticked: true, cant: false, says: "Regular video" },
      ]);
      const action = note(wrapper, "X").find(".new-post__action");
      expect(action.text()).toBe("Pick a shorter cut for X, mayastudio");
      await action.trigger("click");
      await pick(wrapper, 2, [clip("short.mp4")]);
      await flushPromises();
      expect(rows(wrapper)[0]).toEqual({ name: "X, mayastudio", ticked: true, cant: false, says: "Video" });
      expect(wrapper.find(".new-post__cut").text()).toContain("Its own cut: short.mp4");

      await wrapper.find("textarea").setValue("Workshop.");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      const sent = Object.fromEntries(apiPatch.mock.calls.map(([path, body]) => [path, (body as { assetManifest: Array<{ filename: string }> }).assetManifest[0]!.filename]));
      expect(Object.values(sent).sort()).toEqual(["long.mp4", "short.mp4"]);
    });

    it("uses each TikTok account's own limit once it loads, and claims nothing before", async () => {
      let answer: (value: unknown) => void = () => {};
      apiGet.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      readVideoInfo.mockResolvedValue(vertical(720));
      const wrapper = open([account("tiktok")]);
      await wrapper.findAll(".new-post__option")[2]!.trigger("click");
      await pick(wrapper, 1, [clip()]);
      await flushPromises();
      await choose(wrapper, 0);
      expect(rows(wrapper)[0]).toMatchObject({ ticked: true, says: "Video. You choose who sees it on the next screen." });
      answer({ creatorInfo: { maxVideoPostDurationSeconds: 600 } });
      await flushPromises();
      expect(rows(wrapper)[0]).toMatchObject({ ticked: false, cant: true, says: "Too long: TikTok takes up to 10:00 on this account" });
    });

    it("hints at a vertical video for Reels without blocking, and claims nothing when metadata can't be read", async () => {
      readVideoInfo.mockResolvedValueOnce({ durationSeconds: 48, width: 1920, height: 1080 });
      const wrapper = open([account("instagram"), account("x")]);
      await wrapper.findAll(".new-post__option")[2]!.trigger("click");
      await pick(wrapper, 1, [clip()]);
      await flushPromises();
      await choose(wrapper, 0, 1);
      expect(rows(wrapper)[1]).toMatchObject({ ticked: true, says: "Reel. Reels show best vertical (9:16)." });

      readVideoInfo.mockResolvedValueOnce({ durationSeconds: null, width: null, height: null });
      await pick(wrapper, 1, [clip("odd.mkv")]);
      await flushPromises();
      expect(rows(wrapper).map((row) => [row.ticked, row.says])).toEqual([[true, "Video"], [true, "Reel"]]);
    });

    it("asks for a verified YouTube channel before a video over 15 minutes (me3-8l29)", async () => {
      readVideoInfo.mockResolvedValue(vertical(960));
      const wrapper = open([{ ...account("youtube"), youtubeLongUploads: "eligible" }, account("linkedin")]);
      await wrapper.findAll(".new-post__option")[2]!.trigger("click");
      await pick(wrapper, 1, [clip()]);
      await flushPromises();
      expect(rows(wrapper)[1]).toEqual({ name: "YouTube, mayastudio", ticked: false, cant: true, says: "Verify your channel in YouTube to post videos over 15 minutes" });
      const link = note(wrapper, "YouTube").find("a.new-post__action");
      expect(link.attributes("href")).toBe("https://www.youtube.com/verify");
      expect(link.attributes("target")).toBe("_blank");
    });
  });
});
