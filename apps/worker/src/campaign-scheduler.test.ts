import { beforeEach, expect, it, vi } from "vitest";
import worker from "./index";
import { CAMPAIGN_DISPATCH_CRON, dispatchDueCampaignJobs, recoverManagedCampaignEvents } from "./campaign-delivery";
import { dispatchDueScheduledAssistantJobs } from "./assistant-jobs";
import { beginManagedRuntimeWriteLease, releaseManagedRuntimeWriteLease } from "./managed-runtime-lifecycle";
import type { Env } from "./types";

vi.mock("./app", () => ({ default: {} }));
vi.mock("./user-agent", () => ({ Me3UserAgent: class {} }));
vi.mock("./sdk-user-agent", () => ({ Me3SdkUserAgent: class {} }));
vi.mock("./core-runtime-migrations", () => ({ ensureCoreRuntimeMigrations: vi.fn() }));
vi.mock("./campaign-delivery", async (original) => ({
  ...(await original<typeof import("./campaign-delivery")>()),
  dispatchDueCampaignJobs: vi.fn(),
  recoverManagedCampaignEvents: vi.fn(),
}));
vi.mock("./assistant-jobs", () => ({ dispatchDueScheduledAssistantJobs: vi.fn() }));
vi.mock("./managed-runtime-lifecycle", () => ({
  isManagedRuntime: () => true,
  getManagedInstallationId: () => "install-test",
  beginManagedRuntimeWriteLease: vi.fn(),
  releaseManagedRuntimeWriteLease: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(beginManagedRuntimeWriteLease).mockResolvedValue({
    leaseId: "lease-test", installationId: "install-test",
  });
});

it("dispatches campaigns on the minute without running other background jobs", async () => {
  await worker.scheduled({ cron: CAMPAIGN_DISPATCH_CRON } as ScheduledEvent, {} as Env);
  expect(dispatchDueCampaignJobs).toHaveBeenCalledOnce();
  expect(dispatchDueScheduledAssistantJobs).not.toHaveBeenCalled();
  expect(recoverManagedCampaignEvents).not.toHaveBeenCalled();
  expect(releaseManagedRuntimeWriteLease).toHaveBeenCalledOnce();
});

it("does not dispatch during managed maintenance", async () => {
  vi.mocked(beginManagedRuntimeWriteLease).mockResolvedValue(null);
  await worker.scheduled({ cron: CAMPAIGN_DISPATCH_CRON } as ScheduledEvent, {} as Env);
  expect(dispatchDueCampaignJobs).not.toHaveBeenCalled();
});

it("releases the maintenance lease when campaign dispatch fails", async () => {
  vi.mocked(dispatchDueCampaignJobs).mockRejectedValueOnce(new Error("delivery unavailable"));
  await expect(worker.scheduled({ cron: CAMPAIGN_DISPATCH_CRON } as ScheduledEvent, {} as Env))
    .rejects.toThrow("delivery unavailable");
  expect(releaseManagedRuntimeWriteLease).toHaveBeenCalledOnce();
});
