import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api";
import HomePanels from "./HomePanels.vue";

vi.mock("../../api", () => ({ API_BASE: "/api", ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } }, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(async () => ({})), delete: vi.fn(async () => ({ ok: true })) } }));
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
// Most owners never had Today's page on; the Writing card tests set it.
let homeSettings: object | Error = { todayPage: false };
// null is a brand-new install: no client has saved a Home layout yet.
let savedLayout: object | null = null;
const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const contact = (id: string, name: string, extra: object = {}) => ({ id, name, status: "active", source: "manual", socialHandles: {}, metadata: null, isClose: true, closeness: "close", closeSince: daysAgo(100), isClient: false, lastInTouchAt: null, reminderAt: null, ...extra });
beforeEach(() => {
  setActivePinia(createPinia()); localStorage.clear(); vi.clearAllMocks(); calendarUnavailable = false; pending = [core]; people = []; tasks = []; goals = []; gratitudeInToday = false; homeSettings = { todayPage: false }; savedLayout = null;
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
    if (endpoint === "/home/layout" && savedLayout) return { layout: savedLayout } as never;
    if (endpoint === "/home/settings") { if (homeSettings instanceof Error) throw homeSettings; return homeSettings as never; }
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
  // A new install starts with Today alone; these cover an install whose saved layout has People on.
  beforeEach(() => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async endpoint => endpoint === "/home/layout" ? { layout: { order: ["today", "people"], hidden: [], pinned: ["people"], earned: [] } } as never : original(endpoint));
  });
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
  // These cover an existing install; the last test covers a brand-new one.
  beforeEach(() => { savedLayout = { order: ["today"], hidden: ["inbox", "people"], pinned: [], earned: [] }; });
  // Failure modes: tasks, notes, Gratitude or Today's page creeping back into Today; the title not opening
  // the calendar on today; Today's menu offering switches that now live on Writing.
  it("is just the day: no tasks, notes, Gratitude or Today's page", async () => {
    goals = [{ id: "ship", title: "Ship People v1", status: "active" }];
    tasks = [{ id: "t-now", title: "Finish the person sheet", status: "in_progress", goalId: "ship" }];
    gratitudeInToday = true;
    render(); await flushPromises();
    const text = today().textContent!;
    for (const gone of ["Ship People v1", "Finish the person sheet", "Notes", "Today's page"]) expect(text).not.toContain(gone);
    expect(gratitude()).toBeNull();
    expect(today().querySelector(".home-card__title")!.getAttribute("to")).toMatch(/^\/calendar\?date=\d{4}-\d{2}-\d{2}$/);
    (today().querySelector('[aria-label="Today options"]') as HTMLButtonElement).click(); await flushPromises();
    expect([...today().querySelectorAll('[role="menu"] button')].map(item => item.textContent?.trim())).toEqual(["Remove from Home"]);
  });
  it("shows one quiet line when nothing is scheduled", async () => {
    feed([]); render(); await flushPromises();
    expect(today().textContent).toContain("Nothing scheduled");
    expect(today().textContent).not.toContain("Connect a calendar");
  });
  it("leaves connecting a calendar to Settings when none is connected", async () => {
    render(); await flushPromises();
    expect(today().textContent).toContain("No events yet");
    expect(today().textContent).not.toContain("Connect a calendar");
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
});

