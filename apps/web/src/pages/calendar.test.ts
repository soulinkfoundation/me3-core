import { defineComponent } from "vue";
import {
  enableAutoUnmount,
  flushPromises,
  mount,
} from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useSitesStore } from "../stores/sites";
import CalendarPage from "./calendar.vue";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => router,
}));

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const CalendarMonthBoardStub = defineComponent({
  name: "CalendarMonthBoard",
  props: {
    events: { type: Array, default: () => [] },
  },
  emits: ["select-event", "select-day", "show-day"],
  template: '<div class="calendar-month-board-stub" />',
});

enableAutoUnmount(afterEach);

describe("Calendar Social Publishing source", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    window.localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    window.confirm = vi.fn(() => true);

    const sites = useSitesStore();
    sites.sites = [{
      id: "site-1",
      username: "kieran",
      user_id: "owner",
      site_role: "profile",
      custom_domain: null,
      custom_domain_status: null,
      created_at: "2026-07-01T08:00:00.000Z",
      updated_at: "2026-07-18T08:00:00.000Z",
      published_at: "2026-07-01T08:00:00.000Z",
    }];
    sites.ensureSites = vi.fn(async () => undefined) as never;
  });

  it("shows one Social entry per post that opens the post", async () => {
    const feed = calendarFeed(true);
    const [first] = feed.socialPublishing.publications as Array<Record<string, unknown>>;
    feed.socialPublishing.publications.push({ ...first, id: "publication-2", versionId: "version-2", platform: "x" } as never);
    vi.mocked(api.get).mockResolvedValue(feed);
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("Social");
    expect(wrapper.text()).not.toContain("New Social Publication");
    const monthBoard = wrapper.getComponent(CalendarMonthBoardStub);
    const projected = (monthBoard.props("events") as Array<Record<string, unknown>>)
      .filter((event) => event.entryType === "social_publication");
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      recordId: "post-1",
      title: "A source-backed launch Post",
      summary: "Scheduled · LinkedIn, X",
      actionLabel: "Open post",
    });
    expect(JSON.stringify(projected[0])).not.toMatch(/version-1|publication-1|Version|Publication/);

    monthBoard.vm.$emit("select-event", projected[0]?.id, {
      left: 20,
      right: 40,
      top: 20,
      bottom: 40,
      trigger: document.createElement("button"),
    });
    await flushPromises();
    const action = wrapper.findAll("button").find((button) => button.text().trim() === "Open post");
    await action!.trigger("click");

    expect(router.push).toHaveBeenCalledWith("/social/post-1");
  });

  it("marks a post that wasn't sent", async () => {
    const feed = calendarFeed(true);
    Object.assign(feed.socialPublishing.publications[0] as object, { publicationStatus: "failed", calendarState: "failed" });
    vi.mocked(api.get).mockResolvedValue(feed);
    const wrapper = mountPage();
    await flushPromises();

    const projected = (wrapper.getComponent(CalendarMonthBoardStub).props("events") as Array<Record<string, unknown>>)
      .find((event) => event.entryType === "social_publication");
    expect(projected).toMatchObject({ summary: "Not posted · LinkedIn", color: "#c2412d" });
  });

  it("shows neither the source nor records when the plugin is not ready", async () => {
    vi.mocked(api.get).mockResolvedValue(calendarFeed(false));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain("Social");
    const events = wrapper
      .getComponent(CalendarMonthBoardStub)
      .props("events") as Array<Record<string, unknown>>;
    expect(events.some((event) => event.entryType === "social_publication")).toBe(false);
  });

  it("removes an imported event and keeps the action owner-scoped", async () => {
    const importedEvent = {
      id: "imported-event-1",
      title: "Dylans Birthday",
      notes: null,
      location: null,
      startsAt: "2026-08-21T00:00:00.000Z",
      endsAt: "2026-08-22T00:00:00.000Z",
      timezone: null,
      allDay: true,
      kind: "event",
      sourceId: "source-1",
      sourceName: "Personal calendar",
      sourceKind: "imported",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    vi.mocked(api.get).mockResolvedValue(calendarFeed(false, [importedEvent]));
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    const wrapper = mountPage();
    await flushPromises();

    const monthBoard = wrapper.getComponent(CalendarMonthBoardStub);
    monthBoard.vm.$emit("select-event", importedEvent.id, {
      left: 20,
      right: 40,
      top: 20,
      bottom: 40,
      trigger: document.createElement("button"),
    });
    await flushPromises();

    const remove = wrapper
      .findAll("button")
      .find((button) => button.text().trim() === "Remove imported event");
    expect(remove).toBeTruthy();
    await remove!.trigger("click");
    await flushPromises();

    expect(window.confirm).toHaveBeenCalledWith(
      "Remove this imported event from your calendar? It will stay hidden if the source syncs again.",
    );
    expect(api.delete).toHaveBeenCalledWith(
      "/calendar/imported-events/imported-event-1",
    );
  });
});

function mountPage() {
  return mount(CalendarPage, {
    global: {
      stubs: {
        Teleport: true,
        CalendarAgenda: { template: '<div class="calendar-agenda-stub" />' },
        CalendarMiniMonth: { template: "<div />" },
        CalendarMonthBoard: CalendarMonthBoardStub,
        CalendarWeekBoard: { template: "<div />" },
        DatePickerPopover: { template: "<div />" },
        CalendarQuickEventPopover: { template: "<div />" },
        BookingAvailabilityEditor: { template: "<div />" },
      },
    },
  });
}

function calendarFeed(ready: boolean, importedEvents: unknown[] = []) {
  return {
    bookings: [],
    reminders: [],
    events: [],
    importedEvents,
    sources: [],
    tasks: [],
    socialPublishing: {
      ready,
      publications: ready
        ? [{
            id: "publication-1",
            siteId: "site-1",
            postId: "post-1",
            postTitle: "A source-backed launch Post",
            versionId: "version-1",
            versionLabel: "LinkedIn Version",
            platform: "linkedin",
            accountId: "account-1",
            accountLabel: "Kieran Butler",
            publicationStatus: "scheduled",
            calendarState: "planned",
            sourceType: "journal",
            sourceRef: "journal:entry-1",
            sourceLabel: "Journal",
            displayAt: "2026-07-20T09:30:00.000Z",
            scheduledFor: "2026-07-20T09:30:00.000Z",
            publishedAt: null,
            timezone: "Europe/Dublin",
            platformPostUrl: null,
            errorMessage: null,
            updatedAt: "2026-07-18T08:00:00.000Z",
          }]
        : [],
    },
  };
}
