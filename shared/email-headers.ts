export function decodeMimeHeaderValue(value: string): string {
  if (!/=\?[^?]+\?[bq]\?[^?]*\?=/i.test(value)) return value;
  return value
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?[^?]+\?[bq]\?)/gi, "$1")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (_match, charset: string, encoding: string, encoded: string) => {
        const bytes =
          encoding.toLowerCase() === "b"
            ? decodeMimeBBytes(encoded)
            : decodeMimeQBytes(encoded);
        try {
          return new TextDecoder(charset).decode(bytes);
        } catch {
          try {
            return new TextDecoder("utf-8").decode(bytes);
          } catch {
            return encoded;
          }
        }
      },
    );
}

/** Every address in an address-list header such as To or Cc, lowercased, in order. */
export function parseEmailAddressList(value: unknown): string[] {
  const decoded = decodeMimeHeaderValue(typeof value === "string" ? value : "")
    // Display names may contain commas or @ signs; only addresses count.
    .replace(/"(?:[^"\\]|\\.)*"/g, "");
  const addresses = decoded.match(/[^\s<>,;:"()[\]@]+@[^\s<>,;:"()[\]@]+\.[^\s<>,;:"()[\]@]+/g) || [];
  return addresses.map((address) => address.toLowerCase());
}

export function parseEmailAddressHeader(
  value: unknown,
): { name: string | null; address: string } | null {
  const decoded = decodeMimeHeaderValue(
    typeof value === "string" ? value.trim() : "",
  );
  if (!decoded) return null;
  const angleMatch = decoded.match(/^(.*?)<([^<>\s@]+@[^<>\s@]+)>/);
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^"|"$/g, "");
    return {
      name: name || null,
      address: angleMatch[2].trim().toLowerCase(),
    };
  }
  const address = findBareEmailAddress(decoded);
  return address ? { name: null, address: address.toLowerCase() } : null;
}

function findBareEmailAddress(value: string): string | null {
  let start = 0;
  while (start < value.length) {
    while (start < value.length && isEmailAddressDelimiter(value[start])) {
      start += 1;
    }
    let end = start;
    while (end < value.length && !isEmailAddressDelimiter(value[end])) {
      end += 1;
    }
    const candidate = value.slice(start, end);
    if (isBareEmailAddress(candidate)) return candidate;
    start = end + 1;
  }
  return null;
}

function isEmailAddressDelimiter(value: string): boolean {
  return (
    value === " " ||
    value === "\n" ||
    value === "\r" ||
    value === "\t" ||
    value === "<" ||
    value === ">"
  );
}

function isBareEmailAddress(value: string): boolean {
  const atIndex = value.indexOf("@");
  return (
    atIndex > 0 &&
    atIndex === value.lastIndexOf("@") &&
    atIndex < value.length - 1
  );
}

function decodeMimeBBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/\s/g, "")), (char) =>
    char.charCodeAt(0),
  );
}

function decodeMimeQBytes(value: string): Uint8Array {
  const decoded = value
    .replace(/_/g, " ")
    .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0) & 0xff);
}
