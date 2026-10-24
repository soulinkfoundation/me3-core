import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const routerPush = vi.fn();
const routerReplace = vi.fn();

vi.mock("unplugin-vue-router/runtime", () => ({ definePage: vi.fn() }));
vi.mock("vue-router", () => ({
  RouterLink: {
    props: ["to"],
    template: '<a :data-to="typeof to === \'string\' ? to : JSON.stringify(to)"><slot /></a>',
  },
  useRoute: () => ({ params: { campaignId: "campaign-1" } }),
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}));
vi.mock("../../../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: vi.fn(),
  },
}));

import CampaignPage from "./[campaignId].vue";

const campaign = {
  id: "campaign-1",
  siteUsername: "willowyoga",
  status: "sent",
  scheduledFor: null,
  sentAt: "2026-09-23T09:00:00.000Z",
  cancelledAt: null,
  failureReason: null,
  sender: { fromAddress: "campaign@me3.app" },
  updatedAt: "2026-09-23T09:00:00.000Z",
  revision: {
    subject: "September newsletter",
    replyToAddress: null,
    document: { brand: { name: "Willow Yoga" } },
    renderedHtml: "<p>Hi</p>",
  },
  progress: {},
};

describe("campaign page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockImplementation((path: string) =>
      path.endsWith("/results")
        ? Promise.resolve({
          results: {
            sentTo: 210,
            delivered: 201,
            replies: 2,
            replyMessages: [
              { messageId: "message-9", from: "Ann Lee <ann@example.test>", subject: "Re: September newsletter", receivedAt: "2026-09-23 11:00:00" },
            ],
            unsubscribed: 2,
            markedSpam: 1,
            didntArrive: 9,
            didntArriveReasons: { bounced: 7, blocked: 0, refused: 2, failed: 0 },
          },
        })
        : Promise.resolve({ campaign }),
    );
  });

  it("shows how it went, with reasons and links to replies in the Inbox", async () => {
    const wrapper = mount(CampaignPage, { global: { stubs: { CampaignEmailPreview: true, ConfirmationDialog: true } } });
    await flushPromises();

    expect(wrapper.findAll(".campaign-stats div").map((stat) => stat.text())).toEqual([
      "delivered201",
      "replies2",
      "unsubscribed2",
      "didn't arrive9",
    ]);
    expect(wrapper.text()).toContain("Didn't arrive: 7 bounced, 2 refused by their provider.");
    expect(wrapper.text()).toContain("1 marked it as spam");
    const reply = wrapper.get(".campaign-replies a");
    expect(reply.attributes("data-to")).toBe(JSON.stringify({ path: "/email", query: { message: "message-9" } }));
    expect(reply.text()).toContain("Ann Lee");
    expect(wrapper.text()).toContain("And 1 more in your Inbox.");
  });

  it("copies the campaign for people who didn't get it", async () => {
    apiPost.mockResolvedValue({ campaign: { id: "campaign-2" } });
    const wrapper = mount(CampaignPage, { global: { stubs: { CampaignEmailPreview: true, ConfirmationDialog: true } } });
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text() === "Send to new subscribers")!.trigger("click");
    await flushPromises();

    expect(apiPost).toHaveBeenCalledWith("/email/campaigns/campaign-1/duplicate", { onlyNewSubscribers: true });
    expect(routerPush).toHaveBeenCalledWith({ path: "/email/campaigns/create", query: { campaign: "campaign-2" } });
    expect(wrapper.findAll("button").map((button) => button.text())).toEqual(
      expect.arrayContaining(["Duplicate", "Delete campaign"]),
    );
  });
});
