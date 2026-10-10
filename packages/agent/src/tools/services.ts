import type { WebContentFetcher, WebResearchService } from "@me3-core/web-research";
import type { AgentLandingPageEnv } from "../../../agent-chat/src/landing-pages";

export type MailboxRecord = { id: string; status?: string; to?: string | null; toAddress?: string | null; subject?: string | null; bodyText?: string | null; [key: string]: unknown };
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
  search(input: { query: string; offeringType?: "service" | "product"; countryCode?: string; limit?: number }): Promise<{ results: PeopleRecord[]; [key: string]: unknown }>;
}
export interface AgentDomainServices {
  mailbox?: AgentMailboxServices;
  scheduling?: AgentSchedulingServices;
  people?: AgentPeopleServices;
  web?: { search: WebResearchService["search"]; open: WebContentFetcher["open"] };
  landingPageEnv?: AgentLandingPageEnv;
}
