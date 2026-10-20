/**
 * DKIM verification (RFC 6376, RFC 8463) for deciding whether mail that says
 * it is from the owner really is. The From line is free text and the
 * receiving MX's Authentication-Results header cannot be told apart from one
 * the sender wrote, so ME3 checks the signature itself: the raw message,
 * the signer's public key from DNS (over HTTPS), and Web Crypto.
 *
 * Only a passing signature whose d= domain aligns with the From domain and
 * covers the From header counts. Anything else is "none" or "fail", and the
 * mail is treated as ordinary mail.
 */

export type SenderAuthResult = {
  dkim: "pass" | "fail" | "none";
  /** The signing domain of the passing (or last tried) signature. */
  domain: string | null;
  reason?: string;
};

/** Returns the TXT strings published at a DNS name (each record's quoted chunks already joined). */
export type DnsTxtResolver = (name: string) => Promise<string[]>;

type Header = { name: string; raw: string };

const MAX_SIGNATURES = 3;

export async function verifyDkim(
  rawMessage: string,
  options: { resolveTxt?: DnsTxtResolver; now?: Date } = {},
): Promise<SenderAuthResult> {
  const { headers, body } = splitMessage(rawMessage);
  const fromDomain = headerFromDomain(headers);
  if (!fromDomain) return { dkim: "none", domain: null, reason: "No From address" };
  const signatures = headers.filter(header => header.name.toLowerCase() === "dkim-signature").slice(0, MAX_SIGNATURES);
  if (signatures.length === 0) return { dkim: "none", domain: null, reason: "Not signed" };

  const resolveTxt = options.resolveTxt || resolveTxtOverHttps;
  let last: SenderAuthResult = { dkim: "fail", domain: null, reason: "No signature verified" };
  for (const signature of signatures) {
    const result = await verifySignature(signature, headers, body, fromDomain, resolveTxt, options.now || new Date())
      .catch((error: unknown): SenderAuthResult => ({ dkim: "fail", domain: null, reason: error instanceof Error ? error.message : "Verification failed" }));
    if (result.dkim === "pass") return result;
    last = result;
  }
  return last;
}

async function verifySignature(
  signature: Header,
  headers: Header[],
  body: string,
  fromDomain: string,
  resolveTxt: DnsTxtResolver,
  now: Date,
): Promise<SenderAuthResult> {
  const tags = parseTags(headerValue(signature.raw));
  const domain = (tags.d || "").toLowerCase().replace(/\.$/, "");
  const fail = (reason: string): SenderAuthResult => ({ dkim: "fail", domain: domain || null, reason });
  if (tags.v !== "1" || !domain || !tags.s || !tags.b || !tags.bh || !tags.h) return fail("Malformed signature");
  const algorithm = (tags.a || "").toLowerCase();
  if (algorithm !== "rsa-sha256" && algorithm !== "ed25519-sha256") return fail("Unsupported algorithm");
  if (!aligned(fromDomain, domain)) return fail("Signing domain does not match the From address");
  const signedHeaders = tags.h.split(":").map(name => name.trim().toLowerCase()).filter(Boolean);
  if (!signedHeaders.includes("from")) return fail("From is not signed");
  if (tags.x && Number(tags.x) * 1000 < now.getTime()) return fail("Signature expired");

  const [headerCanon, bodyCanon = "simple"] = (tags.c || "simple/simple").toLowerCase().split("/");
  let canonicalBody = bodyCanon === "relaxed" ? canonicalizeBodyRelaxed(body) : canonicalizeBodySimple(body);
  if (tags.l !== undefined) {
    const length = Number(tags.l);
    if (!Number.isInteger(length) || length < 0) return fail("Bad body length");
    canonicalBody = new TextDecoder().decode(new TextEncoder().encode(canonicalBody).slice(0, length));
  }
  const bodyHash = base64Encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalBody))));
  if (bodyHash !== tags.bh.replace(/\s+/g, "")) return fail("Body was changed after signing");

  const signingInput = dkimHeaderSigningInput(headers, signature, signedHeaders, headerCanon === "relaxed");
  const key = await loadPublicKey(resolveTxt, tags.s, domain, algorithm);
  if (!key) return fail("No usable public key");
  const signatureBytes = base64Decode(tags.b.replace(/\s+/g, ""));
  const data = new TextEncoder().encode(signingInput);
  const valid = algorithm === "rsa-sha256"
    ? await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signatureBytes, data)
    : await crypto.subtle.verify("Ed25519", key, signatureBytes, new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
  return valid ? { dkim: "pass", domain } : fail("Signature does not verify");
}

/** Relaxed alignment: the same domain, or one a subdomain of the other. */
function aligned(fromDomain: string, signingDomain: string): boolean {
  return fromDomain === signingDomain || fromDomain.endsWith(`.${signingDomain}`) || signingDomain.endsWith(`.${fromDomain}`);
}

