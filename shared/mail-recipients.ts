// Recipient lists for owner-written mail (To, Cc, Bcc). Shared by the web
// compose form and the Worker send path so both agree on what is valid.

/** Upper bound across To + Cc + Bcc for one owner message. Not a bulk tool. */
export const MAX_MAIL_RECIPIENTS = 20;

const EMAIL_PATTERN = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function isValidMailRecipient(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/**
 * Split "a@x.ie, Bob <b@y.ie>; c@z.ie" (or an array of those) into
 * lower-cased, de-duplicated addresses. Invalid entries are kept so callers
 * can report them; use `invalidMailRecipients` to find them.
 */
export function parseMailRecipients(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? splitRecipients(item) : []))
    : typeof value === "string"
      ? splitRecipients(value)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const angle = part.match(/<([^<>]+)>\s*$/);
    const address = (angle ? angle[1] : part).trim().replace(/^mailto:/i, "").toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

function splitRecipients(value: string): string[] {
  // Split on commas/semicolons/newlines that are not inside a quoted name.
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "," || char === ";" || char === "\n")) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function invalidMailRecipients(addresses: string[]): string[] {
  return addresses.filter((address) => !isValidMailRecipient(address));
}

/** Header-style list, e.g. for the stored to_address column and the To header. */
export function formatMailRecipients(addresses: string[]): string {
  return addresses.join(", ");
}
