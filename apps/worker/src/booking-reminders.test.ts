import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOKING_REMINDER_QUEUE_NAME,
  dispatchDueBookingReminders,
  processBookingReminderBatch,
  scheduleBookingRemindersForBooking,
  getSiteBookingReminders,
  updateSiteBookingReminders,
} from "./booking-reminders";
import {
  EmailProviderInputError,
  EmailProviderDeliveryUnknownError,
  sendEmailWithProvider,
} from "./email-providers";
import type { DbBooking, Env } from "./types";

vi.mock("./email-providers", async () => {
  const actual = await vi.importActual<typeof import("./email-providers")>(
    "./email-providers",
  );
  return {
    ...actual,
    sendEmailWithProvider: vi.fn(),
  };
});

type ReminderRow = {
  id: string;
  booking_id: string;
  site_id: string;
  user_id: string;
  reminder_type: "booking_reminder_24h" | "booking_reminder_2h";
  channel: "email" | "telegram" | "soulink";
  status: "scheduled" | "queued" | "processing" | "sent" | "cancelled" | "failed" | "skipped";
  scheduled_for: string;
  queued_at: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  failed_at: string | null;
  dead_lettered_at: string | null;
  attempt_count: number;
  payload_json: string;
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type TestState = {
  booking: DbBooking;
  reminders: ReminderRow[];
  queuedMessages: unknown[];
  siteEnabled: number;
};

const mockSendEmailWithProvider = vi.mocked(sendEmailWithProvider);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
  mockSendEmailWithProvider.mockReset();
  mockSendEmailWithProvider.mockResolvedValue({
    auditId: "audit-1",
    providerId: "smtp",
    providerLabel: "SMTP",
    providerMessageId: "message-1",
    providerStatus: "sent",
    sentAt: "2026-06-01T10:00:01Z",
  });
});