/** Header bytes the signature covers: each listed header bottom-up, then the signature itself with b= emptied. */
export function dkimHeaderSigningInput(headers: Header[], signature: Header, signedHeaders: string[], relaxed: boolean): string {
  const used = new Set<Header>();
  let input = "";
  for (const name of signedHeaders) {
    const match = [...headers].reverse().find(header => header !== signature && !used.has(header) && header.name.toLowerCase() === name);
    if (!match) continue;
    used.add(match);
    input += relaxed ? canonicalizeHeaderRelaxed(match.raw) : match.raw;
  }
  const emptied = signature.raw.replace(/(^[^:]*:|;)(\s*b\s*=)[^;]*/i, "$1$2");
  const own = relaxed ? canonicalizeHeaderRelaxed(emptied) : emptied;
  return input + own.replace(/\r\n$/, "");
}

export function canonicalizeHeaderRelaxed(raw: string): string {
  const colon = raw.indexOf(":");
  const name = raw.slice(0, colon).trim().toLowerCase();
  const value = raw.slice(colon + 1).replace(/\r\n/g, "").replace(/[ \t]+/g, " ").trim();
  return `${name}:${value}\r\n`;
}

export function canonicalizeBodySimple(body: string): string {
  const trimmed = body.replace(/(\r\n)*$/, "");
  return `${trimmed}\r\n`;
}

export function canonicalizeBodyRelaxed(body: string): string {
  const lines = body.split("\r\n").map(line => line.replace(/[ \t]+/g, " ").replace(/ $/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length === 0 ? "" : `${lines.join("\r\n")}\r\n`;
}

/** Headers (each with its folded lines and trailing CRLF) and the body, with line endings made CRLF. */
export function splitMessage(rawMessage: string): { headers: Header[]; body: string } {
  const raw = rawMessage.replace(/\r?\n/g, "\r\n");
  const end = raw.indexOf("\r\n\r\n");
  const headerBlock = end < 0 ? raw : raw.slice(0, end + 2);
  const body = end < 0 ? "" : raw.slice(end + 4);
  const headers: Header[] = [];
  for (const line of headerBlock.split(/(?<=\r\n)/)) {
    if (!line) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && headers.length > 0) {
      headers[headers.length - 1].raw += line;
    } else {
      headers.push({ name: line.slice(0, Math.max(0, line.indexOf(":"))).trim(), raw: line });
    }
  }
  return { headers, body };
}

function headerValue(raw: string): string {
  return raw.slice(raw.indexOf(":") + 1).replace(/\r\n/g, "");
}

function headerFromDomain(headers: Header[]): string | null {
  const from = headers.filter(header => header.name.toLowerCase() === "from");
  // Two From headers is a classic spoofing trick; refuse to pick one.
  if (from.length !== 1) return null;
  const value = headerValue(from[0].raw);
  const address = value.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] || value.match(/[^\s<>"]+@[^\s<>",;]+/)?.[0];
  return address?.split("@")[1]?.toLowerCase().replace(/\.$/, "") || null;
}

function parseTags(value: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim().toLowerCase();
    if (name && !(name in tags)) tags[name] = part.slice(index + 1).trim();
  }
  return tags;
}

async function loadPublicKey(resolveTxt: DnsTxtResolver, selector: string, domain: string, algorithm: string): Promise<CryptoKey | null> {
  const records = await resolveTxt(`${selector}._domainkey.${domain}`);
  for (const record of records) {
    const tags = parseTags(record);
    if (tags.v && tags.v !== "DKIM1") continue;
    const keyType = (tags.k || "rsa").toLowerCase();
    const publicKey = (tags.p || "").replace(/\s+/g, "");
    if (!publicKey) continue; // An empty p= means the key was revoked.
    if (algorithm === "rsa-sha256" && keyType === "rsa") {
      return crypto.subtle.importKey("spki", base64Decode(publicKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    }
    if (algorithm === "ed25519-sha256" && keyType === "ed25519") {
      return crypto.subtle.importKey("raw", base64Decode(publicKey), { name: "Ed25519" }, false, ["verify"]);
    }
  }
  return null;
}

/** DNS over HTTPS: Workers have no resolver, so ask Cloudflare's public one. */
export async function resolveTxtOverHttps(name: string): Promise<string[]> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) throw new Error(`DNS lookup failed (${response.status})`);
  const payload = await response.json() as { Status?: number; Answer?: Array<{ type: number; data: string }> };
  return (payload.Answer || [])
    .filter(answer => answer.type === 16)
    .map(answer => [...answer.data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => match[1].replace(/\\(.)/g, "$1")).join("") || answer.data);
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
