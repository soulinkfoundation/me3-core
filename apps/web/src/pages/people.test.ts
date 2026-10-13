import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PeoplePage from "./people.vue";
import { api } from "../api";
import type { Contact } from "../stores/contacts";

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../composables/useAppToast", () => ({
  useAppToast: () => ({ toastSuccess: toasts.success, toastError: toasts.error }),
}));

enableAutoUnmount(afterEach);

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function person(id: string, name: string, extra: Partial<Contact> = {}): Contact {
  return {
    id,
    userId: "owner",
    name,
    email: null,
    phone: null,
    source: "manual",
    sourceRef: null,
    relationship: "contact",
    closeness: null,
    status: "active",
    notes: null,
    lastInteractionAt: null,
    socialHandles: {},
    metadata: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    bookingCount: 0,
    lastBookingAt: null,
    isClose: false,
    closeSince: null,
    isClient: false,
    lastInTouchAt: null,
    reminderAt: null,
    ...extra,
  };
}

let contacts: Contact[] = [];

async function mountPeople(path = "/people") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/people", component: PeoplePage },
      { path: "/:pathMatch(.*)*", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(PeoplePage, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return { wrapper, router };
}

const rowNames = (wrapper: Awaited<ReturnType<typeof mountPeople>>["wrapper"]) =>
  wrapper.findAll(".person-row__name").map((row) => row.text());
const filterLabels = (wrapper: Awaited<ReturnType<typeof mountPeople>>["wrapper"]) =>
  wrapper.findAll(".people-chip").map((chip) => chip.text());

describe("People page", () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    toasts.success.mockReset();
    contacts = [
      person("c-zoe", "Zoe Hart"),
      person("c-erum", "Erum Shah", {
        isClose: true,
        closeness: "close",
        lastInTouchAt: ago(42),
        source: "soulink",
        socialHandles: { soulink: "erum" },
        metadata: { soulinkNodeId: "node-erum", soulinkOrigin: "https://soulink.test", soulinkChatUrl: "https://soulink.test/?node=node-erum" },
      }),
      person("c-aoife", "Aoife Byrne"),
      person("c-dad", "Dad", { isClose: true, closeness: "close" }),
      person("c-old", "Archived Person", { status: "archived" }),
    ];
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.delete).mockReset();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/contacts") return { contacts, summary: {} };
      if (path === "/soulink/status") return { connection: null };
      throw new Error(`Unexpected GET ${path}`);
    });
  });

  it("lists everyone A–Z with a star for Close and no Clients filter without clients", async () => {
    const { wrapper } = await mountPeople();

    expect(wrapper.get("h1").text()).toBe("People");
    expect(rowNames(wrapper)).toEqual(["Aoife Byrne", "Dad", "Erum Shah", "Zoe Hart"]);
    expect(wrapper.findAll(".person-row__star")).toHaveLength(2);
    expect(filterLabels(wrapper)).toEqual(["All", "Close"]);
    expect(wrapper.find(".person-avatar__badge").attributes("alt")).toBe("On Soulink");
  });

  it("shows Clients once someone is a client", async () => {
    contacts.push(person("c-bríd", "Bríd Walsh", { isClient: true, lastInTouchAt: ago(10) }));
    const { wrapper } = await mountPeople();

    expect(filterLabels(wrapper)).toEqual(["All", "Close", "Clients"]);
    await wrapper.findAll(".people-chip")[2].trigger("click");
    expect(rowNames(wrapper)).toEqual(["Bríd Walsh"]);
    expect(wrapper.get(".person-row__since").text()).toBe("10d ago");
  });

  it("orders Close by longest since last in touch, with never first", async () => {
    const { wrapper } = await mountPeople();

    await wrapper.findAll(".people-chip")[1].trigger("click");
    expect(rowNames(wrapper)).toEqual(["Dad", "Erum Shah"]);
    expect(wrapper.findAll(".person-row__since").map((cell) => cell.text())).toEqual(["Not yet", "6w ago"]);
  });

  it("searches by name", async () => {
    const { wrapper } = await mountPeople();

    await wrapper.get('input[aria-label="Search people"]').setValue("zo");
    expect(rowNames(wrapper)).toEqual(["Zoe Hart"]);
    await wrapper.get('input[aria-label="Search people"]').setValue("nobody");
    expect(wrapper.text()).toContain("No one called “nobody”.");
  });

  it("opens a Soulink person's sheet with their profile, chat and the Close star", async () => {
    const { wrapper, router } = await mountPeople();

    await wrapper.findAll(".person-row")[2].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.person).toBe("c-erum");

    const sheet = document.querySelector(".person-sheet") as HTMLElement;
    expect(sheet.textContent).toContain("Erum Shah");
    expect(sheet.textContent).toContain("In touch 6 weeks ago");
    expect(sheet.querySelector('a[aria-label="Open Erum Shah\'s Soulink profile"]')?.getAttribute("href"))
      .toBe("https://soulink.test/@erum");
    expect(sheet.textContent).toContain("Message on Soulink");
    const star = sheet.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(star.getAttribute("aria-checked")).toBe("true");

    vi.mocked(api.put).mockResolvedValue({ ok: true, contact: { ...contacts[1], isClose: false, closeness: null } });
    star.click();
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith("/contacts/c-erum", { closeness: null });
    expect(toasts.success).toHaveBeenCalledWith("Removed from Close");
  });

  it("offers phone and email for people not on Soulink, and records We talked", async () => {
    contacts.push(person("c-ann", "Ann Lee", { phone: "+353 87 000 0000", email: "ann@example.com" }));
    const { wrapper } = await mountPeople("/people?person=c-ann");

    const sheet = document.querySelector(".person-sheet") as HTMLElement;
    expect(sheet.querySelector('a[href="sms:+353 87 000 0000"]')?.textContent).toContain("Message");
    expect(sheet.querySelector('a[aria-label="Call"]')?.getAttribute("href")).toBe("tel:+353 87 000 0000");
    expect(sheet.querySelector('a[aria-label="Email"]')?.getAttribute("href")).toBe("mailto:ann@example.com");
    expect(sheet.textContent).toContain("Not in touch yet");

    vi.mocked(api.post).mockResolvedValue({ ok: true, contact: { ...contacts[5], lastInTouchAt: new Date().toISOString() } });
    (Array.from(sheet.querySelectorAll("button")).find((button) => button.textContent?.includes("We talked")) as HTMLButtonElement).click();
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/contacts/c-ann/in-touch");
    expect(document.querySelector(".person-sheet")?.textContent).toContain("In touch today");
    wrapper.unmount();
  });

  it("adds someone by hand and opens their sheet", async () => {
    const { wrapper, router } = await mountPeople();
    await wrapper.get('button[aria-label="Add someone"]').trigger("click");
    await flushPromises();

    const form = document.querySelector(".new-person") as HTMLFormElement;
    const add = Array.from(form.querySelectorAll("button")).find((button) => button.textContent === "Add") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const name = form.querySelector('input[aria-label="Name"]') as HTMLInputElement;
    name.value = "Ruth Keane";
    name.dispatchEvent(new Event("input"));
    const phone = form.querySelector('input[aria-label="Phone"]') as HTMLInputElement;
    phone.value = "087 111 2222";
    phone.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(add.disabled).toBe(false);

    const created = person("c-ruth", "Ruth Keane", { phone: "087 111 2222" });
    vi.mocked(api.post).mockImplementation(async () => {
      contacts.push(created);
      return { ok: true, contact: created };
    });
    form.dispatchEvent(new Event("submit"));
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/contacts", {
      name: "Ruth Keane", phone: "087 111 2222", email: null, source: "manual", relationship: "contact", status: "active",
    });
    expect(router.currentRoute.value.query.person).toBe("c-ruth");
    expect(toasts.success).toHaveBeenCalledWith("Added Ruth");
  });

  it("opens the existing person instead of adding a duplicate", async () => {
    contacts.push(person("c-ann", "Ann Lee", { email: "ann@example.com" }));
    const { wrapper, router } = await mountPeople();
    await wrapper.get('button[aria-label="Add someone"]').trigger("click");
    await flushPromises();

    const form = document.querySelector(".new-person") as HTMLFormElement;
    for (const [label, value] of [["Name", "Annie"], ["Email", "ANN@example.com"]]) {
      const input = form.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event("input"));
    }
    await flushPromises();
    form.dispatchEvent(new Event("submit"));
    await flushPromises();

    expect(api.post).not.toHaveBeenCalledWith("/contacts", expect.anything());
    expect(router.currentRoute.value.query.person).toBe("c-ann");
  });

  it("sets a reminder from a preset, shows it with Remove, and removes it", async () => {
    await mountPeople("/people?person=c-erum");
    const sheet = () => document.querySelector(".person-sheet") as HTMLElement;
    const button = (text: string) =>
      Array.from(sheet().querySelectorAll("button")).find((entry) => entry.textContent?.trim() === text) as HTMLButtonElement;

    const nextWeek = new Date();
    nextWeek.setHours(0, 0, 0, 0);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const dayKey = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, "0")}-${String(nextWeek.getDate()).padStart(2, "0")}`;
    vi.mocked(api.put).mockResolvedValue({ ok: true, reminderAt: `${dayKey}T09:00:00.000Z` });
    button("Next week").click();
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith("/contacts/c-erum/reminder", {
      date: dayKey,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(toasts.success).toHaveBeenCalledWith("Added to your calendar");
    expect(sheet().textContent).toContain("On your calendar · “Get in touch with Erum”");
    expect(button("Next week")).toBeUndefined();

    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    button("Remove").click();
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/contacts/c-erum/reminder");
    expect(button("Next week")).toBeDefined();
  });

  it("picks a later date from the calendar but not a past one", async () => {
    await mountPeople("/people?person=c-dad");
    const sheet = document.querySelector(".person-sheet") as HTMLElement;
    (sheet.querySelector('button[aria-label="Pick a date"]') as HTMLButtonElement).click();
    await flushPromises();

    const days = Array.from(sheet.querySelectorAll(".contact-reminder__grid button")) as HTMLButtonElement[];
    const today = new Date().getDate();
    expect(days[today - 1].disabled).toBe(true);
    (sheet.querySelector('button[aria-label="Next month"]') as HTMLButtonElement).click();
    await flushPromises();
    vi.mocked(api.put).mockResolvedValue({ ok: true, reminderAt: "2099-01-01T09:00:00.000Z" });
    const firstNextMonth = sheet.querySelector(".contact-reminder__grid button") as HTMLButtonElement;
    expect(firstNextMonth.disabled).toBe(false);
    firstNextMonth.click();
    await flushPromises();

    const next = new Date();
    const expected = new Date(next.getFullYear(), next.getMonth() + 1, 1);
    expect(api.put).toHaveBeenCalledWith("/contacts/c-dad/reminder", expect.objectContaining({
      date: `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-01`,
    }));
  });
});
