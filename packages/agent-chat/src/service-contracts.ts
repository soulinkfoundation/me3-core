import type { WebResearchService, WebContentFetcher } from "@me3-core/web-research";
import { type AgentMailboxMessageListOptions, type AgentMailboxMessage, type AgentMailboxDraftInput } from "./mailbox-types";

export type CoreMailboxToolServices = {
  search(
    options: AgentMailboxMessageListOptions,
  ): Promise<{ messages: AgentMailboxMessage[]; total: number }>;
  read(
    messageId: string,
  ): Promise<{ message: AgentMailboxMessage } | { error: string; status: number }>;
  createDraft(
    input: AgentMailboxDraftInput,
    idempotencyKey: string,
  ): Promise<{ draft: AgentMailboxMessage } | { error: string; status: number }>;
};

export type CoreSchedulingContact = {
  name: string;
  relationship: "client" | "prospect" | "contact";
  me3AssistantAvailable: boolean;
};

export type CoreSchedulingOption = {
  option: number;
  label: string;
  startsAt: string;
  endsAt: string;
};

export type CoreSchedulingToolServices = {
  availability?(input: {
    dateFrom: string;
    dateTo: string;
    timeTypeId?: string;
    durationMinutes?: number;
    limit?: number;
  }): Promise<{
    timeTypeName: string;
    timezone: string;
    slots: Array<{ startsAt: string; endsAt: string }>;
  }>;
  searchContacts(input: {
    query?: string;
    limit?: number;
  }): Promise<{
    contacts: CoreSchedulingContact[];
    total: number;
  }>;
  request(input: {
    contact: string;
    durationMinutes?: number;
    dateFrom?: string;
    dateTo?: string;
    reason?: string;
  }, idempotencyKey: string): Promise<{
    contactName: string;
    durationMinutes: number;
    dateRange: { start: string; end: string };
    usedDefaultDuration: boolean;
    usedDefaultDateRange: boolean;
    status:
      | "options_ready"
      | "waiting_for_target_review"
      | "pending_target"
      | "no_owner_availability"
      | "no_mutual_availability";
    options: CoreSchedulingOption[];
  }>;
  requestNetwork?(input: {
    target: { kind: "public_profile"; profileId: string };
    request: {
      kind: "meeting";
      participantMode: "one_to_one";
      paymentMode: "free";
    };
    durationMinutes?: number;
    dateFrom?: string;
    dateTo?: string;
    reason?: string;
  }, idempotencyKey: string): Promise<{
    contactName: string;
    durationMinutes: number;
    dateRange: { start: string; end: string };
    usedDefaultDuration: boolean;
    usedDefaultDateRange: boolean;
    status:
      | "waiting_for_target_review"
      | "pending_target"
      | "no_owner_availability";
    options: CoreSchedulingOption[];
  }>;
  approve(input: {
    contact?: string;
    option?: number;
    confirmed: boolean;
  }, idempotencyKey: string): Promise<{
    contactName: string;
    status: "availability_shared" | "waiting_for_other_owner" | "booked";
    selectedOption: CoreSchedulingOption | null;
  }>;
  decline(input: {
    contact?: string;
    reason?: string;
  }, idempotencyKey: string): Promise<{
    contactName: string;
    status: "declined";
  }>;
};

export type CorePeopleSearchOffering = {
  type: "service" | "product";
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  durationMinutes: number | null;
  price: { amount: string; currency: string } | null;
  /** Commerce shape from the network index; absent from older index responses. */
  kind?: "booking" | "event" | "product";
  delivery?: "online" | "in_person" | "hybrid" | null;
  /** Present only when the seller takes ME3 agent checkouts for this offering. */
  agentCheckout?: { version: string; specUrl: string | null } | null;
};

/** Seller trust signals from the network index. Nothing here is paid placement. */
export type CorePeopleSearchSeller = {
  soulinkLinked: boolean;
  listedSince: string | null;
  completedNetworkSales: number;
  reportStatus: "none" | "reported";
  newSeller: boolean;
  agentCheckout: boolean;
};

export type CorePeopleSearchResult = {
  relationshipTier: "link" | "public";
  profileId: string | null;
  contactName: string | null;
  name: string;
  handle: string | null;
  kind: string;
  bio: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  publicUrl: string | null;
  location: {
    label: string;
    precision: string;
    locality: string | null;
    region: string | null;
    country: string | null;
    countryCode: string | null;
  } | null;
  offerings: CorePeopleSearchOffering[];
  reasons: string[];
  indexedAt: string;
  seller?: CorePeopleSearchSeller | null;
  /** Short owner-facing trust labels, such as "ME3 agent checkout" or "New seller". */
  badges?: string[];
  /** The owner's own listing, returned only when they asked to see how they are found. */
  self?: boolean;
};

export type CorePeopleSearchToolServices = {
  search(input: {
    query: string;
    offeringType?: "service" | "product";
    offeringKind?: "booking" | "event" | "product";
    countryCode?: string;
    limit?: number;
    includeMe?: boolean;
  }): Promise<{
    query: string;
    results: CorePeopleSearchResult[];
    total: number;
    warnings: string[];
  }>;
};

export type CoreWebResearchToolServices = {
  search: WebResearchService["search"];
  open: WebContentFetcher["open"];
};
