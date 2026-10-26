export const CAMPAIGN_DOCUMENT_VERSION = "me3.campaign-document.v1" as const;
export const CAMPAIGN_RENDERER_VERSION = "me3.email-renderer.v3" as const;

export const CAMPAIGN_TEXT_STYLES = ["body", "heading1", "heading2", "bullet"] as const;
export const CAMPAIGN_TEXT_MARKS = ["bold", "italic", "underline"] as const;
export const CAMPAIGN_SPACER_SIZES = ["small", "medium", "large"] as const;

export type CampaignTextStyle = (typeof CAMPAIGN_TEXT_STYLES)[number];
export type CampaignTextMark = (typeof CAMPAIGN_TEXT_MARKS)[number];
export type CampaignSpacerSize = (typeof CAMPAIGN_SPACER_SIZES)[number];

export type CampaignBrand = {
  name: string;
  homeUrl: string;
  logoUrl: string | null;
  logoAlignment: "left" | "center";
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  accentColor: string;
  /** Postal address shown in the footer; required before a real send (CAN-SPAM). */
  mailingAddress?: string;
};

export type CampaignTextSpan = {
  text: string;
  marks?: CampaignTextMark[];
  link?: string;
};

export type CampaignTextParagraph = {
  style: CampaignTextStyle;
  spans: CampaignTextSpan[];
};

export type CampaignTextBlock = {
  id: string;
  type: "text";
  paragraphs: CampaignTextParagraph[];
};

export type CampaignImageBlock = {
  id: string;
  type: "image";
  assetId: string;
  src: string;
  alt: string;
  href?: string;
  caption?: string;
};

export type CampaignButtonBlock = {
  id: string;
  type: "button";
  label: string;
  href: string;
  alignment: "left" | "center";
};

export type CampaignDividerBlock = {
  id: string;
  type: "divider";
};

export type CampaignSpacerBlock = {
  id: string;
  type: "spacer";
  size: CampaignSpacerSize;
};

export type CampaignBlock =
  | CampaignTextBlock
  | CampaignImageBlock
  | CampaignButtonBlock
  | CampaignDividerBlock
  | CampaignSpacerBlock;

export type CampaignDocumentV1 = {
  version: typeof CAMPAIGN_DOCUMENT_VERSION;
  brand: CampaignBrand;
  blocks: CampaignBlock[];
};

export class CampaignDocumentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues[0] || "Campaign content is invalid");
    this.name = "CampaignDocumentValidationError";
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BLOCK_LIMIT = 80;
const PARAGRAPH_LIMIT = 120;
const SPAN_LIMIT = 120;
const TOTAL_TEXT_LIMIT = 100_000;

export function createEmptyCampaignDocument(brand: Partial<CampaignBrand> = {}): CampaignDocumentV1 {
  return {
    version: CAMPAIGN_DOCUMENT_VERSION,
    brand: {
      name: normalizeText(brand.name, 120) || "ME3",
      homeUrl: normalizeHttpUrl(brand.homeUrl) || "https://me3.app/",
      logoUrl: normalizeHttpUrl(brand.logoUrl),
      logoAlignment: brand.logoAlignment === "left" ? "left" : "center",
      backgroundColor: normalizeColor(brand.backgroundColor, "#f4f5f4"),
      surfaceColor: normalizeColor(brand.surfaceColor, "#ffffff"),
      textColor: normalizeColor(brand.textColor, "#18201d"),
      accentColor: normalizeColor(brand.accentColor, "#147d64"),
      ...(normalizeMailingAddress(brand.mailingAddress)
        ? { mailingAddress: normalizeMailingAddress(brand.mailingAddress) }
        : {}),
    },
    blocks: [],
  };
}

