import { clearContactReminder, createAgentContact, markAgentContactInTouch, setContactReminder, updateAgentContact } from "@me3-core/plugin-agent-chat";
import { getAgentContact } from "../../../packages/agent-chat/src/contacts";
import type { AgentContactServices } from "../../../packages/agent/src/tools/services";
import { listContactMailHistory } from "./mailbox-outreach";
import type { Env } from "./types";

const SECTION_LIMIT = 8;
const EDITABLE = ["name", "email", "phone", "organisation", "notes", "tags"] as const;

/** People for the assistant: one person with what ME3 holds about them, and keeping their record. */
export function createAgentContactServices(env: Env, ownerId: string): AgentContactServices {
  const unwrap = <T extends object>(value: T): Exclude<T, { error: string }> => {
    if ("error" in value) throw new Error(String(value.error));
    return value as Exclude<T, { error: string }>;
  };
  return {
    async read(contactId) {
      const contact = await getAgentContact(env, ownerId, contactId);
      if (!contact) return null;
      const email = contact.email?.trim().toLowerCase() || null;
      const [mail, bookings, bookingCount, payments, paymentTotals] = await Promise.all([
        listContactMailHistory(env, ownerId, contactId),
        email ? env.DB.prepare(
          `SELECT b.id, b.starts_at AS startsAt, b.duration_minutes AS durationMinutes, b.status, b.booking_type AS bookingType
           FROM bookings b JOIN sites s ON s.id = b.site_id
           WHERE s.user_id = ? AND LOWER(b.guest_email) = ? ORDER BY b.starts_at DESC LIMIT ?`,
        ).bind(ownerId, email, SECTION_LIMIT).all<Record<string, unknown>>() : null,
        email ? env.DB.prepare(
          `SELECT COUNT(*) AS count FROM bookings b JOIN sites s ON s.id = b.site_id WHERE s.user_id = ? AND LOWER(b.guest_email) = ?`,
        ).bind(ownerId, email).first<{ count: number }>() : null,
        email ? env.DB.prepare(
          `SELECT id, date, description, amount_cents, UPPER(currency) AS currency, status FROM financial_entries
           WHERE user_id = ? AND entry_type = 'income' AND LOWER(customer_email) = ? ORDER BY date DESC LIMIT ?`,
        ).bind(ownerId, email, SECTION_LIMIT).all<{ id: string; date: string; description: string; amount_cents: number; currency: string; status: string }>() : null,
        email ? env.DB.prepare(
          `SELECT UPPER(currency) AS currency, SUM(amount_cents) AS total, COUNT(*) AS count FROM financial_entries
           WHERE user_id = ? AND entry_type = 'income' AND status = 'paid' AND LOWER(customer_email) = ? GROUP BY UPPER(currency) ORDER BY UPPER(currency)`,
        ).bind(ownerId, email).all<{ currency: string; total: number; count: number }>() : null,
      ]);
      const money = (cents: number) => (cents / 100).toFixed(2);
      return {
        contact,
        emails: { recent: "history" in mail ? mail.history : [], note: "Subjects and dates only; read a message with core_mailbox_read." },
        bookings: { total: bookingCount?.count || 0, recent: bookings?.results || [] },
        payments: {
          totals: (paymentTotals?.results || []).map(row => ({ currency: row.currency, amount: money(Number(row.total) || 0) })),
          count: (paymentTotals?.results || []).reduce((sum, row) => sum + Number(row.count), 0),
          recent: (payments?.results || []).map(row => ({ id: row.id, date: row.date, description: row.description, amount: money(row.amount_cents), currency: row.currency, status: row.status })),
        },
        outreach: { status: contact.outreachStatus, offer: contact.offer, followUpAt: contact.nextFollowupAt },
        reminderAt: contact.reminderAt,
        limits: `Up to ${SECTION_LIMIT} recent items per section; totals count everything.`,
      };
    },
    async save(input, timezone) {
      const contactId = typeof input.contactId === "string" && input.contactId.trim() ? input.contactId.trim() : null;
      const fields = Object.fromEntries(EDITABLE.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
      let contact = contactId
        ? Object.keys(fields).length ? unwrap(await updateAgentContact(env, ownerId, contactId, fields)) : await getAgentContact(env, ownerId, contactId)
        : unwrap(await createAgentContact(env, ownerId, fields));
      if (!contact) throw new Error("Contact not found");
      if (input.inTouch === true) contact = unwrap(await markAgentContactInTouch(env, ownerId, contact.id));
      let reminderAt: string | null | undefined;
      if (input.clearReminder === true) { await clearContactReminder(env, ownerId, contact.id); reminderAt = null; }
      if (typeof input.remindOn === "string" && input.remindOn.trim()) {
        reminderAt = unwrap(await setContactReminder(env, ownerId, contact.id, { date: input.remindOn.trim(), timezone })).remindAt;
      }
      return { contact: (await getAgentContact(env, ownerId, contact.id)) || contact, created: !contactId, ...(reminderAt === undefined ? {} : { reminderAt }) };
    },
  };
}
