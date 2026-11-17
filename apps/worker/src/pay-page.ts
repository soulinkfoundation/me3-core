import { create as createQr } from "qrcode/lib/core/qrcode.js";
import { buildPaymentOptions, paymentOptionHint, type PaymentOption } from "../../../shared/pay-directly";
import { loadSiteProfileForCommerce } from "./booking";
import { getPayDirectlyHoldSettings } from "./commerce-settings";
import { holdState, listPaymentMethods, payPagePath } from "./pay-directly";
import { notifyOwnerSaysPaid } from "./pay-directly-holds";
import type { DbBooking, DbCommerceOrder, DbSite, Env } from "./types";

// The buyer's pay page for one pay-directly order or booking. Everything here is reached only
// through that order's own unguessable link; bank details are never part of the published site.

export type PayPageOption = Omit<PaymentOption, "methodId"> & {
  /** The EPC QR as an SVG image, for euro IBAN orders only. */
  epcQrSvg: string | null;
};

export type PayPageData = {
  /** "order" is a product order; "booking" a one-to-one; "event" a class or retreat. */
  kind: "order" | "booking" | "event";
  /**
   * waiting: not paid. says_paid: the buyer tapped I've paid. paid: the owner confirmed.
   * released: it went unpaid and was released. cancelled: no longer open for another reason.
   */
  status: "waiting" | "says_paid" | "paid" | "released" | "cancelled";
  payeeName: string;
  payeeFirstName: string;
  buyerFirstName: string;
  title: string;
  startsAt: string | null;
  quantity: number;
  amountCents: number;
  currency: string;
  reference: string;
  /** Empty once the order is paid or cancelled, and when no saved method takes the currency. */
  options: PayPageOption[];
  note: string | null;
  saysPaidAt: string | null;
  /** While waiting: when it is released if still unpaid (ISO). Null once the buyer says they paid. */
  heldUntil: string | null;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

function isoUtc(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

/** A QR code as a self-contained SVG: dark modules on white, with the 4-module quiet zone scanners need. */
export function qrSvg(text: string): string {
  // EPC069-12 asks for error correction level M.
  const { size, data } = createQr(text, { errorCorrectionLevel: "M" }).modules;
  const quiet = 4;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (data[row * size + column]) path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const total = size + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="QR code for your banking app" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
}

type DirectPaymentRow = {
  reference: string;
  user_id: string;
  order_id: string | null;
  booking_id: string | null;
  says_paid_at: string | null;
  note: string | null;
  created_at: string;
  hold_started_at: string | null;
  owner_warned_at: string | null;
  released_at: string | null;
};

/** What the pay page shows for this link, or null when the link is not one ME3 made. */
export async function getPayPageData(env: Env, token: string): Promise<PayPageData | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const payment = await env.DB.prepare(
    `SELECT reference, user_id, order_id, booking_id, says_paid_at, note, created_at, hold_started_at,
            owner_warned_at, released_at
     FROM commerce_direct_payments WHERE pay_token = ?`,
  ).bind(token).first<DirectPaymentRow>();
  if (!payment) return null;

  let subject: Pick<PayPageData, "kind" | "title" | "startsAt" | "quantity" | "amountCents" | "currency"> & {
    siteId: string; buyerName: string; open: boolean; paid: boolean; createdAt: string;
  };
  if (payment.order_id) {
    const order = await env.DB.prepare("SELECT * FROM commerce_orders WHERE id = ?").bind(payment.order_id).first<DbCommerceOrder>();
    if (!order) return null;
    subject = {
      kind: "order", title: order.product_title, startsAt: null, quantity: 1,
      amountCents: Number(order.amount_paid || order.amount_due || 0), currency: String(order.currency || "USD").toUpperCase(),
      siteId: order.site_id, buyerName: order.buyer_name, open: order.status === "pending", paid: order.status === "paid",
      createdAt: order.created_at,
    };
  } else {
    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(payment.booking_id).first<DbBooking>();
    if (!booking) return null;
    const event = booking.booking_type === "class" || booking.booking_type === "retreat";
    subject = {
      kind: event ? "event" : "booking",
      title: booking.meeting_title || (booking.booking_type === "class" ? "Class booking" : booking.booking_type === "retreat" ? "Retreat booking" : "Booking"),
      startsAt: booking.starts_at, quantity: Number(booking.quantity || 1),
      amountCents: Number(booking.amount_paid || booking.suggested_amount || 0), currency: String(booking.currency || "USD").toUpperCase(),
      siteId: booking.site_id, buyerName: booking.guest_name,
      open: booking.status === "confirmed" && booking.payment_status === "pending",
      paid: booking.status === "confirmed" && booking.payment_status !== "pending",
      createdAt: booking.created_at,
    };
  }

  const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(subject.siteId).first<DbSite>();
  if (!site || site.user_id !== payment.user_id) return null;
  const profile = await loadSiteProfileForCommerce(env, site).catch(() => null);
  const owner = await env.DB.prepare("SELECT name FROM owner_profile WHERE id = ?").bind(site.user_id).first<{ name: string | null }>();
  const payeeName = String(profile?.name || owner?.name || site.username).trim();

  const options = subject.open
    ? buildPaymentOptions(await listPaymentMethods(env, site.user_id), {
        amountMinor: subject.amountCents, currency: subject.currency, reference: payment.reference,
      }).map(({ methodId: _methodId, ...option }): PayPageOption => ({
        ...option,
        epcQrSvg: option.epcQrPayload ? qrSvg(option.epcQrPayload) : null,
      }))
    : [];
  return {
    kind: subject.kind,
    status: subject.paid ? "paid" : !subject.open ? (payment.released_at ? "released" : "cancelled") : payment.says_paid_at ? "says_paid" : "waiting",
    payeeName,
    payeeFirstName: firstName(payeeName),
    buyerFirstName: firstName(subject.buyerName),
    title: subject.title,
    startsAt: subject.startsAt,
    quantity: subject.quantity,
    amountCents: subject.amountCents,
    currency: subject.currency,
    reference: payment.reference,
    options,
    note: subject.open ? payment.note?.trim() || null : null,
    saysPaidAt: isoUtc(payment.says_paid_at),
    heldUntil: subject.open && !payment.says_paid_at
      ? new Date(holdState(
          { created_at: subject.createdAt, hold_started_at: payment.hold_started_at, starts_at: subject.startsAt, says_paid_at: null, owner_warned_at: payment.owner_warned_at },
          await getPayDirectlyHoldSettings(env, site.user_id),
          Date.now(),
        ).releaseAtMs).toISOString()
      : null,
  };
}

/** The buyer says they have paid. Only the first tap on an unpaid order is recorded; the owner still confirms. */
export async function recordSaysPaid(env: Env, token: string): Promise<PayPageData | null> {
  const data = await getPayPageData(env, token);
  if (!data || data.status !== "waiting") return data;
  const recorded = await env.DB.prepare(
    "UPDATE commerce_direct_payments SET says_paid_at = datetime('now') WHERE pay_token = ? AND says_paid_at IS NULL",
  ).bind(token).run();
  if (Number(recorded.meta?.changes || 0) > 0) {
    // The owner hears on the first tap only.
    const owner = await env.DB.prepare("SELECT user_id FROM commerce_direct_payments WHERE pay_token = ?").bind(token).first<{ user_id: string }>();
    if (owner) await notifyOwnerSaysPaid(env, owner.user_id, data.reference).catch((error) => console.error("Says-paid email to the owner failed:", error));
  }
  return getPayPageData(env, token);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function money(amountCents: number, currency: string): string {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountCents / 100); }
  catch { return `${(amountCents / 100).toFixed(2)} ${currency}`; }
}

const groupIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");
const groupSortCode = (sortCode: string) => sortCode.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3");

const METHOD_NAMES = { paypal: "PayPal", revolut: "Revolut", wise: "Wise" } as const;

function copyRow(label: string, shown: string, copied: string): string {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(shown)}</span><button type="button" class="copy" data-copy="${escapeHtml(copied)}">Copy</button></div>`;
}

function whenMarkup(startsAt: string | null): string {
  if (!startsAt) return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  const fallback = `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
  return `<time datetime="${escapeHtml(date.toISOString())}" data-local>${escapeHtml(fallback)}</time>`;
}

function methodsMarkup(data: PayPageData, amount: string): string {
  if (!data.options.length) {
    return `<p class="lede">${escapeHtml(data.payeeFirstName)} will be in touch about how to pay.</p>`;
  }
  return data.options.map((option) => {
    if (option.kind !== "bank" || !option.bank) {
      const name = METHOD_NAMES[option.kind as keyof typeof METHOD_NAMES];
      return `<a class="method" href="${escapeHtml(option.url || "")}" target="_blank" rel="noopener noreferrer"><strong>Pay with ${name}</strong><span>${escapeHtml(paymentOptionHint(option, amount))}</span></a>`;
    }
    const bank = option.bank;
    return `<section class="bank"><h2>Bank transfer</h2>
      ${copyRow("Name", bank.accountName, bank.accountName)}
      ${bank.iban ? copyRow("IBAN", groupIban(bank.iban), bank.iban) : ""}
      ${bank.bic ? copyRow("BIC", bank.bic, bank.bic) : ""}
      ${bank.sortCode ? copyRow("Sort code", groupSortCode(bank.sortCode), bank.sortCode) : ""}
      ${bank.accountNumber ? copyRow("Account number", bank.accountNumber, bank.accountNumber) : ""}
      ${copyRow("Reference", data.reference, data.reference)}
      ${option.epcQrSvg
        ? `<div class="qr">${option.epcQrSvg}<p>On a computer? Scan this with your banking app. It fills in the name, IBAN, ${escapeHtml(amount)} and the reference.</p></div>`
        : `<p class="hint">Send ${escapeHtml(amount)} and use the reference so ${escapeHtml(data.payeeFirstName)} can match your payment.</p>`}
    </section>`;
  }).join("\n");
}

