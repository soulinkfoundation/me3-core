import { EmailProviderDeliveryUnknownError, sendEmailWithProvider } from "./email-providers";
import type { DbBooking, Env } from "./types";

type SendStatus = "sent" | "failed" | "skipped" | "pending";

export type TransactionalEmailResult = {
  status: SendStatus;
  to?: string;
  providerMessageId?: string | null;
  error?: string;
};

export type BookingEmailDetails = {
  operationId?: string;
  ownerId: string;
  hostName: string;
  hostEmail?: string | null;
  siteName?: string | null;
  guestName: string;
  guestEmail: string;
  bookingTitle: string;
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  notes?: string | null;
  bookingId?: string | null;
  meetingUrl?: string | null;
  meetingHostUrl?: string | null;
  amountPaid?: number | null;
  amountDue?: number | null;
  currency?: string | null;
  paymentInstructions?: string | null;
  guestMessageText?: string | null;
  sendHostCopy?: boolean;
  test?: boolean;
};

export type ProductPurchaseEmailDetails = {
  operationId?: string;
  ownerId: string;
  hostName: string;
  hostEmail?: string | null;
  buyerName: string;
  buyerEmail: string;
  productTitle: string;
  subject: string;
  messageText: string;
  test?: boolean;
};

export type ProductPaymentInstructionsEmailDetails = {
  operationId?: string;
  ownerId: string;
  hostName: string;
  hostEmail?: string | null;
  buyerName: string;
  buyerEmail: string;
  productTitle: string;
  amountDue: number;
  currency: string;
  paymentInstructions: string;
  messageText?: string | null;
};

export type NewsletterSubscriptionConfirmationEmailDetails = {
  operationId?: string;
  ownerId: string;
  siteId: string;
  siteName: string;
  newsletterName: string;
  subscriberEmail: string;
  confirmationUrl: string;
};

export async function sendNewsletterSubscriptionConfirmationEmail(
  env: Env,
  details: NewsletterSubscriptionConfirmationEmailDetails,
): Promise<TransactionalEmailResult> {
  const subject = `Confirm your subscription to ${details.newsletterName}`;
  const textBody = `Confirm that you want to receive emails from ${details.newsletterName}:

${details.confirmationUrl}

If you did not request this, you can ignore this email.`;
  const htmlBody = emailShell(`
    <h1 style="margin:0 0 8px;font-size:24px;color:#111;">Confirm your subscription</h1>
    <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;">Confirm that you want to receive emails from ${escapeHtml(details.newsletterName)}.</p>
    <p style="margin:0 0 24px;"><a href="${escapeHtml(details.confirmationUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:14px;font-weight:700;">Confirm subscription</a></p>
    <p style="margin:0;color:#666;font-size:13px;line-height:1.6;">If you did not request this, you can ignore this email.</p>
  `);

  return sendWorkflowEmail(env, details.ownerId, {
    operationId: details.operationId || `newsletter:${details.siteId}:${details.confirmationUrl}`,
    toAddress: details.subscriberEmail,
    subject,
    textBody,
    htmlBody,
    fromName: details.siteName,
    metadata: {
      site_id: details.siteId,
      newsletter_email: "subscription_confirmation",
    },
  });
}

export async function sendBookingConfirmationEmails(
  env: Env,
  details: BookingEmailDetails,
): Promise<{ guest: TransactionalEmailResult; host: TransactionalEmailResult }> {
  const guest = await sendGuestBookingConfirmationEmail(env, details);
  const host =
    details.sendHostCopy === false
      ? ({ status: "skipped", error: "Host copy is disabled" } satisfies TransactionalEmailResult)
      : details.hostEmail
        ? await sendHostBookingConfirmationEmail(env, details)
        : ({ status: "skipped", error: "Host email is not configured" } satisfies TransactionalEmailResult);
  return { guest, host };
}

