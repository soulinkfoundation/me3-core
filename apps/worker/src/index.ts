import { reconcileProductOrders } from "./commerce-reconciliation";
import { reconcileMailboxAttachmentStaging } from "./mailbox-attachment-staging";
import app from "./app";
import { dispatchDueCalendarSourceRefreshes } from "./calendar-sources";
import { dispatchDueCalendarPushNotifications } from "./calendar-push-notifications";
import {
  BOOKING_REMINDER_QUEUE_NAME,
  dispatchDueBookingReminders,
  processBookingReminderBatch,
} from "./booking-reminders";
import {
  dispatchDueScheduledAssistantJobs,
  markAssistantJobQueueMessageFailed,
  processAssistantJobQueueMessage,
} from "./assistant-jobs";
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
  AssistantJobEventQueueMessage,
  BookingReminderQueueMessage,
  Env,
  SocialPublishQueueMessage,
} from "./types";

export { Me3UserAgent };
export { getMe3CloudUsernamePublishBlockReason } from "./sites";

export async function handleAssistantJobQueueBatch(
  batch: MessageBatch<AssistantJobEventQueueMessage>,
  env: Env,
) {
  const isDeadLetterBatch = batch.queue.includes("dlq");

  for (const message of batch.messages) {
    try {
      if (isDeadLetterBatch) {
        await markAssistantJobQueueMessageFailed(
          env,
          message.body,
          new Error("Assistant Job queue message reached the dead-letter queue"),
        );
      } else {
        await processAssistantJobQueueMessage(env, message.body);
      }
      message.ack();
    } catch (error) {
      if (isDeadLetterBatch) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}

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
      return await handleInboundEmail(message, env);
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
      await reconcileMailboxAttachmentStaging(env);
      await dispatchDueScheduledAssistantJobs(env);
      await dispatchDueCalendarPushNotifications(env);
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
      AssistantJobEventQueueMessage | BookingReminderQueueMessage | SocialPublishQueueMessage
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
      return await handleAssistantJobQueueBatch(
        batch as MessageBatch<AssistantJobEventQueueMessage>,
        env,
      );
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
