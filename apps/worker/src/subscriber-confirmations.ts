import { createDoubleOptInPermissionEvidence } from "./campaign-audience";
import { sendNewsletterSubscriptionConfirmationEmail } from "./transactional-emails";
import { constantTimeEqual, sha256Text } from "./sites";
import type { DbSite, DbSubscriber, Env } from "./types";

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIRMATION_RESEND_COOLDOWN_MS = 10 * 60 * 1000;

type ConfirmationSubscriber = Pick<DbSubscriber,
  | "id" | "subscribed_at" | "unsubscribed_at" | "page_id" | "action_id" | "campaign"
  | "marketing_status" | "marketing_permission_method"
  | "confirmation_token_hash" | "confirmation_expires_at" | "confirmation_requested_at"
>;

type DoubleOptInConfirmationStatus = "ready" | "confirmed" | "invalid";

export async function requestDoubleOptInSubscription(
  env: Env,
  input: {
    site: DbSite;
    email: string;
    firstName: string | null;
    lastName: string | null;
    ipHash: string | null;
    pageId: string | null;
    actionId: string | null;
    campaign: string | null;
    confirmationOrigin: string;
    siteName: string;
    newsletterName: string;
  },
  send = sendNewsletterSubscriptionConfirmationEmail,
): Promise<"accepted" | "unavailable"> {
  const now = new Date();
  const requestedAt = now.toISOString();
  const confirmationExpiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString();
  const resendBefore = new Date(now.getTime() - CONFIRMATION_RESEND_COOLDOWN_MS).toISOString();
  const token = crypto.randomUUID();
  const tokenHash = await sha256Text(token);

  // Claim the send and enforce its cooldown in the same write, including concurrent signups.
  const saved = await env.DB.prepare(
    `INSERT INTO subscribers
     (site_id, email, first_name, last_name, source, subscribed_at, ip_hash,
      page_id, action_id, campaign, marketing_status, confirmation_token_hash,
      confirmation_expires_at, confirmation_requested_at)
     VALUES (?, ?, ?, ?, 'me3', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
     ON CONFLICT(site_id, email) DO UPDATE SET
       first_name = COALESCE(excluded.first_name, subscribers.first_name),
       last_name = COALESCE(excluded.last_name, subscribers.last_name),
       source = 'me3', subscribed_at = excluded.subscribed_at, unsubscribed_at = NULL,
       ip_hash = excluded.ip_hash, page_id = excluded.page_id,
       action_id = excluded.action_id, campaign = excluded.campaign,
       marketing_status = 'pending', marketing_permission_method = NULL,
       marketing_permission_granted_at = NULL, marketing_permission_evidence_json = NULL,
       confirmation_token_hash = excluded.confirmation_token_hash,
       confirmation_expires_at = excluded.confirmation_expires_at,
       confirmation_requested_at = excluded.confirmation_requested_at
     WHERE subscribers.delivery_status = 'deliverable'
       AND (subscribers.unsubscribed_at IS NOT NULL OR subscribers.marketing_status = 'pending')
       AND (subscribers.unsubscribed_at IS NOT NULL OR subscribers.confirmation_requested_at IS NULL
            OR subscribers.confirmation_requested_at <= ? OR subscribers.confirmation_expires_at <= ?)`,
  )
    .bind(
      input.site.id,
      input.email,
      input.firstName,
      input.lastName,
      requestedAt,
      input.ipHash,
      input.pageId,
      input.actionId,
      input.campaign,
      tokenHash,
      confirmationExpiresAt,
      requestedAt,
      resendBefore,
      requestedAt,
    )
    .run();
  if (!saved.meta.changes) return "accepted";

  const confirmationUrl = new URL(
    `/api/sites/${encodeURIComponent(input.site.username)}/subscribe/confirm`,
    input.confirmationOrigin,
  );
  confirmationUrl.searchParams.set("email", input.email);
  confirmationUrl.searchParams.set("token", token);

  const result = await send(env, {
    ownerId: input.site.user_id,
    siteId: input.site.id,
    siteName: input.siteName,
    newsletterName: input.newsletterName,
    subscriberEmail: input.email,
    confirmationUrl: confirmationUrl.toString(),
  });
  if (result.status === "sent") return "accepted";

  await env.DB.prepare(
    `UPDATE subscribers SET confirmation_requested_at = NULL
     WHERE site_id = ? AND email = ? AND confirmation_token_hash = ?`,
  )
    .bind(input.site.id, input.email, tokenHash)
    .run();
  return "unavailable";
}

export async function getDoubleOptInConfirmationStatus(
  env: Env,
  input: { siteId: string; email: string; token: string },
): Promise<DoubleOptInConfirmationStatus> {
  const subscriber = await getSubscriber(env, input.siteId, input.email);
  return confirmationStatus(subscriber, input.token);
}

async function confirmationStatus(
  subscriber: ConfirmationSubscriber | null,
  token: string,
): Promise<DoubleOptInConfirmationStatus> {
  if (!subscriber?.confirmation_token_hash) return "invalid";
  if (!constantTimeEqual(await sha256Text(token), subscriber.confirmation_token_hash)) return "invalid";
  if (
    subscriber.marketing_status === "marketable" &&
    subscriber.marketing_permission_method === "double_opt_in" &&
    !subscriber.unsubscribed_at
  ) {
    return "confirmed";
  }
  const expiresAt = Date.parse(subscriber.confirmation_expires_at || "");
  if (
    subscriber.marketing_status !== "pending" ||
    subscriber.unsubscribed_at ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return "invalid";
  }
  return "ready";
}

export async function confirmDoubleOptInSubscriber(
  env: Env,
  input: { siteId: string; email: string; token: string },
): Promise<"confirmed" | "already_confirmed" | "invalid"> {
  const subscriber = await getSubscriber(env, input.siteId, input.email);
  const status = await confirmationStatus(subscriber, input.token);
  if (status === "confirmed") return "already_confirmed";
  if (status !== "ready") return status;
  if (!subscriber) return "invalid";
  const confirmedAt = new Date().toISOString();
  const evidence = createDoubleOptInPermissionEvidence({
    requestedAt: subscriber.confirmation_requested_at || subscriber.subscribed_at,
    confirmedAt,
    pageId: subscriber.page_id,
    actionId: subscriber.action_id,
    campaign: subscriber.campaign,
  });
  const result = await env.DB.prepare(
    `UPDATE subscribers
     SET marketing_status = 'marketable', marketing_permission_method = 'double_opt_in',
         marketing_permission_granted_at = ?, marketing_permission_evidence_json = ?
     WHERE id = ? AND marketing_status = 'pending' AND unsubscribed_at IS NULL
       AND confirmation_token_hash = ?`,
  )
    .bind(confirmedAt, evidence, subscriber.id, subscriber.confirmation_token_hash)
    .run();
  return result.meta.changes > 0 ? "confirmed" : "invalid";
}

async function getSubscriber(
  env: Env,
  siteId: string,
  email: string,
): Promise<ConfirmationSubscriber | null> {
  return env.DB.prepare(
    `SELECT id, subscribed_at, unsubscribed_at, page_id, action_id, campaign,
            marketing_status, marketing_permission_method,
            confirmation_token_hash, confirmation_expires_at, confirmation_requested_at
     FROM subscribers WHERE site_id = ? AND email = ?`,
  )
    .bind(siteId, email)
    .first<ConfirmationSubscriber>();
}