export async function sendGuestBookingConfirmationEmail(
  env: Env,
  details: BookingEmailDetails,
): Promise<TransactionalEmailResult> {
  const startTime = formatBookingTime(details.startsAt, details.timezone);
  const paymentLine = formatPaymentLine(
    details.amountPaid,
    details.amountDue,
    details.currency,
  );
  const paymentInstructions = details.paymentInstructions?.trim() || "";
  const calendarUrl = googleCalendarUrl(details);
  const guestMessage = applyBookingEmailTokens(details.guestMessageText || "", {
    guestName: details.guestName,
    guestEmail: details.guestEmail,
    bookingTitle: details.bookingTitle,
    bookingTime: startTime,
    siteName: details.siteName || details.hostName,
    hostName: details.hostName,
    hostEmail: details.hostEmail || "",
  }).trim();
  const subject = `${details.test ? "[Test] " : ""}Booking confirmed: ${details.bookingTitle}`;
  const textBody = `Hi ${details.guestName},

Your booking is confirmed.

${details.bookingTitle} with ${details.hostName}
${startTime}
Duration: ${details.durationMinutes} minutes${paymentLine ? `\n${paymentLine}` : ""}${paymentInstructions ? `\n\nPayment is not taken now.\nPayment details:\n${paymentInstructions}` : ""}${details.notes ? `\n\nYour notes:\n${details.notes}` : ""}
${details.meetingUrl ? `Join call: ${details.meetingUrl}\n` : ""}
Add to Google Calendar: ${calendarUrl}
${guestMessage ? `\n\n${guestMessage}` : ""}

You can reply to this email to contact ${details.hostName}.

- ${details.hostName}`;
  const htmlBody = bookingEmailHtml({
    title: "Booking confirmed",
    subtitle: "Your meeting is scheduled",
    rows: [
      ["With", details.hostName],
      ["When", startTime],
      ["Duration", `${details.durationMinutes} minutes`],
      ...(details.meetingUrl ? [["Join call", details.meetingUrl] as [string, string]] : []),
      ...(paymentLine
        ? [[details.amountPaid ? "Payment" : "Amount due", paymentLine.replace(/^(?:Payment|Amount due): /, "")] as [string, string]]
        : []),
    ],
    notesLabel: "Your notes",
    notes: details.notes,
    calendarUrl,
    message: [
      paymentInstructions
        ? `Payment is not taken now.\n\nPayment details:\n${paymentInstructions}`
        : "",
      guestMessage,
    ].filter(Boolean).join("\n\n"),
    footer: `Reply to this email to contact ${escapeHtml(details.hostName)}.`,
  });

  return sendWorkflowEmail(env, details.ownerId, {
    operationId: details.operationId || (details.bookingId && !details.test ? `booking:${details.bookingId}:guest-confirmation` : undefined),
    toAddress: details.guestEmail,
    subject,
    textBody,
    htmlBody,
    fromName: details.hostName,
    replyToAddress: details.hostEmail || null,
    metadata: {
      booking_id: details.bookingId,
      booking_email: "guest_confirmation",
      test: details.test || false,
    },
  });
}

