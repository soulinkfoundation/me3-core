import { getMe3CloudApiOrigin } from "./sites";
import type { Env } from "./types";

const OWNER_SECRET = "ME3_CLOUD_OWNER_ID";
const INSTALL_SECRET = "ME3_CORE_INSTALL_ID";
const TOKEN_SECRET = "ME3_CLOUD_CORE_TOKEN";
const DEVICE_ID = /^[A-Za-z0-9._:-]{8,200}$/;
const APNS_TOKEN = /^[0-9a-f]{64}$/;
const FCM_TOKEN = /^[^\s\u0000-\u001f\u007f]{20,4096}$/;

export class PushNotificationInputError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 502) {
    super(message);
  }
}

export const CALENDAR_PUSH_CATEGORIES = [
  "events",
  "bookings",
  "birthdays",
  "reminders",
  "tasks",
  "subscribed_calendars",
] as const;

export type CalendarPushCategory = typeof CALENDAR_PUSH_CATEGORIES[number];

export type CalendarPushPreferences = {
  enabled: boolean;
  categories: Record<CalendarPushCategory, boolean>;
};

export type CalendarPushAlert = {
  category: CalendarPushCategory;
  itemId: string;
  occurrenceId: string;
  alertOffsetMinutes: number;
  title: string;
};

export async function getPushNotificationDevice(
  env: Env,
  userId: string,
  deviceIdValue: unknown,
) {
  const deviceId = normalizeDeviceId(deviceIdValue);
  const [relay, preferences] = await Promise.all([
    relayRequest(env, `/api/push/devices/${encodeURIComponent(deviceId)}`),
    getLocalPushPreferences(env, userId, deviceId),
  ]);
  return {
    ...relay,
    dailyBriefingEnabled: preferences.dailyBriefingEnabled,
    calendarNotifications: preferences.calendarNotifications,
    paymentNotificationsEnabled: preferences.paymentNotificationsEnabled,
  };
}

export async function registerPushNotificationDevice(
  env: Env,
  userId: string,
  input: unknown,
) {
  if (!isRecord(input)) throw new PushNotificationInputError("Invalid push device", 400);
  const deviceId = normalizeDeviceId(input.deviceId);
  const provider = input.provider === "fcm" ? "fcm" : "apns";
  const platform = input.platform === "android" ? "android" : "ios";
  const rawToken = typeof input.token === "string" ? input.token.trim() : "";
  const token = provider === "apns" ? rawToken.toLowerCase() : rawToken;
  if (
    (provider === "apns" && (!APNS_TOKEN.test(token) || platform !== "ios")) ||
    (provider === "fcm" && (!FCM_TOKEN.test(token) || platform !== "android"))
  ) {
    throw new PushNotificationInputError("Invalid push token", 400);
  }
  const dailyBriefingEnabled = input.dailyBriefingEnabled !== false;
  const paymentNotificationsEnabled = input.paymentNotificationsEnabled !== false;
  const calendarNotifications = normalizeCalendarPushPreferences(input.calendarNotifications);
  await upsertLocalPushPreferences(env, userId, deviceId, {
    dailyBriefingEnabled,
    paymentNotificationsEnabled,
    calendarNotifications,
  });
  return relayRequest(env, "/api/push/devices", {
    method: "PUT",
    body: JSON.stringify({
      deviceId,
      token,
      provider,
      platform,
      environment: input.environment === "production" ? "production" : "sandbox",
      dailyBriefingEnabled,
      paymentNotificationsEnabled,
      calendarNotifications,
    }),
  });
}