const PAGE_CSS = `
:root{color-scheme:light dark;--bg:#fff;--text:#111;--muted:#666;--border:#e2e2e2;--surface:#f6f6f6;--accent:#111;--accent-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--text:#f2f2f2;--muted:#a0a0a0;--border:#2a2a2a;--surface:#181818;--accent:#f2f2f2;--accent-text:#111}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:440px;margin:0 auto;padding:32px 20px 56px}
.payee{margin:0 0 20px;color:var(--muted);font-size:14px}
h1{margin:0 0 4px;font-size:24px;line-height:1.25}
h2{margin:0 0 8px;font-size:16px}
.what{margin:0;color:var(--muted)}
.amount{margin:16px 0 4px;font-size:40px;font-weight:700;line-height:1.1}
.lede{margin:0 0 20px;color:var(--muted)}
.row{display:flex;align-items:center;gap:12px;min-height:48px;padding:6px 0;border-top:1px solid var(--border)}
.row .label{flex:0 0 auto;color:var(--muted);font-size:14px}
.row .value{flex:1;text-align:right;font-weight:600;overflow-wrap:anywhere}
.copy{flex:0 0 auto;min-width:64px;min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}
.reference{margin:0 0 20px;border-bottom:1px solid var(--border)}
.method{display:block;margin:0 0 12px;padding:14px 16px;border:1px solid var(--border);border-radius:12px;color:inherit;text-decoration:none}
.method strong{display:block}
.method span,.hint{color:var(--muted);font-size:14px}
.bank{margin:0 0 12px;padding:14px 16px;border:1px solid var(--border);border-radius:12px}
.bank .row:first-of-type{border-top:0}
.qr{margin:12px 0 0;padding-top:12px;border-top:1px solid var(--border)}
.qr svg{display:block;width:200px;max-width:100%;height:auto;margin:0 auto 8px;border-radius:8px}
.qr p{margin:0;color:var(--muted);font-size:14px;text-align:center}
.note{margin:16px 0;padding:14px 16px;border-radius:12px;background:var(--surface);white-space:pre-line}
.primary{width:100%;min-height:52px;margin:12px 0 8px;border:0;border-radius:12px;background:var(--accent);color:var(--accent-text);font:inherit;font-weight:700;cursor:pointer}
.small{margin:0;color:var(--muted);font-size:14px;text-align:center}
.held{margin-top:12px}
.tick{display:grid;place-items:center;width:48px;height:48px;margin:0 0 16px;border-radius:50%;background:var(--accent);color:var(--accent-text);font-size:26px}
.summary{margin:20px 0;border-bottom:1px solid var(--border)}
details{margin:20px 0 0}
summary{min-height:44px;cursor:pointer;font-weight:600}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--text);outline-offset:2px}
`;