export async function sendHostBookingConfirmationEmail(
  env: Env,
  details: BookingEmailDetails,
): Promise<TransactionalEmailResult> {
  if (!details.hostEmail) return { status: "skipped", error: "Host email is not configured" };

  const startTime = formatBookingTime(details.startsAt, details.timezone);
  const paymentLine = formatPaymentLine(
    details.amountPaid,
    details.amountDue,
    details.currency,
  );
  const paymentInstructions = details.paymentInstructions?.trim() || "";
  const subject = `${details.test ? "[Test] " : ""}New booking: ${details.guestName}`;
  const textBody = `Hi ${details.hostName},

You have a new booking.

Guest: ${details.guestName}
Email: ${details.guestEmail}

${details.bookingTitle}
${startTime}
Duration: ${details.durationMinutes} minutes${paymentLine ? `\n${paymentLine}` : ""}${paymentInstructions ? `\n\nPayment details sent to the guest:\n${paymentInstructions}` : ""}${details.notes ? `\n\nGuest notes:\n${details.notes}` : ""}
${details.meetingHostUrl || details.meetingUrl ? `Your call room: ${details.meetingHostUrl || details.meetingUrl}\n` : ""}

- ME3`;
  const htmlBody = bookingEmailHtml({
    title: "New booking",
    subtitle: "You have a new appointment",
    rows: [
      ["Guest", details.guestName],
      ["Email", details.guestEmail],
      ["When", startTime],
      ["Duration", `${details.durationMinutes} minutes`],
      ...(details.meetingHostUrl || details.meetingUrl ? [["Call room", (details.meetingHostUrl || details.meetingUrl)!] as [string, string]] : []),
      ...(paymentLine
        ? [[details.amountPaid ? "Payment" : "Amount due", paymentLine.replace(/^(?:Payment|Amount due): /, "")] as [string, string]]
        : []),
    ],
    notesLabel: "Guest notes",
    notes: details.notes,
    message: paymentInstructions
      ? `Payment details sent to the guest:\n${paymentInstructions}`
      : null,
    footer: "Open ME3 Calendar to manage this booking.",
  });

  return sendWorkflowEmail(env, details.ownerId, {
    operationId: details.operationId ? `${details.operationId}:host` : (details.bookingId && !details.test ? `booking:${details.bookingId}:host-confirmation` : undefined),
    toAddress: details.hostEmail,
    subject,
    textBody,
    htmlBody,
    fromName: "ME3",
    replyToAddress: details.guestEmail,
    metadata: {
      booking_id: details.bookingId,
      booking_email: "host_confirmation",
      test: details.test || false,
    },
  });
}

export async function sendProductPurchaseConfirmationEmail(
  env: Env,
  details: ProductPurchaseEmailDetails,
): Promise<TransactionalEmailResult> {
  const subject = `${details.test ? "[Test] " : ""}${details.subject}`;
  const textBody = `${details.messageText}

---

${details.productTitle}
You can reply to this email to contact ${details.hostName}.`;
  const htmlBody = productEmailHtml(details);

  return sendWorkflowEmail(env, details.ownerId, {
    operationId: details.operationId,
    toAddress: details.buyerEmail,
    subject,
    textBody,
    htmlBody,
    fromName: details.hostName,
    replyToAddress: details.hostEmail || null,
    metadata: {
      product_title: details.productTitle,
      product_email: "purchase_confirmation",
      test: details.test || false,
    },
  });
}

