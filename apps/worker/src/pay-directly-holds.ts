import { findActiveBookingHoldOverlap, findConfirmedBookingOverlap, loadSiteProfileForCommerce, type CoreBookIntent } from "./booking";
import { cancelPendingBookingReminders } from "./booking-reminders";
import { getPayDirectlyHoldSettings } from "./commerce-settings";
import { getEventOccurrenceAvailability, resolveEventBookingOffer, type EventOccurrence } from "./event-booking";
import { recordManualOrderPayment } from "./account-order-fulfillment";
import { getDefaultCommerceCurrency } from "./commerce-settings";
import { payPageUrl } from "./pay-directly";
import { DirectPaymentError, loadWaitingHolds, markBookingPaid, type WaitingHold, type WaitingMatch } from "./pay-directly-bookings";
import { matchPaymentEmail, parsePaymentEmail } from "./payment-email-matching";
import { sendPayDirectlyNotice } from "./transactional-emails";
import type { DbBooking, DbSite, Env } from "./types";
import { PAY_DIRECTLY_SAYS_PAID_PAUSE_DAYS } from "../../../shared/pay-directly";

// What happens to a pay-directly order or booking while nobody has paid: one reminder to the buyer,
// a warning to the owner before release, then release (the slot, seats or stock go back and both
// sides are told). "I've paid" stops automatic release; the owner then confirms or releases.
// ME3 still never marks anything paid by itself.

type OwnerContext = { name: string; firstName: string; email: string | null; timezone: string };

const sqliteTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

function money(amountCents: number, currency: string): string {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountCents / 100); }
  catch { return `${(amountCents / 100).toFixed(2)} ${currency}`; }
}

