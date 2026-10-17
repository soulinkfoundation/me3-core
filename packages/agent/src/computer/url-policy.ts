/**
 * Address policy for the agent's browser. Browser Run executes in Cloudflare's
 * network, not the owner's, but internal names, literal private addresses and
 * cloud metadata endpoints are still refused so a page cannot steer the browser
 * at infrastructure. Hostnames are checked as written; DNS is resolved remotely.
 */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp", ".private"];

export type BrowserUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function checkBrowserUrl(raw: string): BrowserUrlCheck {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: "Not a valid absolute URL." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only http and https pages can be opened." };
  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are refused." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "The URL has no host." };
  if (host === "localhost" || BLOCKED_SUFFIXES.some(suffix => host.endsWith(suffix)) || !host.includes(".") && !host.startsWith("[")) {
    return { ok: false, reason: "Internal and local hostnames are refused." };
  }
  if (host.startsWith("[")) return privateIpv6(host.slice(1, -1)) ? { ok: false, reason: "Private and internal addresses are refused." } : { ok: true, url };
  const ipv4 = parseIpv4(host);
  if (ipv4 && privateIpv4(ipv4)) return { ok: false, reason: "Private and internal addresses are refused." };
  return { ok: true, url };
}

/** Subresources may also use inline schemes that never leave the browser. */
export function allowBrowserRequest(raw: string, kind: "navigation" | "subresource"): boolean {
  if (kind === "subresource" && /^(data|blob):/i.test(raw)) return true;
  if (raw === "about:blank") return true;
  return checkBrowserUrl(raw).ok;
}

// WHATWG URL already normalizes decimal, hex and octal IPv4 forms to dotted quads.
function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every(part => /^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  return numbers.every(value => value <= 255) ? numbers : null;
}
function privateIpv4([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || a === 100 && b >= 64 && b <= 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168
    || a === 192 && b === 0
    || a === 198 && (b === 18 || b === 19);
}
function privateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value) ?? /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (mapped) {
    const quad = mapped.length === 2 ? parseIpv4(mapped[1]) : [parseInt(mapped[1], 16) >> 8, parseInt(mapped[1], 16) & 255, parseInt(mapped[2], 16) >> 8, parseInt(mapped[2], 16) & 255];
    return !quad || privateIpv4(quad);
  }
  const first = parseInt(value.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || value.startsWith("64:ff9b:") || value.startsWith("2001:db8:");
}
