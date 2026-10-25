import {
  CAMPAIGN_DARK,
  campaignBackground,
  campaignButtonTextColor,
  campaignDarkLinkColor,
  campaignLinkColor,
  campaignTextColor,
} from "../../../shared/campaign-brand";
import {
  CAMPAIGN_RENDERER_VERSION,
  createEmptyCampaignDocument,
  parseCampaignDocument,
  type CampaignBlock,
  type CampaignBrand,
  type CampaignDocumentV1,
  type CampaignTextParagraph,
  type CampaignTextSpan,
} from "../../../shared/campaign-document";
import type { CampaignLayoutBlock } from "../../../shared/campaign-layouts";

export type RenderCampaignInput = {
  document: CampaignDocumentV1 | unknown;
  previewText?: string;
  unsubscribeUrl: string;
};

export type RenderedCampaign = {
  rendererVersion: typeof CAMPAIGN_RENDERER_VERSION;
  html: string;
  text: string;
};

/** Colours actually used, after the readability rules in shared/campaign-brand. */
type Palette = {
  font: string;
  background: string;
  text: string;
  link: string;
  linkDark: string;
  accent: string;
  buttonText: string;
};

const SPACER_HEIGHTS = { small: 12, medium: 24, large: 40 } as const;
// The phone's own font; classic Outlook gets Arial from the mso rule instead of Times New Roman.
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MUTED = "#6b7470";
const PAD = 36;
const CONTENT_WIDTH = 600 - PAD * 2;

export function renderCampaign(input: RenderCampaignInput): RenderedCampaign {
  const document = parseCampaignDocument(input.document);
  const previewText = normalizePreviewText(input.previewText);
  const unsubscribeUrl = input.unsubscribeUrl.trim();
  if (!unsubscribeUrl) throw new Error("Campaign rendering requires an unsubscribe URL");

  const palette = campaignPalette(document.brand);
  return {
    rendererVersion: CAMPAIGN_RENDERER_VERSION,
    html: renderCampaignHtml(
      document.brand,
      document.blocks.map((block) => renderBlock(block, palette)).join(""),
      palette,
      previewText,
      unsubscribeUrl,
    ),
    text: renderCampaignText(document, unsubscribeUrl),
  };
}

/** A starting layout as it would look, photo slots included (the editor's "Start from" thumbnails). */
export function renderCampaignLayoutPreview(
  brandInput: Partial<CampaignBrand>,
  blocks: CampaignLayoutBlock[],
): string {
  const { brand } = createEmptyCampaignDocument(brandInput);
  const palette = campaignPalette(brand);
  const html = blocks
    .map((block) => (block.type === "photo-slot" ? renderPhotoSlot(palette) : renderBlock(block, palette)))
    .join("");
  return renderCampaignHtml(brand, html, palette, "", "#");
}

function campaignPalette(brand: CampaignBrand): Palette {
  return {
    font: FONT_STACK,
    background: campaignBackground(brand.backgroundColor),
    text: campaignTextColor(brand.textColor),
    link: campaignLinkColor(brand.accentColor),
    linkDark: campaignDarkLinkColor(brand.accentColor),
    accent: brand.accentColor,
    buttonText: campaignButtonTextColor(brand.accentColor),
  };
}

