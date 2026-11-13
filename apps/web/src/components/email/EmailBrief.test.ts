import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailBrief from "./EmailBrief.vue";
import { api } from "../../api";
import type { MailboxBrief, MailboxFollowUp } from "./brief";

vi.mock("../../api", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), plain: vi.fn() }));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toast: Object.assign(toasts.plain, { success: toasts.success, error: toasts.error }), toastSuccess: toasts.success, toastFromUnknown: toasts.error }),
}));

enableAutoUnmount(afterEach);

// Failure modes: follow-ups are missing from the count so the Brief says
// "all caught up" while prospects wait; a follow-up without a draft never gets
// one; Send goes out without the owner's click, or without the edit the owner
// just made; a sent, put-off or stopped follow-up stays on screen.
function followUp(extra: Partial<MailboxFollowUp> = {}): MailboxFollowUp {
  return {
    contactId: "p-aoife", name: "Aoife", organisation: "IMTA", email: "aoife@imta.example",
    offer: "free setup for 10 members", subject: "ME3 for IMTA members", daysWaiting: 9,
    followUpNumber: 1, followUpCap: 2,
    draft: { id: "draft-1", preview: "Hi Aoife, just bringing this back", body: "Hi Aoife, just bringing this back to the top of your inbox." },
    ...extra,
  };
}
function briefWith(followUps: MailboxFollowUp[]): MailboxBrief {
  return { needsYou: [], followUps, handled: { total: 0, groups: [] }, fyi: { inboxLeft: 0, unread: 0 }, checkedAt: null, dayStartsAt: "2026-11-20T00:00:00.000Z" };
}
let current: MailboxBrief;

async function mountBrief() {
  const wrapper = mount(EmailBrief, { props: { active: true, formatTime: () => "now" } });
  await flushPromises();
  return wrapper;
}
const rows = (wrapper: Awaited<ReturnType<typeof mountBrief>>) => wrapper.findAll(".brief-row");
const press = async (wrapper: Awaited<ReturnType<typeof mountBrief>>, label: string, index = 0) => {
  const button = rows(wrapper)[index].findAll("button").find((candidate) => candidate.text() === label || candidate.attributes("aria-label")?.startsWith(label));
  await button!.trigger("click");
  await flushPromises();
};

describe("Brief follow-ups due", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    toasts.success.mockReset();
    current = briefWith([followUp()]);
    vi.mocked(api.get).mockImplementation(async () => current);
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    vi.mocked(api.put).mockResolvedValue({ draft: { id: "draft-1" } });
  });

  it("counts a follow-up as a row that needs the owner and shows ME3's draft in it", async () => {
    const wrapper = await mountBrief();

    expect(wrapper.get("h1").text()).toBe("1 thing needs you");
    expect(wrapper.emitted("countChanged")?.at(-1)).toEqual([1]);
    const row = rows(wrapper)[0];
    expect(row.text()).toContain("Aoife · IMTA");
    expect(row.text()).toContain("No reply in 9 days · you offered free setup for 10 members");
    expect(row.text()).toContain("Follow-up drafted");
    expect((row.get("textarea").element as HTMLTextAreaElement).value).toContain("bringing this back to the top of your inbox");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("asks ME3 for a draft when a follow-up has none, without sending anything", async () => {
    current = briefWith([followUp({ draft: null, followUpNumber: 2 })]);
    vi.mocked(api.post).mockImplementation(async () => {
      current = briefWith([followUp({ followUpNumber: 2 })]);
      return { draft: { id: "draft-1" } };
    });
    const wrapper = await mountBrief();

    expect(vi.mocked(api.post).mock.calls).toEqual([["/mailbox/followups/p-aoife/draft"]]);
    expect(rows(wrapper)[0].text()).toContain("follow-up 2 of 2");
    expect((rows(wrapper)[0].get("textarea").element as HTMLTextAreaElement).value).toContain("bringing this back to the top of your inbox");
  });

  it("sends only on Send, with the owner's edit saved first", async () => {
    const wrapper = await mountBrief();

    await rows(wrapper)[0].get("textarea").setValue("Hi Aoife, any thoughts?");
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();

    await press(wrapper, "Send");
    expect(api.put).toHaveBeenCalledWith("/mailbox/drafts/draft-1", { textBody: "Hi Aoife, any thoughts?" });
    expect(api.post).toHaveBeenCalledWith("/mailbox/drafts/draft-1/approve", { holdSeconds: 10 });
    expect(rows(wrapper)).toHaveLength(0);
    expect(wrapper.get("h1").text()).toBe("You're all caught up");
    // This Core answered without holding the send, so it has gone.
    expect(toasts.success).toHaveBeenCalledWith("Follow-up sent to Aoife.");
  });

  it("puts a follow-up off until tomorrow from the menu and ends it with the Done check", async () => {
    current = briefWith([followUp(), followUp({ contactId: "p-mary", name: "Mary", organisation: null, offer: null })]);
    const wrapper = await mountBrief();
    expect(rows(wrapper)[1].text()).toContain("No reply in 9 days");
    expect(rows(wrapper)[1].text()).not.toContain("you offered");

    await press(wrapper, "More");
    await press(wrapper, "Remind me tomorrow morning");
    expect(api.post).toHaveBeenLastCalledWith("/mailbox/followups/p-aoife/later");
    expect(rows(wrapper)).toHaveLength(1);

    await press(wrapper, "Done: clear Mary");
    expect(api.post).toHaveBeenLastCalledWith("/mailbox/followups/p-mary/stop");
    expect(rows(wrapper)).toHaveLength(0);
  });
});
