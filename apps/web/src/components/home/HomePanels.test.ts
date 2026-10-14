import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api";
import HomePanels from "./HomePanels.vue";

vi.mock("../../api", () => ({ API_BASE: "/api", ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } }, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock("../../composables/useAppToast", () => ({ useAppToast: () => ({ toastError: vi.fn(), toastFromUnknown: vi.fn(), toastSuccess: vi.fn() }) }));
enableAutoUnmount(afterEach);
const body = `First paragraph.\n${"The owner must see this complete text. ".repeat(30)}\nLast paragraph <img src=x onerror=alert(1)>`;
const core = { id: "approval-1", pluginId: "me3.core", title: "Send email", summary: "Review the launch email", payload: { recipient: "ada@example.test", subject: "Launch confirmation", body, target: { id: "draft-1", toAddress: "ada@example.test", subject: "Launch confirmation", bodyText: body } } };
let calendarUnavailable = false;
let pending: object[];
let people: object[] = [];
const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const contact = (id: string, name: string, extra: object = {}) => ({ id, name, status: "active", source: "manual", socialHandles: {}, metadata: null, isClose: true, closeness: "close", closeSince: daysAgo(100), isClient: false, lastInTouchAt: null, reminderAt: null, ...extra });
beforeEach(() => {
  setActivePinia(createPinia()); localStorage.clear(); vi.clearAllMocks(); calendarUnavailable = false; pending = [core]; people = [];
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  vi.mocked(api.get).mockImplementation(async endpoint => {
    if (endpoint.startsWith("/calendar/feed")) { if (calendarUnavailable) throw new ApiError("Calendar disabled", 403); return { events: [], sources: [] } as never; }
    if (endpoint.startsWith("/mission-control/approvals")) return { approvals: pending } as never;
    if (endpoint === "/sites") return { sites: [] } as never;
    if (endpoint === "/mailbox") return { mailbox: {} } as never;
    if (endpoint.startsWith("/mailbox/messages")) return { messages: [] } as never;
    if (endpoint === "/soulink/status") return { recentEvents: [] } as never;
    if (endpoint.startsWith("/mission-control/tasks")) return { tasks: [] } as never;
    if (endpoint.startsWith("/journal/archive")) return { entries: [] } as never;
    if (endpoint === "/mission-control/wheel") return { snapshots: [], settings: { segments: [] } } as never;
    if (endpoint === "/plugins") return { plugins: [] } as never;
    if (endpoint === "/contacts") return { contacts: people, summary: {} } as never;
    return {} as never;
  });
  vi.mocked(api.post).mockImplementation(async endpoint => { if (endpoint.includes("/approvals/")) pending = []; return { ok: true } as never; });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });
function render(props: { active?: boolean } = {}) { return mount(HomePanels, { props, attachTo: document.body, global: { stubs: { RouterLink: { template: "<a><slot /></a>" }, UiIcon: true } } }); }
function button(text: string) { return [...document.body.querySelectorAll("button")].find(node => node.textContent?.trim() === text); }

describe("Home Core approval review", () => {
  // The hidden Home stays mounted while Chat runs. Its initial empty list must
  // not hide a later durable approval, retain a resolved one, or win a read race.
  it("discovers a newly pending approval when returning from Chat to Home", async () => {
    pending = []; const wrapper = render({ active: false }); await flushPromises();
    expect(button("Review")).toBeUndefined();
    pending = [core]; await wrapper.setProps({ active: true }); await flushPromises();
    expect(button("Review")).toBeTruthy(); button("Review")!.click(); await flushPromises();
    expect(document.body.querySelector("dialog[open]")?.textContent).toContain(body);
    expect(api.post).not.toHaveBeenCalled();
  });
  it("refreshes pending and resolved approvals after a terminal Chat result", async () => {
    pending = []; const wrapper = render({ active: false }); await flushPromises();
    const home = wrapper.vm as unknown as { refreshToday: () => Promise<void> };
    pending = [core]; await home.refreshToday(); await flushPromises();
    expect(button("Review")).toBeTruthy();
    pending = []; await home.refreshToday(); await flushPromises();
    expect(button("Review")).toBeUndefined(); expect(api.post).not.toHaveBeenCalled();
  });
  it("does not restore an approval from a delayed older refresh", async () => {
    pending = []; const wrapper = render({ active: false }); await flushPromises();
    const home = wrapper.vm as unknown as { refreshToday: () => Promise<void> };
    const originalGet = vi.mocked(api.get).getMockImplementation()!;
    let finishOld!: (value: unknown) => void; let reads = 0;
    vi.mocked(api.get).mockImplementation(endpoint => {
      if (endpoint.startsWith("/mission-control/approvals") && reads++ === 0) {
        return new Promise(resolve => { finishOld = resolve; }) as never;
      }
      return originalGet(endpoint);
    });
    const older = home.refreshToday(); await flushPromises();
    await home.refreshToday(); finishOld({ approvals: [core] }); await older; await flushPromises();
    expect(button("Review")).toBeUndefined(); expect(api.post).not.toHaveBeenCalled();
  });
  it("shows the complete escaped email before making an approval decision", async () => {
    render(); await flushPromises();
    expect(button("Review")).toBeTruthy(); button("Review")!.click(); await flushPromises();
    const dialog = document.body.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("ada@example.test"); expect(dialog.textContent).toContain("Launch confirmation"); expect(dialog.textContent).toContain(body);
    expect(dialog.querySelector("img")).toBeNull(); expect(api.post).not.toHaveBeenCalled();
    button("Approve")!.click(); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/assistant/approvals/approval-1", { decision: "approved" });
    expect(button("Review")).toBeUndefined();
  });
  it("keeps Core approval review available when the calendar plugin returns 403", async () => {
    calendarUnavailable = true; render(); await flushPromises();
    expect(button("Review")).toBeTruthy(); button("Review")!.click(); await flushPromises();
    button("Decline")!.click(); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/assistant/approvals/approval-1", { decision: "declined" });
  });
  it("preserves existing plugin confirmation and rescheduling actions", async () => {
    pending = [{ id: "plugin-1", pluginId: "me3.mission-control", title: "Meeting request", summary: "Tomorrow" }];
    render(); await flushPromises(); expect(button("Another time")).toBeTruthy();
    button("Confirm")!.click(); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/mission-control/approvals/plugin-1", { decision: "approved" });
  });
});

describe("Home People card", () => {
  const card = () => document.body.querySelector('[aria-label="People"]');
  it("is hidden until someone is Close", async () => {
    people = [contact("c-1", "Brian Lynch", { isClose: false, closeness: null, lastInTouchAt: daysAgo(60) })];
    render(); await flushPromises();
    expect(card()).toBeNull();
  });
  it("lists up to three Close people with time since last in touch and opens the person sheet", async () => {
    people = [
      contact("c-erum", "Erum Shah", { lastInTouchAt: daysAgo(42) }),
      contact("c-dad", "Dad", { lastInTouchAt: daysAgo(12) }),
      contact("c-mam", "Mam", { lastInTouchAt: daysAgo(2) }),
      contact("c-dara", "Dara Kelly", { lastInTouchAt: null }),
      contact("c-sis", "Saoirse Lynch", { lastInTouchAt: daysAgo(20) }),
    ];
    render(); await flushPromises();
    const rows = [...card()!.querySelectorAll(".home-person")].map(row => row.textContent?.replace(/\s+/g, " ").trim());
    expect(rows).toEqual(["DKDaraNot yet", "ESErum6w ago", "SLSaoirse2w ago"]);
    (card()!.querySelector(".home-person") as HTMLButtonElement).click(); await flushPromises();
    expect(document.body.querySelector(".person-sheet")?.textContent).toContain("Dara Kelly");
  });
  it("says all caught up when every Close person was in touch this week", async () => {
    people = [contact("c-mam", "Mam", { lastInTouchAt: daysAgo(2) })];
    render(); await flushPromises();
    expect(card()?.textContent).toContain("All caught up.");
  });
});

describe("Home Gratitude card", () => {
  it("keeps the reorder and options controls so the card can be moved or removed", async () => {
    render(); await flushPromises();
    const card = document.body.querySelector('[aria-label="Gratitude"]')!;
    expect(card.querySelector('[aria-label="Drag Gratitude to reorder"]')).toBeTruthy();
    (card.querySelector('[aria-label="Gratitude options"]') as HTMLButtonElement).click(); await flushPromises();
    expect(button("Remove from Home")).toBeTruthy();
    button("Remove from Home")!.click(); await flushPromises();
    expect(document.body.querySelector('[aria-label="Gratitude"]')).toBeNull();
  });
});
