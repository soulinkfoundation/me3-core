import type { MessageBatch } from "@cloudflare/workers-types";
import {
  EmailProviderInputError,
  sendEmailWithProvider,
} from "./email-providers";
import { resolveTelegramBotToken } from "./telegram-settings";
import type {
  BookingReminderQueueMessage,
  DbBooking,
  DbBookingReminder,
  Env,
} from "./types";

export const BOOKING_REMINDER_QUEUE_NAME = "me3-booking-reminders";

type BookingReminderType = "booking_reminder_24h" | "booking_reminder_2h";
type BookingReminderChannel = "email" | "telegram" | "soulink";
type BookingReminderSettings = {
  enabled?: boolean;
  reminder24h?: boolean;
  reminder2h?: boolean;
};

type BookingReminderPayload = {
  bookingId: string;
  siteId: string;
  userId: string;
  bookingTitle: string;
  hostName: string;
  hostEmail: string;
  guestName: string;
  guestEmail: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  timezone: string;
  notes: string | null;
  amountPaid: number | null;
  currency: string | null;
  isFree: boolean;
  meetingUrl?: string | null;
  meetingHostUrl?: string | null;
  telegramChatId?: string | null;
  soulinkConnectionId?: string | null;
  soulinkThreadId?: string | null;
};

type BookingReminderPlanInput = Omit<
  BookingReminderPayload,
  "userId" | "telegramChatId" | "soulinkConnectionId" | "soulinkThreadId"
> & {
  userId: string;
  reminders?: BookingReminderSettings | null;
  telegramChatId?: string | null;
  soulinkConnection?: {
    id: string;
    threadId: string;
  } | null;
};

type BookingReminderPlanEntry = {
  reminderType: BookingReminderType;
  channel: BookingReminderChannel;
  scheduledFor: string;
  payload: BookingReminderPayload;
};

type ReminderSendResult =
  | { status: "sent"; providerMessageId?: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; retryable?: boolean };

type OwnerProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  timezone: string | null;
};

type ActiveChannelConnectionRow = {
  id: string;
  setup_token: string;
  provider_connection_id: string | null;
  provider_thread_id: string | null;
  telegram_chat_id: string | null;
};

type SoulinkNotifyResult = {
  ok?: unknown;
  messageId?: unknown;
  error?: unknown;
};

export async function scheduleBookingRemindersForBooking(
  env: Env,
  input: {
    booking: DbBooking;
    bookingTitle: string;
    timezone: string;
    reminders?: BookingReminderSettings | null;
  },
): Promise<number> {
  const owner = await getBookingOwner(env, input.booking.site_id);
  if (!owner?.email) return 0;

  if (!(await isBookingRemindersEnabledForSite(env, input.booking.site_id))) {
    return 0;
  }

  const [telegramConnection, soulinkConnection] = await Promise.all([
    getActiveTelegramConnection(env, owner.id),
    getActiveSoulinkConnection(env, owner.id),
  ]);

  const entries = buildBookingReminderPlan({
    bookingId: input.booking.id,
    siteId: input.booking.site_id,
    userId: owner.id,
    bookingTitle: input.bookingTitle,
    hostName: owner.name || "ME3",
    hostEmail: owner.email,
    guestName: input.booking.guest_name,
    guestEmail: input.booking.guest_email,
    startsAt: input.booking.starts_at,
    endsAt: input.booking.ends_at,
    durationMinutes: input.booking.duration_minutes,
    timezone: input.timezone || owner.timezone || "UTC",
    notes: input.booking.notes || null,
    amountPaid: input.booking.amount_paid,
    currency: input.booking.currency,
    isFree: input.booking.is_free_booking === 1,
    meetingUrl: input.booking.meeting_url || null,
    meetingHostUrl: input.booking.meeting_host_url || null,
    reminders: input.reminders,
    telegramChatId: telegramConnection?.telegram_chat_id || null,
    soulinkConnection: soulinkConnection?.provider_thread_id
      ? {
          id: soulinkConnection.id,
          threadId: soulinkConnection.provider_thread_id,
        }
      : null,
  });

  for (const entry of entries) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO booking_reminders
         (id, booking_id, site_id, user_id, reminder_type, channel, status,
          scheduled_for, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
      .bind(
        crypto.randomUUID(),
        input.booking.id,
        input.booking.site_id,
        owner.id,
        entry.reminderType,
        entry.channel,
        entry.scheduledFor,
        JSON.stringify(entry.payload),
      )
      .run();
  }

  return entries.length;
}