describe("booking reminders", () => {
  it("schedules email reminders idempotently from a booking", async () => {
    const env = createEnv();

    const first = await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking,
      bookingTitle: "Coaching Session",
      timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: true },
    });
    const duplicate = await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking,
      bookingTitle: "Coaching Session",
      timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: true },
    });

    expect(first).toBe(2);
    expect(duplicate).toBe(2);
    expect(env.__state.reminders).toHaveLength(2);
    expect(env.__state.reminders.map((row) => row.reminder_type)).toEqual([
      "booking_reminder_24h",
      "booking_reminder_2h",
    ]);
  });

  it("enqueues due reminders and prevents duplicate queue claims", async () => {
    const env = createEnv({ queue: true });
    await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking,
      bookingTitle: "Coaching Session",
      timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: false },
    });
    env.__state.reminders[0]!.scheduled_for = "2026-06-01T09:59:00Z";

    const first = await dispatchDueBookingReminders(env);
    const second = await dispatchDueBookingReminders(env);

    expect(first).toEqual({ queued: 1, delivered: 0, skipped: 0 });
    expect(second).toEqual({ queued: 0, delivered: 0, skipped: 0 });
    expect(env.__state.queuedMessages).toEqual([
      { reminderId: env.__state.reminders[0]!.id },
    ]);
    expect(env.__state.reminders[0]!.status).toBe("queued");
  });

  it("processes queued email reminders", async () => {
    const env = createEnv();
    await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking,
      bookingTitle: "Coaching Session",
      timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: false },
    });
    env.__state.reminders[0]!.status = "queued";
    const message = createQueueMessage(env.__state.reminders[0]!.id);

    await processBookingReminderBatch(
      { queue: BOOKING_REMINDER_QUEUE_NAME, messages: [message] } as never,
      env,
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(mockSendEmailWithProvider).toHaveBeenCalledTimes(2);
    expect(env.__state.reminders[0]).toMatchObject({
      status: "sent",
      provider_message_id: "message-1",
      error_message: null,
    });
  });

  it("retries an ambiguous managed host copy with stable guest and host operation IDs", async () => {
    const env = createEnv();
    await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking, bookingTitle: "Session", timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: false },
    });
    const reminder = env.__state.reminders[0]!;
    reminder.status = "queued";
    const accepted = { auditId: "audit", providerId: "managed_gateway" as const, providerLabel: "Managed", providerMessageId: "guest", providerStatus: "accepted", sentAt: new Date().toISOString() };
    mockSendEmailWithProvider.mockResolvedValueOnce(accepted).mockRejectedValueOnce(new EmailProviderDeliveryUnknownError()).mockResolvedValue(accepted);
    const message = createQueueMessage(reminder.id);
    await processBookingReminderBatch({ queue: BOOKING_REMINDER_QUEUE_NAME, messages: [message] } as never, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(reminder.status).toBe("scheduled");
    reminder.status = "queued";
    await processBookingReminderBatch({ queue: BOOKING_REMINDER_QUEUE_NAME, messages: [createQueueMessage(reminder.id)] } as never, env);
    const operations = mockSendEmailWithProvider.mock.calls.map((call) => call[2].operationId);
    expect(operations).toEqual([`reminder:${reminder.id}:guest`, `reminder:${reminder.id}:host`, `reminder:${reminder.id}:guest`, `reminder:${reminder.id}:host`]);
    expect(reminder.status).toBe("sent");
  });

  it("marks setup-missing email providers as failed", async () => {
    const env = createEnv();
    await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking,
      bookingTitle: "Coaching Session",
      timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: false },
    });
    env.__state.reminders[0]!.status = "queued";
    mockSendEmailWithProvider.mockRejectedValueOnce(
      new EmailProviderInputError("Email provider is not configured", 503),
    );
    const message = createQueueMessage(env.__state.reminders[0]!.id);

    await processBookingReminderBatch(
      { queue: BOOKING_REMINDER_QUEUE_NAME, messages: [message] } as never,
      env,
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(env.__state.reminders[0]).toMatchObject({
      status: "failed",
      error_message: "Email provider is not configured",
    });
  });

  it("does not schedule when booking reminders are paused", async () => {
    const env = createEnv({ enabled: false });

    const scheduled = await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking,
      bookingTitle: "Coaching Session",
      timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: true },
    });

    expect(scheduled).toBe(0);
    expect(env.__state.reminders).toHaveLength(0);
  });
  it("persists the site switch and respects ownership and boolean input", async () => {
    const env = createEnv();
    expect(await getSiteBookingReminders(env, "owner", "site-1")).toEqual({ enabled: true });
    expect(await updateSiteBookingReminders(env, "owner", "site-1", false)).toEqual({ enabled: false });
    expect(await getSiteBookingReminders(env, "owner", "site-1")).toEqual({ enabled: false });
    await expect(updateSiteBookingReminders(env, "other", "site-1", true)).rejects.toMatchObject({ status: 404 });
    await expect(getSiteBookingReminders(env, "other", "site-1")).rejects.toMatchObject({ status: 404 });
    await expect(updateSiteBookingReminders(env, "owner", "site-1", "false")).rejects.toMatchObject({ status: 400 });
    expect(env.__state.siteEnabled).toBe(0);
  });

  it("holds due reminders while disabled and sends them after re-enabling without a queue", async () => {
    const env = createEnv();
    await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking, bookingTitle: "Session", timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: false },
    });
    env.__state.reminders[0]!.scheduled_for = "2026-06-01T09:59:00Z";
    await updateSiteBookingReminders(env, "owner", "site-1", false);
    expect(await dispatchDueBookingReminders(env)).toEqual({ queued: 0, delivered: 0, skipped: 0 });
    expect(mockSendEmailWithProvider).not.toHaveBeenCalled();
    await updateSiteBookingReminders(env, "owner", "site-1", true);
    expect(await dispatchDueBookingReminders(env)).toEqual({ queued: 0, delivered: 1, skipped: 0 });
    expect(mockSendEmailWithProvider).toHaveBeenCalledTimes(2);
    expect(env.__state.reminders[0]!.status).toBe("sent");
  });

  it("does not send an already queued reminder after the site switch is disabled", async () => {
    const env = createEnv({ queue: true });
    await scheduleBookingRemindersForBooking(env, {
      booking: env.__state.booking, bookingTitle: "Session", timezone: "Europe/Dublin",
      reminders: { enabled: true, reminder24h: true, reminder2h: false },
    });
    const reminder = env.__state.reminders[0]!;
    reminder.status = "queued";
    await updateSiteBookingReminders(env, "owner", "site-1", false);
    const message = createQueueMessage(reminder.id);
    await processBookingReminderBatch({ queue: BOOKING_REMINDER_QUEUE_NAME, messages: [message] } as never, env);
    expect(mockSendEmailWithProvider).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(reminder.status).toBe("cancelled");
  });
});

function createQueueMessage(reminderId: string) {
  return {
    body: { reminderId },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createEnv(options: { queue?: boolean; enabled?: boolean } = {}) {
  const state: TestState = {
    booking: {
      id: "booking-1",
      site_id: "site-1",
      offer_id: "offer-1",
      booking_type: "one_to_one",
      guest_name: "Guest Person",
      guest_email: "guest@example.com",
      starts_at: "2026-06-03T10:00:00.000Z",
      ends_at: "2026-06-03T11:00:00.000Z",
      duration_minutes: 60,
      calendar_event_id: null,
      status: "confirmed",
      notes: "Bring notes",
      created_at: "2026-06-01T10:00:00Z",
      cancelled_at: null,
      payment_intent_id: null,
      amount_paid: null,
      suggested_amount: null,
      currency: null,
      payment_status: "not_required",
      is_free_booking: 1,
      paid_at: null,
    },
    reminders: [],
    queuedMessages: [],
    siteEnabled: options.enabled === false ? 0 : 1,
  };

  const db = {
    prepare(sql: string) {
      const values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values.push(...nextValues);
          return this;
        },
        first<T>() {
          return Promise.resolve(handleFirst(state, sql, values) as T | null);
        },
        all<T>() {
          return Promise.resolve({ results: handleAll(state, sql, values) as T[] });
        },
        run() {
          return Promise.resolve(handleRun(state, sql, values));
        },
      };
    },
  };

  const queue = {
    send(message: unknown) {
      state.queuedMessages.push(message);
      return Promise.resolve();
    },
  };

  return {
    DB: db,
    BOOKING_REMINDER_QUEUE: options.queue ? queue : undefined,
    __state: state,
  } as unknown as Env & { __state: TestState };
}

