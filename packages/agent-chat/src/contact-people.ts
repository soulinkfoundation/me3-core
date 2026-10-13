import type { ReminderDb } from "./reminders";

// People v1: the derived fields behind "Close", "Client" and "last in touch".
// Close is metadata.closeness (also the close_contact scheduling tier); Client
// comes from bookings and purchases on the owner's own sites; last in touch is
// contacts.last_interaction_at, which only ever moves forward.

type ContactPeopleEnv = { DB: ReminderDb };

const CLOSE_CLOSENESS = new Set(["close", "very_close"]);

export function isCloseCloseness(value: unknown): boolean {
  return typeof value === "string" && CLOSE_CLOSENESS.has(value);
}

// Matches the customers that /api/accounts/customers lists: confirmed bookings
// and paid (or manual pending) orders on the owner's sites, plus Stripe income.
export const CONTACT_IS_CLIENT_SQL = `(
  c.relationship = 'client'
  OR (c.email IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM bookings cb
      INNER JOIN sites cs ON cs.id = cb.site_id
      WHERE cs.user_id = c.user_id AND cb.status = 'confirmed'
        AND LOWER(TRIM(cb.guest_email)) = LOWER(TRIM(c.email))
    )
    OR EXISTS (
      SELECT 1 FROM commerce_orders co
      INNER JOIN sites os ON os.id = co.site_id
      WHERE os.user_id = c.user_id
        AND (co.status IN ('paid', 'refunded')
             OR (co.payment_method = 'manual' AND co.status = 'pending'))
        AND LOWER(TRIM(co.buyer_email)) = LOWER(TRIM(c.email))
    )
    OR EXISTS (
      SELECT 1 FROM financial_entries fe
      WHERE fe.user_id = c.user_id AND fe.entry_type = 'income' AND fe.source = 'stripe'
        AND LOWER(TRIM(fe.customer_email)) = LOWER(TRIM(c.email))
    )
  ))
)`;

export function normalizeInteractionTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  // SQLite CURRENT_TIMESTAMP values have no zone; they are UTC.
  const parsed = Date.parse(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
      ? `${trimmed.replace(" ", "T")}Z`
      : trimmed,
  );
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function laterInteractionTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  let latest: string | null = null;
  for (const value of values) {
    const normalized = normalizeInteractionTimestamp(value);
    if (normalized && (!latest || normalized > latest)) latest = normalized;
  }
  return latest;
}

// Moves last_interaction_at forward for the matching contacts; never back.
export async function touchContactInteraction(
  env: ContactPeopleEnv,
  userId: string,
  target: { contactId?: string | null; emails?: Array<string | null | undefined> },
  at: string = new Date().toISOString(),
): Promise<number> {
  const touchedAt = normalizeInteractionTimestamp(at);
  if (!touchedAt) return 0;
  const emails = Array.from(
    new Set(
      (target.emails || [])
        .map((email) => email?.trim().toLowerCase() || "")
        .filter((email) => email.includes("@")),
    ),
  ).slice(0, 50);
  if (!target.contactId && emails.length === 0) return 0;

  const match = target.contactId
    ? "id = ?"
    : `LOWER(TRIM(email)) IN (${emails.map(() => "?").join(", ")})`;
  const result = await env.DB.prepare(
    `UPDATE contacts
     SET last_interaction_at = ?
     WHERE user_id = ? AND ${match}
       AND (last_interaction_at IS NULL
            OR COALESCE(julianday(last_interaction_at), 0) < julianday(?))`,
  )
    .bind(touchedAt, userId, ...(target.contactId ? [target.contactId] : emails), touchedAt)
    .run();
  return Number(result.meta?.changes || 0);
}

// A booking counts as being in touch when it is made, and again when the call
// takes place. Run before reading contacts so past calls are reflected.
export async function refreshContactInteractionsFromBookings(
  env: ContactPeopleEnv,
  userId: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(
    `WITH touches AS (
       SELECT c.id AS contact_id,
              MAX(CASE
                WHEN julianday(b.starts_at) <= julianday(?) THEN julianday(b.starts_at)
                ELSE julianday(b.created_at)
              END) AS touched
       FROM contacts c
       INNER JOIN bookings b ON LOWER(TRIM(b.guest_email)) = LOWER(TRIM(c.email))
       INNER JOIN sites s ON s.id = b.site_id AND s.user_id = c.user_id
       WHERE c.user_id = ? AND c.email IS NOT NULL AND b.status = 'confirmed'
       GROUP BY c.id
     )
     UPDATE contacts
     SET last_interaction_at = strftime(
       '%Y-%m-%dT%H:%M:%fZ',
       (SELECT touched FROM touches WHERE touches.contact_id = contacts.id)
     )
     WHERE user_id = ? AND id IN (
       SELECT t.contact_id FROM touches t
       WHERE t.touched IS NOT NULL
         AND t.touched > COALESCE(julianday(contacts.last_interaction_at), 0)
     )`,
  )
    .bind(now, userId, userId)
    .run();
}