export async function cancelPendingBookingReminders(
  env: Env,
  bookingId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE booking_reminders
     SET status = 'cancelled',
         cancelled_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE booking_id = ?
       AND status IN ('scheduled', 'queued', 'processing')`,
  )
    .bind(bookingId)
    .run();
}

export async function isBookingRemindersEnabledForSite(
  env: Env,
  siteId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT aj.status
     FROM sites s
     LEFT JOIN assistant_jobs aj
       ON aj.user_id = s.user_id
      AND aj.recipe_id = 'booking-reminder'
      AND aj.status != 'archived'
     WHERE s.id = ?
     ORDER BY aj.updated_at DESC
     LIMIT 1`,
  )
    .bind(siteId)
    .first<{ status: string | null }>();

  return row?.status !== "paused";
}

export function buildBookingReminderPlan(
  input: BookingReminderPlanInput,
): BookingReminderPlanEntry[] {
  const startMs = new Date(input.startsAt).getTime();
  if (!Number.isFinite(startMs)) return [];

  const reminderSettings = {
    enabled: input.reminders?.enabled ?? true,
    reminder24h: input.reminders?.reminder24h ?? true,
    reminder2h: input.reminders?.reminder2h ?? true,
  };
  const basePayload: BookingReminderPayload = {
    bookingId: input.bookingId,
    siteId: input.siteId,
    userId: input.userId,
    bookingTitle: input.bookingTitle,
    hostName: input.hostName,
    hostEmail: input.hostEmail,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    durationMinutes: input.durationMinutes,
    timezone: input.timezone,
    notes: input.notes,
    amountPaid: input.amountPaid,
    currency: input.currency,
    isFree: input.isFree,
  };
  const candidates: Array<{
    reminderType: BookingReminderType;
    scheduledForMs: number;
    enabled: boolean;
  }> = [
    {
      reminderType: "booking_reminder_24h",
      scheduledForMs: startMs - 24 * 60 * 60 * 1000,
      enabled: reminderSettings.enabled && reminderSettings.reminder24h,
    },
    {
      reminderType: "booking_reminder_2h",
      scheduledForMs: startMs - 2 * 60 * 60 * 1000,
      enabled: reminderSettings.enabled && reminderSettings.reminder2h,
    },
  ];
  const entries: BookingReminderPlanEntry[] = [];
  const nowMs = Date.now();

  for (const candidate of candidates) {
    if (!candidate.enabled || candidate.scheduledForMs <= nowMs) continue;
    const scheduledFor = new Date(candidate.scheduledForMs).toISOString();
    entries.push({
      reminderType: candidate.reminderType,
      channel: "email",
      scheduledFor,
      payload: basePayload,
    });
    if (input.telegramChatId) {
      entries.push({
        reminderType: candidate.reminderType,
        channel: "telegram",
        scheduledFor,
        payload: { ...basePayload, telegramChatId: input.telegramChatId },
      });
    }
    if (input.soulinkConnection) {
      entries.push({
        reminderType: candidate.reminderType,
        channel: "soulink",
        scheduledFor,
        payload: {
          ...basePayload,
          soulinkConnectionId: input.soulinkConnection.id,
          soulinkThreadId: input.soulinkConnection.threadId,
        },
      });
    }
  }

  return entries;
}

