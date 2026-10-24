export const EMAIL_CAMPAIGNS_PLUGIN_ID = "me3.email-campaigns";
export const EMAIL_CAMPAIGNS_PLUGIN_VERSION = "0.1.0";

export const EMAIL_CAMPAIGNS_RUNTIME = {
  id: EMAIL_CAMPAIGNS_PLUGIN_ID,
  packageName: "@me3-core/plugin-email-campaigns",
  bundled: true,
  runtimeStatus: "email_campaigns_workspace",
  defaultRoute: "/email/campaigns",
  notes: [
    "Core owns subscriber permission, drafts, audience snapshots, schedules, delivery history, and portable campaign data.",
    "Plugin activation enables the workspace independently of any delivery provider or paid managed service.",
    "Managed installations may purchase ME3-operated delivery; self-hosted installations use an owner-supplied provider path.",
  ],
} as const;

export const CAMPAIGN_ADD_ON_PLANS = [
  { key: "5k", allowance: 5_000, monthlyPriceUsd: 10 },
  { key: "10k", allowance: 10_000, monthlyPriceUsd: 15 },
  { key: "20k", allowance: 20_000, monthlyPriceUsd: 25 },
] as const;

export type CampaignAddOnPlanKey = (typeof CAMPAIGN_ADD_ON_PLANS)[number]["key"];

export type CampaignAddOnStatus = {
  available: boolean;
  entitled: boolean;
  status: "active" | "trialing" | "past_due" | "canceled" | "inactive";
  planKey: CampaignAddOnPlanKey | "custom" | null;
  allowance: number;
  used: number;
  remaining: number;
  resetAt: string;
  cancelAtPeriodEnd: boolean;
  paidThroughAt: string | null;
  plans: Array<{
    key: CampaignAddOnPlanKey;
    allowance: number;
    monthlyPriceUsd: number;
    checkoutAvailable: boolean;
  }>;
};

export function campaignAddOnPlan(key: unknown) {
  return CAMPAIGN_ADD_ON_PLANS.find((plan) => plan.key === key) || null;
}

export function campaignAddOnPlanForAllowance(allowance: number) {
  return CAMPAIGN_ADD_ON_PLANS.find((plan) => plan.allowance === allowance) || null;
}

/** What the owner confirms before people they add or import can be emailed. */
export const MARKETING_PERMISSION_ATTESTATION_VERSION =
  "me3.marketing-permission-attestation.v1";
export const MARKETING_PERMISSION_ATTESTATION_STATEMENT =
  "I confirm these people asked to receive marketing email from this site.";