export function parseCampaignDocument(input: unknown): CampaignDocumentV1 {
  const issues: string[] = [];
  if (!isRecord(input)) throw new CampaignDocumentValidationError(["Campaign content must be an object"]);
  if (input.version !== CAMPAIGN_DOCUMENT_VERSION) {
    issues.push(`Campaign content version must be ${CAMPAIGN_DOCUMENT_VERSION}`);
  }

  const brandInput = isRecord(input.brand) ? input.brand : {};
  const brand = createEmptyCampaignDocument({
    name: stringValue(brandInput.name),
    homeUrl: stringValue(brandInput.homeUrl),
    logoUrl: stringValue(brandInput.logoUrl),
    logoAlignment: brandInput.logoAlignment === "left" ? "left" : "center",
    backgroundColor: stringValue(brandInput.backgroundColor),
    surfaceColor: stringValue(brandInput.surfaceColor),
    textColor: stringValue(brandInput.textColor),
    accentColor: stringValue(brandInput.accentColor),
    mailingAddress: stringValue(brandInput.mailingAddress),
  }).brand;
  validateBrandInput(brandInput, issues);

  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  if (!Array.isArray(input.blocks)) issues.push("Campaign blocks must be an array");
  if (rawBlocks.length > BLOCK_LIMIT) issues.push(`Campaigns support at most ${BLOCK_LIMIT} blocks`);

  const blocks: CampaignBlock[] = [];
  let totalText = 0;
  for (const [index, rawBlock] of rawBlocks.slice(0, BLOCK_LIMIT).entries()) {
    const parsed = parseBlock(rawBlock, index, issues);
    if (!parsed) continue;
    totalText += campaignBlockTextLength(parsed);
    blocks.push(parsed);
  }
  if (totalText > TOTAL_TEXT_LIMIT) {
    issues.push(`Campaign text must be ${TOTAL_TEXT_LIMIT.toLocaleString()} characters or fewer`);
  }
  if (issues.length) throw new CampaignDocumentValidationError(issues);
  return { version: CAMPAIGN_DOCUMENT_VERSION, brand, blocks };
}

function parseBlock(rawBlock: unknown, index: number, issues: string[]): CampaignBlock | null {
  if (!isRecord(rawBlock)) {
    issues.push(`Block ${index + 1} must be an object`);
    return null;
  }
  const id = normalizeId(rawBlock.id);
  if (!id) issues.push(`Block ${index + 1} needs a stable id`);

  if (rawBlock.type === "text") {
    const rawParagraphs = Array.isArray(rawBlock.paragraphs) ? rawBlock.paragraphs : [];
    if (!Array.isArray(rawBlock.paragraphs)) issues.push(`Text block ${index + 1} needs paragraphs`);
    if (rawParagraphs.length > PARAGRAPH_LIMIT) {
      issues.push(`Text block ${index + 1} has too many paragraphs`);
    }
    const paragraphs = rawParagraphs
      .slice(0, PARAGRAPH_LIMIT)
      .map((paragraph, paragraphIndex) =>
        parseParagraph(paragraph, index, paragraphIndex, issues),
      )
      .filter((paragraph): paragraph is CampaignTextParagraph => Boolean(paragraph));
    return { id: id || `block-${index + 1}`, type: "text", paragraphs };
  }

  if (rawBlock.type === "image") {
    const assetId = normalizeId(rawBlock.assetId);
    const src = normalizeHttpUrl(rawBlock.src);
    if (!assetId) issues.push(`Image block ${index + 1} needs an asset id`);
    if (!src) issues.push(`Image block ${index + 1} needs an absolute HTTP(S) URL`);
    const href = rawBlock.href === undefined ? undefined : normalizeHttpUrl(rawBlock.href) || undefined;
    if (rawBlock.href !== undefined && !href) issues.push(`Image block ${index + 1} has an invalid link`);
    return {
      id: id || `block-${index + 1}`,
      type: "image",
      assetId: assetId || "invalid",
      src: src || "https://invalid.invalid",
      alt: normalizeText(rawBlock.alt, 500),
      ...(href ? { href } : {}),
      ...(normalizeText(rawBlock.caption, 500)
        ? { caption: normalizeText(rawBlock.caption, 500) }
        : {}),
    };
  }

  if (rawBlock.type === "button") {
    const label = normalizeText(rawBlock.label, 160);
    const href = normalizeHttpUrl(rawBlock.href);
    if (!label) issues.push(`Button block ${index + 1} needs a label`);
    if (!href) issues.push(`Button block ${index + 1} needs an absolute HTTP(S) URL`);
    return {
      id: id || `block-${index + 1}`,
      type: "button",
      label,
      href: href || "https://invalid.invalid",
      alignment: rawBlock.alignment === "left" ? "left" : "center",
    };
  }

  if (rawBlock.type === "divider") {
    return { id: id || `block-${index + 1}`, type: "divider" };
  }

  if (rawBlock.type === "spacer") {
    return {
      id: id || `block-${index + 1}`,
      type: "spacer",
      size: includes(CAMPAIGN_SPACER_SIZES, rawBlock.size) ? rawBlock.size : "medium",
    };
  }

  issues.push(`Block ${index + 1} has an unsupported type`);
  return null;
}