export async function dispatchDueBookingReminders(
  env: Env,
  limit = 50,
): Promise<{ queued: number; delivered: number; skipped: number }> {
  await env.DB.prepare(
    `UPDATE booking_reminders
     SET status = 'scheduled',
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing'
       AND updated_at < datetime('now', '-15 minutes')`,
  ).run();

  const dueReminders = await env.DB.prepare(
    `SELECT br.id
     FROM booking_reminders br
     JOIN sites s ON s.id = br.site_id
     LEFT JOIN assistant_jobs aj
       ON aj.user_id = s.user_id
      AND aj.recipe_id = 'booking-reminder'
      AND aj.status != 'archived'
     WHERE br.status = 'scheduled'
       AND br.scheduled_for <= ?
       AND COALESCE(aj.status, 'active') != 'paused'
     ORDER BY br.scheduled_for ASC
     LIMIT ?`,
  )
    .bind(new Date().toISOString(), limit)
    .all<{ id: string }>();

  let queued = 0;
  let delivered = 0;
  let skipped = 0;

  for (const row of dueReminders.results || []) {
    const claimed = await env.DB.prepare(
      `UPDATE booking_reminders
       SET status = 'queued',
           queued_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'scheduled'`,
    )
      .bind(row.id)
      .run();
    if (!claimed.meta.changes) {
      skipped += 1;
      continue;
    }

    if (env.BOOKING_REMINDER_QUEUE) {
      try {
        await env.BOOKING_REMINDER_QUEUE.send({ reminderId: row.id });
        queued += 1;
        continue;
      } catch (error) {
        await markReminderFailed(env, row.id, formatError(error), false);
        skipped += 1;
        continue;
      }
    }

    const result = await deliverBookingReminder(env, row.id);
    if (result.status === "sent") delivered += 1;
    else skipped += 1;
  }

  return { queued, delivered, skipped };
}

