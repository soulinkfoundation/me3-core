import { decodeMimeHeaderValue } from "../../../shared/email-headers";
import { ACCOUNTS_PLUGIN_ID, AccountsInputError, getOrCreateCategoryByName } from "./accounts";
import { getDefaultCommerceCurrency } from "./commerce-settings";
import { isCorePluginEnabled } from "./plugins";
import { sha256Text } from "./sites";
import type { Env } from "./types";

export const ACCOUNTS_EMAIL_TRIAGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts_email_triage_settings (
    user_id TEXT PRIMARY KEY REFERENCES owner_profile(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
  )`,
] as const;

type InvoiceMessage = {
  id: string;
  user_id: string;
  mailbox_id: string;
  provider_id: string | null;
  provider_message_id: string | null;
  subject: string | null;
  from_address: string | null;
  text_body: string | null;
  received_at: string | null;
  created_at: string;
};

type InvoiceExtraction = {
  messageId: string;
  entryType: "income" | "expense";
  description: string;
  amountCents: number;
  currency: string;
  date: string;
  status: "paid" | "needs_review";
  categoryHint: string;
  confidence: "high" | "medium";
  sourceRef: string;
};

export async function getAccountsEmailTriageSettings(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT enabled FROM accounts_email_triage_settings WHERE user_id = ?")
    .bind(userId).first<{ enabled: number }>();
  return { enabled: row ? row.enabled === 1 : true };
}

export async function updateAccountsEmailTriageSettings(env: Env, userId: string, enabled: unknown) {
  if (typeof enabled !== "boolean") throw new AccountsInputError("enabled must be a boolean");
  await env.DB.prepare(
    `INSERT INTO accounts_email_triage_settings(user_id, enabled) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled`,
  ).bind(userId, enabled ? 1 : 0).run();
  return { enabled };
}

export async function triageInboundInvoiceEmail(env: Env, mailboxId: string, messageId: string): Promise<boolean> {
  const message = await env.DB.prepare(
    `SELECT m.id, a.user_id, m.mailbox_id, m.provider_id, m.provider_message_id,
            m.subject, m.from_address, m.text_body, m.received_at, m.created_at
     FROM mailbox_messages m JOIN mailbox_aliases a ON a.id = m.mailbox_id
     WHERE m.id = ? AND m.mailbox_id = ? AND a.status = 'active'
       AND m.direction = 'inbound' AND m.message_kind = 'email'
       AND m.status IN ('received', 'forwarded')`,
  ).bind(messageId, mailboxId).first<InvoiceMessage>();
  if (!message || !await isCorePluginEnabled(env, ACCOUNTS_PLUGIN_ID)) return false;
  if (!(await getAccountsEmailTriageSettings(env, message.user_id)).enabled) return false;
  const score = scoreInvoiceMessage(message);
  if (score < MIN_INVOICE_MESSAGE_SCORE) return false;
  const extraction = extractInvoiceFromMessage(message, score, await getDefaultCommerceCurrency(env, message.user_id));
  if (!extraction) return false;

  // Direct delivery retries can persist a new mailbox row for the same provider message.
  const entryId = `email-triage:${await sha256Text(JSON.stringify([mailboxId, message.provider_id, message.provider_message_id || message.id]))}`;
  return insertInvoiceFinancialEntry(env, message.user_id, entryId, extraction);
}

async function insertInvoiceFinancialEntry(env: Env, userId: string, entryId: string, extraction: InvoiceExtraction) {
  const category = await getOrCreateCategoryByName(env, userId, extraction.entryType, extraction.categoryHint);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO financial_entries
       (id, user_id, entry_type, date, description, category_id, amount_cents,
        currency, status, source, notes, source_ref, source_email_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'email_triage', ?, ?, ?)`,
  ).bind(
    entryId, userId, extraction.entryType, extraction.date, extraction.description,
    category?.id || null, extraction.amountCents, extraction.currency, extraction.status,
    `Auto-triaged from email with ${extraction.confidence} confidence.`, extraction.sourceRef, extraction.messageId,
  ).run();
  return (result.meta?.changes || 0) > 0;
}