function when(iso: string | number, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  try { return new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short", timeZone: timezone }).format(date); }
  catch { return new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(date); }
}

async function ownerContext(env: Env, ownerId: string): Promise<OwnerContext> {
  const owner = await env.DB.prepare("SELECT name, email, timezone FROM owner_profile WHERE id = ?")
    .bind(ownerId).first<{ name: string | null; email: string | null; timezone: string | null }>();
  const name = owner?.name?.trim() || "ME3";
  return { name, firstName: firstName(name), email: owner?.email || null, timezone: owner?.timezone || "UTC" };
}

function rows(hold: WaitingHold, owner: OwnerContext): Array<[string, string]> {
  const { item } = hold;
  return [
    [item.kind === "order" ? "Order" : "Booking", [item.title, item.quantity > 1 ? `${item.quantity} places` : "", item.startsAt ? when(item.startsAt, owner.timezone) : ""].filter(Boolean).join(" · ")],
    ["Amount", money(item.amountCents, item.currency)],
    ["Reference", item.reference],
  ];
}

const thing = (hold: WaitingHold) => (hold.item.kind === "order" ? "order" : "booking");

async function payLink(env: Env, hold: WaitingHold): Promise<{ label: string; url: string } | null> {
  const url = hold.payToken ? await payPageUrl(env, hold.siteId, hold.payToken) : "";
  return url ? { label: "Open the payment page", url } : null;
}

/** The buyer's reminder: what they owe, the reference, the pay page, and when the hold ends. */
async function sendBuyerReminder(env: Env, ownerId: string, hold: WaitingHold, owner: OwnerContext, stamp: string) {
  const { item } = hold;
  const link = await payLink(env, hold);
  return sendPayDirectlyNotice(env, ownerId, {
    operationId: `pay-directly:${item.reference}:reminder:${stamp}`,
    kind: "buyer_reminder",
    toAddress: item.customerEmail,
    fromName: owner.name,
    replyToAddress: owner.email,
    subject: `Reminder: ${item.title} is waiting for your payment`,
    heading: "Still waiting for your payment",
    greeting: `Hi ${firstName(item.customerName)},`,
    paragraphs: [
      `${owner.firstName} is still holding your ${thing(hold)} and has not had your payment yet.`,
      item.heldUntil ? `It is held until ${when(item.heldUntil, owner.timezone)}. After that it is released.` : "",
      link
        ? `If you have already paid, tap I’ve paid on the payment page so ${owner.firstName} knows to look for it.`
        : `The payment details are in the earlier email. If you have already paid, reply to this email so ${owner.firstName} knows to look for it.`,
    ].filter(Boolean),
    rows: rows(hold, owner),
    link,
    signature: owner.name,
  });
}

async function sendOwnerNotice(
  env: Env,
  ownerId: string,
  hold: WaitingHold,
  owner: OwnerContext,
  notice: { kind: string; stamp: string; subject: string; heading: string; paragraphs: string[] },
) {
  if (!owner.email) return null;
  return sendPayDirectlyNotice(env, ownerId, {
    operationId: `pay-directly:${hold.item.reference}:${notice.kind}:${notice.stamp}`,
    kind: notice.kind,
    toAddress: owner.email,
    fromName: "ME3",
    replyToAddress: hold.item.customerEmail,
    subject: notice.subject,
    heading: notice.heading,
    greeting: `Hi ${owner.firstName},`,
    paragraphs: notice.paragraphs,
    rows: [["Buyer", `${hold.item.customerName} (${hold.item.customerEmail})`], ...rows(hold, owner)],
    signature: "ME3",
  });
}

/** Sets a time on the hold only if it is still empty, so two overlapping runs send one email. */
async function claim(env: Env, reference: string, column: "reminded_at" | "owner_warned_at" | "owner_nudged_at", now: Date, force = false): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE commerce_direct_payments SET ${column} = ? WHERE reference = ? AND released_at IS NULL${force ? "" : ` AND (${column} IS NULL OR ${column} < COALESCE(hold_started_at, ''))`}`,
  ).bind(sqliteTime(now), reference).run();
  return Number(result.meta?.changes || 0) > 0;
}

/**
 * Releases an unpaid hold: a booking is cancelled (its slot or seats are free again), an order is
 * closed (its copy is back in stock), and the buyer is told. The owner is told too unless they did it.
 */
async function releaseHold(env: Env, ownerId: string, hold: WaitingHold, owner: OwnerContext, by: "auto" | "owner", now: Date): Promise<boolean> {
  const { item } = hold;
  const stamp = sqliteTime(now);
  const changed = item.kind === "order"
    ? await env.DB.prepare(
        "UPDATE commerce_orders SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending' AND payment_method = 'manual'",
      ).bind(stamp, item.id).run()
    : await env.DB.prepare(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, payment_status = 'failed'
         WHERE id = ? AND status = 'confirmed' AND payment_status = 'pending'`,
      ).bind(stamp, item.id).run();
  if (!Number(changed.meta?.changes || 0)) return false;
  await env.DB.prepare("UPDATE commerce_direct_payments SET released_at = ? WHERE reference = ?").bind(stamp, item.reference).run();
  if (item.kind !== "order") await cancelPendingBookingReminders(env, item.id).catch(() => undefined);

  const buyer = await sendPayDirectlyNotice(env, ownerId, {
    operationId: `pay-directly:${item.reference}:released:${stamp}`,
    kind: "buyer_released",
    toAddress: item.customerEmail,
    fromName: owner.name,
    replyToAddress: owner.email,
    subject: `${item.kind === "order" ? "Order closed" : "Booking released"}: ${item.title}`,
    heading: item.kind === "order" ? "Your order was closed" : "Your booking was released",
    greeting: `Hi ${firstName(item.customerName)},`,
    paragraphs: [
      item.kind === "order"
        ? `${owner.firstName} has not received your payment, so your order was closed. There is nothing to pay.`
        : `${owner.firstName} has not received your payment, so your booking was released and the time is open to others. There is nothing to pay.`,
      `If you have already paid, reply to this email and ${owner.firstName} will sort it out with you.`,
    ],
    rows: rows(hold, owner),
    signature: owner.name,
  });
  if (buyer.status === "failed") console.error("Pay-directly release email failed:", buyer.error);
  if (by === "auto") {
    await sendOwnerNotice(env, ownerId, hold, owner, {
      kind: "owner_released",
      stamp,
      subject: `Released: ${item.customerName} · ${item.title}`,
      heading: item.kind === "order" ? "An unpaid order was closed" : "An unpaid booking was released",
      paragraphs: [
        item.kind === "order"
          ? `${item.customerName} did not pay, so ME3 closed the order and put the copy back in stock. ${firstName(item.customerName)} has been told.`
          : `${item.customerName} did not pay, so ME3 released the booking and the time is free again. ${firstName(item.customerName)} has been told.`,
        item.kind === "order"
          ? "If they did pay you, reply to them and take a new order."
          : "If they did pay you, restore the booking in ME3 → Accounts → Waiting while the time is still free, then mark it paid.",
      ],
    });
  }
  return true;
}

