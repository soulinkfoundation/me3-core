// Which emails count as "money arrived" for Pay me directly, and where the payer, amount and
// reference sit in them. THIS TABLE IS THE ONE PLACE TO CORRECT WHEN A REAL EMAIL DISAGREES.
//
// UNVERIFIED (2026-11-17): none of these were checked against real provider emails. There were no
// real PayPal, Wise or Revolut payment emails in the repository's fixtures or the local mailbox data
// when this was written, so every sender address and every wording pattern below is a best guess,
// tested only against the synthetic examples in payment-email-matching.test.ts. Per provider:
// - PayPal: unverified. Senders and "sent you" / "You received a payment" wording are assumed.
// - Wise: unverified. Senders and "sent you" / "You received" wording are assumed. A Wise Business
//   payment link carries the reference; whether the email repeats it is assumed, not known.
// - Revolut: unverified, and Revolut Business only. Revolut personal accounts are not known to email
//   when money arrives (they may only notify in the app); nothing here assumes they do.
// A provider whose emails turn out not to exist should be deleted from this table.
//
// A rule only says what an email is. It never confirms a payment: a matched email becomes a
// suggestion for the owner, who confirms or leaves it.

export type PaymentEmailProvider = "paypal" | "wise" | "revolut";

export type PaymentEmailRule = {
  provider: PaymentEmailProvider;
  /** Shown to the owner as where the evidence came from. */
  label: string;
  /** The sender's domain must be one of these, or a subdomain of one. */
  senderDomains: string[];
  /** The subject or body must match one of these to count as incoming money. */
  received: RegExp[];
  /** First capture group is the payer's name. Tried in order. */
  payer: RegExp[];
  /** Checked against real emails from this provider. False means a guess. */
  verified: boolean;
};

// A person's name as it appears in these emails: up to four capitalised words, with the usual
// lower-case particles between them ("Ana de la Cruz"). It stops at the first other lower-case word.
const NAME = String.raw`(\p{Lu}[\p{L}'’.-]*(?:[ \t]+(?:(?:de|da|do|dos|del|della|di|la|le|van|von|der|den|bin|al)[ \t]+)*\p{Lu}[\p{L}'’.-]*){0,3})`;

export const PAYMENT_EMAIL_RULES: PaymentEmailRule[] = [
  {
    provider: "paypal",
    label: "PayPal",
    senderDomains: ["paypal.com", "paypal.co.uk", "paypal.ie", "paypal.de", "paypal.fr"],
    received: [/you(?:'|’)ve got money/i, /you received a payment/i, /\bsent you\b/i, /payment received from/i],
    payer: [
      new RegExp(String.raw`^\s*${NAME}[ \t]+(?:has[ \t]+)?sent you\b`, "mu"),
      new RegExp(String.raw`payment(?:[ \t]+of[ \t]+[^\n]{1,30}?)?[ \t]+from[ \t]+${NAME}`, "u"),
    ],
    verified: false,
  },
  {
    provider: "wise",
    label: "Wise",
    senderDomains: ["wise.com", "transferwise.com"],
    received: [/\byou received\b/i, /\bsent you\b/i, /\bpaid you\b/i, /money (?:has )?arrived/i],
    payer: [
      new RegExp(String.raw`^\s*${NAME}[ \t]+(?:has[ \t]+)?(?:sent|paid) you\b`, "mu"),
      new RegExp(String.raw`\bfrom[ \t]+${NAME}`, "u"),
    ],
    verified: false,
  },
  {
    // Revolut Business only. Personal accounts are not known to send these.
    provider: "revolut",
    label: "Revolut",
    senderDomains: ["revolut.com"],
    received: [/\byou received\b/i, /\bsent you\b/i, /payment received/i],
    payer: [
      new RegExp(String.raw`^\s*${NAME}[ \t]+(?:has[ \t]+)?sent you\b`, "mu"),
      new RegExp(String.raw`\bfrom[ \t]+${NAME}`, "u"),
    ],
    verified: false,
  },
];

/** An ME3 payment reference anywhere in an email (the buyer may have typed it as a note). */
export const PAYMENT_REFERENCE_IN_TEXT = /\bME3-[2-9A-HJ-NP-Z]{4,6}\b/i;

/** "€60.00", "60.00 EUR" or "EUR 60.00". */
export const PAYMENT_AMOUNT_IN_TEXT =
  /([$€£])[ \t]?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)[ \t]?(USD|EUR|GBP|CAD|AUD|CHF|SGD|INR|PKR)\b|\b(USD|EUR|GBP|CAD|AUD|CHF|SGD|INR|PKR)[ \t]?(\d[\d,]*(?:\.\d{1,2})?)/i;
