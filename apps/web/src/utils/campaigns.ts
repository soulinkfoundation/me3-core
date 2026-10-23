export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";

export type CampaignSummary = {
  id: string;
  siteId: string;
  siteUsername: string;
  subject: string;
  status: CampaignStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  cancelledAt?: string | null;
  failureReason: string | null;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  updatedAt: string;
};

export type CampaignGroupId = "needs-you" | "coming-up" | "sent";

const GROUP_FOR_STATUS: Record<CampaignStatus, CampaignGroupId> = {
  draft: "needs-you",
  failed: "needs-you",
  scheduled: "coming-up",
  sending: "coming-up",
  sent: "sent",
  cancelled: "sent",
};

export const CAMPAIGN_GROUPS: Array<{ id: CampaignGroupId; label: string }> = [
  { id: "needs-you", label: "Needs you" },
  { id: "coming-up", label: "Coming up" },
  { id: "sent", label: "Sent" },
];

export function campaignGroup(status: CampaignStatus) {
  return GROUP_FOR_STATUS[status];
}

/** Coming up reads soonest first; the other groups read newest first. */
export function campaignSortKey(campaign: CampaignSummary) {
  if (campaign.status === "scheduled" || campaign.status === "sending") {
    return campaign.scheduledFor || campaign.updatedAt;
  }
  return campaign.sentAt || campaign.cancelledAt || campaign.updatedAt;
}

export function campaignTitle(campaign: { subject: string }) {
  return campaign.subject.trim() || "No subject";
}

export function campaignStatusLabel(status: CampaignStatus) {
  return {
    draft: "Draft",
    scheduled: "Scheduled",
    sending: "Sending",
    sent: "Sent",
    cancelled: "Cancelled",
    failed: "Didn't send",
  }[status];
}

/** Pill tone from the design: warn needs the owner, go is on its way, ok is done, bad failed. */
export function campaignStatusTone(status: CampaignStatus) {
  return {
    draft: "warn",
    scheduled: "go",
    sending: "go",
    sent: "ok",
    cancelled: "muted",
    failed: "bad",
  }[status];
}

export function canCancelCampaign(status: CampaignStatus) {
  return status === "scheduled" || status === "sending";
}

export function canDeleteCampaign(status: CampaignStatus) {
  return status === "draft" || status === "failed" || status === "cancelled";
}

export function formatCampaignDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(value),
  );
}

export function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

/** One quiet line under the subject: when it went or goes, and how it went. */
export function campaignDetail(campaign: CampaignSummary) {
  const people = (count: number) => `${formatCount(count)} ${count === 1 ? "person" : "people"}`;
  switch (campaign.status) {
    case "draft":
      return `Draft · edited ${formatShortDate(campaign.updatedAt)}`;
    case "scheduled":
      return campaign.scheduledFor
        ? `${formatCampaignDate(campaign.scheduledFor)}${campaign.recipientCount ? ` · ${people(campaign.recipientCount)}` : ""}`
        : "Scheduled";
    case "sending":
      return `${formatCount(campaign.deliveredCount)} of ${formatCount(campaign.recipientCount)} delivered`;
    case "sent": {
      const parts = [
        formatShortDate(campaign.sentAt || campaign.updatedAt),
        `${formatCount(campaign.deliveredCount)} delivered`,
      ];
      if (campaign.failedCount) parts.push(`${formatCount(campaign.failedCount)} didn't arrive`);
      return parts.join(" · ");
    }
    case "cancelled":
      return `Cancelled ${formatShortDate(campaign.cancelledAt || campaign.updatedAt)}`;
    case "failed":
      return campaign.failureReason || "Something went wrong before it sent";
  }
}

export function cancelCampaignMessage(campaign: { subject: string }) {
  return `“${campaignTitle(campaign)}” won't go to anyone who hasn't received it yet.`;
}

export function deleteCampaignMessage(campaign: { subject: string; status: CampaignStatus }) {
  return campaign.status === "draft"
    ? `“${campaignTitle(campaign)}” will be removed. This can't be undone.`
    : `“${campaignTitle(campaign)}” and its delivery history will be removed. This can't be undone.`;
}
