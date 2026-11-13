/** Shapes of GET /api/mailbox/brief and the sender identity Core adds to mail rows (Core 0.1.227+). */

export type MailSenderIdentity = {
  name: string;
  address: string;
  initials: string;
  avatarUrl: string | null;
  contactId: string | null;
  isForward?: boolean;
  originalSender?: { name: string; address: string } | null;
};

export type MailTriageTag = {
  category: "needs_you" | "handled" | "fyi" | "noise" | null;
  summary: string | null;
  handledKind: string | null;
  draftId: string | null;
  label: string | null;
};

export type MailboxBriefAction = {
  kind: string;
  label: string;
  url?: string | null;
};

export type MailboxBriefItem = {
  messageId: string;
  threadId: string;
  sender: MailSenderIdentity;
  subject: string;
  summary: string;
  receivedAt: string;
  unread: boolean;
  urgency: "low" | "normal" | "urgent";
  pending: boolean;
  primaryAction: MailboxBriefAction | null;
  secondaryAction: MailboxBriefAction | null;
  /** updatedAt (Core 0.1.268+) is the draft's version, sent back as expectedUpdatedAt when an edit is saved. */
  draft: { id: string; preview: string; body: string; updatedAt?: string | null } | null;
  /** Older messages from the same sender about the same thing, folded into this item (Core 0.1.232+). */
  duplicates?: number;
  relatedMessageIds?: string[];
};

export type MailboxHandledItem = {
  id: string;
  messageId: string;
  threadId: string | null;
  kind: string;
  label: string;
  detail: string | null;
  sender: MailSenderIdentity | null;
  subject: string | null;
  amountCents: number | null;
  currency: string | null;
  createdAt: string;
  undo: { kind: "move_to_inbox" | "remove_ledger_entry" | "restore_outreach" } | null;
};

export type MailboxHandledGroup = {
  kind: string;
  title: string;
  count: number;
  amountCents: number | null;
  currency: string | null;
  byRule: boolean;
  items: MailboxHandledItem[];
};

/** Outreach: a prospect past their follow-up date who has not answered. */
export type MailboxFollowUp = {
  contactId: string;
  name: string;
  organisation: string | null;
  email: string;
  offer: string | null;
  subject: string | null;
  daysWaiting: number;
  followUpNumber: number;
  followUpCap: number;
  draft: { id: string; preview: string; body: string; updatedAt?: string | null } | null;
};

/** A conversation that left needs-you today, and how (Core 0.1.268+). */
export type MailboxClearedItem = {
  messageId: string;
  threadId: string;
  sender: MailSenderIdentity;
  subject: string;
  how: "done" | "replied" | "replied_elsewhere" | "archived" | "trashed" | "spam";
  clearedAt: string;
};

export type MailboxBrief = {
  needsYou: MailboxBriefItem[];
  /** Missing on older Workers. */
  cleared?: MailboxClearedItem[];
  /** Missing on older Workers. */
  followUps?: MailboxFollowUp[];
  handled: { total: number; groups: MailboxHandledGroup[] };
  fyi: { inboxLeft: number; unread: number };
  checkedAt: string | null;
  dayStartsAt: string;
};

export type MailboxRule = {
  id: string;
  kind: "archive_sender" | "archive_domain" | "always_show_sender" | "spam_sender" | "spam_domain";
  matchValue: string;
  label: string;
  status: "active" | "paused";
  createdAt: string;
};

export function formatMailMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amountCents / 100);
  } catch {
    return `${currency} ${(amountCents / 100).toFixed(2)}`;
  }
}

export function mailInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}