export async function deliverBookingReminder(
  env: Env,
  reminderId: string,
): Promise<ReminderSendResult> {
  const reminder = await fetchBookingReminder(env, reminderId);
  if (!reminder) return { status: "skipped", reason: "Reminder not found" };
  if (reminder.status === "sent") return { status: "skipped", reason: "Reminder already sent" };
  if (reminder.status === "cancelled") return { status: "skipped", reason: "Reminder cancelled" };
  if (reminder.status === "failed" || reminder.status === "skipped") {
    return { status: "skipped", reason: `Reminder already ${reminder.status}` };
  }

  if (!(await isBookingRemindersEnabledForSite(env, reminder.site_id))) {
    await cancelPendingBookingReminders(env, reminder.booking_id);
    return { status: "skipped", reason: "Booking reminders job is paused" };
  }

  const claimed = await env.DB.prepare(
    `UPDATE booking_reminders
     SET status = 'processing',
         attempt_count = attempt_count + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status = 'queued'`,
  )
    .bind(reminder.id)
    .run();
  if (!claimed.meta.changes) {
    return { status: "skipped", reason: "Reminder already claimed" };
  }

  let payload: BookingReminderPayload;
  try {
    payload = JSON.parse(reminder.payload_json) as BookingReminderPayload;
  } catch (error) {
    const message = `Invalid reminder payload: ${formatError(error)}`;
    await markReminderFailed(env, reminder.id, message, false);
    return { status: "failed", error: message };
  }

  if (payload.bookingId !== reminder.booking_id || payload.siteId !== reminder.site_id) {
    const message = "Reminder payload does not match reminder row";
    await markReminderFailed(env, reminder.id, message, false);
    return { status: "failed", error: message };
  }

  const booking = await fetchBooking(env, reminder.booking_id);
  if (!booking) {
    await markReminderSkipped(env, reminder.id, "Booking not found");
    return { status: "skipped", reason: "Booking not found" };
  }
  if (booking.status !== "confirmed") {
    await cancelPendingBookingReminders(env, booking.id);
    return { status: "skipped", reason: "Booking no longer confirmed" };
  }

  const result = await sendBookingReminder(env, reminder, payload);
  if (result.status === "sent") {
    await env.DB.prepare(
      `UPDATE booking_reminders
       SET status = 'sent',
           sent_at = CURRENT_TIMESTAMP,
           provider_message_id = ?,
           error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(result.providerMessageId || null, reminder.id)
      .run();
    return result;
  }

  if (result.status === "skipped") {
    await markReminderSkipped(env, reminder.id, result.reason);
    return result;
  }

  await markReminderFailed(env, reminder.id, result.error, result.retryable === true);
  return result;
}

export async function markBookingReminderQueueMessageFailed(
  env: Env,
  message: BookingReminderQueueMessage,
  error: Error,
): Promise<void> {
  if (!message.reminderId) return;
  await env.DB.prepare(
    `UPDATE booking_reminders
     SET status = 'failed',
         failed_at = CURRENT_TIMESTAMP,
         dead_lettered_at = CURRENT_TIMESTAMP,
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status IN ('queued', 'processing', 'scheduled')`,
  )
    .bind(error.message, message.reminderId)
    .run();
}

export async function processBookingReminderBatch(
  batch: MessageBatch<BookingReminderQueueMessage>,
  env: Env,
): Promise<void> {
  const isDeadLetterBatch = batch.queue.includes("dlq");
  for (const message of batch.messages) {
    try {
      if (isDeadLetterBatch) {
        await markBookingReminderQueueMessageFailed(
          env,
          message.body,
          new Error("Booking reminder reached the dead-letter queue"),
        );
        message.ack();
        continue;
      }

      const result = await deliverBookingReminder(env, message.body.reminderId);
      if (result.status === "failed" && result.retryable) {
        message.retry();
        continue;
      }
      message.ack();
    } catch (error) {
      if (isDeadLetterBatch) message.ack();
      else message.retry();
    }
  }
}

async function sendBookingReminder(
  env: Env,
  reminder: DbBookingReminder,
  payload: BookingReminderPayload,
): Promise<ReminderSendResult> {
  if (reminder.channel === "email") return sendEmailReminder(env, payload, reminder.reminder_type, reminder.id);
  if (reminder.channel === "telegram") return sendTelegramReminder(env, payload, reminder.reminder_type);
  if (reminder.channel === "soulink") return sendSoulinkReminder(env, payload, reminder.reminder_type);
  return { status: "skipped", reason: "Unsupported reminder channel" };
}

async function sendEmailReminder(
  env: Env,
  payload: BookingReminderPayload,
  reminderType: BookingReminderType,
  reminderId: string,
): Promise<ReminderSendResult> {
  const guest = buildGuestReminderEmail(reminderType, payload);
  try {
    const result = await sendEmailWithProvider(env, payload.userId, {
      purpose: "workflow",
      operationId: `reminder:${reminderId}:guest`,
      fromName: payload.hostName,
      replyToAddress: payload.hostEmail,
      toAddress: guest.to,
      subject: guest.subject,
      textBody: guest.textBody,
      htmlBody: guest.htmlBody,
      metadata: {
        booking_id: payload.bookingId,
        reminder_type: reminderType,
        reminder_channel: "guest",
      },
      createdBy: "assistant",
    });

    const host = buildHostReminderEmail(reminderType, payload);
    await sendEmailWithProvider(env, payload.userId, {
      purpose: "workflow",
      operationId: `reminder:${reminderId}:host`,
      toAddress: host.to,
      subject: host.subject,
      textBody: host.textBody,
      htmlBody: host.htmlBody,
      metadata: {
        booking_id: payload.bookingId,
        reminder_type: reminderType,
        reminder_channel: "host",
      },
      createdBy: "assistant",
    }).catch((error) => {
      // Managed retries replay the completed guest operation; other providers
      // retain their existing best-effort host-copy behavior.
      if (result.providerId === "managed_gateway") throw error;
    });

    return { status: "sent", providerMessageId: result.providerMessageId };
  } catch (error) {
    return {
      status: "failed",
      error: formatError(error),
      retryable: !(error instanceof EmailProviderInputError),
    };
  }
}

async function sendTelegramReminder(
  env: Env,
  payload: BookingReminderPayload,
  reminderType: BookingReminderType,
): Promise<ReminderSendResult> {
  if (!payload.telegramChatId) {
    return { status: "skipped", reason: "No active Telegram chat" };
  }
  const botToken = await resolveTelegramBotToken(env, payload.userId);
  if (!botToken) {
    return { status: "failed", error: "Telegram bot token is not configured" };
  }

  try {
    await sendTelegramMessage(botToken, payload.telegramChatId, buildOwnerReminderText(reminderType, payload));
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: formatError(error), retryable: true };
  }
}

async function sendSoulinkReminder(
  env: Env,
  payload: BookingReminderPayload,
  reminderType: BookingReminderType,
): Promise<ReminderSendResult> {
  if (!payload.soulinkConnectionId || !payload.soulinkThreadId) {
    return { status: "skipped", reason: "No active Soulink thread" };
  }
  const connection = await getActiveSoulinkConnection(env, payload.userId);
  if (!connection || connection.id !== payload.soulinkConnectionId) {
    return { status: "skipped", reason: "Soulink connection is no longer active" };
  }

  const providerEventId = crypto.randomUUID();
  const messageText = buildOwnerReminderText(reminderType, payload);
  const eventId = await insertOwnerNotificationChannelEvent(env, {
    connection,
    providerEventId,
    status: "pending",
    messageText,
    rawJson: { bookingId: payload.bookingId, reminderType },
  });

  try {
    const response = await fetch(`${getSoulinkApiOrigin(env)}/api/me3/assistant-channel/notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.setup_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        streamChannelType: connection.provider_connection_id || "messaging",
        streamChannelId: connection.provider_thread_id,
        messageId: providerEventId,
        messageText,
        createdAt: new Date().toISOString(),
      }),
    });
    const body = await response.json().catch(() => null) as SoulinkNotifyResult | null;
    if (!response.ok || body?.ok !== true) {
      const message = normalizeOptionalText(body?.error) || `Soulink notification failed with ${response.status}`;
      await updateOwnerNotificationChannelEvent(env, eventId, "failed", null, body, message);
      return { status: "failed", error: message, retryable: response.status >= 500 };
    }

    const providerMessageId = normalizeOptionalText(body.messageId);
    await updateOwnerNotificationChannelEvent(env, eventId, "sent", providerMessageId, body, null);
    await updateOwnerNotificationConnectionSentAt(env, connection.id);
    return { status: "sent", providerMessageId };
  } catch (error) {
    const message = formatError(error);
    await updateOwnerNotificationChannelEvent(env, eventId, "failed", null, null, message);
    return { status: "failed", error: message, retryable: true };
  }
}

