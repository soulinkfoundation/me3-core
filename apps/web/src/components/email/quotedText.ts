import { findInlineImageIds, normalizeContentId } from "./inlineImages";

// A reply usually carries the whole conversation under it. In a conversation view that history is
// already on screen as the earlier messages, so it sits behind a "•••" toggle (as in Gmail). The
// sender's own words and signature stay visible. Nothing is folded when there would be nothing
// left to read, and only what a mail client marked as quoted history is folded.

const QUOTE_INTRO = /^(?:On .+ wrote:|Le .+ a écrit\s?:|Am .+ schrieb .+:|-{2,}\s*Original Message\s*-{2,})\s*$/i;

/** Splits a plain-text message into the sender's words and the quoted history that ends it. */
export function splitQuotedText(text: string): { body: string; quoted: string } {
  const lines = text.split("\n");
  let start = lines.length;
  // Walk up from the end over quoted lines (and the blank lines between them).
  while (start > 0 && (/^\s*>/.test(lines[start - 1]) || lines[start - 1].trim() === "")) start -= 1;
  const hasQuote = lines.slice(start).some((line) => /^\s*>/.test(line));
  if (!hasQuote) return { body: text, quoted: "" };
  // The quote begins at its first ">" line, or at the "On ... wrote:" line just above it.
  while (start < lines.length && lines[start].trim() === "") start += 1;
  if (start > 0 && QUOTE_INTRO.test(lines[start - 1].trim())) start -= 1;
  const body = lines.slice(0, start).join("\n").trimEnd();
  if (!body.trim()) return { body: text, quoted: "" };
  return { body, quoted: lines.slice(start).join("\n").trimEnd() };
}

const QUOTE_SELECTOR = '.gmail_quote, .gmail_extra, .yahoo_quoted, .moz-cite-prefix, blockquote[type="cite"], #divRplyFwdMsg, #appendonsend';

export const QUOTE_TOGGLE_STYLE = `details.me3-quote { margin-top: 12px; }
details.me3-quote > summary { display: inline-block; list-style: none; cursor: pointer; padding: 0 8px; border-radius: 8px; background: #eef0f2; color: #555b66; font: 600 14px/20px system-ui, sans-serif; letter-spacing: 1px; }
details.me3-quote > summary::-webkit-details-marker { display: none; }
details.me3-quote > summary:focus-visible { outline: 2px solid #229874; outline-offset: 2px; }
details.me3-quote[open] > summary { margin-bottom: 10px; }`;

/**
 * Folds the quoted history a mail client added to an HTML message into a closed <details>.
 * Returns the HTML untouched when there is no marked quote or nothing would be left above it.
 */
export function collapseQuotedHtml(html: string): string {
  if (!html || !/gmail_quote|gmail_extra|yahoo_quoted|moz-cite-prefix|type\s*=\s*["']?cite|divRplyFwdMsg|appendonsend/i.test(html)) return html;
  const fullDocument = /<html[\s>]/i.test(html);
  const doc = new DOMParser().parseFromString(fullDocument ? html : `<!doctype html><html><body>${html}</body></html>`, "text/html");
  const quote = doc.body?.querySelector(QUOTE_SELECTOR);
  if (!quote || !doc.body) return html;
  // Climb to the element that sits directly in the body, so everything after it folds with it.
  let top: Element = quote;
  while (top.parentElement && top.parentElement !== doc.body) {
    // A quote nested beside other content of its parent folds from the quote itself.
    if ([...top.parentElement.childNodes].some((node) => node !== top && (node.textContent || "").trim())) break;
    top = top.parentElement;
  }
  const container = top.parentElement;
  if (!container) return html;
  const following: ChildNode[] = [];
  for (let node: ChildNode | null = top; node; node = node.nextSibling) following.push(node);
  // Something must remain to read above the quote.
  for (const node of following) node.parentNode?.removeChild(node);
  const remaining = (doc.body.textContent || "").trim() || doc.body.querySelector("img");
  if (!remaining) return html;
  const details = doc.createElement("details");
  details.className = "me3-quote";
  const summary = doc.createElement("summary");
  summary.setAttribute("aria-label", "Show quoted text");
  summary.setAttribute("title", "Show quoted text");
  summary.textContent = "•••";
  details.append(summary, ...following);
  container.append(details);
  return fullDocument ? `<!doctype html>${doc.documentElement.outerHTML}` : doc.body.innerHTML;
}

type AttachmentLike = { filename?: string | null; mimeType?: string | null; contentId?: string | null };

/** A picture the email's own HTML shows in place (cid:), which is not listed again as an attachment. */
export function isEmbeddedPicture(attachment: AttachmentLike, html: string | null | undefined): boolean {
  if (!html || !/^image\//i.test(attachment.mimeType || "")) return false;
  const id = normalizeContentId(attachment.contentId);
  return Boolean(id) && findInlineImageIds(html).includes(id);
}
