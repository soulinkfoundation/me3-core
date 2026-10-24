import {
  MARKETING_PERMISSION_ATTESTATION_STATEMENT,
  MARKETING_PERMISSION_ATTESTATION_VERSION,
} from "@me3-core/plugin-email-campaigns";

export const CAMPAIGN_PERMISSION_METHODS = [
  "single_opt_in",
  "double_opt_in",
  "import_attested",
] as const;

export type CampaignPermissionMethod = (typeof CAMPAIGN_PERMISSION_METHODS)[number];
export type CampaignMarketingStatus = "pending" | "marketable";
export type CampaignDeliveryStatus = "deliverable" | "bounced" | "complained" | "suppressed";

export type CampaignAudienceExclusionReason =
  | "invalid_email"
  | "pending_permission"
  | "unsubscribed"
  | "bounced"
  | "complained"
  | "suppressed"
  | "duplicate";

export type CampaignAudienceSubscriber = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
  marketing_status: CampaignMarketingStatus;
  marketing_permission_method: CampaignPermissionMethod | null;
  marketing_permission_granted_at: string | null;
  marketing_permission_evidence_json: string | null;
  delivery_status: CampaignDeliveryStatus;
};

export type EligibleCampaignSubscriber = CampaignAudienceSubscriber & {
  normalizedEmail: string;
  marketing_permission_method: CampaignPermissionMethod;
  marketing_permission_granted_at: string;
  marketing_permission_evidence_json: string;
};

export type ExcludedCampaignSubscriber = {
  subscriberId: number;
  email: string;
  reason: CampaignAudienceExclusionReason;
};

export type CampaignAudienceEvaluation = {
  eligible: EligibleCampaignSubscriber[];
  excluded: ExcludedCampaignSubscriber[];
  exclusionCounts: Record<CampaignAudienceExclusionReason, number>;
};

export { MARKETING_PERMISSION_ATTESTATION_STATEMENT, MARKETING_PERMISSION_ATTESTATION_VERSION };

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function evaluateCampaignAudience(
  subscribers: readonly CampaignAudienceSubscriber[],
): CampaignAudienceEvaluation {
  const eligibleCandidates: EligibleCampaignSubscriber[] = [];
  const excluded: ExcludedCampaignSubscriber[] = [];

  for (const subscriber of subscribers) {
    const normalizedEmail = normalizeCampaignEmail(subscriber.email);
    const reason = getCampaignSubscriberExclusionReason(subscriber, normalizedEmail);
    if (reason) {
      excluded.push({ subscriberId: subscriber.id, email: subscriber.email, reason });
      continue;
    }

    eligibleCandidates.push({
      ...subscriber,
      normalizedEmail,
      marketing_permission_method: subscriber.marketing_permission_method as CampaignPermissionMethod,
      marketing_permission_granted_at: subscriber.marketing_permission_granted_at as string,
      marketing_permission_evidence_json: subscriber.marketing_permission_evidence_json as string,
    });
  }

  const eligibleByAddress = new Map<string, EligibleCampaignSubscriber>();
  for (const candidate of eligibleCandidates.sort(compareCampaignSubscriberPriority)) {
    if (eligibleByAddress.has(candidate.normalizedEmail)) {
      excluded.push({
        subscriberId: candidate.id,
        email: candidate.email,
        reason: "duplicate",
      });
      continue;
    }
    eligibleByAddress.set(candidate.normalizedEmail, candidate);
  }

  const exclusionCounts = emptyExclusionCounts();
  for (const item of excluded) exclusionCounts[item.reason] += 1;

  return {
    eligible: [...eligibleByAddress.values()].sort((left, right) =>
      left.normalizedEmail.localeCompare(right.normalizedEmail),
    ),
    excluded: excluded.sort((left, right) => left.subscriberId - right.subscriberId),
    exclusionCounts,
  };
}

export function normalizeCampaignEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createSiteFormPermissionEvidence(input: {
  source?: string;
  pageId?: string | null;
  actionId?: string | null;
  campaign?: string | null;
}): string {
  return JSON.stringify({
    version: 1,
    kind: "site_form",
    source: input.source || "me3",
    pageId: input.pageId || null,
    actionId: input.actionId || null,
    campaign: input.campaign || null,
  });
}

export function createDoubleOptInPermissionEvidence(input: {
  requestedAt: string;
  confirmedAt: string;
  pageId?: string | null;
  actionId?: string | null;
  campaign?: string | null;
}): string {
  return JSON.stringify({
    version: 1,
    kind: "site_form",
    source: "me3",
    method: "double_opt_in",
    requestedAt: input.requestedAt,
    confirmedAt: input.confirmedAt,
    pageId: input.pageId || null,
    actionId: input.actionId || null,
    campaign: input.campaign || null,
  });
}

export function createImportAttestationEvidence(input: {
  attestedAt: string;
  source: string;
}): string {
  return JSON.stringify({
    version: 1,
    kind: "owner_attestation",
    statementVersion: MARKETING_PERMISSION_ATTESTATION_VERSION,
    statement: MARKETING_PERMISSION_ATTESTATION_STATEMENT,
    attestedBy: "owner",
    attestedAt: input.attestedAt,
    source: input.source,
  });
}

function getCampaignSubscriberExclusionReason(
  subscriber: CampaignAudienceSubscriber,
  normalizedEmail: string,
): CampaignAudienceExclusionReason | null {
  if (!EMAIL_ADDRESS_PATTERN.test(normalizedEmail)) return "invalid_email";
  if (subscriber.unsubscribed_at) return "unsubscribed";
  if (subscriber.delivery_status !== "deliverable") return subscriber.delivery_status;
  if (
    subscriber.marketing_status !== "marketable" ||
    !subscriber.marketing_permission_method ||
    !subscriber.marketing_permission_granted_at ||
    !subscriber.marketing_permission_evidence_json
  ) {
    return "pending_permission";
  }
  return null;
}

function compareCampaignSubscriberPriority(
  left: EligibleCampaignSubscriber,
  right: EligibleCampaignSubscriber,
): number {
  const leftGrantedAt = campaignTimestamp(left.marketing_permission_granted_at);
  const rightGrantedAt = campaignTimestamp(right.marketing_permission_granted_at);
  if (leftGrantedAt !== rightGrantedAt) return rightGrantedAt - leftGrantedAt;

  const leftSubscribedAt = campaignTimestamp(left.subscribed_at);
  const rightSubscribedAt = campaignTimestamp(right.subscribed_at);
  if (leftSubscribedAt !== rightSubscribedAt) return rightSubscribedAt - leftSubscribedAt;

  return left.id - right.id;
}

function campaignTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function emptyExclusionCounts(): Record<CampaignAudienceExclusionReason, number> {
  return {
    invalid_email: 0,
    pending_permission: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
    suppressed: 0,
    duplicate: 0,
  };
}