function buildGuestReminderEmail(reminderType: BookingReminderType, payload: BookingReminderPayload) {
  const timeLabel =
    reminderType === "booking_reminder_24h"
      ? "Your booking is coming up tomorrow"
      : "Your booking is coming up soon";
  const startTime = formatBookingTime(payload.startsAt, payload.timezone);
  const notes = normalizeText(payload.notes);
  const subject = `Reminder: ${payload.bookingTitle} with ${payload.hostName}`;
  const textBody = `Hi ${payload.guestName},

${timeLabel}.

${payload.bookingTitle} with ${payload.hostName}
${startTime}
Duration: ${payload.durationMinutes} minutes${payload.meetingUrl ? `\nJoin call: ${payload.meetingUrl}` : ""}${notes ? `\n\nYour notes:\n${notes}` : ""}

If you need to reschedule, reply to ${payload.hostEmail}.`;
  const htmlBody = `<!doctype html><html><body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;background:#f6f6f6"><main style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px"><h1 style="margin:0 0 8px">Reminder</h1><p style="margin:0 0 24px;color:#555">${escapeHtml(timeLabel)}</p><h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(payload.bookingTitle)}</h2><p><strong>With:</strong> ${escapeHtml(payload.hostName)}</p><p><strong>When:</strong> ${escapeHtml(startTime)}</p><p><strong>Duration:</strong> ${payload.durationMinutes} minutes</p>${payload.meetingUrl ? `<p><strong>Join call:</strong> <a href="${escapeHtml(payload.meetingUrl)}">${escapeHtml(payload.meetingUrl)}</a></p>` : ""}${notes ? `<p><strong>Your notes:</strong><br>${escapeHtml(notes).replace(/\n/g, "<br>")}</p>` : ""}<p style="color:#555">If you need to reschedule, reply to ${escapeHtml(payload.hostEmail)}.</p></main></body></html>`;
  return { to: payload.guestEmail, subject, textBody, htmlBody };
}

