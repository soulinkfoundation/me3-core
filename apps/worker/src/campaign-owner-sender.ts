import type {
  ManagedCampaignEventType,
  ManagedCampaignReason,
} from "../../../shared/managed-campaign-contract";
import { getEmailProviderSettings, type EmailProviderId } from "./email-providers";
import { getOrCreateInstallSessionSecret } from "./install-secrets";
import { MANAGED_EMAIL_PROVIDER_ID } from "./managed-email-outbound";
import { constantTimeEqual, getCoreApiOrigin } from "./sites";
import type { Env } from "./types";

/**
 * Self-hosted campaign sending (me3-bli3.2.11): the owner's own provider from email-providers.ts
 * delivers each recipient job, Core serves the one-click unsubscribe link, and providers that report
 * outcomes (Postmark webhooks) post them back here. Managed installs never use this module.
 */
export const OWNER_SENDER_REF_PREFIX = "provider:";

/** Providers that can post delivered/bounced back to Core. */
const PROVIDERS_WITH_EVENTS: ReadonlySet<EmailProviderId> = new Set(["postmark"]);

export type OwnerCampaignSender = {
  sender: { ref: string; domain: string; fromAddress: string; status: string };
  provider: {
    id: EmailProviderId;
    label: string;
    tracksDelivery: boolean;
    deliveryEventsUrl: string | null;
  };
};

export function isOwnerSenderRef(ref: string | null | undefined) {
  return Boolean(ref?.startsWith(OWNER_SENDER_REF_PREFIX));
}

/** Self-hosted installs have one owner; campaigns send as them. */
export async function resolveInstallOwnerId(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM owner_profile ORDER BY rowid LIMIT 1")
    .first<{ id: string }>()
    .catch(() => null);
  return row?.id || null;
}

export async function getOwnerCampaignSender(
  env: Env,
  ownerId: string | null,
  requestUrl?: string,
): Promise<OwnerCampaignSender | null> {
  if (!ownerId) return null;
  const settings = await getEmailProviderSettings(env, ownerId).catch(() => null);
  const provider = settings?.providers.find((item) => item.id === settings.activeProviderId);
  if (!provider || provider.id === MANAGED_EMAIL_PROVIDER_ID || !provider.configured) return null;
  const fromAddress = provider.config.fromAddress.trim().toLowerCase();
  if (!fromAddress || fromAddress.endsWith("@me3.local")) return null;
  const tracksDelivery = PROVIDERS_WITH_EVENTS.has(provider.id);
  return {
    sender: {
      ref: `${OWNER_SENDER_REF_PREFIX}${provider.id}`,
      domain: provider.config.sendingDomain || fromAddress.split("@")[1] || "",
      fromAddress,
      status: "ready",
    },
    provider: {
      id: provider.id,
      label: provider.label,
      tracksDelivery,
      deliveryEventsUrl: tracksDelivery
        ? await providerEventsUrl(env, provider.id, requestUrl)
        : null,
    },
  };
}

export async function campaignUnsubscribeUrl(env: Env, jobId: string): Promise<string | null> {
  const origin = getCoreApiOrigin(env);
  if (!origin) return null;
  const signature = await signValue(env, `campaign-unsubscribe:${jobId}`, 32);
  return `${origin}/api/public/campaigns/unsubscribe/${encodeURIComponent(`${jobId}.${signature}`)}`;
}

/** Returns the recipient job id the token was issued for, or null when it is forged. */
export async function verifyCampaignUnsubscribeToken(env: Env, token: string): Promise<string | null> {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const jobId = token.slice(0, separator);
  const expected = await signValue(env, `campaign-unsubscribe:${jobId}`, 32);
  return constantTimeEqual(expected, token.slice(separator + 1)) ? jobId : null;
}

export async function verifyProviderEventsToken(env: Env, providerId: EmailProviderId, token: string) {
  return constantTimeEqual(await signValue(env, `campaign-provider-events:${providerId}`, 40), token);
}

async function providerEventsUrl(env: Env, providerId: EmailProviderId, requestUrl?: string) {
  const origin = getCoreApiOrigin(env, requestUrl);
  if (!origin) return null;
  const token = await signValue(env, `campaign-provider-events:${providerId}`, 40);
  return `${origin}/api/public/campaigns/provider-events/${providerId}/${token}`;
}

export type ProviderCampaignOutcome = {
  jobId: string;
  eventId: string;
  type: ManagedCampaignEventType;
  reason: ManagedCampaignReason | null;
  occurredAt: string;
};

/**
 * Postmark webhook (Delivery, Bounce, SpamComplaint, SubscriptionChange) → a campaign outcome.
 * Each send carries `me3_campaign_job` metadata, which Postmark echoes back.
 */
export function parsePostmarkCampaignEvent(body: unknown): ProviderCampaignOutcome | null {
  if (!body || typeof body !== "object") return null;
  const event = body as Record<string, unknown>;
  const metadata = event.Metadata && typeof event.Metadata === "object"
    ? (event.Metadata as Record<string, unknown>)
    : {};
  const jobId = typeof metadata.me3_campaign_job === "string" ? metadata.me3_campaign_job : "";
  if (!jobId) return null;
  const at = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : new Date().toISOString();
  const id = String(event.ID ?? event.MessageID ?? crypto.randomUUID());
  const recordType = event.RecordType;
  if (recordType === "Delivery") {
    return { jobId, eventId: `postmark-delivery-${id}`, type: "delivery.delivered", reason: null, occurredAt: at(event.DeliveredAt) };
  }
  if (recordType === "Bounce") {
    const hard = event.Type === "HardBounce" || event.Inactive === true;
    return {
      jobId,
      eventId: `postmark-bounce-${id}`,
      type: hard ? "delivery.bounced" : "delivery.delayed",
      reason: hard ? "hard_bounce" : null,
      occurredAt: at(event.BouncedAt),
    };
  }
  if (recordType === "SpamComplaint") {
    return { jobId, eventId: `postmark-complaint-${id}`, type: "delivery.complained", reason: "complaint", occurredAt: at(event.BouncedAt) };
  }
  if (recordType === "SubscriptionChange" && event.SuppressSending === true && event.SuppressionReason === "ManualSuppression") {
    return { jobId, eventId: `postmark-unsubscribe-${id}`, type: "recipient.unsubscribed", reason: "unsubscribe", occurredAt: at(event.ChangedAt) };
  }
  return null;
}

async function signValue(env: Env, value: string, length: number) {
  const secret = await getOrCreateInstallSessionSecret(env);
  return (await hmacHex(secret, `me3:${value}`)).slice(0, length);
}

export async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
