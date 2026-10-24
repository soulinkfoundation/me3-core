import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";

const apiPost = vi.fn();
const toastError = vi.fn();

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));
vi.mock("../../composables/useAppToast", () => ({
  useAppToast: () => ({ toastError, toastFromUnknown: vi.fn() }),
}));

import CampaignApprovalCard from "./CampaignApprovalCard.vue";

const baseProps = {
  campaignId: "campaign-1",
  revisionId: "revision-7",
  recipientCount: 214,
  audienceLine: "214 subscribers of @willowyoga",
  senderReady: true,
  sendsLeft: 8_700,
  timeZone: "Europe/Dublin",
};

function primary(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("button").at(-1)!;
}

describe("Campaign approval card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names what the button does and approves this revision for this count", async () => {
    apiPost.mockResolvedValue({ ok: true });
    const wrapper = mount(CampaignApprovalCard, { props: baseProps });

    expect(wrapper.text()).toContain("Uses 214 of 8,700 sends left");
    expect(primary(wrapper).text()).toBe("Send to 214 people");
    await primary(wrapper).trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns/campaign-1/send", {
      revisionId: "revision-7",
      recipientCount: 214,
      scheduledFor: null,
    });
    expect(wrapper.emitted("sent")).toHaveLength(1);
  });

  it("schedules in the owner's timezone and says when", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
    apiPost.mockResolvedValue({ ok: true });
    const wrapper = mount(CampaignApprovalCard, { props: baseProps });

    await wrapper.findAll('[role="radio"]')[1]!.trigger("click");
    expect(wrapper.text()).toContain("Choose when it should go.");
    expect(primary(wrapper).attributes("disabled")).toBeDefined();
    await wrapper.get('input[type="datetime-local"]').setValue("2026-10-25T09:00");
    expect(wrapper.text()).toContain("Europe/Dublin time");
    expect(primary(wrapper).text()).toMatch(/^Schedule for Sun.*25.*09:00/);
    await primary(wrapper).trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns/campaign-1/send", expect.objectContaining({
      scheduledFor: "2026-10-25T09:00:00.000Z",
    }));
    vi.useRealTimers();
  });

  it.each([
    [{ senderReady: false }, "Sending isn't set up yet, so this stays a draft."],
    [{ recipientCount: 0 }, "Nobody on this list can be emailed yet."],
    [{ sendsLeft: 100 }, "This needs 214 sends and 100 are left this month."],
  ])("says why it can't send: %o", (overrides, reason) => {
    const wrapper = mount(CampaignApprovalCard, { props: { ...baseProps, ...overrides } });

    expect(wrapper.get(".campaign-approval__blocker").text()).toBe(reason);
    expect(primary(wrapper).attributes("disabled")).toBeDefined();
  });

  it("asks again when the email or its audience changed after review", async () => {
    apiPost.mockRejectedValue(
      new ApiError("This email changed after you reviewed it. Check it and approve again.", 409, "campaign_changed"),
    );
    const wrapper = mount(CampaignApprovalCard, { props: baseProps });

    await primary(wrapper).trigger("click");
    await flushPromises();

    expect(toastError).toHaveBeenCalledWith("This email changed after you reviewed it. Check it and approve again.");
    expect(wrapper.emitted("stale")).toHaveLength(1);
    expect(wrapper.emitted("sent")).toBeUndefined();
  });
});