export async function sendProductPaymentInstructionsEmail(
  env: Env,
  details: ProductPaymentInstructionsEmailDetails,
): Promise<TransactionalEmailResult> {
  const amountDue = formatCurrencyAmount(details.amountDue, details.currency);
  const message = details.messageText?.trim() || "";
  const textBody = `Hi ${details.buyerName},

Your request for ${details.productTitle} is confirmed.

Payment is not taken now.
Amount due: ${amountDue}

Payment details:
${details.paymentInstructions}${message ? `\n\n${message}` : ""}

You can reply to this email to contact ${details.hostName}.`;
  const htmlBody = emailShell(`
    <h1 style="margin:0 0 8px;font-size:24px;color:#111;">Payment details</h1>
    <p style="margin:0 0 32px;color:#666;font-size:14px;">Your request is confirmed. Payment is not taken now.</p>
    <div style="background:#f8f8f8;border-radius:8px;padding:24px;margin:0 0 24px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#111;">${escapeHtml(details.productTitle)}</h2>
      <p style="margin:0 0 16px;color:#333;font-size:14px;"><strong>Amount due:</strong> ${escapeHtml(amountDue)}</p>
      <p style="margin:0;color:#333;font-size:14px;line-height:1.6;"><strong>Payment details:</strong><br>${renderPlainText(details.paymentInstructions)}</p>
    </div>
    ${message ? `<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:18px;margin:0 0 24px;color:#333;font-size:14px;line-height:1.6;">${renderPlainText(message)}</div>` : ""}
    <p style="margin:0;color:#666;font-size:14px;">Reply to this email to contact <strong>${escapeHtml(details.hostName)}</strong>.</p>
  `);

  return sendWorkflowEmail(env, details.ownerId, {
    operationId: details.operationId,
    toAddress: details.buyerEmail,
    subject: `Payment details: ${details.productTitle}`,
    textBody,
    htmlBody,
    fromName: details.hostName,
    replyToAddress: details.hostEmail || null,
    metadata: {
      product_title: details.productTitle,
      product_email: "manual_payment_instructions",
    },
  });
}

export async function getOwnerContact(
  env: Env,
  ownerId: string,
): Promise<{ name: string | null; email: string | null }> {
  const owner = await env.DB.prepare("SELECT name, email FROM owner_profile WHERE id = ?")
    .bind(ownerId)
    .first<{ name: string | null; email: string | null }>();
  return { name: owner?.name || null, email: owner?.email || null };
}

export function bookingDetailsFromBooking(input: {
  booking: DbBooking;
  operationId?: string;
  ownerId: string;
  hostName: string;
  hostEmail?: string | null;
  siteName?: string | null;
  bookingTitle: string;
  timezone: string;
  guestMessageText?: string | null;
  paymentInstructions?: string | null;
  sendHostCopy?: boolean;
  test?: boolean;
}): BookingEmailDetails {
  return {
    operationId: input.operationId,
    ownerId: input.ownerId,
    hostName: input.hostName,
    hostEmail: input.hostEmail || null,
    siteName: input.siteName || input.hostName,
    guestName: input.booking.guest_name,
    guestEmail: input.booking.guest_email,
    bookingTitle: input.bookingTitle,
    startsAt: input.booking.starts_at,
    durationMinutes: input.booking.duration_minutes,
    timezone: input.timezone,
    notes: input.booking.notes,
    bookingId: input.booking.id,
    meetingUrl: input.booking.meeting_url,
    meetingHostUrl: input.booking.meeting_host_url,
    amountPaid: input.booking.amount_paid,
    amountDue:
      !input.booking.amount_paid &&
      input.booking.is_free_booking === 0 &&
      input.booking.payment_status === "not_required"
        ? input.booking.suggested_amount
        : null,
    currency: input.booking.currency,
    paymentInstructions: input.paymentInstructions || null,
    guestMessageText: input.guestMessageText || null,
    sendHostCopy: input.sendHostCopy,
    test: input.test,
  };
}

async function sendWorkflowEmail(
  env: Env,
  ownerId: string,
  input: {
    operationId?: string;
    toAddress: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    fromName: string;
    replyToAddress?: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<TransactionalEmailResult> {
  try {
    const result = await sendEmailWithProvider(env, ownerId, {
      purpose: "workflow",
      operationId: input.operationId,
      fromName: input.fromName,
      replyToAddress: input.replyToAddress || undefined,
      toAddress: input.toAddress,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      metadata: input.metadata,
      createdBy: "system",
    });
    return {
      status: "sent",
      to: input.toAddress,
      providerMessageId: result.providerMessageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email failed to send";
    return {
      status: error instanceof EmailProviderDeliveryUnknownError ? "pending" : message.includes("not ready to send yet") ? "skipped" : "failed",
      to: input.toAddress,
      error: message,
    };
  }
}

function formatBookingTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone || "UTC",
  }).format(date);
}

function formatPaymentLine(
  amountPaid: number | null | undefined,
  amountDue: number | null | undefined,
  currency: string | null | undefined,
) {
  const amount = amountPaid || amountDue;
  if (!amount || !currency) return "";
  return `${amountPaid ? "Payment" : "Amount due"}: ${formatCurrencyAmount(amount, currency)}`;
}

function formatCurrencyAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function bookingEmailHtml(input: {
  title: string;
  subtitle: string;
  rows: Array<[string, string]>;
  notesLabel: string;
  notes?: string | null;
  calendarUrl?: string | null;
  message?: string | null;
  footer: string;
}) {
  const rows = input.rows
    .map(
      ([label, value]) => {
        const display = (label === "Join call" || label === "Call room") && /^https:\/\//.test(value)
          ? `<a href="${escapeHtml(value)}" style="color:#111;font-weight:700;">${escapeHtml(value)}</a>`
          : escapeHtml(value);
        return `<p style="margin:0 0 8px;color:#333;font-size:14px;"><strong>${escapeHtml(label)}:</strong> ${display}</p>`;
      },
    )
    .join("");
  const notes = input.notes
    ? `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #e0e0e0;color:#666;font-size:14px;"><strong>${escapeHtml(input.notesLabel)}:</strong><br>${renderPlainText(input.notes)}</p>`
    : "";
  const calendarLink = input.calendarUrl
    ? `<p style="margin:12px 0 0;color:#666;font-size:14px;"><a href="${escapeHtml(input.calendarUrl)}" style="color:#111;font-weight:700;">Add to Google Calendar</a></p>`
    : "";
  const message = input.message
    ? `<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:18px;margin:0 0 24px;color:#333;font-size:14px;line-height:1.6;">${renderPlainText(input.message)}</div>`
    : "";

  return emailShell(`
    <h1 style="margin:0 0 8px;font-size:24px;color:#111;">${escapeHtml(input.title)}</h1>
    <p style="margin:0 0 32px;color:#666;font-size:14px;">${escapeHtml(input.subtitle)}</p>
    <div style="background:#f8f8f8;border-radius:8px;padding:24px;margin:0 0 24px;">${rows}${calendarLink}${notes}</div>
    ${message}
    <p style="margin:0;color:#666;font-size:14px;">${input.footer}</p>
  `);
}

function googleCalendarUrl(details: BookingEmailDetails): string {
  const start = new Date(details.startsAt);
  const end = new Date(start.getTime() + details.durationMinutes * 60_000);
  const dates = `${googleCalendarDate(start)}/${googleCalendarDate(end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${details.bookingTitle} with ${details.hostName}`,
    dates,
    details: `Booking confirmed with ${details.hostName}.${details.hostEmail ? ` Reply to ${details.hostEmail} if you need to make changes.` : ""}`,
  });
  if (details.meetingUrl) params.set("location", details.meetingUrl);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function googleCalendarDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function productEmailHtml(details: ProductPurchaseEmailDetails) {
  return emailShell(`
    <h1 style="margin:0 0 8px;font-size:24px;color:#111;">Purchase confirmed</h1>
    <p style="margin:0 0 32px;color:#666;font-size:14px;">Thank you for your purchase</p>
    <div style="background:#f8f8f8;border-radius:8px;padding:24px;margin:0 0 24px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#111;">${escapeHtml(details.productTitle)}</h2>
      <p style="margin:0;color:#333;font-size:14px;line-height:1.6;">${renderPlainText(details.messageText)}</p>
    </div>
    <p style="margin:0;color:#666;font-size:14px;">Reply to this email to contact <strong>${escapeHtml(details.hostName)}</strong>.</p>
  `);
}

function emailShell(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px 20px;background:#f5f5f5;"><div style="max-width:500px;margin:0 auto;background:white;border-radius:12px;padding:40px;">${body}</div></body></html>`;
}

function renderPlainText(text: string) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function applyBookingEmailTokens(
  template: string,
  ctx: Record<string, string>,
): string {
  let output = template;
  for (const [key, value] of Object.entries(ctx)) {
    output = output.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), () => value);
  }
  return output;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
