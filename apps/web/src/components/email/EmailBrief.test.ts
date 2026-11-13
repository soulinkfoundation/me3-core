import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailBrief from "./EmailBrief.vue";
import { api } from "../../api";
import type { MailboxBrief, MailboxFollowUp } from "./brief";

vi.mock("../../api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toast: { success: toasts.success }, toastSuccess: toasts.success, toastFromUnknown: toasts.error }),
}));

enableAutoUnmount(afterEach);

// Failure modes: follow-ups are missing from the count so the Brief says
// "all caught up" while prospects wait; a follow-up without a draft never gets
// one; Send goes out without the owner's click; a sent, snoozed or stopped
// follow-up stays on screen.
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
const cards = (wrapper: Awaited<ReturnType<typeof mountBrief>>) => wrapper.findAll(".brief-followup");
const act = async (wrapper: Awaited<ReturnType<typeof mountBrief>>, label: string) => {
  await wrapper.findAll(".brief-followup button").find((button) => button.text() === label)!.trigger("click");
  await flushPromises();
};

describe("Brief follow-ups due", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    toasts.success.mockReset();
    current = briefWith([followUp()]);
    vi.mocked(api.get).mockImplementation(async () => current);
    vi.mocked(api.post).mockResolvedValue({ ok: true });
  });

  it("counts follow-ups as things that need the owner and shows ME3's draft", async () => {
    const wrapper = await mountBrief();

    expect(wrapper.get("h1").text()).toBe("1 thing needs you");
    expect(wrapper.emitted("countChanged")?.at(-1)).toEqual([1]);
    expect(wrapper.text()).toContain("Follow-ups due");
    const card = cards(wrapper)[0];
    expect(card.text()).toContain("Aoife · IMTA");
    expect(card.text()).toContain("No reply in 9 days · you offered free setup for 10 members");
    expect(card.text()).toContain("ME3 drafted a follow-up");
    expect(card.text()).toContain("bringing this back to the top of your inbox");
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
    expect(cards(wrapper)[0].text()).toContain("follow-up 2 of 2");
    expect(cards(wrapper)[0].text()).toContain("bringing this back to the top of your inbox");
  });

  it("sends the draft only on Send, and opens it for Edit", async () => {
    const wrapper = await mountBrief();

    await act(wrapper, "Edit");
    expect(wrapper.emitted("editDraft")?.[0]?.[0]).toBe("draft-1");
    expect(api.post).not.toHaveBeenCalled();

    await act(wrapper, "Send");
    expect(api.post).toHaveBeenCalledWith("/mailbox/drafts/draft-1/approve");
    expect(cards(wrapper)).toHaveLength(0);
    expect(wrapper.get("h1").text()).toBe("You're all caught up");
    expect(toasts.success).toHaveBeenCalledWith("Follow-up sent to Aoife.");
  });

  it("puts a follow-up off with Later and ends it with Stop following up", async () => {
    current = briefWith([followUp(), followUp({ contactId: "p-mary", name: "Mary", organisation: null, offer: null })]);
    const wrapper = await mountBrief();
    expect(cards(wrapper)[1].text()).toContain("No reply in 9 days");
    expect(cards(wrapper)[1].text()).not.toContain("you offered");

    await act(wrapper, "Later");
    expect(api.post).toHaveBeenLastCalledWith("/mailbox/followups/p-aoife/later");
    expect(cards(wrapper)).toHaveLength(1);

    await act(wrapper, "Stop following up");
    expect(api.post).toHaveBeenLastCalledWith("/mailbox/followups/p-mary/stop");
    expect(cards(wrapper)).toHaveLength(0);
  });
});