// The retired invoice-receipt job's deterministic heuristic; no model or mailbox scan.
const INVOICE_SUBJECT_KEYWORDS = ["invoice", "receipt", "billing", "payment", "statement", "subscription", "charge", "order confirmation"];
const INVOICE_SENDER_KEYWORDS = ["billing", "invoice", "receipt", "stripe", "paypal", "wise", "quickbooks", "xero"];
const INVOICE_BODY_CUES = ["amount due", "balance due", "grand total", "invoice number", "invoice #", "payment received", "payment confirmation", "thank you for your payment"];
const INVOICE_NON_TRANSACTIONAL_NOTICE_CUES = ["introducing", "eligible for", "how it works", "learn more", "for example", "available for", "available to", "allowing you to", "new feature", "beta", "preview"];
const INVOICE_TRANSACTIONAL_CUE_PATTERN = /\b(invoice|receipt|billing statement|amount due|balance due|grand total|invoice number|invoice #|payment received|payment confirmation|thank you for your payment|successful payment|payment of|charged|charge receipt|paid invoice|order confirmation)\b/i;
const INVOICE_AMOUNT_PATTERN = /([$€£¥])\s?(\d[\d,]*(?:\.\d{1,2})?)|(?:\b(USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|SEK|NOK|DKK|SGD|HKD)\b)\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
const INVOICE_LABELLED_AMOUNT_PATTERN = /(?:total|amount\s*due|balance\s*due|grand\s*total|subtotal|net\s*amount|invoice\s*total)[:\s]*[$€£¥]?\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
const MIN_INVOICE_MESSAGE_SCORE = 5;

function scoreInvoiceMessage(message: InvoiceMessage) {
  const subject = decodeMimeHeaderValue(message.subject || "").toLowerCase();
  const from = (message.from_address || "").toLowerCase();
  const body = (message.text_body || "").toLowerCase();
  const text = `${subject}\n${body}`;
  if (!INVOICE_TRANSACTIONAL_CUE_PATTERN.test(text) && INVOICE_NON_TRANSACTIONAL_NOTICE_CUES.some(cue => text.includes(cue))) return 0;
  let score = 0;
  if (INVOICE_SUBJECT_KEYWORDS.some(keyword => subject.includes(keyword))) score += 3;
  if (INVOICE_SENDER_KEYWORDS.some(keyword => from.includes(keyword))) score += 2;
  if (INVOICE_AMOUNT_PATTERN.test(text)) score += 2;
  for (const cue of INVOICE_BODY_CUES) if (body.includes(cue)) score++;
  if (INVOICE_LABELLED_AMOUNT_PATTERN.test(body)) score += 2;
  return score;
}

function extractInvoiceFromMessage(message: InvoiceMessage, score: number, defaultCurrency: string): InvoiceExtraction | null {
  const subject = decodeMimeHeaderValue(message.subject || "").trim() || "Invoice";
  const body = (message.text_body || "").replace(/\s+/g, " ").trim();
  const combined = `${subject}\n${body}`;
  const amount = parseInvoiceAmount(combined, defaultCurrency);
  if (!amount) return null;
  const confidence = score >= 7 ? "high" : "medium";
  return {
    messageId: message.id,
    entryType: inferInvoiceEntryType(message, combined),
    description: subject,
    ...amount,
    date: (message.received_at || message.created_at).slice(0, 10),
    status: confidence === "high" && looksPaid(combined) ? "paid" : "needs_review",
    categoryHint: inferInvoiceCategory(message),
    confidence,
    sourceRef: `email:${message.id}`,
  };
}

function inferInvoiceEntryType(message: InvoiceMessage, text: string): "income" | "expense" {
  return /\b(stripe|paypal|wise)\b/i.test(message.from_address || "") &&
    /\b(payment\s+of|payment\s+received|successful\s+payment|you\s+received)\b/i.test(text)
    ? "income" : "expense";
}

function parseInvoiceAmount(text: string, defaultCurrency: string) {
  const match = text.match(INVOICE_AMOUNT_PATTERN);
  const labelled = text.match(INVOICE_LABELLED_AMOUNT_PATTERN);
  const value = match?.[2] || match?.[4] || labelled?.[1];
  if (!value) return null;
  const amountCents = Math.round(Number.parseFloat(value.replace(/,/g, "")) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  const currency = ({ "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" } as Record<string, string>)[match?.[1] || ""] || match?.[3]?.toUpperCase() || defaultCurrency;
  return { amountCents, currency };
}

function looksPaid(text: string) {
  if (/\b(unpaid|not\s+paid|outstanding|amount\s+due|balance\s+due|payment\s+(?:due|failed))\b/i.test(text)) return false;
  return /\b(receipt|paid|payment received|payment confirmation|successful payment|thank you for your payment)\b/i.test(text);
}

function inferInvoiceCategory(message: InvoiceMessage) {
  const text = `${decodeMimeHeaderValue(message.subject || "")}\n${message.from_address || ""}\n${message.text_body || ""}`;
  if (/\b(hosting|cloudflare|vercel|netlify|aws|google cloud|render)\b/i.test(text)) return "Hosting";
  if (/\b(software|subscription|saas|github|notion|linear|figma|openai)\b/i.test(text)) return "Software";
  if (/\b(contractor|freelance|consultant)\b/i.test(text)) return "Contractor";
  if (/\b(marketing|ads|campaign)\b/i.test(text)) return "Marketing";
  if (/\b(travel|hotel|flight|train|taxi|uber)\b/i.test(text)) return "Travel";
  return "Other";
}
