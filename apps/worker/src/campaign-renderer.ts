import {
  CAMPAIGN_RENDERER_VERSION,
  parseCampaignDocument,
  type CampaignBlock,
  type CampaignDocumentV1,
  type CampaignTextParagraph,
  type CampaignTextSpan,
} from "../../../shared/campaign-document";

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

const SPACER_HEIGHTS = { small: 12, medium: 24, large: 40 } as const;

export function renderCampaign(input: RenderCampaignInput): RenderedCampaign {
  const document = parseCampaignDocument(input.document);
  const previewText = normalizePreviewText(input.previewText);
  const unsubscribeUrl = input.unsubscribeUrl.trim();
  if (!unsubscribeUrl) throw new Error("Campaign rendering requires an unsubscribe URL");

  return {
    rendererVersion: CAMPAIGN_RENDERER_VERSION,
    html: renderCampaignHtml(document, previewText, unsubscribeUrl),
    text: renderCampaignText(document, unsubscribeUrl),
  };
}

function renderCampaignHtml(
  document: CampaignDocumentV1,
  previewText: string,
  unsubscribeUrl: string,
): string {
  const { brand } = document;
  const blocks = document.blocks.map((block) => renderBlock(block, document)).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(brand.name)}</title>
  <style>
    @media only screen and (max-width:620px) {
      .me3-email-shell { width:100% !important; }
      .me3-email-pad { padding-left:24px !important; padding-right:24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${brand.backgroundColor};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(previewText)}${previewText ? "&#847; &zwnj; &nbsp;".repeat(20) : ""}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:${brand.backgroundColor}">
    <tr>
      <td align="center" style="padding:32px 12px">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="me3-email-shell" style="width:600px;max-width:600px;border-collapse:collapse;background:${brand.surfaceColor}">
          <tr><td class="me3-email-pad" style="padding:32px 40px 16px">${blocks}</td></tr>
          <tr>
            <td class="me3-email-pad" style="padding:8px 40px 28px;color:#8a938f;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6">
              You're getting this because you subscribed to ${escapeHtml(brand.name)}. <a href="${escapeAttribute(unsubscribeUrl)}" style="color:#8a938f;text-decoration:underline">Unsubscribe</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderBlock(block: CampaignBlock, document: CampaignDocumentV1): string {
  if (block.type === "text") {
    return block.paragraphs.map((paragraph) => renderParagraph(paragraph, document)).join("");
  }
  if (block.type === "image") {
    const image = `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:8px">`;
    const linkedImage = block.href
      ? `<a href="${escapeAttribute(block.href)}" style="text-decoration:none">${image}</a>`
      : image;
    const caption = block.caption
      ? `<p style="margin:8px 0 0;color:#69736f;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;text-align:center">${escapeHtml(block.caption)}</p>`
      : "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:8px 0 24px">${linkedImage}${caption}</td></tr></table>`;
  }
  if (block.type === "button") {
    return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"${block.alignment === "center" ? ' align="center"' : ""} style="border-collapse:collapse;margin:${block.alignment === "center" ? "8px auto 24px" : "8px 0 24px"}"><tr><td bgcolor="${document.brand.accentColor}" style="border-radius:7px"><a href="${escapeAttribute(block.href)}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:700;text-decoration:none;border-radius:7px">${escapeHtml(block.label)}</a></td></tr></table>`;
  }
  if (block.type === "divider") {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0 24px;border-top:1px solid #dfe3e1;font-size:0;line-height:0">&nbsp;</td></tr></table>';
  }
  const height = SPACER_HEIGHTS[block.size];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td height="${height}" style="height:${height}px;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

function renderParagraph(
  paragraph: CampaignTextParagraph,
  document: CampaignDocumentV1,
): string {
  const content = paragraph.spans.map((span) => renderSpan(span, document)).join("") || "&nbsp;";
  const base = `color:${document.brand.textColor};font-family:Arial,Helvetica,sans-serif`;
  if (paragraph.style === "heading1") {
    return `<h1 style="margin:0 0 18px;${base};font-size:30px;line-height:1.2;font-weight:700">${content}</h1>`;
  }
  if (paragraph.style === "heading2") {
    return `<h2 style="margin:0 0 14px;${base};font-size:22px;line-height:1.3;font-weight:700">${content}</h2>`;
  }
  if (paragraph.style === "bullet") {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td width="20" valign="top" style="padding:0 0 12px;${base};font-size:16px;line-height:1.6">&#8226;</td><td valign="top" style="padding:0 0 12px;${base};font-size:16px;line-height:1.6">${content}</td></tr></table>`;
  }
  return `<p style="margin:0 0 16px;${base};font-size:16px;line-height:1.6">${content}</p>`;
}

function renderSpan(span: CampaignTextSpan, document: CampaignDocumentV1): string {
  let content = escapeHtml(span.text).replace(/\n/g, "<br>");
  for (const mark of span.marks || []) {
    if (mark === "bold") content = `<strong style="font-weight:700">${content}</strong>`;
    if (mark === "italic") content = `<em>${content}</em>`;
    if (mark === "underline") content = `<u>${content}</u>`;
  }
  if (span.link) {
    content = `<a href="${escapeAttribute(span.link)}" style="color:${document.brand.accentColor};text-decoration:underline">${content}</a>`;
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