function parseParagraph(
  rawParagraph: unknown,
  blockIndex: number,
  paragraphIndex: number,
  issues: string[],
): CampaignTextParagraph | null {
  if (!isRecord(rawParagraph)) {
    issues.push(`Paragraph ${paragraphIndex + 1} in block ${blockIndex + 1} must be an object`);
    return null;
  }
  const rawSpans = Array.isArray(rawParagraph.spans) ? rawParagraph.spans : [];
  if (!Array.isArray(rawParagraph.spans)) {
    issues.push(`Paragraph ${paragraphIndex + 1} in block ${blockIndex + 1} needs text spans`);
  }
  if (rawSpans.length > SPAN_LIMIT) {
    issues.push(`Paragraph ${paragraphIndex + 1} in block ${blockIndex + 1} has too many spans`);
  }
  const spans = rawSpans.slice(0, SPAN_LIMIT).flatMap((rawSpan, spanIndex) => {
    if (!isRecord(rawSpan)) {
      issues.push(
        `Span ${spanIndex + 1} in paragraph ${paragraphIndex + 1} must be an object`,
      );
      return [];
    }
    const text = normalizeText(rawSpan.text, 20_000, false);
    const marks = Array.isArray(rawSpan.marks)
      ? [...new Set(rawSpan.marks.filter((mark) => includes(CAMPAIGN_TEXT_MARKS, mark)))]
      : [];
    const link = rawSpan.link === undefined ? undefined : normalizeHttpUrl(rawSpan.link) || undefined;
    if (rawSpan.link !== undefined && !link) {
      issues.push(`Span ${spanIndex + 1} in paragraph ${paragraphIndex + 1} has an invalid link`);
    }
    return [{ text, ...(marks.length ? { marks } : {}), ...(link ? { link } : {}) }];
  });
  return {
    style: includes(CAMPAIGN_TEXT_STYLES, rawParagraph.style) ? rawParagraph.style : "body",
    spans,
  };
}

function validateBrandInput(brand: Record<string, unknown>, issues: string[]) {
  if (!normalizeText(brand.name, 120)) issues.push("Campaign needs a sender name");
  if (!normalizeHttpUrl(brand.homeUrl)) issues.push("Campaign brand needs an absolute home URL");
  if (brand.logoUrl !== null && brand.logoUrl !== undefined && !normalizeHttpUrl(brand.logoUrl)) {
    issues.push("Campaign brand logo must use an absolute HTTP(S) URL");
  }
  for (const key of ["backgroundColor", "surfaceColor", "textColor", "accentColor"]) {
    if (!HEX_COLOR.test(stringValue(brand[key]))) issues.push(`${key} must be a six-digit hex color`);
  }
}

function campaignBlockTextLength(block: CampaignBlock): number {
  if (block.type === "text") {
    return block.paragraphs.reduce(
      (paragraphTotal, paragraph) =>
        paragraphTotal + paragraph.spans.reduce((spanTotal, span) => spanTotal + span.text.length, 0),
      0,
    );
  }
  if (block.type === "button") return block.label.length;
  if (block.type === "image") return block.alt.length + (block.caption?.length || 0);
  return 0;
}

/** One line, comma-separated, so the footer stays a quiet single line in every mail client. */
export function normalizeMailingAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .split(/[\r\n]+/)
    .map((part) => part.trim().replace(/,+$/, ""))
    .filter(Boolean)
    .join(", ")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function normalizeText(value: unknown, maxLength: number, trim = true): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\r\n?/g, "\n").slice(0, maxLength);
  return trim ? normalized.trim() : normalized;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(value)
    ? value
    : "";
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}