const PAGE_SCRIPT = `
document.querySelectorAll('time[data-local]').forEach(function(el){var d=new Date(el.getAttribute('datetime'));if(!isNaN(d.getTime()))el.textContent=d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});});
document.querySelectorAll('[data-copy]').forEach(function(button){button.addEventListener('click',function(){var value=button.getAttribute('data-copy');var done=function(){button.textContent='Copied';setTimeout(function(){button.textContent='Copy';},1500);};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(done,function(){});}else{var area=document.createElement('textarea');area.value=value;document.body.appendChild(area);area.select();try{document.execCommand('copy');done();}catch(e){}area.remove();}});});
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body><main>${body}</main><script>${PAGE_SCRIPT}</script></body></html>`;
}

export function renderPayPageNotFound(): string {
  return shell("Payment page not found", `<h1>This payment page is not available</h1><p class="lede">Check the link in your email, or reply to that email to ask for help.</p>`);
}

function summaryRows(data: PayPageData, amount: string, status: string): string {
  const when = whenMarkup(data.startsAt);
  const row = (label: string, value: string) => `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  return `<div class="summary">
    ${row(escapeHtml(data.title), when || (data.quantity > 1 ? `${data.quantity} places` : ""))}
    ${row("Amount", escapeHtml(amount))}
    ${row("Reference", escapeHtml(data.reference))}
    ${row("Status", escapeHtml(status))}
  </div>`;
}

/** The pay page for one order: how to pay, then (after I've paid) the thanks screen. */
export function renderPayPage(data: PayPageData, token: string): string {
  const amount = money(data.amountCents, data.currency);
  const payee = escapeHtml(data.payeeFirstName);
  const buyer = escapeHtml(data.buyerFirstName);
  const what = [escapeHtml(data.title), whenMarkup(data.startsAt), data.quantity > 1 ? `${data.quantity} places` : ""].filter(Boolean).join(" · ");
  const header = `<p class="payee">${escapeHtml(data.payeeName)}</p>`;

  if (data.status === "released") {
    return shell(`${data.title}`, `${header}<h1>${data.kind === "order" ? "This order was closed" : "This booking was released"}</h1>
      <p class="lede">${payee} did not receive payment in time, so there is nothing to pay now. If you have already paid, reply to the email from ${payee}.</p>
      ${summaryRows(data, amount, "Released")}`);
  }
  if (data.status === "cancelled") {
    return shell(`${data.title}`, `${header}<h1>${data.kind === "order" ? "This order is no longer open" : "This booking was cancelled"}</h1>
      <p class="lede">There is nothing to pay. If you have already paid, reply to the email from ${payee}.</p>
      ${summaryRows(data, amount, "Cancelled")}`);
  }
  if (data.status === "paid") {
    return shell(`${data.title}`, `${header}<div class="tick" aria-hidden="true">✓</div><h1>You’re all set, ${buyer}</h1>
      <p class="lede">${payee} has confirmed your payment. Check your email for the details.</p>
      ${summaryRows(data, amount, "Paid")}`);
  }
  const methods = `${methodsMarkup(data, amount)}${data.note ? `<p class="note">${escapeHtml(data.note)}</p>` : ""}`;
  if (data.status === "says_paid") {
    return shell(`Thanks, ${data.buyerFirstName}`, `${header}<div class="tick" aria-hidden="true">✓</div><h1>Thanks, ${buyer}</h1>
      <p class="lede">${payee} will confirm as soon as the money arrives. We’ve emailed you the payment details and the reference.</p>
      ${summaryRows(data, amount, `Waiting for ${data.payeeFirstName}`)}
      <details><summary>Payment details</summary>${methods}</details>`);
  }
  return shell(`Pay ${data.payeeFirstName} directly`, `${header}<h1>Pay ${payee} directly</h1>
    <p class="what">${what}</p>
    <p class="amount">${escapeHtml(amount)}</p>
    <p class="lede">${data.kind === "order" ? `${payee} sends your order once your payment arrives.` : `Your spot is held while you pay. ${payee} confirms your booking once your payment arrives.`}</p>
    <div class="reference">${copyRow("Reference", data.reference, data.reference)}</div>
    ${methods}
    <form method="post" action="${escapeHtml(payPagePath(token))}/paid"><button class="primary" type="submit">I’ve paid</button></form>
    <p class="small">Tap this once you have sent the money, so ${payee} knows to look for it.</p>
    ${data.heldUntil ? `<p class="small held">Held until ${whenMarkup(data.heldUntil)}</p>` : ""}`);
}