function handleFirst(state: TestState, sql: string, values: unknown[]) {
  if (sql.includes("FROM sites s") && sql.includes("JOIN owner_profile")) {
    return {
      id: "owner",
      email: "owner@example.com",
      name: "Core Owner",
      timezone: "Europe/Dublin",
    };
  }
  if (sql.includes("SELECT booking_reminders_enabled FROM sites")) {
    if (values[0] !== "site-1" || (values.length > 1 && values[1] !== "owner")) return null;
    return { booking_reminders_enabled: state.siteEnabled };
  }
  if (sql.includes("FROM agent_channel_connections")) return null;
  if (sql.includes("FROM booking_reminders WHERE id = ?")) {
    return state.reminders.find((row) => row.id === values[0]) || null;
  }
  if (sql.includes("FROM bookings")) return state.booking.id === values[0] ? state.booking : null;
  return null;
}

function handleAll(state: TestState, sql: string, values: unknown[]) {
  if (sql.includes("FROM booking_reminders br")) {
    const now = values[0] as string;
    const limit = values[1] as number;
    return state.reminders
      .filter((row) => state.siteEnabled !== 0 && row.status === "scheduled" && row.scheduled_for <= now)
      .slice(0, limit)
      .map((row) => ({ id: row.id }));
  }
  return [];
}

function handleRun(state: TestState, sql: string, values: unknown[]) {
  let changes = 0;
  if (sql.includes("UPDATE sites SET booking_reminders_enabled")) {
    if (values[1] === "site-1" && values[2] === "owner") {
      state.siteEnabled = values[0] as number;
      changes = 1;
    }
  } else if (sql.includes("SET status = 'cancelled'")) {
    for (const row of state.reminders) {
      if (row.booking_id === values[0] && ["scheduled", "queued", "processing"].includes(row.status)) {
        row.status = "cancelled";
        changes += 1;
      }
    }
  } else if (sql.includes("INSERT OR IGNORE INTO booking_reminders")) {
    const exists = state.reminders.some(
      (row) =>
        row.booking_id === values[1] &&
        row.reminder_type === values[4] &&
        row.channel === values[5],
    );
    if (!exists) {
      state.reminders.push({
        id: values[0] as string,
        booking_id: values[1] as string,
        site_id: values[2] as string,
        user_id: values[3] as string,
        reminder_type: values[4] as ReminderRow["reminder_type"],
        channel: values[5] as ReminderRow["channel"],
        status: "scheduled",
        scheduled_for: values[6] as string,
        queued_at: null,
        sent_at: null,
        cancelled_at: null,
        failed_at: null,
        dead_lettered_at: null,
        attempt_count: 0,
        payload_json: values[7] as string,
        provider_message_id: null,
        error_message: null,
        created_at: "2026-06-01T10:00:00Z",
        updated_at: "2026-06-01T10:00:00Z",
      });
      changes = 1;
    }
  } else if (sql.includes("SET status = 'queued'")) {
    const row = state.reminders.find((entry) => entry.id === values[0] && entry.status === "scheduled");
    if (row) {
      row.status = "queued";
      row.queued_at = "2026-06-01T10:00:00Z";
      changes = 1;
    }
  } else if (sql.includes("SET status = 'processing'")) {
    const row = state.reminders.find((entry) => entry.id === values[0] && entry.status === "queued");
    if (row) {
      row.status = "processing";
      row.attempt_count += 1;
      changes = 1;
    }
  } else if (sql.includes("SET status = 'sent'")) {
    const row = state.reminders.find((entry) => entry.id === values[1]);
    if (row) {
      row.status = "sent";
      row.sent_at = "2026-06-01T10:00:00Z";
      row.provider_message_id = values[0] as string | null;
      row.error_message = null;
      changes = 1;
    }
  } else if (sql.includes("SET status = ?")) {
    const row = state.reminders.find((entry) => entry.id === values[3]);
    if (row) {
      row.status = values[0] as ReminderRow["status"];
      row.error_message = values[2] as string;
      changes = 1;
    }
  }
  return { meta: { changes } };
}