function renderCampaignHtml(
  brand: CampaignBrand,
  blocks: string,
  palette: Palette,
  previewText: string,
  unsubscribeUrl: string,
): string {
  const bg = palette.background;
  const footer = `You're getting this because you subscribed to ${escapeHtml(brand.name)}. <a href="${escapeAttribute(unsubscribeUrl)}" class="muted" style="color:${MUTED};text-decoration:underline">Unsubscribe</a>${brand.mailingAddress ? `<br>${escapeHtml(brand.mailingAddress)}` : ""}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(brand.name)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin:0; }
    @media only screen and (max-width:620px) {
      .me3-shell { width:100% !important; }
      .me3-pad { padding-left:22px !important; padding-right:22px !important; }
      .me3-outer { padding:0 !important; }
      .me3-card { border-radius:0 !important; }
    }
    @media (prefers-color-scheme: dark) {
      ${darkRules(palette, "")}
    }
    ${darkRules(palette, "[data-ogsc]", "[data-ogsb]")}
  </style>
  <!--[if mso]><style>* { font-family:Arial,Helvetica,sans-serif !important; }</style><![endif]-->
</head>
<body class="me3-bg" style="margin:0;padding:0;background:${bg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(previewText)}${previewText ? "&#847; &zwnj; &nbsp;".repeat(20) : ""}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${bg}" class="me3-bg" style="width:100%;border-collapse:collapse;background:${bg}">
    <tr>
      <td align="center" class="me3-outer" style="padding:28px 12px 0">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" class="me3-shell me3-card" style="width:600px;max-width:600px;border-collapse:separate;background:#ffffff;border-radius:12px">
          <tr><td align="center" class="me3-pad" style="padding:28px ${PAD}px 6px">${renderHeader(brand, palette)}</td></tr>
          <tr><td class="me3-pad" style="padding:20px ${PAD}px 12px">${blocks}</td></tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" class="me3-pad me3-muted" style="padding:20px 32px 34px;color:${MUTED};font-family:${palette.font};font-size:12px;line-height:1.6;mso-line-height-rule:exactly">${footer}</td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * The dark version for clients that ask for it (Apple Mail, iOS Mail), and the same rules under
 * Outlook.com's data-ogsc/data-ogsb markers. Gmail apps invert on their own and ignore these.
 */
function darkRules(palette: Palette, textScope: string, backgroundScope = textScope): string {
  const t = textScope ? `${textScope} ` : "";
  const b = backgroundScope ? `${backgroundScope} ` : "";
  return [
    `${b}.me3-bg { background:${CAMPAIGN_DARK.background} !important; }`,
    `${b}.me3-card { background:${CAMPAIGN_DARK.card} !important; }`,
    `${t}.me3-txt { color:${CAMPAIGN_DARK.text} !important; }`,
    `${t}.me3-muted { color:${CAMPAIGN_DARK.muted} !important; }`,
    `${t}.me3-lnk { color:${palette.linkDark} !important; }`,
    `${b}.me3-rule { border-top-color:${CAMPAIGN_DARK.rule} !important; }`,
  ].join(" ");
}

function renderHeader(brand: CampaignBrand, palette: Palette): string {
  const href = escapeAttribute(brand.homeUrl);
  if (brand.logoUrl) {
    // The email copy of the logo already sits on its own white tile, so it reads on dark cards too.
    // When images are blocked, the alt text stands in as the bold name.
    const width = brand.logoWidth || 200;
    const height = brand.logoHeight ? ` height="${brand.logoHeight}"` : "";
    return `<a href="${href}" style="text-decoration:none"><img src="${escapeAttribute(brand.logoUrl)}" alt="${escapeAttribute(brand.name)}" class="me3-txt" width="${width}"${height} style="display:block;width:${width}px;max-width:${width}px;height:auto;border:0;border-radius:8px;color:${palette.text};font-family:${palette.font};font-size:20px;font-weight:700"></a>`;
  }
  return `<a href="${href}" class="me3-txt" style="color:${palette.text};font-family:${palette.font};font-size:20px;line-height:1.2;font-weight:700;text-decoration:none;mso-line-height-rule:exactly">${escapeHtml(brand.name)}</a>`;
}

function renderBlock(block: CampaignBlock, palette: Palette): string {
  if (block.type === "text") {
    return block.paragraphs.map((paragraph) => renderParagraph(paragraph, palette)).join("");
  }
  if (block.type === "image") {
    const image = `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" width="${CONTENT_WIDTH}" style="display:block;width:100%;max-width:${CONTENT_WIDTH}px;height:auto;border:0;border-radius:8px">`;
    const linkedImage = block.href
      ? `<a href="${escapeAttribute(block.href)}" style="text-decoration:none">${image}</a>`
      : image;
    const caption = block.caption
      ? `<p class="me3-muted" style="margin:8px 0 0;color:${MUTED};font-family:${palette.font};font-size:12px;line-height:1.5;text-align:center">${escapeHtml(block.caption)}</p>`
      : "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:4px 0 22px">${linkedImage}${caption}</td></tr></table>`;
  }
  if (block.type === "button") {
    const center = block.alignment === "center";
    return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"${center ? ' align="center"' : ""} style="border-collapse:collapse;margin:${center ? "8px auto 26px" : "8px 0 26px"}"><tr><td bgcolor="${palette.accent}" style="border-radius:8px;background:${palette.accent}"><a href="${escapeAttribute(block.href)}" style="display:inline-block;padding:14px 24px;color:${palette.buttonText};font-family:${palette.font};font-size:16px;line-height:1.2;font-weight:700;text-decoration:none;border-radius:8px;mso-line-height-rule:exactly">${escapeHtml(block.label)}</a></td></tr></table>`;
  }
  if (block.type === "divider") {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td class="me3-rule" style="padding:8px 0 22px;border-top:1px solid #e1e5e3;font-size:0;line-height:0">&nbsp;</td></tr></table>';
  }
  const height = SPACER_HEIGHTS[block.size];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td height="${height}" style="height:${height}px;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

