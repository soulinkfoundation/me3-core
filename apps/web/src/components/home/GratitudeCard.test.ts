import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import GratitudeCard from "./GratitudeCard.vue";

vi.mock("../../api", () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../../composables/useAppToast", () => ({ useAppToast: () => ({ toastFromUnknown: vi.fn() }) }));
enableAutoUnmount(afterEach);
const quote = { id: "q216", text: "Very little is needed to make a happy life.", author: "Marcus Aurelius", source: "Meditations", savedAt: null };
function state() { return { date: "2026-10-13", timezone: "Europe/Dublin", quote, gratitude: ["", "", ""], goodThings: ["", "", ""], days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${7 + i}`, written: i === 1 })), settings: { quoteInBriefing: true, eveningReminder: false } }; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T15:59:00Z")); vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async url => (url === "/quotes/mine" ? { quotes: [] } : state()) as never);
  vi.mocked(api.patch).mockResolvedValue({ ok: true } as never);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; });
function render() { return mount(GratitudeCard, { attachTo: document.body, global: { stubs: { UiIcon: true } } }); }

// Failure modes: switch at UTC time, loss of morning lines at 17:00, whitespace
// ticks, streak copy, losing an edit during save, silent failure, sheet inaccessible.
describe("Gratitude card", () => {
  it("switches at 17:00 in the owner's timezone and keeps both sets of inputs", async () => {
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain("🌅"); expect(wrapper.text()).toContain("Gratitude");
    expect(wrapper.find(".gratitude-quote").text()).toContain("— Marcus Aurelius");
    expect(wrapper.findAll("input")).toHaveLength(3);
    await wrapper.findAll("input")[0].setValue("Tea");
    await vi.advanceTimersByTimeAsync(60_000); await flushPromises();
    expect(wrapper.text()).toContain("🌙"); expect(wrapper.text()).toContain("Three good things");
    expect(wrapper.find(".gratitude-quote").exists()).toBe(false);
    expect(wrapper.findAll("input")[0].element.value).toBe("");
    expect(api.patch).toHaveBeenCalledWith("/gratitude/lines", { date: "2026-10-13", gratitude: ["Tea", "", ""] });
    expect(wrapper.findAll("input").some(i => i.attributes("placeholder"))).toBe(false);
  });

  it("shows seven grey days with an outlined today; either list counts, whitespace doesn't", async () => {
    const wrapper = render(); await flushPromises();
    expect(wrapper.findAll(".gratitude-day")).toHaveLength(7);
    expect(wrapper.findAll(".gratitude-day.is-written")).toHaveLength(1);
    expect(wrapper.find(".gratitude-day.is-today").attributes("aria-label")).toContain("Nothing written");
    await wrapper.find("input").setValue("  ");
    expect(wrapper.find(".gratitude-day.is-today").classes()).not.toContain("is-written");
    await wrapper.find("input").setValue("A walk");
    expect(wrapper.find(".gratitude-day.is-today").classes()).toContain("is-written");
    expect(wrapper.text()).not.toMatch(/streak|mic|hard day/i);
  });

  it("opens the quote sheet with Another, Save, My quotes and both persisted switches", async () => {
    const wrapper = render(); await flushPromises(); await wrapper.find(".gratitude-quote").trigger("click"); await flushPromises();
    const sheet = document.body.querySelector("dialog[open]")!;
    expect(sheet.textContent).toContain("Today's quote"); expect(sheet.textContent).toContain("Another"); expect(sheet.textContent).toContain("My quotes");
    const switches = sheet.querySelectorAll<HTMLButtonElement>("[role=switch]");
    expect(switches[0].getAttribute("aria-checked")).toBe("true"); expect(switches[1].getAttribute("aria-checked")).toBe("false");
    switches[1].click(); await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/gratitude/settings", { eveningReminder: true });
  });
});