describe("Home Writing card", () => {
  const writing = () => document.body.querySelector('article[aria-label="Writing"]');
  const gratitude = () => writing()!.querySelector('[aria-label="Gratitude"], [aria-label="Three good things"]');
  const pinnedOnSave = () => (vi.mocked(api.put).mock.calls.filter(call => call[0] === "/home/layout").at(-1)?.[1] as { pinned?: string[] } | undefined)?.pinned;
  // Failure modes: Today's page missing or counting tasks; Gratitude shown while off or not switching from
  // Writing's menu; the switch not saving to the shared server setting.
  it("holds one line into today's page, and Gratitude switched from its menu", async () => {
    savedLayout = { order: ["today", "notes"], hidden: ["inbox", "people"], pinned: ["notes"], earned: [] };
    tasks = [{ id: "t-now", title: "Finish the person sheet", status: "in_progress" }];
    render(); await flushPromises();
    const line = writing()!.querySelector('a[aria-label="Open today\'s page"]')!;
    expect(line.textContent!.replace(/\s+/g, "")).toBe("📝Today'spage");
    expect(gratitude()).toBeNull();
    (writing()!.querySelector('[aria-label="Writing options"]') as HTMLButtonElement).click(); await flushPromises();
    const items = [...writing()!.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
    expect(items.map(item => item.textContent?.replace(/🌅/u, "").trim())).toEqual(["Gratitude", "Remove from Home"]);
    expect(items[0].getAttribute("aria-checked")).toBe("false");
    items[0].click(); await flushPromises();
    expect(gratitude()).toBeTruthy();
    expect(api.patch).toHaveBeenCalledWith("/gratitude/settings", { inToday: true });
  });
  // Failure modes: an owner who journaled from Today losing Today's page or Gratitude; the card forced on an
  // owner who never used them, on one whose Core never answered, or back onto a Home it was removed from.
  const existing = { order: ["today"], hidden: ["inbox", "people"], pinned: [], earned: [] };
  it("is added for an owner who had Today's page on", async () => {
    savedLayout = existing; homeSettings = { todayPage: true }; render(); await flushPromises();
    expect(writing()).toBeTruthy();
    expect(pinnedOnSave()).toContain("notes");
  });
  it("is added for an owner who had Gratitude on, even with Today's page off", async () => {
    savedLayout = existing; homeSettings = { todayPage: false }; gratitudeInToday = true; render(); await flushPromises();
    expect(writing()).toBeTruthy();
    expect(gratitude()).toBeTruthy();
  });
  it("is not added when neither was on, when the setting couldn't be read, or when the owner removed it", async () => {
    savedLayout = existing; homeSettings = { todayPage: false }; render(); await flushPromises();
    expect(writing()).toBeNull();
    document.body.innerHTML = "";
    homeSettings = new ApiError("Not found", 404); render(); await flushPromises();
    expect(writing()).toBeNull();
    document.body.innerHTML = "";
    homeSettings = { todayPage: true }; savedLayout = { ...existing, hidden: ["inbox", "people", "notes"] }; render(); await flushPromises();
    expect(writing()).toBeNull();
    expect(pinnedOnSave()).toBeUndefined();
  });
  it("is not added to a brand-new install, which starts with Today's page off", async () => {
    savedLayout = null; render(); await flushPromises();
    expect(writing()).toBeNull();
    expect(api.patch).toHaveBeenCalledWith("/home/settings", { todayPage: false });
    expect(api.put).toHaveBeenCalledWith("/home/layout", expect.objectContaining({ order: ["soup", "today"], pinned: ["soup"] }));
  });
});

describe("Home Tasks card", () => {
  const card = () => document.body.querySelector('article[aria-label="Tasks"]');
  async function addTasks() {
    render(); await flushPromises();
    expect(card()).toBeNull();
    button("Add to Home")!.click(); await flushPromises();
    (document.body.querySelector('dialog[open] button[aria-label="Tasks"]') as HTMLButtonElement).click(); await flushPromises();
  }
  // Failure modes: the card shows on its own; Now hidden behind the backlog; rows not opening their task.
  it("is added by hand and lists what's in Now, each opening its task", async () => {
    tasks = [{ id: "n1", title: "Finish the person sheet", status: "in_progress" }, { id: "b1", title: "Someday idea", status: "backlog" }];
    await addTasks();
    expect(card()!.querySelector(".home-card__detail")!.textContent).toBe("Now");
    const rows = [...card()!.querySelectorAll(".home-task")];
    expect(rows.map(row => row.textContent!.trim())).toEqual(["Finish the person sheet"]);
    expect(rows[0].getAttribute("to")).toBe("/tasks?view=now&task=n1");
    expect(card()!.querySelector(".home-card__title")!.getAttribute("to")).toBe("/tasks?view=now");
  });
  it("falls back to three from the backlog when Now is empty", async () => {
    tasks = ["One", "Two", "Three", "Four"].map((title, i) => ({ id: `b${i}`, title, status: "backlog" }));
    await addTasks();
    expect(card()!.querySelector(".home-card__detail")!.textContent).toBe("Backlog");
    expect([...card()!.querySelectorAll(".home-task")].map(row => row.textContent!.trim())).toEqual(["One", "Two", "Three"]);
    expect(card()!.querySelector(".home-card__title")!.getAttribute("to")).toBe("/tasks?view=backlog");
  });
});

describe("Home custom cards", () => {
  const habits = (today: boolean) => ({
    card: { id: "card-habits", name: "Habits", emoji: "✅", version: 1, createdBy: "agent", createdAt: "2026-11-24T09:00:00Z", updatedAt: "", history: [{ version: 1, name: "Habits", emoji: "✅", summary: "Made by your ME3", createdAt: "2026-11-24T09:00:00Z" }], access: { sees: [], changes: ["Its own entries"] },
      blocks: [{ type: "habit", key: "run", label: "Run" }, { type: "stat", key: "stat1", source: "money.today" }] },
    state: { date: "2026-11-24", done: today ? 1 : 0, total: 1, blocks: { run: { type: "habit", today, streak: today ? 1 : 0, week: [null, today, null, null, null, null, null] }, stat1: { type: "stat", value: "–", label: "Part of ME3 Starter and Business" } } },
  });
  let response: object;
  beforeEach(() => {
    response = { date: "2026-11-24", cards: [habits(false)], offered: true, sources: ["tasks", "reminders", "goal"] };
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async endpoint => {
      if (endpoint === "/home/layout") return { layout: { order: ["today", "card-habits"], hidden: [], pinned: ["card-habits"], earned: [] } } as never;
      if (endpoint === "/home/cards") return response as never;
      return original(endpoint);
    });
  });
  const card = () => document.body.querySelector('[aria-label="Habits"].home-card');

  it("draws a pinned card and saves a tick to the install", async () => {
    vi.mocked(api.post).mockImplementation(async () => habits(true) as never);
    render(); await flushPromises();
    expect(card()?.textContent).toContain("Part of ME3 Starter and Business");
    (card()!.querySelector('[aria-label="Run"]') as HTMLButtonElement).click(); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/home/cards/card-habits/act", { action: "tick", key: "run", on: true });
    expect(card()!.querySelector('[aria-label="Run"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(card()!.textContent).toContain("1 of 1 today");
  });
  it("puts the tick back when the install refuses it", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("offline"));
    render(); await flushPromises();
    (card()!.querySelector('[aria-label="Run"]') as HTMLButtonElement).click(); await flushPromises();
    expect(card()!.querySelector('[aria-label="Run"]')!.getAttribute("aria-pressed")).toBe("false");
  });
  it("lists Your cards in Add to Home and starts a Custom card in chat with ideas this plan can show", async () => {
    const wrapper = render(); await flushPromises();
    (wrapper.vm as unknown as { openAdd: () => void }).openAdd(); await flushPromises();
    expect(document.body.textContent).toContain("Your cards");
    expect(document.body.querySelector('.home-add-tile[aria-label="Habits"]')!.getAttribute("aria-pressed")).toBe("true");
    button("Custom card")!.click(); await flushPromises();
    expect(document.body.textContent).toContain("A goal with its tasks");
    expect(document.body.textContent).not.toContain("Who owes me money");
    const field = document.body.querySelector('textarea[aria-label="Describe your card"]') as HTMLTextAreaElement;
    field.value = "water I drink"; field.dispatchEvent(new Event("input")); await flushPromises();
    button("Make it")!.click(); await flushPromises();
    expect(wrapper.emitted("ask")).toEqual([["Make me a Home card: water I drink"]]);
  });
  it("hides Your cards when ME3 can't build cards and there are none", async () => {
    response = { date: "2026-11-24", cards: [], offered: false };
    const wrapper = render(); await flushPromises();
    (wrapper.vm as unknown as { openAdd: () => void }).openAdd(); await flushPromises();
    expect(document.body.textContent).not.toContain("Your cards");
    expect(button("Custom card")).toBeUndefined();
  });
  it("removes a card from Home, keeping it in Your cards", async () => {
    render(); await flushPromises();
    (card()!.querySelector('[aria-label="Habits options"]') as HTMLButtonElement).click(); await flushPromises();
    button("Remove from Home")!.click(); await flushPromises();
    expect(card()).toBeNull();
    expect(api.put).toHaveBeenLastCalledWith("/home/layout", expect.objectContaining({ pinned: [], hidden: ["card-habits"] }));
  });
  it("opens About this card, goes back a version and removes the card", async () => {
    vi.mocked(api.post).mockImplementation(async () => habits(false) as never);
    render(); await flushPromises();
    (card()!.querySelector('[aria-label="Open Habits"]') as HTMLButtonElement).click(); await flushPromises();
    const about = document.body.querySelector('dialog[open][aria-label="About this card"]')!;
    expect(about.textContent).toContain("Made by your ME3");
    expect(about.textContent).toContain("Nothing else");
    button("Remove card")!.click(); await flushPromises();
    [...document.body.querySelectorAll("button")].filter(node => node.textContent?.trim() === "Remove card").at(-1)!.click(); await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/home/cards/card-habits");
    expect(card()).toBeNull();
  });
});
