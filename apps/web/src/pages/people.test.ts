import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PeoplePage from "./people.vue";
import { api } from "../api";
import type { Contact } from "../stores/contacts";
import { resetSoulinkInvite } from "../composables/useSoulinkInvite";

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
    nextFollowupAt: null,
    outreachStatus: null,
    organisation: null,
    offer: null,
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
  // The page bar teleports into the app shell, which this mount does not render.
  const wrapper = mount(PeoplePage, { global: { plugins: [router, createPinia()], stubs: { AppPageBar: { props: ["title"], template: '<div><h1><slot name="title">{{ title }}</slot></h1><slot name="actions" /></div>' } } } });
  await flushPromises();
  return { wrapper, router };
}

async function openAddByHand(wrapper: Awaited<ReturnType<typeof mountPeople>>["wrapper"]) {
  await wrapper.get('button[aria-label="Add someone"]').trigger("click");
  await flushPromises();
  (Array.from(document.querySelectorAll(".add-someone button")).find((button) => button.textContent?.includes("Add by hand")) as HTMLButtonElement).click();
  await flushPromises();
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
    resetSoulinkInvite();
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
      if (path === "/soulink/invite-link") return { ok: true, url: "https://soulink.test/i/invite_abc" };
      throw new Error(`Unexpected GET ${path}`);
    });
  });

  it("lists everyone A–Z with a star for Close and no Customers filter without customers", async () => {
    const { wrapper } = await mountPeople();

    expect(wrapper.get("h1").text()).toBe("People");
    expect(rowNames(wrapper)).toEqual(["Aoife Byrne", "Dad", "Erum Shah", "Zoe Hart"]);
    expect(wrapper.findAll(".person-row__star")).toHaveLength(2);
    expect(filterLabels(wrapper)).toEqual(["All", "Close", "Outreach"]);
    expect(wrapper.find(".person-avatar__badge").attributes("alt")).toBe("On Soulink");
  });

  it("shows Customers once someone has booked or bought", async () => {
    contacts.push(person("c-bríd", "Bríd Walsh", { isClient: true, lastInTouchAt: ago(10) }));
    const { wrapper } = await mountPeople();

    expect(filterLabels(wrapper)).toEqual(["All", "Close", "Customers", "Outreach"]);
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
    await openAddByHand(wrapper);

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
    await openAddByHand(wrapper);

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

  it("shares the owner's Soulink invite link from Add someone and from people not on Soulink", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const { wrapper } = await mountPeople();
    await wrapper.get('button[aria-label="Add someone"]').trigger("click");
    await flushPromises();

    const invite = Array.from(document.querySelectorAll(".add-someone button")).find((button) => button.textContent?.includes("Invite a friend")) as HTMLButtonElement;
    expect(invite.textContent).not.toContain("Soulink link");
    invite.click();
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("https://soulink.test/i/invite_abc");
    expect(toasts.success).toHaveBeenCalledWith("Invite link copied");
    wrapper.unmount();

    await mountPeople("/people?person=c-zoe");
    const sheetInvite = Array.from(document.querySelectorAll(".person-sheet button")).find((button) => button.textContent?.includes("Invite to Soulink"));
    expect(sheetInvite).toBeDefined();
  });

  describe("Outreach", () => {
    const inDays = (days: number) => {
      const date = new Date();
      date.setHours(9, 0, 0, 0);
      date.setDate(date.getDate() + days);
      return date.toISOString();
    };
    const prospect = (id: string, name: string, extra: Partial<Contact>) =>
      person(id, name, { relationship: "prospect", source: "outreach", outreachStatus: "sent", ...extra });
    const outreach = async (wrapper: Awaited<ReturnType<typeof mountPeople>>["wrapper"]) => {
      await wrapper.findAll(".people-chip").find((chip) => chip.text() === "Outreach")!.trigger("click");
    };
    const groups = (wrapper: Awaited<ReturnType<typeof mountPeople>>["wrapper"]) =>
      wrapper.findAll(".prospect-group").map((group) => ({
        label: group.get(".prospect-group__label").text(),
        rows: group.findAll(".prospect-row").map((row) => row.get(".prospect-row__title").text()),
      }));
    const tab = async (wrapper: Awaited<ReturnType<typeof mountPeople>>["wrapper"], label: string) => {
      await wrapper.findAll(".prospect-tabs button").find((button) => button.text() === label)!.trigger("click");
    };

    beforeEach(() => {
      contacts.push(
        prospect("p-iacp", "Membership office", {
          organisation: "IACP", offer: "Member discount", email: "office@iacp.example", nextFollowupAt: inDays(0),
        }),
        prospect("p-imta", "Aoife", { organisation: "IMTA", offer: "Free setup", nextFollowupAt: inDays(-2) }),
        prospect("p-yti", "Niamh", { organisation: "Yoga Therapy Ireland", outreachStatus: "replied" }),
        prospect("p-isme", "ISME", { organisation: "ISME", nextFollowupAt: inDays(5) }),
        prospect("p-icf", "ICF Ireland", { outreachStatus: "converted" }),
        prospect("p-iya", "Irish Yoga Association", { outreachStatus: "not_interested" }),
        prospect("p-quiet", "Quiet Guild", { outreachStatus: "no_response" }),
      );
    });

    it("groups open prospects into Follow up due and Waiting, most overdue first", async () => {
      const { wrapper } = await mountPeople();
      await outreach(wrapper);

      expect(wrapper.findAll(".prospect-tabs button").map((button) => button.text()))
        .toEqual(["Open", "Due", "Agreed", "No"]);
      expect(groups(wrapper)).toEqual([
        { label: "Follow up due", rows: ["IMTA · Aoife", "IACP · Membership office"] },
        { label: "Waiting", rows: ["ISME", "Yoga Therapy Ireland · Niamh"] },
      ]);
      const due = wrapper.findAll(".prospect-row")[0];
      expect(due.text()).toContain("Offered Free setup");
      expect(due.text()).toContain("Sent");
      expect(due.text()).toContain("Overdue 2 days");
      expect(wrapper.findAll(".prospect-row")[1].text()).toContain("Follow up today");
    });

    it("filters by Due, Agreed and No", async () => {
      const { wrapper } = await mountPeople();
      await outreach(wrapper);

      await tab(wrapper, "Due");
      expect(groups(wrapper)).toEqual([{ label: "Follow up due", rows: ["IMTA · Aoife", "IACP · Membership office"] }]);
      await tab(wrapper, "Agreed");
      expect(groups(wrapper)).toEqual([{ label: "Done", rows: ["ICF Ireland"] }]);
      await tab(wrapper, "No");
      expect(groups(wrapper)).toEqual([{ label: "Done", rows: ["Irish Yoga Association", "Quiet Guild"] }]);
      expect(wrapper.text()).toContain("No response");
    });

    it("searches prospects by organisation", async () => {
      const { wrapper } = await mountPeople();
      await outreach(wrapper);
      await wrapper.get('input[aria-label="Search people"]').setValue("imta");
      expect(groups(wrapper)).toEqual([{ label: "Follow up due", rows: ["IMTA · Aoife"] }]);
    });

    it("explains Outreach when no one is tracked yet", async () => {
      contacts = contacts.filter((contact) => contact.relationship !== "prospect");
      const { wrapper } = await mountPeople();
      await outreach(wrapper);
      expect(wrapper.text()).toContain("No outreach yet.");
    });

    it("sets status, offer and follow-up date from the prospect panel", async () => {
      await mountPeople("/people?person=p-iacp");
      const sheet = () => document.querySelector(".person-sheet") as HTMLElement;
      const button = (text: string) =>
        Array.from(sheet().querySelectorAll("button")).find((entry) => entry.textContent?.trim() === text) as HTMLButtonElement;
      vi.mocked(api.put).mockImplementation(async (_path: string, body: unknown) => ({
        ok: true, contact: { ...contacts.find((contact) => contact.id === "p-iacp"), ...(body as object) },
      }));

      expect(sheet().textContent).toContain("Follow up today");
      expect(button("Sent").getAttribute("aria-pressed")).toBe("true");
      button("Call booked").click();
      await flushPromises();
      expect(api.put).toHaveBeenLastCalledWith("/contacts/p-iacp", { outreachStatus: "booked" });

      button("+1 week").click();
      await flushPromises();
      expect(api.put).toHaveBeenLastCalledWith("/contacts/p-iacp", { nextFollowupAt: inDays(7) });
      button("Clear").click();
      await flushPromises();
      expect(api.put).toHaveBeenLastCalledWith("/contacts/p-iacp", { nextFollowupAt: null });

      const offer = sheet().querySelector('textarea[aria-label="What I offered"]') as HTMLTextAreaElement;
      expect(offer.value).toBe("Member discount");
      offer.value = "Member discount, 3 months free";
      offer.dispatchEvent(new Event("input"));
      offer.dispatchEvent(new Event("change"));
      await flushPromises();
      expect(api.put).toHaveBeenLastCalledWith("/contacts/p-iacp", { offer: "Member discount, 3 months free" });
    });

    it("asks ME3 to draft a follow-up for a prospect who has not answered, and opens Drafts", async () => {
      const { router } = await mountPeople("/people?person=p-iacp");
      const button = (text: string) =>
        Array.from(document.querySelectorAll(".person-sheet button")).find((entry) => entry.textContent?.trim() === text) as HTMLButtonElement;
      vi.mocked(api.post).mockResolvedValue({ draft: { id: "draft-1" } });

      button("Draft follow-up").click();
      await flushPromises();
      expect(api.post).toHaveBeenCalledWith("/mailbox/followups/p-iacp/draft");
      expect(router.currentRoute.value.fullPath).toBe("/email?tab=drafts");
      expect(toasts.success).toHaveBeenCalledWith("ME3 drafted a follow-up. Read it before you send.");
    });

    it("offers no follow-up draft once a prospect has replied or has no email", async () => {
      await mountPeople("/people?person=p-yti");
      expect(document.querySelector(".person-sheet")?.textContent).not.toContain("Draft follow-up");
    });

    it("starts and stops tracking someone as outreach from their panel", async () => {
      await mountPeople("/people?person=c-zoe");
      const button = (text: string) =>
        Array.from(document.querySelectorAll(".person-sheet button")).find((entry) => entry.textContent?.trim() === text) as HTMLButtonElement;
      expect(document.querySelector(".prospect-panel")).toBeNull();
      vi.mocked(api.put).mockImplementation(async (_path: string, body: unknown) => {
        // A fresh list, as the API returns one.
        contacts = contacts.map((contact) => (contact.id === "c-zoe" ? { ...contact, ...(body as object) } : contact));
        return { ok: true, contact: contacts.find((contact) => contact.id === "c-zoe") };
      });

      button("Track as outreach").click();
      await flushPromises();
      expect(api.put).toHaveBeenLastCalledWith("/contacts/c-zoe", { relationship: "prospect", outreachStatus: "new" });
      expect(document.querySelector(".prospect-panel")).not.toBeNull();

      button("Stop tracking").click();
      await flushPromises();
      expect(api.put).toHaveBeenLastCalledWith("/contacts/c-zoe", {
        relationship: "contact", outreachStatus: null, nextFollowupAt: null,
      });
    });
  });

  it("hides Invite a friend when Soulink can't share invites", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/contacts") return { contacts, summary: {} };
      if (path === "/soulink/status") return { connection: null };
      throw new Error("Connect Soulink to invite friends");
    });
    const { wrapper } = await mountPeople("/people?person=c-zoe");
    await wrapper.get('button[aria-label="Add someone"]').trigger("click");
    await flushPromises();
    expect(document.querySelector(".add-someone")?.textContent).not.toContain("Invite a friend");
  });
});
