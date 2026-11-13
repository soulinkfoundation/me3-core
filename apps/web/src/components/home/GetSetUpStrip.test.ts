import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { TOUR_VIDEO } from "../../utils/tourVideo";
import GetSetUpStrip from "./GetSetUpStrip.vue";

vi.mock("../../api", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../utils/firstSite", () => ({ loadProfileSite: vi.fn(async () => ({ bio: "Sports massage." })) }));
enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear();
  TOUR_VIDEO.desktop = ""; TOUR_VIDEO.mobile = "";
  vi.mocked(api.get).mockImplementation(async url => (url === "/mission-control/dashboard" ? { settings: { setupChecklistDismissed: false } } : { connection: null }) as never);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

async function render() {
  const wrapper = mount(GetSetUpStrip, { props: { inboxCount: 0, agentAddress: "ada@me3.app" }, attachTo: document.body, global: { stubs: { UiIcon: true } } });
  await flushPromises();
  return wrapper;
}
const chips = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.findAll(".setup-strip__chip").map(chip => chip.text());

// Failure modes: an empty tour shipped before the video exists, the email hint keyed to a position,
// ticking from opening rather than watching, the tick lost on the next visit.
describe("Get set up tour", () => {
  it("hides the tour until a video is set, and keeps the email hint", async () => {
    const wrapper = await render();
    expect(chips(wrapper)).toEqual(["Website", "Email ME3", "Mission", "Soulink"]);
    expect(wrapper.text()).toContain("ada@me3.app");
  });

  it("leads with the tour, ticks it only once most of the video has played, and remembers it", async () => {
    TOUR_VIDEO.desktop = "https://example.test/tour.mp4";
    const wrapper = await render();
    expect(chips(wrapper)).toEqual(["Watch the 3-min tour", "Website", "Email ME3", "Mission", "Soulink"]);
    expect(wrapper.text()).toContain("ada@me3.app");

    await wrapper.findAll(".setup-strip__chip")[0].trigger("click");
    const video = document.querySelector<HTMLVideoElement>("[data-testid=tour-video] video")!;
    expect(video.getAttribute("src")).toBe("https://example.test/tour.mp4");
    Object.defineProperty(video, "duration", { value: 180, configurable: true });
    video.currentTime = 60; video.dispatchEvent(new Event("timeupdate")); await flushPromises();
    expect(wrapper.findAll(".setup-strip__chip")[0].classes()).not.toContain("is-done");
    video.currentTime = 150; video.dispatchEvent(new Event("timeupdate")); await flushPromises();
    expect(wrapper.findAll(".setup-strip__chip")[0].classes()).toContain("is-done");

    wrapper.unmount();
    const again = await render();
    expect(again.findAll(".setup-strip__chip")[0].classes()).toContain("is-done");
  });
});
