import { deliverInboundEmail, getActiveMailboxForInbound } from "./mailbox-inbound";
import { SITE_ENQUIRY_PROVIDER_ID } from "./site-enquiry-source";
import { escapeHtml } from "./sites";
import type { Env } from "./types";

/**
 * A site's Enquire button (a paid offer nobody can pay for yet) opens this short form. What the visitor
 * writes lands in the owner's ME3 inbox as an email from them, with the offer named in the subject, so
 * the owner and their agent handle it like any other mail and can reply straight back.
 */
export { SITE_ENQUIRY_PROVIDER_ID };

const MAX_NAME = 80;
const MAX_MESSAGE = 4000;
const MAX_ABOUT = 120;
// A site form is open to anyone, so a burst of enquiries is capped per installation.
const HOURLY_LIMIT = 30;
const EMAIL_PATTERN = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;

export type EnquiryInput = { name: string; email: string; message: string; about: string };

export function enquirySubject(about: string): string {
  return about ? `Enquiry: ${about}` : "Enquiry from your website";
}

export function cleanAbout(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ABOUT);
}

/** Validates the visitor's form. Returns the cleaned enquiry or a message to show beside the form. */
export function parseEnquiry(form: Record<string, unknown>): { enquiry: EnquiryInput } | { error: string } {
  const oneLine = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
  const name = oneLine(form.name, MAX_NAME);
  const email = oneLine(form.email, 254).toLowerCase();
  const message = String(form.message ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!name) return { error: "Add your name." };
  if (!EMAIL_PATTERN.test(email)) return { error: "Add an email address they can reply to." };
  if (!message) return { error: "Write a short message." };
  if (message.length > MAX_MESSAGE) return { error: `Keep the message under ${MAX_MESSAGE} characters.` };
  return { enquiry: { name, email, message, about: cleanAbout(form.about) } };
}

function encodeWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`;
}

function base64(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The enquiry as a plain email from the visitor, so Reply in ME3 goes back to them. */
export function enquiryMime(enquiry: EnquiryInput, input: { to: string; siteUrl: string; now?: Date }): string {
  const body = [
    enquiry.message,
    "",
    "—",
    `Sent with the Enquire button${enquiry.about ? ` for ${enquiry.about}` : ""} on ${input.siteUrl}.`,
    "The sender typed this email address themselves, so it isn't verified.",
  ].join("\n");
  const safeName = enquiry.name.replace(/["\\]/g, "");
  return [
    `From: "${encodeWord(safeName)}" <${enquiry.email}>`,
    `To: ${input.to}`,
    `Subject: ${encodeWord(enquirySubject(enquiry.about))}`,
    `Date: ${(input.now ?? new Date()).toUTCString()}`,
    `Message-ID: <enquiry-${crypto.randomUUID()}@me3.site>`,
    "X-ME3-Source: site-enquiry",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    (base64(body).match(/.{1,76}/g) || []).join("\r\n"),
    "",
  ].join("\r\n");
}

async function underHourlyLimit(env: Env): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM mailbox_messages WHERE provider_id = ? AND created_at >= ?",
  ).bind(SITE_ENQUIRY_PROVIDER_ID, since).first<{ count: number }>();
  return (row?.count ?? 0) < HOURLY_LIMIT;
}

export type EnquiryResult = "sent" | "unavailable" | "busy";

/** Files the enquiry in the owner's inbox. */
export async function deliverSiteEnquiry(
  env: Env,
  enquiry: EnquiryInput,
  input: { siteUrl: string; waitUntil?: (work: Promise<unknown>) => void },
): Promise<EnquiryResult> {
  const mailbox = await getActiveMailboxForInbound(env);
  if (!mailbox) return "unavailable";
  if (!(await underHourlyLimit(env))) return "busy";
  const to = `${mailbox.alias_local_part}@me3.app`;
  const bytes = new TextEncoder().encode(enquiryMime(enquiry, { to, siteUrl: input.siteUrl }));
  const result = await deliverInboundEmail({
    from: enquiry.email,
    to,
    headers: new Headers(),
    raw: new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(),
    rawBytes: bytes,
    rawSize: bytes.byteLength,
    canBeForwarded: false,
    setReject() {},
    async forward() {},
  }, env, { providerId: SITE_ENQUIRY_PROVIDER_ID, allowNativeForwarding: false, waitUntil: input.waitUntil });
  return result.status === "accepted" || result.status === "duplicate" || result.status === "forwarded" ? "sent" : "unavailable";
}

/** The form page, plain and readable on a phone, in the visitor's light or dark mode. */
export function enquiryPage(input: {
  siteName: string;
  siteUrl: string;
  about: string;
  action: string;
  state?: "form" | "sent" | "unavailable" | "busy";
  error?: string;
  values?: Partial<EnquiryInput>;
}): string {
  const state = input.state ?? "form";
  const heading = input.about ? `Enquire about ${input.about}` : `Get in touch with ${input.siteName}`;
  const value = (key: keyof EnquiryInput) => escapeHtml(input.values?.[key] ?? "");
  const back = `<a class="back" href="${escapeHtml(input.siteUrl)}">Back to ${escapeHtml(input.siteName)}</a>`;
  const body = state === "sent"
    ? `<h1>Sent</h1><p>${escapeHtml(input.siteName)} has your message and will reply by email.</p>${back}`
    : state === "unavailable"
      ? `<h1>Enquiries aren't open yet</h1><p>${escapeHtml(input.siteName)} can't take messages here right now. Please try again later.</p>${back}`
      : state === "busy"
        ? `<h1>Try again soon</h1><p>A lot of messages arrived in the last hour. Please try again a little later.</p>${back}`
        : `<h1>${escapeHtml(heading)}</h1>
<p class="lead">Send ${escapeHtml(input.siteName)} a message and they'll reply by email.</p>
${input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : ""}
<form method="post" action="${escapeHtml(input.action)}">
<input type="hidden" name="about" value="${escapeHtml(input.about)}">
<div class="trap" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label>Your name<input name="name" required maxlength="${MAX_NAME}" autocomplete="name" value="${value("name")}"></label>
<label>Your email<input name="email" type="email" required autocomplete="email" value="${value("email")}"></label>
<label>Message<textarea name="message" required rows="6" maxlength="${MAX_MESSAGE}">${value("message")}</textarea></label>
<button type="submit">Send</button>
</form>
${back}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(heading)}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f6f3;--surface:#fff;--text:#1f2023;--muted:#6b6d72;--field:#f0efec;--accent:#1f8a65;--danger:#b42318}
@media(prefers-color-scheme:dark){:root{--bg:#121316;--surface:#1b1d21;--text:#ecedef;--muted:#9a9ca3;--field:#26282d;--accent:#3fbf8f;--danger:#f97066}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:32px 16px 48px}
.card{padding:24px 20px;border-radius:24px;background:var(--surface);box-shadow:0 1px 3px rgb(0 0 0/8%)}
h1{margin:0 0 8px;font-size:24px;line-height:1.2}.lead,p{margin:0 0 20px;color:var(--muted)}
form{display:grid;gap:16px}label{display:grid;gap:6px;font-size:14px;color:var(--muted)}
input,textarea{width:100%;padding:13px 14px;border:0;border-radius:14px;background:var(--field);color:var(--text);font:inherit;font-size:16px}
input:focus-visible,textarea:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{min-height:48px;border:0;border-radius:24px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.error{color:var(--danger)}.back{display:inline-block;margin-top:20px;color:var(--muted);font-size:14px}
.trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
</style></head><body><main><div class="card">${body}</div></main></body></html>`;
}