/** The quarter-hour job: remind buyers, warn owners, release what is overdue, and nudge on stale "I've paid". */
export async function runPayDirectlyFollowUps(env: Env, now = new Date()): Promise<{ reminded: number; warned: number; released: number; nudged: number }> {
  const done = { reminded: 0, warned: 0, released: 0, nudged: 0 };
  let owners: Array<{ user_id: string }> = [];
  try {
    owners = (await env.DB.prepare(
      "SELECT DISTINCT user_id FROM commerce_direct_payments WHERE released_at IS NULL",
    ).all<{ user_id: string }>()).results || [];
  } catch {
    return done; // The tables arrive with the runtime migration.
  }
  const nowMs = now.getTime();
  for (const { user_id: ownerId } of owners) {
    const holds = await loadWaitingHolds(env, ownerId, await getPayDirectlyHoldSettings(env, ownerId), nowMs);
    if (!holds.length) continue;
    const owner = await ownerContext(env, ownerId);
    for (const hold of holds) {
      try {
        const { item, state } = hold;
        const stamp = sqliteTime(now);
        if (state.paused) {
          // The buyer says they paid: never released for them. After the pause the owner is asked to decide.
          if (item.needsDecision && await claim(env, item.reference, "owner_nudged_at", now)) {
            await sendOwnerNotice(env, ownerId, hold, owner, {
              kind: "owner_decide",
              stamp,
              subject: `Still waiting: ${item.customerName} said they paid`,
              heading: "Did this payment arrive?",
              paragraphs: [
                `${item.customerName} said they paid ${money(item.amountCents, item.currency)} on ${when(item.saysPaidAt || nowMs, owner.timezone)}, and it is still not marked paid.`,
                `Mark it paid, or release it, in ME3 → Accounts → Waiting. ME3 will not release it for you. Not yet keeps it waiting and asks you again in ${PAY_DIRECTLY_SAYS_PAID_PAUSE_DAYS} days.`,
              ],
            });
            done.nudged += 1;
          }
          continue;
        }
        if (nowMs >= state.releaseAtMs) {
          if (await releaseHold(env, ownerId, hold, owner, "auto", now)) done.released += 1;
          continue;
        }
        if (!item.remindedAt && nowMs >= state.remindAtMs && await claim(env, item.reference, "reminded_at", now)) {
          const sent = await sendBuyerReminder(env, ownerId, hold, owner, stamp);
          if (sent.status === "failed") console.error("Pay-directly reminder failed:", sent.error);
          done.reminded += 1;
        }
        if (!item.ownerWarnedAt && nowMs >= state.warnOwnerAtMs && await claim(env, item.reference, "owner_warned_at", now)) {
          await sendOwnerNotice(env, ownerId, hold, owner, {
            kind: "owner_release_warning",
            stamp,
            subject: `Unpaid: ${item.customerName} · ${item.title} is released ${when(state.releaseAtMs, owner.timezone)}`,
            heading: `This ${thing(hold)} is about to be released`,
            paragraphs: [
              `${item.customerName} has not paid for ${item.title}. ME3 releases it on ${when(state.releaseAtMs, owner.timezone)} and tells them.`,
              "If they have paid you, by bank transfer for example, mark it paid in ME3 → Accounts → Waiting. To give them longer, choose Keep holding there.",
            ],
          });
          done.warned += 1;
        }
      } catch (error) {
        console.error("Pay-directly follow-up failed for one hold:", error);
      }
    }
  }
  return done;
}

async function findHold(env: Env, ownerId: string, reference: string, now: Date): Promise<WaitingHold> {
  const holds = await loadWaitingHolds(env, ownerId, await getPayDirectlyHoldSettings(env, ownerId), now.getTime());
  const hold = holds.find((candidate) => candidate.item.reference === reference);
  if (!hold) throw new DirectPaymentError("That is not waiting for payment.", 404);
  return hold;
}

/** "Remind <name>": sends the buyer's reminder now, whether or not one has gone already. */
export async function remindWaitingBuyer(env: Env, ownerId: string, reference: string, now = new Date()) {
  const hold = await findHold(env, ownerId, reference, now);
  const sent = await sendBuyerReminder(env, ownerId, hold, await ownerContext(env, ownerId), sqliteTime(now));
  if (sent.status === "failed" || sent.status === "skipped") {
    throw new DirectPaymentError(sent.error || "The reminder could not be sent.", 409);
  }
  await claim(env, reference, "reminded_at", now, true);
  return { ok: true as const, remindedAt: now.toISOString() };
}

/**
 * "Keep holding" and "Not yet": the hold starts again from now, so release (or the next
 * "did this arrive?" question) moves out by the owner's setting. The buyer is not reminded again.
 */