function buildHostReminderEmail(reminderType: BookingReminderType, payload: BookingReminderPayload) {
  const timeLabel =
    reminderType === "booking_reminder_24h"
      ? "You have a booking coming up tomorrow"
      : "You have a booking coming up soon";
  const startTime = formatBookingTime(payload.startsAt, payload.timezone);
  const notes = normalizeText(payload.notes);
  const subject = `Upcoming: ${payload.bookingTitle} with ${payload.guestName}`;
  const textBody = `Hi ${payload.hostName},

${timeLabel}.

${payload.bookingTitle} with ${payload.guestName}
${startTime}
Duration: ${payload.durationMinutes} minutes
Guest contact: ${payload.guestEmail}${payload.meetingHostUrl || payload.meetingUrl ? `\nCall room: ${payload.meetingHostUrl || payload.meetingUrl}` : ""}${notes ? `\n\nGuest notes:\n${notes}` : ""}`;
  const htmlBody = `<!doctype html><html><body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;background:#f6f6f6"><main style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px"><h1 style="margin:0 0 8px">Upcoming booking</h1><p style="margin:0 0 24px;color:#555">${escapeHtml(timeLabel)}</p><h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(payload.bookingTitle)}</h2><p><strong>With:</strong> ${escapeHtml(payload.guestName)}</p><p><strong>When:</strong> ${escapeHtml(startTime)}</p><p><strong>Duration:</strong> ${payload.durationMinutes} minutes</p><p><strong>Guest contact:</strong> ${escapeHtml(payload.guestEmail)}</p>${payload.meetingHostUrl || payload.meetingUrl ? `<p><strong>Call room:</strong> <a href="${escapeHtml((payload.meetingHostUrl || payload.meetingUrl)!)}">${escapeHtml((payload.meetingHostUrl || payload.meetingUrl)!)}</a></p>` : ""}${notes ? `<p><strong>Guest notes:</strong><br>${escapeHtml(notes).replace(/\n/g, "<br>")}</p>` : ""}</main></body></html>`;
  return { to: payload.hostEmail, subject, textBody, htmlBody };
}

function buildOwnerReminderText(reminderType: BookingReminderType, payload: BookingReminderPayload): string {
  const timeLabel =
    reminderType === "booking_reminder_24h"
      ? "You have a booking coming up tomorrow"
      : "You have a booking coming up soon";
  const notes = normalizeText(payload.notes);
  const lines = [
    "Upcoming booking",
    "",
    timeLabel,
    "",
    `${payload.bookingTitle} with ${payload.guestName}`,
    formatBookingTime(payload.startsAt, payload.timezone),
    `${payload.durationMinutes} minutes`,
    payload.guestEmail,
  ];
  if (payload.meetingHostUrl || payload.meetingUrl) lines.push(payload.meetingHostUrl || payload.meetingUrl || "");
  if (notes) lines.push("", "Guest notes:", notes);
  return lines.join("\n");
}

async function fetchBookingReminder(env: Env, reminderId: string) {
  return env.DB.prepare("SELECT * FROM booking_reminders WHERE id = ?")
    .bind(reminderId)
    .first<DbBookingReminder>();
}

async function fetchBooking(env: Env, bookingId: string) {
  return env.DB.prepare(
    `SELECT id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at,
            duration_minutes, calendar_event_id, status, notes, created_at,
            cancelled_at, payment_intent_id, amount_paid, suggested_amount,
            currency, payment_status, is_free_booking, paid_at, meeting_url, meeting_host_url
     FROM bookings
     WHERE id = ?`,
  )
    .bind(bookingId)
    .first<DbBooking>();
}