function renderPhotoSlot(palette: Palette): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td style="padding:4px 0 22px"><div style="height:150px;border:1.5px dashed #c9d0cd;border-radius:8px;background:#f6f8f7;color:#7b8581;font-family:${palette.font};font-size:14px;line-height:150px;text-align:center">Your photo</div></td></tr></table>`;
}

function renderParagraph(paragraph: CampaignTextParagraph, palette: Palette): string {
  const content = paragraph.spans.map((span) => renderSpan(span, palette)).join("") || "&nbsp;";
  const base = `color:${palette.text};font-family:${palette.font};mso-line-height-rule:exactly`;
  if (paragraph.style === "heading1") {
    return `<h1 class="me3-txt" style="margin:0 0 16px;${base};font-size:28px;line-height:1.25;font-weight:700">${content}</h1>`;
  }
  if (paragraph.style === "heading2") {
    return `<h2 class="me3-txt" style="margin:4px 0 10px;${base};font-size:20px;line-height:1.3;font-weight:700">${content}</h2>`;
  }
  if (paragraph.style === "bullet") {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td width="20" valign="top" class="me3-txt" style="padding:0 0 10px;${base};font-size:16px;line-height:1.6">&#8226;</td><td valign="top" class="me3-txt" style="padding:0 0 10px;${base};font-size:16px;line-height:1.6">${content}</td></tr></table>`;
  }
  return `<p class="me3-txt" style="margin:0 0 16px;${base};font-size:16px;line-height:1.6">${content}</p>`;
}

function renderSpan(span: CampaignTextSpan, palette: Palette): string {
  let content = escapeHtml(span.text).replace(/\n/g, "<br>");
  for (const mark of span.marks || []) {
    if (mark === "bold") content = `<strong style="font-weight:700">${content}</strong>`;
    if (mark === "italic") content = `<em>${content}</em>`;
    if (mark === "underline") content = `<u>${content}</u>`;
  }
  if (span.link) {
    content = `<a href="${escapeAttribute(span.link)}" class="me3-lnk" style="color:${palette.link};text-decoration:underline">${content}</a>`;
  }
  return content;
}

function renderCampaignText(document: CampaignDocumentV1, unsubscribeUrl: string): string {
  const sections: string[] = [];
  for (const block of document.blocks) {
    if (block.type === "text") {
      for (const paragraph of block.paragraphs) {
        const text = paragraph.spans.map((span) => span.text).join("");
        sections.push(paragraph.style === "bullet" ? `• ${text}` : text);
      }
      sections.push("");
    } else if (block.type === "button") {
      sections.push(`${block.label}: ${block.href}`, "");
    } else if (block.type === "image") {
      const description = [block.alt, block.caption].filter(Boolean).join(" — ");
      if (description) sections.push(description);
      if (block.href) sections.push(block.href);
      sections.push("");
    } else if (block.type === "divider") {
      sections.push("---", "");
    } else if (block.type === "spacer") {
      sections.push("");
    }
  }
  sections.push(
    `You're getting this because you subscribed to ${document.brand.name}. Unsubscribe: ${unsubscribeUrl}`,
  );
  if (document.brand.mailingAddress) sections.push(document.brand.mailingAddress);
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizePreviewText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
