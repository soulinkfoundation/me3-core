import { splitMessage } from "./mailbox-sender-auth";
import type { Env } from "./types";

/**
 * "Show original": a received message's raw headers, as they arrived, with a
 * short SPF/DKIM/DMARC summary read from its Authentication-Results headers.
 * Headers are listed top first, so the first result is from the server that
 * handed the mail to ME3; ARC results carry what earlier hops saw before a
 * forward, such as Cloudflare Email Routing, rewrote the envelope.
 */

const MAX_HEADER_BYTES = 256 * 1024;
const AUTH_METHODS = ["spf", "dkim", "dmarc"] as const;

export type MailAuthMethodResult = { result: string; detail: string };
export type MailAuthSummary = {
  header: "Authentication-Results" | "ARC-Authentication-Results";
  instance: number | null;
  server: string;
  spf: MailAuthMethodResult[];
  dkim: MailAuthMethodResult[];
  dmarc: MailAuthMethodResult[];
};
export type MailboxOriginal = {
  headers: string;
  source: "raw" | "parsed";
  authentication: MailAuthSummary[];
};

/** The header block of a raw message, unchanged apart from CRLF line endings. */
export function rawHeaderBlock(rawMessage: string): string {
  return splitMessage(rawMessage).headers.map((header) => header.raw).join("").replace(/\r\n/g, "\n").trimEnd();
}

export function summarizeAuthentication(headerBlock: string): MailAuthSummary[] {
  const summaries: MailAuthSummary[] = [];
  for (const header of splitMessage(headerBlock).headers) {
    const name = header.name.toLowerCase();
    if (name !== "authentication-results" && name !== "arc-authentication-results") continue;
    const value = header.raw.slice(header.raw.indexOf(":") + 1).replace(/\r\n[ \t]+/g, " ").replace(/\r\n/g, "").trim();
    const parts = splitResultParts(value);
    let instance: number | null = null;
    if (name === "arc-authentication-results" && /^i=\d+$/i.test(parts[0] || "")) {
      instance = Number.parseInt(parts.shift()!.slice(2), 10);
    }
    const server = (parts.shift() || "").split(/\s+/)[0] || "unknown";
    const summary: MailAuthSummary = {
      header: name === "authentication-results" ? "Authentication-Results" : "ARC-Authentication-Results",
      instance,
      server,
      spf: [],
      dkim: [],
      dmarc: [],
    };
    for (const part of parts) {
      const match = part.match(/^(spf|dkim|dmarc)\s*=\s*([a-z]+)\b\s*(.*)$/i);
      if (!match) continue;
      const method = match[1].toLowerCase() as (typeof AUTH_METHODS)[number];
      summary[method].push({ result: match[2].toLowerCase(), detail: match[3].replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() });
    }
    if (AUTH_METHODS.some((method) => summary[method].length)) summaries.push(summary);
  }
  return summaries;
}

// Semicolons inside comments or quoted strings do not split results.
function splitResultParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of value) {
    if (char === '"' && depth === 0) quoted = !quoted;
    else if (!quoted && char === "(") depth += 1;
    else if (!quoted && char === ")") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0 && !quoted) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

export async function getMailboxOriginal(
  env: Env,
  ownerId: string,
  messageId: string,
): Promise<MailboxOriginal | null> {
  const row = await env.DB.prepare(
    `SELECT m.raw_message, m.raw_headers_json, m.metadata_json
     FROM mailbox_messages m
     JOIN mailbox_aliases a ON a.id = m.mailbox_id
     WHERE a.user_id = ? AND m.id = ? AND m.direction = 'inbound'`,
  )
    .bind(ownerId, messageId)
    .first<{ raw_message: string | null; raw_headers_json: string | null; metadata_json: string | null }>();
  if (!row) return null;

  let raw = row.raw_message;
  if (!raw && env.SITE_ASSETS) {
    const key = readRawStorageKey(row.metadata_json);
    const object = key ? await env.SITE_ASSETS.get(key) : null;
    if (object) raw = await readHead(object.body);
  }
  if (raw) {
    const headers = rawHeaderBlock(raw.slice(0, MAX_HEADER_BYTES));
    return { headers, source: "raw", authentication: summarizeAuthentication(headers) };
  }

  // Older or oversized messages kept only their parsed headers.
  const headers = Object.entries(parseRecord(row.raw_headers_json))
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  return { headers, source: "parsed", authentication: summarizeAuthentication(headers) };
}

function readRawStorageKey(metadataJson: string | null): string | null {
  const key = parseRecord(metadataJson).rawStorageKey;
  return typeof key === "string" && key.startsWith("mailbox/") ? key : null;
}

function parseRecord(json: string | null): Record<string, unknown> {
  try {
    const value = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Reads only until the end of the headers, so a large attachment is never loaded.
async function readHead(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < MAX_HEADER_BYTES && !/\r?\n\r?\n/.test(text)) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}