async function getBookingOwner(env: Env, siteId: string): Promise<OwnerProfileRow | null> {
  return env.DB.prepare(
    `SELECT o.id, o.email, o.name, o.timezone
     FROM sites s
     JOIN owner_profile o ON o.id = s.user_id
     WHERE s.id = ?
     LIMIT 1`,
  )
    .bind(siteId)
    .first<OwnerProfileRow>();
}

async function getActiveTelegramConnection(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT id, setup_token, provider_connection_id, provider_thread_id, telegram_chat_id
     FROM agent_channel_connections
     WHERE user_id = ?
       AND channel = 'telegram'
       AND status = 'active'
       AND telegram_chat_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<ActiveChannelConnectionRow>();
}

async function getActiveSoulinkConnection(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT id, setup_token, provider_connection_id, provider_thread_id, telegram_chat_id
     FROM agent_channel_connections
     WHERE user_id = ?
       AND channel = 'soulink'
       AND status = 'active'
       AND provider_thread_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<ActiveChannelConnectionRow>();
}

async function insertOwnerNotificationChannelEvent(
  env: Env,
  input: {
    connection: ActiveChannelConnectionRow;
    providerEventId: string;
    status: "pending" | "sent" | "failed";
    messageText: string;
    rawJson: unknown;
  },
) {
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_channel_events
       (id, connection_id, channel, direction, event_type, status,
        provider_event_id, provider_message_id, reply_to_message_id,
        text_body, raw_json, error_message, created_at, updated_at)
     VALUES (?, ?, 'soulink', 'outbound', 'send', ?, ?, NULL, NULL, ?, ?, NULL,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      eventId,
      input.connection.id,
      input.status,
      input.providerEventId,
      input.messageText,
      JSON.stringify(input.rawJson),
    )
    .run();
  return eventId;
}

async function updateOwnerNotificationChannelEvent(
  env: Env,
  eventId: string,
  status: "sent" | "failed",
  providerMessageId: string | null,
  rawJson: unknown,
  errorMessage: string | null,
) {
  await env.DB.prepare(
    `UPDATE agent_channel_events
     SET status = ?,
         provider_message_id = ?,
         raw_json = ?,
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(status, providerMessageId, JSON.stringify(rawJson), errorMessage, eventId)
    .run();
}

async function updateOwnerNotificationConnectionSentAt(env: Env, connectionId: string) {
  await env.DB.prepare(
    `UPDATE agent_channel_connections
     SET last_outbound_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(connectionId)
    .run();
}

async function markReminderFailed(
  env: Env,
  reminderId: string,
  message: string,
  retryable: boolean,
) {
  await env.DB.prepare(
    `UPDATE booking_reminders
     SET status = ?,
         failed_at = CASE WHEN ? = 'failed' THEN CURRENT_TIMESTAMP ELSE failed_at END,
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(retryable ? "scheduled" : "failed", retryable ? "scheduled" : "failed", message, reminderId)
    .run();
}

async function markReminderSkipped(env: Env, reminderId: string, message: string) {
  await env.DB.prepare(
    `UPDATE booking_reminders
     SET status = 'skipped',
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(message, reminderId)
    .run();
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncateText(text, 4096) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { description?: string } | null;
    throw new Error(payload?.description || `Telegram sendMessage failed (${response.status})`);
  }
}

function formatBookingTime(startsAt: string, timezone: string): string {
  return new Date(startsAt).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: timezone || "UTC",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim() || "";
  return trimmed || null;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSoulinkApiOrigin(env: Env) {
  const configured = normalizeOptionalText(env.SOULINK_API_ORIGIN);
  if (!configured) return "https://soulinkfoundation.org";
  try {
    return new URL(configured).origin;
  } catch {
    return "https://soulinkfoundation.org";
  }
}
