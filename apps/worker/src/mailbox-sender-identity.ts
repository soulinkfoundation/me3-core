import { decodeMimeHeaderValue, parseEmailAddressHeader } from "../../../shared/email-headers";
import type { Env } from "./types";

/**
 * Sender identity for mail rows: display names instead of raw addresses, the
 * original sender of a forward, a preview without forward and quote headers,
 * and a brand avatar fetched once by the Worker so a client never contacts the
 * sender. The avatar bytes live in R2 (or inline when small) and are served
 * from a signed, cacheable URL.
 */

export const GENERIC_MAIL_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "pm.me", "aol.com", "fastmail.com", "fastmail.fm", "hey.com", "yandex.com", "gmx.com", "gmx.de", "zoho.com",
  "mail.com", "me3.local",
]);

const AUTOMATED_LOCAL_PARTS = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|alerts?|mailer-daemon|postmaster|bounces?|noreply-.*|.*-noreply|system|robot|automated?)$/i;
const SIGNATURE_DIVIDER = /^--\s*$/;
const FORWARD_MARKER = /^(?:-{2,}\s*(?:forwarded message|original message)\s*-{2,}|begin forwarded message:?)\s*$/i;
const QUOTE_TAIL = /^(?:on .{3,200}? wrote:?|le .{3,200}? a écrit\s?:?|am .{3,200}? schrieb .*:?)$/i;
const DEVICE_SIGNATURE = /^(?:sent from my .{1,40}|get outlook for .{1,40}|envoyé de mon .{1,40})$/i;

export type MailSenderIdentity = {
  name: string;
  address: string;
  initials: string;
  avatarUrl: string | null;
  contactId: string | null;
  isForward: boolean;
  originalSender: { name: string; address: string } | null;
};

