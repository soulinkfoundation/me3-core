// Pure domain normalizers retained from the existing mailbox service.

export const MAILBOX_FOLDERS = new Set(["inbox", "drafts", "sent", "archive", "trash"]);

export const DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[\s\S]*?(?:\n\s*\n|$)/i;

export const DRAFT_WRAPPER_INTRO_LINE_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*(?:\n|$)/i;

export const DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN =
  /^\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*$/im;

export function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

export function normalizeEmailText(value: unknown): string | null {
  return normalizeNullableText(value)?.toLowerCase() || null;
}

export function isValidEmail(value: string): boolean {
  const atIndex = value.indexOf("@");
  if (
    atIndex <= 0 ||
    atIndex !== value.lastIndexOf("@") ||
    atIndex >= value.length - 1
  ) {
    return false;
  }
  const dotIndex = value.indexOf(".", atIndex + 1);
  if (dotIndex <= atIndex + 1 || dotIndex >= value.length - 1) return false;
  for (const character of value) {
    if (
      character === " " ||
      character === "\n" ||
      character === "\r" ||
      character === "\t"
    ) {
      return false;
    }
  }
  return true;
}

export function getAgentMailboxInternalAddress(localPart: string): string {
  return `${localPart}@me3.local`;
}

export function stripAgentDraftWrapperText(text: string): string {
  let body = text.replace(/\r\n/g, "\n").trim();
  const paragraphMarker = body.match(DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN);
  const draftMarker =
    paragraphMarker && !draftWrapperParagraphIncludesEmailBody(paragraphMarker[0])
      ? paragraphMarker
      : body.match(DRAFT_WRAPPER_INTRO_LINE_PATTERN);
  if (draftMarker?.index !== undefined) {
    body = body.slice(draftMarker.index + draftMarker[0].length).trim();
  }
  body = body.replace(DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN, "");
  const closingPromptIndex = body.search(
    /\n\s*(?:[-–—]\s*)?(?:please\s+let\s+me\s+know\s+if\s+you(?:'|’)d\s+like\s+(?:me\s+)?to\s+(?:make\s+any\s+changes\s+or\s+if\s+you(?:'|’)d\s+like\s+me\s+to\s+)?save\s+this\s+draft\.?|this is a chat draft only|if you want|if you(?:'|’)d like|if you(?:'|’)re happy|want me to|would you like|send me|I can save)/i,
  );
  if (closingPromptIndex >= 0) body = body.slice(0, closingPromptIndex).trim();
  return body.trim();
}

export function draftWrapperParagraphIncludesEmailBody(paragraph: string): boolean {
  const rest = paragraph.split(/\n/).slice(1).join("\n");
  return /^\s*(?:[-–—]{3,}|(?:\*\*)?\s*(?:to|recipient|subject|subject line)\s*:|(?:hi|hello|dear)\b)/im.test(
    rest,
  );
}
