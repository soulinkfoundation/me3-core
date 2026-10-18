import type { WebContentFetcher, WebResearchService } from "@me3-core/web-research";
import type { AgentLandingPageEnv } from "../../../agent-chat/src/landing-pages";

export type MailboxDeliveryIdentity = { providerId: string; fromAddress: string; fromName: string; replyToAddress: string; routeRevision: string };
export type MailboxRecord = { id: string; status?: string; to?: string | null; toAddress?: string | null; subject?: string | null; bodyText?: string | null; fromAddress?: string | null; storedFromAddress?: string | null; deliveryIdentity?: MailboxDeliveryIdentity | null; [key: string]: unknown };
export interface AgentMailboxServices {
  search(options: Record<string, unknown>): Promise<{ messages: MailboxRecord[]; total: number }>;
  read(messageId: string): Promise<{ message: MailboxRecord } | { error: string; status?: number }>;
  createDraft(input: { to: string; subject: string; body: string; replyToMessageId?: string }, idempotencyKey: string): Promise<{ draft: MailboxRecord } | { error: string; status?: number }>;
  sendDraft?(draftId: string, idempotencyKey: string, expected: MailboxRecord): Promise<unknown>;
}
export type SchedulingContact = { id: string; name: string; relationship: string; me3AssistantAvailable: boolean; [key: string]: unknown };
export type SchedulingRequest = { id: string; contactId?: string; contactName?: string; options?: Array<{ option: number; startsAt: string; endsAt: string; label?: string }>; [key: string]: unknown };
export interface AgentSchedulingServices {
  availability?(input: { dateFrom: string; dateTo: string; timeTypeId?: string; durationMinutes?: number; limit?: number }): Promise<unknown>;
  searchContacts(input: { query?: string; limit?: number }): Promise<{ contacts: SchedulingContact[]; total: number }>;
  request?(input: { contactId: string; expectedContact: SchedulingContact; durationMinutes?: number; dateFrom?: string; dateTo?: string; reason?: string }, idempotencyKey: string): Promise<SchedulingRequest>;
  requestNetwork?(input: { target: { kind: "public_profile"; profileId: string }; request: { kind: "meeting"; participantMode: "one_to_one"; paymentMode: "free" }; durationMinutes?: number; dateFrom?: string; dateTo?: string; reason?: string }, idempotencyKey: string): Promise<SchedulingRequest>;
  getRequest?(requestId: string): Promise<SchedulingRequest | null>;
  approve?(input: { requestId: string; option?: number; confirmed: true; expected: SchedulingRequest }, idempotencyKey: string): Promise<SchedulingRequest>;
  decline?(input: { requestId: string; reason?: string; expected: SchedulingRequest }, idempotencyKey: string): Promise<SchedulingRequest>;
}
export type PeopleRecord = { profileId: string | null; name: string; [key: string]: unknown };
export interface AgentPeopleServices {
  search(input: { query: string; offeringType?: "service" | "product"; offeringKind?: "booking" | "event" | "product"; countryCode?: string; limit?: number }): Promise<{ results: PeopleRecord[]; [key: string]: unknown }>;
}
export type AgentGeneratedImageAsset = {
  id: string; attachmentId: string; name: string; mimeType: string; size: number;
  width: number | null; height: number | null; url: string; storageKey: string;
};
export type AgentGeneratedImageAction = {
  kind: "generated"; status: "complete"; prompt: string; revisedPrompt: string | null;
  providerId: string; model: string; reason: null; assets: AgentGeneratedImageAsset[];
};
export type AgentImageGenerationResult =
  | { status: "complete"; operationId: string; action: AgentGeneratedImageAction }
  | { status: "unknown"; operationId: string; error: string }
  | { status: "failed"; operationId?: string; error: string };
export interface AgentImageGenerationServices {
  generate(prompt: string, input: {
    idempotencyKey: string; threadId: string; turnId: string; requestId: string; signal: AbortSignal;
  }): Promise<AgentImageGenerationResult>;
}
/** Payment proposal records; Core never charges. See apps/worker/src/agent-payments.ts. */
export type PaymentProposalRecord = { id: string; status: string; proposalHash: string; amount: string; currency: string; merchant: { name: string; url: string }; [key: string]: unknown };
export interface AgentPaymentServices {
  propose(input: Record<string, unknown>, scope: { threadId: string; turnId: string; idempotencyKey: string }): Promise<PaymentProposalRecord>;
  handOver(proposalId: string, proposalHash: string): Promise<{ proposal: PaymentProposalRecord; handOver: { openUrl: string; instructions: string } }>;
  recordReceipt(input: Record<string, unknown>): Promise<PaymentProposalRecord>;
  list(options: { status?: string; limit?: number }): Promise<{ payments: PaymentProposalRecord[] }>;
  limits(currency: string): Promise<Record<string, unknown>>;
  shopifyCart?(input: { productUrl: unknown; options?: unknown; quantity?: unknown }): Promise<Record<string, unknown>>;
  /** Buying from another ME3 site through its agent commerce API (network commerce). */
  networkCheck?(seller: NetworkSellerRef, input: { offeringId: unknown; from?: unknown; to?: unknown }): Promise<Record<string, unknown>>;
  proposeNetwork?(input: { seller: NetworkSellerRef | null; offeringId: unknown; slotStart?: unknown; quantity?: unknown; purpose: unknown }, scope: { threadId: string; turnId: string; idempotencyKey: string }): Promise<PaymentProposalRecord>;
  handOverNetwork?(proposalId: string, proposalHash: string): Promise<{ outcome: string; proposal: PaymentProposalRecord; handOver: { openUrl: string; instructions: string; expiresAt: string | null } | null; next: string; [key: string]: unknown }>;
  refreshNetwork?(proposalId: string): Promise<PaymentProposalRecord>;
}
/** A seller from the network index. Its spec URL is the only address ME3 calls to buy. */
export type NetworkSellerRef = { profileId: string | null; name: string; handle: string | null; profileUrl: string | null; specUrl: string; offeringUrl?: string | null };

/** Custom Home cards, provided by the worker. Each call throws an owner-facing Error on bad input. */
export interface AgentHomeCardServices {
  list(): Promise<unknown>;
  read(cardId: string): Promise<unknown>;
  create(input: unknown): Promise<unknown>;
  update(cardId: string, input: unknown, summary: unknown): Promise<unknown>;
  act(cardId: string, input: unknown): Promise<unknown>;
}
export interface AgentDomainServices {
  cards?: AgentHomeCardServices;
  quotes?: { save(input: Record<string, unknown>, options?: { signal?: AbortSignal; authorization?: import("../owner-create-intent").OwnerCreateAuthorization }): Promise<unknown> };
  mailbox?: AgentMailboxServices;
  scheduling?: AgentSchedulingServices;
  people?: AgentPeopleServices;
  images?: AgentImageGenerationServices;
  payments?: AgentPaymentServices;
  /** Background browser jobs; present only when the installation has Browser Run. */
  computer?: import("../computer/tools").ComputerChatServices;
  web?: { search: WebResearchService["search"]; open: WebContentFetcher["open"] };
  landingPageEnv?: AgentLandingPageEnv;
}
