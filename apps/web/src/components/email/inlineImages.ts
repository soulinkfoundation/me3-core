// Pictures a sender embedded in their email (a signature logo, a pasted screenshot) arrive as
// attachments and are referenced from the HTML as cid:<content-id>. They are part of the message
// itself, so showing them contacts nobody; remote images stay behind "Show".

const CID_REFERENCE = /cid:([^"'\s)>]+)/gi;

export function normalizeContentId(value: string | null | undefined): string {
  let id = (value || "").trim();
  try {
    id = decodeURIComponent(id);
  } catch {
    // Keep the raw value when it is not percent-encoded.
  }
  return id.replace(/^</, "").replace(/>$/, "").trim().toLowerCase();
}

/** The content IDs an email's HTML refers to. */
export function findInlineImageIds(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(CID_REFERENCE)) {
    const id = normalizeContentId(match[1]);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Swaps cid: references for the loaded pictures; unknown references are left alone. */
export function replaceInlineImages(html: string, urls: Record<string, string> | undefined): string {
  if (!urls) return html;
  return html.replace(CID_REFERENCE, (reference, id: string) => urls[normalizeContentId(id)] || reference);
}
