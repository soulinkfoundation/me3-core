import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api";
import HomePanels from "./HomePanels.vue";

vi.mock("../../api", () => ({ API_BASE: "/api", ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } }, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(async () => ({})) } }));
vi.mock("../../composables/useAppToast", () => ({ useAppToast: () => ({ toastError: vi.fn(), toastFromUnknown: vi.fn(), toastSuccess: vi.fn() }) }));
enableAutoUnmount(afterEach);
const body = `First paragraph.\n${"The owner must see this complete text. ".repeat(30)}\nLast paragraph <img src=x onerror=alert(1)>`;
const core = { id: "approval-1", pluginId: "me3.core", title: "Send email", summary: "Review the launch email", payload: { recipient: "ada@example.test", subject: "Launch confirmation", body, target: { id: "draft-1", toAddress: "ada@example.test", subject: "Launch confirmation", bodyText: body } } };
let calendarUnavailable = false;
let pending: object[];
let people: object[] = [];
let tasks: object[] = [];
let goals: object[] = [];
let gratitudeInToday = false;
const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const contact = (id: string, name: string, extra: object = {}) => ({ id, name, status: "active", source: "manual", socialHandles: {}, metadata: null, isClose: true, closeness: "close", closeSince: daysAgo(100), isClient: false, lastInTouchAt: null, reminderAt: null, ...extra });
beforeEach(() => {
  setActivePinia(createPinia()); localStorage.clear(); vi.clearAllMocks(); calendarUnavailable = false; pending = [core]; people = []; tasks = []; goals = []; gratitudeInToday = false;
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  vi.mocked(api.get).mockImplementation(async endpoint => {
    if (endpoint.startsWith("/calendar/feed")) { if (calendarUnavailable) throw new ApiError("Calendar disabled", 403); return { events: [], sources: [] } as never; }
    if (endpoint.startsWith("/mission-control/approvals")) return { approvals: pending } as never;
    if (endpoint === "/sites") return { sites: [] } as never;
    if (endpoint === "/mailbox") return { mailbox: {} } as never;
    if (endpoint.startsWith("/mailbox/messages")) return { messages: [] } as never;
    if (endpoint === "/soulink/status") return { recentEvents: [] } as never;
    if (endpoint.startsWith("/mission-control/tasks")) return { tasks } as never;
    if (endpoint === "/tasks/goals") return { goals } as never;
    if (endpoint === "/gratitude") return { date: "2026-10-14", timezone: "UTC", quote: null, gratitude: [], goodThings: [], days: [], settings: { quoteInBriefing: true, eveningReminder: false, inToday: gratitudeInToday } } as never;
    if (endpoint.startsWith("/journal/archive")) return { entries: [] } as never;
    if (endpoint === "/mission-control/wheel") return { snapshots: [], settings: { segments: [] } } as never;
    if (endpoint === "/plugins") return { plugins: [] } as never;
    if (endpoint === "/contacts") return { contacts: people, summary: {} } as never;
    return {} as never;
  });
  vi.mocked(api.post).mockImplementation(async (endpoint, payload) => {
    if (endpoint.includes("/approvals/")) pending = [];
    if (endpoint === "/mission-control/tasks") return { task: { id: "new", status: "in_progress", ...(payload as object) } } as never;
    return { ok: true } as never;
  });
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
  // Failure modes: two actions per row again, dismiss hitting the wrong approval store.
  it("gives each approval one action and a dismiss icon", async () => {
    pending = [{ id: "plugin-1", pluginId: "me3.mission-control", title: "Meeting request", summary: "Tomorrow" }, core];
    render(); await flushPromises();
    expect(button("Another time")).toBeUndefined();
    button("Confirm")!.click(); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/mission-control/approvals/plugin-1", { decision: "approved" });
    (document.body.querySelector('[aria-label="Dismiss Send email"]') as HTMLButtonElement).click(); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/assistant/approvals/approval-1", { decision: "declined" });
  });
  it("dismisses a plugin approval through Mission Control", async () => {
    pending = [{ id: "plugin-1", pluginId: "me3.mission-control", title: "Meeting request" }];
    render(); await flushPromises();
    (document.body.querySelector('[aria-label="Dismiss Meeting request"]') as HTMLButtonElement).click(); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/mission-control/approvals/plugin-1", { decision: "declined" });
    expect(document.body.textContent).not.toContain("Meeting request");
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

describe("Home Today card", () => {
  const today = () => document.body.querySelector('article[aria-label="Today"]')!;
  const gratitude = () => today().querySelector('[aria-label="Gratitude"], [aria-label="Three good things"]');
  const feed = (events: object[], sources: object[] = [{ id: "google" }]) => vi.mocked(api.get).mockImplementation((original => async (endpoint: string) => endpoint.startsWith("/calendar/feed") ? { events, sources } as never : original(endpoint))(vi.mocked(api.get).getMockImplementation()!));
  // Failure modes: tasks, notes or the focus goal creeping back into Today; the tasks line
  // miscounting or not opening the journal; the title not opening the calendar on today.
  it("is the calendar at a glance, with one line into today's page for tasks", async () => {
    goals = [{ id: "ship", title: "Ship People v1", status: "active" }];
    tasks = [
      { id: "t-now", title: "Finish the person sheet", status: "in_progress", goalId: "ship" },
      { id: "t-done", title: "Done earlier", status: "done", updatedAt: new Date().toISOString() },
      { id: "t-someday", title: "Someday idea", status: "backlog" },
    ];
    render(); await flushPromises();
    const text = today().textContent!;
    expect(text).not.toContain("Ship People v1");
    expect(text).not.toContain("Finish the person sheet");
    expect(text).not.toContain("Notes");
    expect(today().querySelector('input[aria-label="Add a task"]')).toBeNull();
    const line = today().querySelector('a[aria-label^="1 of 2 tasks left"]')!;
    expect(line.getAttribute("href") ?? line.getAttribute("to")).toBe("/journal");
    expect(today().querySelector(".home-card__title")!.getAttribute("to")).toMatch(/^\/calendar\?date=\d{4}-\d{2}-\d{2}$/);
  });
  it("shows the server's Gratitude setting", async () => {
    gratitudeInToday = true; render(); await flushPromises();
    expect(gratitude()).toBeTruthy();
  });
  it("keeps a way into the calendar when nothing is scheduled", async () => {
    feed([]); render(); await flushPromises();
    expect(today().textContent).toContain("Nothing scheduled");
    expect(today().textContent).toContain("Open calendar");
    expect(today().textContent).not.toContain("Connect a calendar");
  });
  it("offers only the way to connect when no calendar is connected", async () => {
    render(); await flushPromises();
    expect(today().textContent).toContain("Connect a calendar");
    expect(today().textContent).not.toContain("Nothing scheduled");
  });
  it("fades finished events and points to tomorrow once the day's schedule is over", async () => {
    const start = new Date(); start.setHours(0, 30, 0, 0); const end = new Date(start.getTime() + 15 * 60_000);
    if (end.getTime() > Date.now()) return; // Just after midnight there is nothing finished yet.
    feed([{ id: "e1", title: "Early run", startsAt: start.toISOString(), endsAt: end.toISOString() }]);
    render(); await flushPromises();
    expect(today().querySelector(".home-event.is-past")?.textContent).toContain("Early run");
    expect(today().textContent).toContain("Nothing else today");
    expect(today().querySelector('a[aria-label="Open tomorrow in Calendar"]')).toBeTruthy();
  });
  it("keeps gratitude off until it is switched on from the Today menu, which holds only that switch", async () => {
    render(); await flushPromises();
    expect(gratitude()).toBeNull();
    (today().querySelector('[aria-label="Today options"]') as HTMLButtonElement).click(); await flushPromises();
    const items = [...today().querySelectorAll('[role="menu"] button')];
    expect(items.map(item => item.textContent?.replace("🌅", "").trim())).toEqual(["Gratitude"]);
    expect(items[0].getAttribute("aria-checked")).toBe("false");
    (items[0] as HTMLButtonElement).click(); await flushPromises();
    expect(gratitude()).toBeTruthy();
    expect(api.patch).toHaveBeenCalledWith("/gratitude/settings", { inToday: true });
  });
});