export function senderDomain(address: string | null | undefined): string | null {
  const at = (address || "").trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return null;
  const domain = (address || "").trim().toLowerCase().slice(at + 1).replace(/[>\s]+$/g, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

export function isGenericMailProvider(domain: string | null): boolean {
  return !domain || GENERIC_MAIL_PROVIDERS.has(domain);
}

export function isAutomatedLocalPart(address: string | null | undefined): boolean {
  const local = (address || "").trim().toLowerCase().split("@")[0] || "";
  return AUTOMATED_LOCAL_PARTS.test(local);
}

/** "sam.reyes" -> "Sam Reyes"; automated or opaque local parts return null. */
export function prettifyLocalPart(address: string | null | undefined): string | null {
  const local = (address || "").trim().toLowerCase().split("@")[0] || "";
  if (!local || isAutomatedLocalPart(address) || /\d{4,}/.test(local) || /^[a-f0-9]{12,}$/.test(local)) return null;
  const words = local.split(/[._+-]+/).filter(Boolean).filter(word => !/^\d+$/.test(word));
  if (words.length === 0 || words.length > 4) return null;
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** "mail.northwind-hosting.com" -> "Northwind Hosting". */
export function brandNameFromDomain(domain: string | null): string | null {
  if (!domain) return null;
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const secondLevelCountry = labels.length >= 3 && labels.at(-2)!.length <= 3 && labels.at(-1)!.length === 2;
  const brand = labels[labels.length - (secondLevelCountry ? 3 : 2)];
  if (!brand) return null;
  return brand.split(/[-_]+/).filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function describeSenderName(input: { headerName?: string | null; address: string | null | undefined; contactName?: string | null }): string {
  const contact = (input.contactName || "").trim();
  if (contact) return contact;
  const header = decodeMimeHeaderValue((input.headerName || "").trim()).replace(/^"|"$/g, "").trim();
  if (header && !/^[^\s@]+@[^\s@]+$/.test(header)) return header;
  const local = prettifyLocalPart(input.address);
  if (local) return local;
  const domain = senderDomain(input.address);
  if (domain && !isGenericMailProvider(domain)) return brandNameFromDomain(domain) || domain;
  return (input.address || "").trim() || "Unknown sender";
}

export function senderInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

export function parseForwardedMessage(text: string | null | undefined, subject: string | null | undefined): {
  isForward: boolean;
  originalSender: { name: string; address: string } | null;
  forwardedBody: string;
} {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const markerIndex = lines.findIndex(line => FORWARD_MARKER.test(line.trim()));
  const subjectSaysForward = /^\s*(?:fwd?|tr|wg)\s*:/i.test(subject || "");
  if (markerIndex < 0) {
    return { isForward: subjectSaysForward, originalSender: null, forwardedBody: (text || "").trim() };
  }
  let originalSender: { name: string; address: string } | null = null;
  let bodyStart = markerIndex + 1;
  for (let index = markerIndex + 1; index < Math.min(lines.length, markerIndex + 12); index += 1) {
    const line = lines[index].trim();
    if (!line) { bodyStart = index + 1; if (originalSender) break; continue; }
    const header = line.match(/^(?:\*\*)?(from|de|von)\s*:\s*(?:\*\*)?\s*(.+)$/i);
    if (header) {
      const parsed = parseEmailAddressHeader(header[2]);
      if (parsed) originalSender = { name: describeSenderName({ headerName: parsed.name, address: parsed.address }), address: parsed.address };
    }
    if (/^(?:to|date|subject|cc|sent|à|an|betreff|datum|objet)\s*:/i.test(line)) bodyStart = index + 1;
  }
  return { isForward: true, originalSender, forwardedBody: lines.slice(bodyStart).join("\n").trim() };
}

/** One readable line for list rows: no forward headers, quotes, signatures or device footers. */
export function cleanMailPreview(text: string | null | undefined, options: { maxLength?: number; subject?: string | null } = {}): string {
  const maxLength = options.maxLength ?? 200;
  const { forwardedBody } = parseForwardedMessage(text, options.subject);
  const kept: string[] = [];
  for (const rawLine of forwardedBody.split("\n")) {
    const line = rawLine.replace(/\s+$/g, "");
    const trimmed = line.trim();
    if (SIGNATURE_DIVIDER.test(trimmed) || QUOTE_TAIL.test(trimmed)) break;
    if (trimmed.startsWith(">") || DEVICE_SIGNATURE.test(trimmed) || FORWARD_MARKER.test(trimmed)) continue;
    if (/^(?:from|to|cc|date|subject)\s*:/i.test(trimmed) && kept.length === 0) continue;
    kept.push(trimmed);
  }
  const compact = kept.join(" ").replace(/\[image:[^\]]*\]/gi, " ").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}…`;
}

export function firstSentence(text: string, maxLength = 110): string {
  const clean = cleanMailPreview(text, { maxLength: 600 });
  const sentence = clean.match(/^.{12,}?[.!?](?:\s|$)/)?.[0]?.trim() || clean;
  return sentence.length <= maxLength ? sentence : `${sentence.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}…`;
}

// --- Sender avatars -------------------------------------------------------

type AvatarRow = { domain: string; status: "found" | "none" | "failed"; source: string | null; storage_key: string | null; content_type: string | null; data_base64: string | null; fetched_at: string };

const AVATAR_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_INLINE_AVATAR_BYTES = 32 * 1024;
const MAX_AVATAR_BYTES = 192 * 1024;

export function senderAvatarsEnabled(env: Pick<Env, "ME3_MAIL_AVATARS">): boolean {
  return (env.ME3_MAIL_AVATARS || "").trim().toLowerCase() !== "off";
}

export async function getSenderAvatarRows(env: Pick<Env, "DB">, domains: string[]): Promise<Map<string, AvatarRow>> {
  const unique = [...new Set(domains.filter(Boolean))];
  const rows = new Map<string, AvatarRow>();
  if (unique.length === 0) return rows;
  const result = await env.DB.prepare(
    `SELECT domain, status, source, storage_key, content_type, data_base64, fetched_at
     FROM mailbox_sender_avatars WHERE domain IN (${unique.map(() => "?").join(",")})`,
  ).bind(...unique).all<AvatarRow>().catch(() => ({ results: [] as AvatarRow[] }));
  for (const row of result.results || []) rows.set(row.domain, row);
  return rows;
}

/** Fetches and caches a brand avatar for a sender domain (BIMI logo, then favicon). Never throws. */
export async function resolveSenderAvatar(env: Env, domain: string | null, now = new Date()): Promise<void> {
  if (!domain || !senderAvatarsEnabled(env) || isGenericMailProvider(domain)) return;
  try {
    const existing = (await getSenderAvatarRows(env, [domain])).get(domain);
    if (existing && (existing.status === "found" || now.getTime() - Date.parse(existing.fetched_at) < AVATAR_RETRY_MS)) return;
    const found = await fetchSenderAvatar(domain);
    let storageKey: string | null = null;
    let inline: string | null = null;
    if (found) {
      if (env.SITE_ASSETS) {
        storageKey = `mailbox/avatars/${domain}`;
        await env.SITE_ASSETS.put(storageKey, found.bytes, { httpMetadata: { contentType: found.contentType }, customMetadata: { domain, source: found.source } });
      } else if (found.bytes.byteLength <= MAX_INLINE_AVATAR_BYTES) {
        inline = bytesToBase64(found.bytes);
      }
    }
    const stored = Boolean(storageKey || inline);
    await env.DB.prepare(
      `INSERT INTO mailbox_sender_avatars (domain, status, source, storage_key, content_type, data_base64, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET status = excluded.status, source = excluded.source, storage_key = excluded.storage_key,
         content_type = excluded.content_type, data_base64 = excluded.data_base64, fetched_at = excluded.fetched_at`,
    ).bind(domain, stored ? "found" : "none", stored ? found!.source : null, storageKey, stored ? found!.contentType : null, inline, now.toISOString()).run();
  } catch (error) {
    console.warn("Sender avatar lookup failed", { domain, error: error instanceof Error ? error.message : String(error) });
    await env.DB.prepare(
      `INSERT INTO mailbox_sender_avatars (domain, status, fetched_at) VALUES (?, 'failed', ?)
       ON CONFLICT(domain) DO UPDATE SET status = 'failed', fetched_at = excluded.fetched_at`,
    ).bind(domain, now.toISOString()).run().catch(() => undefined);
  }
}

async function fetchSenderAvatar(domain: string): Promise<{ bytes: Uint8Array; contentType: string; source: "bimi" | "favicon" } | null> {
  const bimi = await fetchBimiLogo(domain).catch(() => null);
  if (bimi) return bimi;
  for (const host of [domain, `www.${domain}`]) {
    const favicon = await fetchImage(`https://${host}/favicon.ico`, MAX_AVATAR_BYTES).catch(() => null);
    if (favicon) return { ...favicon, source: "favicon" };
  }
  return null;
}

async function fetchBimiLogo(domain: string): Promise<{ bytes: Uint8Array; contentType: string; source: "bimi" } | null> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=default._bimi.${encodeURIComponent(domain)}&type=TXT`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { Answer?: Array<{ data?: string }> };
  const record = (payload.Answer || []).map(answer => (answer.data || "").replace(/"/g, "")).find(data => /v=bimi1/i.test(data));
  const logoUrl = record?.match(/l=(https:\/\/[^;\s]+)/i)?.[1];
  if (!logoUrl) return null;
  const image = await fetchImage(logoUrl, 64 * 1024);
  return image && /svg/i.test(image.contentType) ? { ...image, source: "bimi" } : null;
}

async function fetchImage(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5_000), headers: { accept: "image/*" } });
  if (!response.ok) return null;
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) return null;
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
  return { bytes, contentType };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function avatarSignature(env: Pick<Env, "JWT_SECRET" | "TOKEN_ENCRYPTION_KEY">, domain: string): Promise<string> {
  const secret = env.JWT_SECRET || env.TOKEN_ENCRYPTION_KEY || "me3-sender-avatars";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`sender-avatar:${domain}`)));
  return [...signature.slice(0, 16)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifySenderAvatarSignature(env: Pick<Env, "JWT_SECRET" | "TOKEN_ENCRYPTION_KEY">, domain: string, signature: string | undefined): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{32}$/.test(signature)) return false;
  return (await avatarSignature(env, domain)) === signature;
}

export async function senderAvatarUrl(env: Pick<Env, "JWT_SECRET" | "TOKEN_ENCRYPTION_KEY">, domain: string, apiOrigin: string | null): Promise<string> {
  return `${apiOrigin || ""}/api/mailbox/sender-avatars/${encodeURIComponent(domain)}?sig=${await avatarSignature(env, domain)}`;
}

export async function readSenderAvatar(env: Env, domain: string): Promise<{ body: BodyInit; contentType: string } | null> {
  const row = (await getSenderAvatarRows(env, [domain])).get(domain);
  if (!row || row.status !== "found") return null;
  if (row.storage_key && env.SITE_ASSETS) {
    const object = await env.SITE_ASSETS.get(row.storage_key);
    if (object) return { body: object.body, contentType: row.content_type || "image/png" };
  }
  if (row.data_base64) return { body: new Blob([base64ToBytes(row.data_base64) as BlobPart]), contentType: row.content_type || "image/png" };
  return null;
}

// --- Row decoration --------------------------------------------------------

export type MailTriageTag = {
  category: "needs_you" | "handled" | "fyi" | "noise" | null;
  summary: string | null;
  handledKind: string | null;
  draftId: string | null;
  label: string | null;
};

type ContactLookup = Map<string, { id: string; name: string; avatarUrl: string | null }>;

async function loadContactLookup(env: Pick<Env, "DB">, ownerId: string): Promise<ContactLookup> {
  const lookup: ContactLookup = new Map();
  const rows = await env.DB.prepare(
    "SELECT id, name, email, metadata FROM contacts WHERE user_id = ? AND email IS NOT NULL AND TRIM(email) != ''",
  ).bind(ownerId).all<{ id: string; name: string; email: string; metadata: string | null }>().catch(() => ({ results: [] as Array<{ id: string; name: string; email: string; metadata: string | null }> }));
  for (const row of rows.results || []) {
    let avatarUrl: string | null = null;
    try {
      const metadata = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
      avatarUrl = typeof metadata.avatarUrl === "string" && /^https:\/\//.test(metadata.avatarUrl) ? metadata.avatarUrl : null;
    } catch { /* metadata stays optional */ }
    lookup.set(row.email.trim().toLowerCase(), { id: row.id, name: row.name, avatarUrl });
  }
  return lookup;
}

export async function loadTriageTags(env: Pick<Env, "DB">, messageIds: string[]): Promise<Map<string, MailTriageTag>> {
  const unique = [...new Set(messageIds.filter(Boolean))];
  const tags = new Map<string, MailTriageTag>();
  if (unique.length === 0) return tags;
  const rows = await env.DB.prepare(
    `SELECT t.message_id, t.category, t.summary, t.handled_kind, t.status,
            CASE WHEN d.status = 'pending_approval' THEN d.id END AS draft_id
     FROM mailbox_triage t
     LEFT JOIN mailbox_messages d ON d.id = t.draft_id
     WHERE t.message_id IN (${unique.map(() => "?").join(",")})`,
  ).bind(...unique).all<{ message_id: string; category: MailTriageTag["category"]; summary: string | null; handled_kind: string | null; status: string; draft_id: string | null }>()
    .catch(() => ({ results: [] as Array<{ message_id: string; category: MailTriageTag["category"]; summary: string | null; handled_kind: string | null; status: string; draft_id: string | null }> }));
  for (const row of rows.results || []) {
    tags.set(row.message_id, {
      category: row.status === "done" ? row.category : null,
      summary: row.summary,
      handledKind: row.handled_kind,
      draftId: row.draft_id,
      label: triageTagLabel(row.handled_kind, row.draft_id),
    });
  }
  return tags;
}

export function triageTagLabel(handledKind: string | null, draftId: string | null): string | null {
  if (draftId) return "Draft ready";
  switch (handledKind) {
    case "receipt": return "Filed to Accounts";
    case "rule_reply": return "ME3 replied";
    case "newsletter": return "Summarised";
    case "notification": return "Archived";
    case "rule_archive": return "Archived · your rule";
    default: return null;
  }
}

export type SenderDecorationContext = {
  contacts: ContactLookup;
  avatars: Map<string, AvatarRow>;
  apiOrigin: string | null;
};

export async function createSenderDecorationContext(env: Env, ownerId: string, addresses: string[], apiOrigin: string | null): Promise<SenderDecorationContext> {
  const domains = addresses.map(senderDomain).filter((domain): domain is string => Boolean(domain) && !isGenericMailProvider(domain));
  const [contacts, avatars] = await Promise.all([loadContactLookup(env, ownerId), getSenderAvatarRows(env, domains)]);
  return { contacts, avatars, apiOrigin };
}

export async function describeSender(
  env: Env,
  context: SenderDecorationContext,
  input: { address: string | null | undefined; headerName?: string | null; textBody?: string | null; subject?: string | null },
): Promise<MailSenderIdentity> {
  const forward = parseForwardedMessage(input.textBody, input.subject);
  const address = (input.address || "").trim().toLowerCase();
  const contact = context.contacts.get(address) || null;
  const name = describeSenderName({ headerName: input.headerName, address, contactName: contact?.name });
  const domain = senderDomain(address);
  let avatarUrl = contact?.avatarUrl || null;
  if (!avatarUrl && domain && context.avatars.get(domain)?.status === "found") {
    avatarUrl = await senderAvatarUrl(env, domain, context.apiOrigin);
  }
  return {
    name,
    address,
    initials: senderInitials(name),
    avatarUrl,
    contactId: contact?.id || null,
    isForward: forward.isForward,
    originalSender: forward.originalSender,
  };
}

/** Adds `sender`, `cleanPreview` and `triage` to serialized mailbox messages. */
export async function decorateMailboxMessages<T extends { id: string; direction: string; fromAddress: string | null; fromName: string | null; toAddress: string | null; subject: string; body: string }>(
  env: Env,
  ownerId: string,
  messages: T[],
  apiOrigin: string | null,
): Promise<Array<T & { sender: MailSenderIdentity; cleanPreview: string; triage: MailTriageTag | null }>> {
  if (messages.length === 0) return [];
  const context = await createSenderDecorationContext(env, ownerId, messages.map(message => message.direction === "outbound" ? message.toAddress || "" : message.fromAddress || ""), apiOrigin);
  const tags = await loadTriageTags(env, messages.filter(message => message.direction === "inbound").map(message => message.id));
  return Promise.all(messages.map(async message => ({
    ...message,
    sender: await describeSender(env, context, {
      address: message.direction === "outbound" ? message.toAddress : message.fromAddress,
      headerName: message.direction === "outbound" ? null : message.fromName,
      textBody: message.body,
      subject: message.subject,
    }),
    cleanPreview: cleanMailPreview(message.body, { subject: message.subject }),
    triage: tags.get(message.id) || null,
  })));
}

/** Adds `sender`, `cleanSnippet` and `triage` to thread summaries using each thread's latest message. */
export async function decorateMailboxThreads<T extends { id: string; latestMessageId: string; subject: string; latestSnippet: string }>(
  env: Env,
  ownerId: string,
  threads: T[],
  apiOrigin: string | null,
): Promise<Array<T & { sender: MailSenderIdentity | null; cleanSnippet: string; triage: MailTriageTag | null }>> {
  if (threads.length === 0) return [];
  const latestIds = [...new Set(threads.map(thread => thread.latestMessageId).filter(Boolean))];
  const rows = await env.DB.prepare(
    `SELECT m.id, m.direction, m.from_address, m.to_address, m.raw_headers_json, m.subject,
            SUBSTR(COALESCE(m.text_body, ''), 1, 2000) AS text_body
     FROM mailbox_messages m
     JOIN mailbox_aliases a ON a.id = m.mailbox_id
     WHERE a.user_id = ? AND m.id IN (${latestIds.map(() => "?").join(",")})`,
  ).bind(ownerId, ...latestIds).all<{ id: string; direction: string; from_address: string | null; to_address: string | null; raw_headers_json: string | null; subject: string | null; text_body: string }>();
  const latest = new Map((rows.results || []).map(row => [row.id, row]));
  const context = await createSenderDecorationContext(env, ownerId, [...latest.values()].map(row => row.direction === "outbound" ? row.to_address || "" : row.from_address || ""), apiOrigin);
  const tags = await loadTriageTags(env, [...latest.values()].filter(row => row.direction === "inbound").map(row => row.id));
  return Promise.all(threads.map(async thread => {
    const row = latest.get(thread.latestMessageId);
    if (!row) return { ...thread, sender: null, cleanSnippet: cleanMailPreview(thread.latestSnippet, { subject: thread.subject }), triage: null };
    let headerName: string | null = null;
    try { headerName = parseEmailAddressHeader((JSON.parse(row.raw_headers_json || "{}") as Record<string, unknown>).from ?? (JSON.parse(row.raw_headers_json || "{}") as Record<string, unknown>).From)?.name || null; } catch { headerName = null; }
    return {
      ...thread,
      sender: await describeSender(env, context, {
        address: row.direction === "outbound" ? row.to_address : row.from_address,
        headerName: row.direction === "outbound" ? null : headerName,
        textBody: row.text_body,
        subject: row.subject,
      }),
      cleanSnippet: cleanMailPreview(row.text_body, { subject: row.subject }) || cleanMailPreview(thread.latestSnippet, { subject: thread.subject }),
      triage: tags.get(row.id) || null,
    };
  }));
}