export async function keepHolding(env: Env, ownerId: string, reference: string, now = new Date()) {
  await findHold(env, ownerId, reference, now);
  await env.DB.prepare(
    "UPDATE commerce_direct_payments SET hold_started_at = ?, owner_warned_at = NULL, owner_nudged_at = NULL WHERE reference = ? AND user_id = ?",
  ).bind(sqliteTime(now), reference, ownerId).run();
  const kept = await findHold(env, ownerId, reference, now);
  return { ok: true as const, waiting: kept.item };
}

/** The owner releases an unpaid order or booking now. The buyer is told. */
export async function releaseWaiting(env: Env, ownerId: string, reference: string, now = new Date()) {
  const hold = await findHold(env, ownerId, reference, now);
  if (!await releaseHold(env, ownerId, hold, await ownerContext(env, ownerId), "owner", now)) {
    throw new DirectPaymentError("That is not waiting for payment.", 409);
  }
  return { ok: true as const };
}

/** Puts a released booking back on hold if its time (or its seats) are still free. The buyer is told. */
export async function restoreReleasedBooking(env: Env, ownerId: string, reference: string, now = new Date()) {
  const booking = await env.DB.prepare(
    `SELECT b.* FROM bookings b
     JOIN sites s ON s.id = b.site_id
     JOIN commerce_direct_payments p ON p.booking_id = b.id
     WHERE p.reference = ? AND s.user_id = ? AND p.released_at IS NOT NULL
       AND b.status = 'cancelled' AND b.payment_status = 'failed'`,
  ).bind(reference, ownerId).first<DbBooking>();
  if (!booking) throw new DirectPaymentError("That booking cannot be restored.", 404);
  if (Date.parse(booking.starts_at) <= now.getTime()) throw new DirectPaymentError("That booking's time has passed.", 409);
  const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(booking.site_id).first<DbSite>();
  if (!site) throw new DirectPaymentError("That booking cannot be restored.", 404);

  const range = { siteId: booking.site_id, offerId: booking.offer_id || "", startsAt: booking.starts_at, endsAt: booking.ends_at };
  if (booking.booking_type === "class" || booking.booking_type === "retreat") {
    const bookIntent = (await loadSiteProfileForCommerce(env, site))?.intents?.book as CoreBookIntent | undefined;
    const offer = bookIntent ? resolveEventBookingOffer(bookIntent, booking.booking_type, booking.offer_id || "") : null;
    if (!offer) throw new DirectPaymentError("That event is no longer on your site.", 409);
    const availability = await getEventOccurrenceAvailability(env, {
      siteId: booking.site_id, offer, occurrence: { startsAt: booking.starts_at, endsAt: booking.ends_at } as EventOccurrence,
    });
    if (availability.remaining !== null && availability.remaining < Number(booking.quantity || 1)) {
      throw new DirectPaymentError("Those places have been taken since.", 409);
    }
  } else if (await findConfirmedBookingOverlap(env, range) || await findActiveBookingHoldOverlap(env, range)) {
    throw new DirectPaymentError("That time has been taken since.", 409);
  }

  const stamp = sqliteTime(now);
  const restored = await env.DB.prepare(
    "UPDATE bookings SET status = 'confirmed', cancelled_at = NULL, payment_status = 'pending' WHERE id = ? AND status = 'cancelled' AND payment_status = 'failed'",
  ).bind(booking.id).run();
  if (!Number(restored.meta?.changes || 0)) throw new DirectPaymentError("That booking cannot be restored.", 409);
  await env.DB.prepare(
    `UPDATE commerce_direct_payments SET released_at = NULL, hold_started_at = ?, reminded_at = NULL, owner_warned_at = NULL,
       owner_nudged_at = NULL, says_paid_at = NULL WHERE reference = ?`,
  ).bind(stamp, reference).run();

  const hold = await findHold(env, ownerId, reference, now);
  const owner = await ownerContext(env, ownerId);
  const link = await payLink(env, hold);
  const sent = await sendPayDirectlyNotice(env, ownerId, {
    operationId: `pay-directly:${reference}:restored:${stamp}`,
    kind: "buyer_restored",
    toAddress: hold.item.customerEmail,
    fromName: owner.name,
    replyToAddress: owner.email,
    subject: `Held again: ${hold.item.title}`,
    heading: "Your booking is held again",
    greeting: `Hi ${firstName(hold.item.customerName)},`,
    paragraphs: [
      `${owner.firstName} has put your booking back. It is confirmed once ${owner.firstName} has your payment.`,
      hold.item.heldUntil ? `It is held until ${when(hold.item.heldUntil, owner.timezone)}.` : "",
    ].filter(Boolean),
    rows: rows(hold, owner),
    link,
    signature: owner.name,
  });
  if (sent.status === "failed") console.error("Pay-directly restore email failed:", sent.error);
  return { ok: true as const, waiting: hold.item };
}

