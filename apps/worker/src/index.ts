import { reconcileProductOrders } from "./commerce-reconciliation";
import { expireStaleAgentCheckouts } from "./agent-commerce";
import { pollNetworkPurchases } from "./agent-network-commerce";
import { reconcileMailboxAttachmentStaging } from "./mailbox-attachment-staging";
import app from "./app";
import { dispatchDueCalendarSourceRefreshes } from "./calendar-sources";
import { dispatchDueCalendarPushNotifications } from "./calendar-push-notifications";
import { dispatchDueMorningCalendarPushes } from "./morning-calendar-push";
import { dispatchDueGratitudeReminders } from "./gratitude";
import { retryPendingMailTriage } from "./mailbox-triage";
import { retryAgentTurnNotifications } from "./agent-notifications";
import {
  BOOKING_REMINDER_QUEUE_NAME,
  dispatchDueBookingReminders,
  processBookingReminderBatch,
} from "./booking-reminders";
import {
  dispatchDueSocialPublications,
  processSocialPublishBatch,
  recoverStrandedQueuedSocialPublications,
  SOCIAL_PUBLISH_QUEUE_NAME,
} from "./social-publishing";
import {
  handleInboundEmail,
  type ForwardableEmailMessageLike,
} from "./routes/mailbox";
import {
  ensureCoreRuntimeMigrations,
  ensureCoreRuntimeMigrationsForRequest,
} from "./core-runtime-migrations";
import { Me3UserAgent } from "./user-agent";
import { Me3Agent } from "./me3-agent";
import { syncManagedAiUsage } from "./managed-ai-billing";
import { syncDueSoulinkContacts } from "./routes/channels";
import {
  CAMPAIGN_DISPATCH_CRON,
  dispatchDueCampaignJobs,
  recoverManagedCampaignEvents,
} from "./campaign-delivery";
import {
  beginManagedRuntimeWriteLease,
  getManagedInstallationId,
  isManagedRuntime,
  releaseManagedRuntimeWriteLease,
} from "./managed-runtime-lifecycle";
import type {
  BookingReminderQueueMessage,
  Env,
  SocialPublishQueueMessage,
} from "./types";

export { Me3UserAgent, Me3Agent };
export { getMe3CloudUsernamePublishBlockReason } from "./sites";

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    const migrationResponse = await ensureCoreRuntimeMigrationsForRequest(request, env);
    if (migrationResponse) return migrationResponse;
    return app.fetch(request, env, ctx);
  },
  async email(message: ForwardableEmailMessageLike, env: Env, _ctx?: ExecutionContext) {
    await ensureCoreRuntimeMigrations(env);
    const lease = await acquireBackgroundWriteLease(env, "EMAIL", "email");
    if (shouldBlockManagedRuntimeBackground(env, lease)) {
      message.setReject("Managed ME3 is not accepting email during maintenance");
      return;
    }
    try {
      return await handleInboundEmail(message, env, {
        waitUntil: _ctx ? (work) => _ctx.waitUntil(work) : undefined,
      });
    } finally {
      await releaseManagedRuntimeWriteLease(env, lease);
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, _ctx?: ExecutionContext) {
    await ensureCoreRuntimeMigrations(env);
    const lease = await acquireBackgroundWriteLease(env, "SCHEDULED", "scheduled");
    if (shouldBlockManagedRuntimeBackground(env, lease)) return;
    try {
      if (_event.cron === CAMPAIGN_DISPATCH_CRON) {
        await dispatchDueCampaignJobs(env);
        return;
      }
      await reconcileProductOrders(env);
      await expireStaleAgentCheckouts(env).catch((error) => console.error("Agent checkout sweep failed", error));
      await pollNetworkPurchases(env).catch(() => console.error("Network purchase sweep failed"));
      await reconcileMailboxAttachmentStaging(env);
      await retryPendingMailTriage(env).catch((error) => console.error("Mail triage retry failed", error));
      await dispatchDueMorningCalendarPushes(env);
      await dispatchDueGratitudeReminders(env);
      await dispatchDueCalendarPushNotifications(env);
      await retryAgentTurnNotifications(env);
      await dispatchDueBookingReminders(env);
      await dispatchDueSocialPublications(env);
      await recoverStrandedQueuedSocialPublications(env);
      await dispatchDueCalendarSourceRefreshes(env);
      await syncDueSoulinkContacts(env);
      await syncManagedAiUsage(env);
      await dispatchDueCampaignJobs(env);
      await recoverManagedCampaignEvents(env).catch(() => undefined);
    } finally {
      await releaseManagedRuntimeWriteLease(env, lease);
    }
  },
  async queue(
    batch: MessageBatch<
      BookingReminderQueueMessage | SocialPublishQueueMessage
    >,
    env: Env,
  ) {
    await ensureCoreRuntimeMigrations(env);
    const lease = await acquireBackgroundWriteLease(env, "QUEUE", "queue");
    if (shouldBlockManagedRuntimeBackground(env, lease)) {
      for (const message of batch.messages) message.retry();
      return;
    }
    try {
      if (batch.queue === BOOKING_REMINDER_QUEUE_NAME || batch.queue.includes("booking-reminders")) {
        return await processBookingReminderBatch(
          batch as MessageBatch<BookingReminderQueueMessage>,
          env,
        );
      }
      if (batch.queue === SOCIAL_PUBLISH_QUEUE_NAME || batch.queue.includes("social-publish")) {
        return await processSocialPublishBatch(batch as MessageBatch<SocialPublishQueueMessage>, env);
      }
      for (const message of batch.messages) message.ack();
    } finally {
      await releaseManagedRuntimeWriteLease(env, lease);
    }
  },
};

async function acquireBackgroundWriteLease(
  env: Env,
  method: string,
  pathClass: "email" | "queue" | "scheduled",
) {
  if (!isManagedRuntime(env)) return null;
  if (!getManagedInstallationId(env) && env.ENVIRONMENT !== "production") return null;
  return beginManagedRuntimeWriteLease(env, method, pathClass);
}

export function shouldBlockManagedRuntimeBackground(
  env: Env,
  lease: { leaseId: string; installationId: string } | null,
): boolean {
  return (
    isManagedRuntime(env) &&
    (Boolean(getManagedInstallationId(env)) || env.ENVIRONMENT === "production") &&
    !lease
  );
}

export default worker;
