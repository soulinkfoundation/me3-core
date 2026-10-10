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
beforeEach(() => {
  setActivePinia(createPinia()); localStorage.clear(); vi.clearAllMocks(); calendarUnavailable = false; pending = [core];
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
    return {} as never;
  });
  vi.mocked(api.post).mockImplementation(async endpoint => { if (endpoint.includes("/approvals/")) pending = []; return { ok: true } as never; });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });
function render() { return mount(HomePanels, { attachTo: document.body, global: { stubs: { RouterLink: { template: "<a><slot /></a>" }, UiIcon: true } } }); }
function button(text: string) { return [...document.body.querySelectorAll("button")].find(node => node.textContent?.trim() === text); }

describe("Home Core approval review", () => {
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
