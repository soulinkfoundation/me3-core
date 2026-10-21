import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import worker from "./index";
import { reconcileProductOrders } from "./commerce-reconciliation";
import { reconcileMailboxAttachmentStaging } from "./mailbox-attachment-staging";
import { dispatchDueMorningCalendarPushes } from "./morning-calendar-push";
import { dispatchDueGratitudeReminders } from "./gratitude";
import { dispatchDueCalendarPushNotifications } from "./calendar-push-notifications";
import { dispatchDueBookingReminders } from "./booking-reminders";
import { dispatchDueSocialPublications } from "./social-publishing";
import { CAMPAIGN_DISPATCH_CRON, dispatchDueCampaignJobs } from "./campaign-delivery";
import { releaseManagedRuntimeWriteLease } from "./managed-runtime-lifecycle";
import type { Env } from "./types";

vi.mock("./app", () => ({ default: {} }));
vi.mock("./user-agent", () => ({ Me3UserAgent: class {} }));
vi.mock("./me3-agent", () => ({ Me3Agent: class {} }));
vi.mock("./core-runtime-migrations", () => ({ ensureCoreRuntimeMigrations: vi.fn() }));
vi.mock("./managed-runtime-lifecycle", () => ({
  isManagedRuntime: () => false,
  getManagedInstallationId: () => null,
  beginManagedRuntimeWriteLease: vi.fn(),
  releaseManagedRuntimeWriteLease: vi.fn(),
}));
vi.mock("./commerce-reconciliation", () => ({ reconcileProductOrders: vi.fn() }));
vi.mock("./agent-commerce", () => ({ expireStaleAgentCheckouts: vi.fn(async () => undefined) }));
vi.mock("./agent-network-commerce", () => ({ pollNetworkPurchases: vi.fn(async () => undefined) }));
vi.mock("./mailbox-attachment-staging", () => ({ reconcileMailboxAttachmentStaging: vi.fn() }));
vi.mock("./mailbox-triage", () => ({ retryPendingMailTriage: vi.fn(async () => undefined), archiveStaleLoginCodes: vi.fn(async () => undefined), purgeStaleSpam: vi.fn(async () => undefined) }));
vi.mock("./morning-calendar-push", () => ({ dispatchDueMorningCalendarPushes: vi.fn() }));
vi.mock("./gratitude", () => ({ dispatchDueGratitudeReminders: vi.fn() }));
vi.mock("./calendar-push-notifications", () => ({ dispatchDueCalendarPushNotifications: vi.fn() }));
vi.mock("./agent-notifications", () => ({ retryAgentTurnNotifications: vi.fn() }));
vi.mock("./booking-reminders", () => ({ dispatchDueBookingReminders: vi.fn() }));
vi.mock("./social-publishing", () => ({
  dispatchDueSocialPublications: vi.fn(),
  recoverStrandedQueuedSocialPublications: vi.fn(),
}));
vi.mock("./calendar-sources", () => ({ dispatchDueCalendarSourceRefreshes: vi.fn() }));
vi.mock("./routes/channels", () => ({ syncDueSoulinkContacts: vi.fn() }));
vi.mock("./managed-ai-billing", () => ({
  syncManagedAiUsage: vi.fn(),
  refreshManagedBillingPolicyIfStale: vi.fn(async () => undefined),
}));
vi.mock("./campaign-delivery", async (original) => ({
  ...(await original<typeof import("./campaign-delivery")>()),
  dispatchDueCampaignJobs: vi.fn(),
  recoverManagedCampaignEvents: vi.fn(async () => undefined),
}));

const QUARTER_HOUR_CRON = "*/15 * * * *";
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => consoleError.mockRestore());

it("keeps dispatching calendar pushes when an earlier scheduled step throws", async () => {
  vi.mocked(reconcileProductOrders).mockRejectedValueOnce(new Error("orders unavailable"));
  vi.mocked(reconcileMailboxAttachmentStaging).mockRejectedValueOnce(new Error("staging unavailable"));
  vi.mocked(dispatchDueMorningCalendarPushes).mockRejectedValueOnce(new Error("morning unavailable"));
  vi.mocked(dispatchDueGratitudeReminders).mockRejectedValueOnce(new Error("gratitude unavailable"));

  await expect(worker.scheduled({ cron: QUARTER_HOUR_CRON } as ScheduledEvent, {} as Env)).rejects.toThrow();

  expect(dispatchDueCalendarPushNotifications).toHaveBeenCalledOnce();
  expect(dispatchDueBookingReminders).toHaveBeenCalledOnce();
  expect(dispatchDueSocialPublications).toHaveBeenCalledOnce();
  expect(dispatchDueCampaignJobs).toHaveBeenCalledOnce();
  expect(releaseManagedRuntimeWriteLease).toHaveBeenCalledOnce();
});

it("logs each failed scheduled step by name", async () => {
  vi.mocked(reconcileProductOrders).mockRejectedValueOnce(new Error("orders unavailable"));
  vi.mocked(dispatchDueGratitudeReminders).mockRejectedValueOnce(new Error("gratitude unavailable"));

  await worker.scheduled({ cron: QUARTER_HOUR_CRON } as ScheduledEvent, {} as Env).catch(() => undefined);

  const logged = consoleError.mock.calls.map((call) => String(call[0]));
  expect(logged).toEqual(expect.arrayContaining([
    expect.stringContaining("product order reconciliation"),
    expect.stringContaining("gratitude reminders"),
  ]));
});

it("dispatches calendar pushes on the minute cron so reminders arrive on time", async () => {
  await worker.scheduled({ cron: CAMPAIGN_DISPATCH_CRON } as ScheduledEvent, {} as Env);

  expect(dispatchDueCalendarPushNotifications).toHaveBeenCalledOnce();
  expect(dispatchDueCampaignJobs).toHaveBeenCalledOnce();
  expect(dispatchDueBookingReminders).not.toHaveBeenCalled();
});

it("still dispatches calendar pushes on the minute cron when campaign dispatch fails", async () => {
  vi.mocked(dispatchDueCampaignJobs).mockRejectedValueOnce(new Error("delivery unavailable"));

  await expect(worker.scheduled({ cron: CAMPAIGN_DISPATCH_CRON } as ScheduledEvent, {} as Env))
    .rejects.toThrow("delivery unavailable");

  expect(dispatchDueCalendarPushNotifications).toHaveBeenCalledOnce();
});
