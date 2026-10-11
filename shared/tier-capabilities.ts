export type SubscriptionTier = "free" | "starter" | "pro";

export interface TierCapabilities {
  maxSites: number;
  customDomain: boolean;
  footerCustomization: boolean;
  financialLedger: boolean;
  mailboxAlias: boolean;
  agentInbox: boolean;
  approvalFirstOutbound: boolean;
  shopEnabled: boolean;
  importFromUrl: boolean;
  agentEnabled: boolean;
  soulinkAgentAccess: boolean;
  telegramAgentAccess: boolean;
  notificationDelivery: boolean;
  bookingsEnabled: boolean;
  bookingReminders: boolean;
  newsletterSignup: boolean;
}

export const TIER_CAPABILITIES: Record<SubscriptionTier, TierCapabilities> = {
  free: {
    maxSites: 1,
    customDomain: false,
    footerCustomization: false,
    financialLedger: false,
    mailboxAlias: false,
    agentInbox: false,
    approvalFirstOutbound: false,
    shopEnabled: false,
    importFromUrl: true,
    agentEnabled: false,
    soulinkAgentAccess: false,
    telegramAgentAccess: false,
    notificationDelivery: true,
    bookingsEnabled: false,
    bookingReminders: false,
    newsletterSignup: false,
  },
  starter: {
    maxSites: 1,
    customDomain: true,
    footerCustomization: true,
    financialLedger: false,
    mailboxAlias: false,
    agentInbox: false,
    approvalFirstOutbound: false,
    shopEnabled: false,
    importFromUrl: true,
    agentEnabled: false,
    soulinkAgentAccess: false,
    telegramAgentAccess: false,
    notificationDelivery: true,
    bookingsEnabled: true,
    bookingReminders: true,
    newsletterSignup: true,
  },
  pro: {
    maxSites: 4,
    customDomain: true,
    footerCustomization: true,
    financialLedger: true,
    mailboxAlias: true,
    agentInbox: true,
    approvalFirstOutbound: true,
    shopEnabled: true,
    importFromUrl: true,
    agentEnabled: false,
    soulinkAgentAccess: true,
    telegramAgentAccess: true,
    notificationDelivery: true,
    bookingsEnabled: true,
    bookingReminders: true,
    newsletterSignup: true,
  },
};

export function normalizeSubscriptionTier(
  tier: string | null | undefined,
): SubscriptionTier {
  if (tier === "pro") return "pro";
  if (tier === "starter") return "starter";
  return "free";
}

export function getTierCapabilities(
  tier: string | null | undefined,
): TierCapabilities {
  return TIER_CAPABILITIES[normalizeSubscriptionTier(tier)];
}

export const PAID_TIERS: SubscriptionTier[] = ["starter", "pro"];

export function isPaidTier(tier: string | null | undefined): boolean {
  return PAID_TIERS.includes(normalizeSubscriptionTier(tier));
}
