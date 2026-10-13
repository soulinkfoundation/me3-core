import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import ContactsPanel from "./ContactsPanel.vue";

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const soulinkContact = {
  id: "contact-1",
  userId: "owner",
  name: "Ada Lovelace",
  email: null,
  phone: null,
  source: "soulink" as const,
  sourceRef: "node-ada",
  relationship: "contact" as const,
  closeness: null,
  status: "active" as const,
  notes: null,
  lastInteractionAt: null,
  socialHandles: {},
  metadata: {
    avatarUrl: "https://cdn.test/missing-avatar.jpg",
    soulinkNodeId: "node-ada",
    soulinkContextLabel: "Shared 1:1 chat",
    soulinkChatUrl: "https://soulink.test/?node=node-ada",
  },
  createdAt: "2026-08-18T10:00:00Z",
  updatedAt: "2026-08-18T10:00:00Z",
  bookingCount: 0,
  lastBookingAt: null,
  isClose: false,
  closeSince: null,
  isClient: false,
  lastInTouchAt: null,
};

describe("ContactsPanel", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/contacts") {
        return { contacts: [soulinkContact], summary: {} };
      }
      if (path === "/soulink/status") {
        return { available: true, configured: true, connection: null, recentEvents: [] };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
  });

  it("omits redundant Soulink context and falls back when an avatar fails", async () => {
    const wrapper = mount(ContactsPanel, {
      global: {
        plugins: [createPinia()],
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("Shared 1:1 chat");
    expect(wrapper.get('.contacts-icon-link').attributes("href")).toBe(
      "https://soulink.test/?node=node-ada",
    );

    await wrapper.get(".contact-avatar img").trigger("error");
    expect(wrapper.find(".contact-avatar img").exists()).toBe(false);
    expect(wrapper.find(".contact-avatar svg").exists()).toBe(true);
  });
});