export async function unregisterPushNotificationDevice(
  env: Env,
  userId: string,
  deviceIdValue: unknown,
) {
  const deviceId = normalizeDeviceId(deviceIdValue);
  await env.DB.prepare(
    "DELETE FROM mobile_push_preferences WHERE user_id = ? AND device_id = ?",
  ).bind(userId, deviceId).run();
  return relayRequest(env, `/api/push/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
  });
}

export type DailyBriefingPushSummary = {
  ownerName: string | null;
  counts: {
    reminders: number;
    tasks: number;
    bookings: number;
  };
};

export async function notifyDailyBriefingReady(
  env: Env,
  briefingId: string,
  summary?: DailyBriefingPushSummary | null,
) {
  try {
    return await relayRequest(
      env,
      `/api/push/daily-briefings/${encodeURIComponent(briefingId)}`,
      {
        method: "POST",
        body: summary ? JSON.stringify(summary) : undefined,
      },
    );
  } catch (error) {
    console.warn("Daily Briefing push was skipped", {
      briefingId,
      error: error instanceof Error ? error.message : "Unknown push relay error",
    });
    return { ok: false, skipped: true };
  }
}

export async function notifyCalendarItemDue(env: Env, alert: CalendarPushAlert) {
  try {
    return await relayRequest(env, "/api/push/calendar-alerts", {
      method: "POST",
      body: JSON.stringify(alert),
    });
  } catch (error) {
    console.warn("Calendar push was skipped", {
      category: alert.category,
      itemId: alert.itemId,
      occurrenceId: alert.occurrenceId,
      error: error instanceof Error ? error.message : "Unknown push relay error",
    });
    return { ok: false, skipped: true };
  }
}

export type WebsitePaymentPush = {
  sourceKind: "order" | "booking";
  sourceId: string;
  amountCents: number;
  currency: string;
  customerName: string | null;
  itemTitle: string;
  siteName: string;
};

export async function notifyWebsitePaymentReceived(env: Env, payment: WebsitePaymentPush) {
  try {
    return await relayRequest(env, "/api/push/payment-received", {
      method: "POST",
      body: JSON.stringify(payment),
    });
  } catch (error) {
    console.warn("Payment push was skipped", {
      sourceKind: payment.sourceKind,
      sourceId: payment.sourceId,
      error: error instanceof Error ? error.message : "Unknown push relay error",
    });
    return { ok: false, skipped: true };
  }
}

export function normalizeCalendarPushPreferences(value: unknown): CalendarPushPreferences {
  const body = isRecord(value) ? value : {};
  const categories = isRecord(body.categories) ? body.categories : {};
  return {
    enabled: body.enabled !== false,
    categories: Object.fromEntries(
      CALENDAR_PUSH_CATEGORIES.map((category) => [category, categories[category] !== false]),
    ) as Record<CalendarPushCategory, boolean>,
  };
}

async function upsertLocalPushPreferences(
  env: Env,
  userId: string,
  deviceId: string,
  preferences: {
    dailyBriefingEnabled: boolean;
    paymentNotificationsEnabled: boolean;
    calendarNotifications: CalendarPushPreferences;
  },
) {
  await env.DB.prepare(
    `INSERT INTO mobile_push_preferences
       (user_id, device_id, daily_briefing_enabled, calendar_notifications_json,
        payment_notifications_enabled)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, device_id) DO UPDATE SET
       daily_briefing_enabled = excluded.daily_briefing_enabled,
       calendar_notifications_json = excluded.calendar_notifications_json,
       payment_notifications_enabled = excluded.payment_notifications_enabled,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    userId,
    deviceId,
    preferences.dailyBriefingEnabled ? 1 : 0,
    JSON.stringify(preferences.calendarNotifications),
    preferences.paymentNotificationsEnabled ? 1 : 0,
  ).run();
}

async function getLocalPushPreferences(env: Env, userId: string, deviceId: string) {
  const row = await env.DB.prepare(
    `SELECT daily_briefing_enabled, calendar_notifications_json, payment_notifications_enabled
     FROM mobile_push_preferences WHERE user_id = ? AND device_id = ?`,
  ).bind(userId, deviceId).first<{
    daily_briefing_enabled: number;
    calendar_notifications_json: string;
    payment_notifications_enabled: number;
  }>();
  let calendarNotifications = normalizeCalendarPushPreferences(null);
  if (row?.calendar_notifications_json) {
    try {
      calendarNotifications = normalizeCalendarPushPreferences(
        JSON.parse(row.calendar_notifications_json),
      );
    } catch {
      // Keep the default-on policy if a legacy row is malformed.
    }
  }
  return {
    dailyBriefingEnabled: row ? row.daily_briefing_enabled === 1 : true,
    paymentNotificationsEnabled: row ? row.payment_notifications_enabled === 1 : true,
    calendarNotifications,
  };
}

async function relayRequest(env: Env, path: string, init: RequestInit = {}) {
  const context = await relayContext(env);
  if (!context) throw new PushNotificationInputError("ME3 Cloud is not linked", 409);
  const response = await fetch(new URL(path, getMe3CloudApiOrigin(env)), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-ME3-Core-Owner-ID": context.ownerId,
      "X-ME3-Core-Install-ID": context.installId,
      "X-ME3-Core-Update-Token": context.token,
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new PushNotificationInputError(
      typeof payload?.error === "string" ? payload.error : "Push relay request failed",
      response.status === 400 ? 400 : response.status === 409 ? 409 : 502,
    );
  }
  return payload || { ok: true };
}

async function relayContext(env: Env) {
  const rows = await Promise.all(
    [OWNER_SECRET, INSTALL_SECRET, TOKEN_SECRET].map((name) =>
      env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
        .bind(name)
        .first<{ value: string }>(),
    ),
  );
  const [ownerId, installId, token] = rows.map((row) => row?.value?.trim() || "");
  return ownerId && installId && token ? { ownerId, installId, token } : null;
}

function normalizeDeviceId(value: unknown) {
  const deviceId = typeof value === "string" ? value.trim() : "";
  if (!DEVICE_ID.test(deviceId)) throw new PushNotificationInputError("Invalid device ID", 400);
  return deviceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