/** The buyer tapped "I've paid": the owner hears straight away, with what to look for. */
export async function notifyOwnerSaysPaid(env: Env, ownerId: string, reference: string, now = new Date()): Promise<void> {
  const hold = await findHold(env, ownerId, reference, now);
  const owner = await ownerContext(env, ownerId);
  const amount = money(hold.item.amountCents, hold.item.currency);
  await sendOwnerNotice(env, ownerId, hold, owner, {
    kind: "owner_says_paid",
    stamp: sqliteTime(now),
    subject: `${hold.item.customerName} says they’ve paid ${amount}`,
    heading: `${firstName(hold.item.customerName)} says they’ve paid`,
    paragraphs: [
      `Check your account for ${amount} with the reference ${hold.item.reference}. When it has arrived, mark it paid in ME3 → Accounts → Waiting and ME3 confirms with ${firstName(hold.item.customerName)}.`,
      "Nothing is released while you check.",
    ],
  });
}

// ---------------------------------------------------------------------------
// Payment emails. A "money arrived" email from PayPal, Wise or Revolut Business that fits a waiting
// order is shown to the owner as "Match found". It is evidence, never a confirmation.

/**
 * Looks at one inbound email. True when it was recorded as a possible payment for one or more
 * waiting orders, in which case Accounts must not also file it as income: the income is counted
 * once, from the order, when the owner confirms.
 */
export async function recordPaymentEmailMatch(
  env: Env,
  ownerId: string,
  message: { id: string; fromAddress: string | null; subject: string | null; textBody: string | null; receivedAt: string },
  now = new Date(),
): Promise<boolean> {
  const email = parsePaymentEmail(message, await getDefaultCommerceCurrency(env, ownerId).catch(() => "USD"));
  if (!email) return false;
  let holds: WaitingHold[];
  try {
    holds = await loadWaitingHolds(env, ownerId, await getPayDirectlyHoldSettings(env, ownerId), now.getTime());
  } catch {
    return false; // Pay me directly is not set up on this install yet.
  }
  const match = matchPaymentEmail(email, holds.map((hold) => hold.item));
  if (!match) return false;

  let recorded = 0;
  for (const reference of match.references) {
    const evidence: WaitingMatch = {
      messageId: message.id,
      provider: email.provider,
      providerLabel: email.providerLabel,
      amountCents: email.amountCents,
      currency: email.currency,
      payerName: email.payerName,
      subject: (message.subject || "").slice(0, 200),
      receivedAt: message.receivedAt,
      by: match.by,
      alsoFits: match.references.filter((other) => other !== reference),
    };
    // An order keeps the first email that matched it; a redelivery of the same email is harmless.
    const result = await env.DB.prepare(
      `UPDATE commerce_direct_payments SET matched_email_id = ?, matched_email_json = ?, match_dismissed_at = NULL
       WHERE reference = ? AND user_id = ? AND released_at IS NULL
         AND (matched_email_id IS NULL OR matched_email_id = ?)`,
    ).bind(message.id, JSON.stringify(evidence), reference, ownerId, message.id).run();
    recorded += Number(result.meta?.changes || 0);
  }
  return recorded > 0;
}

/**
 * "Confirm" on a matched (or any) waiting order: the owner says the money arrived. The same as Mark
 * paid, by reference, so a Home card can do it in one call. Income is recorded once, from the order.
 */
export async function confirmWaiting(env: Env, ownerId: string, reference: string, now = new Date()) {
  const hold = await findHold(env, ownerId, reference, now);
  if (hold.item.kind === "order") {
    await recordManualOrderPayment(env, ownerId, hold.item.id);
    return { ok: true as const };
  }
  const matched = hold.item.match;
  const amountCents = matched && matched.currency === hold.item.currency ? matched.amountCents : undefined;
  const paid = await markBookingPaid(env, ownerId, hold.item.id, amountCents ? { amountCents } : {});
  return { ok: true as const, booking: paid.booking };
}

/** "Not yet" on a match: the suggestion is put away and the order stays waiting. Nothing is paid or released. */
export async function dismissWaitingMatch(env: Env, ownerId: string, reference: string, now = new Date()) {
  await findHold(env, ownerId, reference, now);
  await env.DB.prepare("UPDATE commerce_direct_payments SET match_dismissed_at = ? WHERE reference = ? AND user_id = ?")
    .bind(sqliteTime(now), reference, ownerId).run();
  return { ok: true as const };
}
