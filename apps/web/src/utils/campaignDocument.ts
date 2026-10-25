export type CampaignTextMark = "bold" | "italic" | "underline";

export type CampaignTextSpan = {
  text: string;
  marks?: CampaignTextMark[];
  link?: string;
};

export type CampaignTextParagraph = {
  style: "body" | "heading1" | "heading2" | "bullet";
  spans: CampaignTextSpan[];
};

export type CampaignTextBlock = {
  id: string;
  type: "text";
  paragraphs: CampaignTextParagraph[];
};

export type CampaignExtraBlock =
  | {
      id: string;
      type: "image";
      assetId: string;
      src: string;
      alt: string;
      href?: string;
      caption?: string;
    }
  | {
      id: string;
      type: "button";
      label: string;
      href: string;
      alignment: "left" | "center";
    }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; size: "small" | "medium" | "large" };

export type CampaignDocument = {
  version: "me3.campaign-document.v1";
  brand: {
    name: string;
    homeUrl: string;
    logoUrl: string | null;
    logoAlignment: "left" | "center";
    backgroundColor: string;
    surfaceColor: string;
    textColor: string;
    accentColor: string;
    mailingAddress?: string;
  };
  blocks: Array<CampaignTextBlock | CampaignExtraBlock>;
};

export function campaignDocumentToEditorHtml(document: CampaignDocument): string {
  const html = document.blocks.map((block) => blockToEditorHtml(block)).join("");
  return html || "<p></p>";
}

export function campaignEditorHtmlToBlocks(
  html: string,
): Array<CampaignTextBlock | CampaignExtraBlock> {
  const parsed = new DOMParser().parseFromString(html || "<p></p>", "text/html");
  const blocks: Array<CampaignTextBlock | CampaignExtraBlock> = [];
  let paragraphs: CampaignTextParagraph[] = [];

  const flushText = () => {
    if (!paragraphs.length) return;
    blocks.push({
      id: `campaign-copy-${blocks.length + 1}`,
      type: "text",
      paragraphs,
    });
    paragraphs = [];
  };

  for (const element of Array.from(parsed.body.children)) {
    if (["P", "H1", "H2"].includes(element.tagName)) {
      paragraphs.push(paragraphFromElement(element));
      continue;
    }
    if (element.tagName === "UL") {
      for (const item of Array.from(element.children)) {
        if (item.tagName === "LI") {
          paragraphs.push({ style: "bullet", spans: spansFromNode(item) });
        }
      }
      continue;
    }

    flushText();
    if (element.tagName === "HR") {
      blocks.push({
        id: `campaign-divider-${blocks.length + 1}`,
        type: "divider",
      });
      continue;
    }

    const image = element.tagName === "IMG"
      ? element
      : element.matches("figure[data-tiptap-image]")
        ? element.querySelector("img")
        : null;
    if (image instanceof HTMLImageElement) {
      const assetId = image.getAttribute("data-image-id")?.trim() || "";
      const src = image.getAttribute("src")?.trim() || "";
      if (!assetId || !isAbsoluteHttpUrl(src)) continue;
      const caption = element.tagName === "FIGURE"
        ? element.querySelector("figcaption")?.textContent?.trim() || ""
        : "";
      blocks.push({
        id: `campaign-image-${blocks.length + 1}`,
        type: "image",
        assetId,
        src,
        alt: image.getAttribute("alt")?.trim() || "",
        ...(caption ? { caption } : {}),
      });
      continue;
    }

    if (element.matches("[data-me3-cta-button]")) {
      const label = element.getAttribute("data-text")?.trim() || "";
      const href = element.getAttribute("data-url")?.trim() || "";
      if (!label || !isAbsoluteHttpUrl(href)) continue;
      blocks.push({
        id: `campaign-button-${blocks.length + 1}`,
        type: "button",
        label,
        href,
        alignment: "center",
      });
    }
  }
  flushText();

  return blocks.length
    ? blocks
    : [{
        id: "campaign-copy-1",
        type: "text",
        paragraphs: [{ style: "body", spans: [{ text: "" }] }],
      }];
}

export function campaignEditorHtmlToTextBlock(html: string): CampaignTextBlock {
  return campaignEditorHtmlToBlocks(html).find(
    (block): block is CampaignTextBlock => block.type === "text",
  ) || {
    id: "campaign-copy-1",
    type: "text",
    paragraphs: [{ style: "body", spans: [{ text: "" }] }],
  };
}

function blockToEditorHtml(block: CampaignTextBlock | CampaignExtraBlock): string {
  if (block.type === "text") return textBlockToEditorHtml(block);
  if (block.type === "image") {
    const image = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" data-image-id="${escapeHtml(block.assetId)}">`;
    return block.caption
      ? `<figure data-tiptap-image="true">${image}<figcaption>${escapeHtml(block.caption)}</figcaption></figure>`
      : image;
  }
  if (block.type === "button") {
    return `<div data-me3-cta-button="true" data-text="${escapeHtml(block.label)}" data-url="${escapeHtml(block.href)}" data-style="primary" data-icon="" data-context="campaign">&#8203;</div>`;
  }
  if (block.type === "divider") return '<hr class="tiptap-divider">';
  return "<p><br></p>";
}

function textBlockToEditorHtml(text: CampaignTextBlock): string {
  const html: string[] = [];
  let inList = false;
  for (const paragraph of text.paragraphs) {
    if (paragraph.style === "bullet" && !inList) {
      html.push("<ul>");
      inList = true;
    } else if (paragraph.style !== "bullet" && inList) {
      html.push("</ul>");
      inList = false;
    }
    const content = paragraph.spans.map(spanToHtml).join("") || "<br>";
    const tag =
      paragraph.style === "heading1"
        ? "h1"
        : paragraph.style === "heading2"
          ? "h2"
          : paragraph.style === "bullet"
            ? "li"
            : "p";
    html.push(`<${tag}>${content}</${tag}>`);
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

function paragraphFromElement(element: Element): CampaignTextParagraph {
  return {
    style: element.tagName === "H1"
      ? "heading1"
      : element.tagName === "H2"
        ? "heading2"
        : "body",
    spans: spansFromNode(element),
  };
}

function spansFromNode(node: Node): CampaignTextSpan[] {
  const spans: CampaignTextSpan[] = [];
  walk(node, [], undefined, spans);
  return spans.length ? mergeAdjacentSpans(spans) : [{ text: "" }];
}

function walk(
  node: Node,
  marks: CampaignTextMark[],
  link: string | undefined,
  spans: CampaignTextSpan[],
) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (text) spans.push({ text, ...(marks.length ? { marks } : {}), ...(link ? { link } : {}) });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === "BR") {
    spans.push({ text: "\n", ...(marks.length ? { marks } : {}), ...(link ? { link } : {}) });
    return;
  }
  const nextMarks = [...marks];
  if (["STRONG", "B"].includes(node.tagName)) nextMarks.push("bold");
  if (["EM", "I"].includes(node.tagName)) nextMarks.push("italic");
  if (node.tagName === "U") nextMarks.push("underline");
  const nextLink = node.tagName === "A" ? node.getAttribute("href") || undefined : link;
  for (const child of node.childNodes) walk(child, [...new Set(nextMarks)], nextLink, spans);
}

function mergeAdjacentSpans(spans: CampaignTextSpan[]): CampaignTextSpan[] {
  const merged: CampaignTextSpan[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.link === span.link &&
      JSON.stringify(previous.marks || []) === JSON.stringify(span.marks || [])
    ) {
      previous.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function spanToHtml(span: CampaignTextSpan): string {
  let content = escapeHtml(span.text).replace(/\n/g, "<br>");
  for (const mark of span.marks || []) {
    if (mark === "bold") content = `<strong>${content}</strong>`;
    if (mark === "italic") content = `<em>${content}</em>`;
    if (mark === "underline") content = `<u>${content}</u>`;
  }
  if (span.link) content = `<a href="${escapeHtml(span.link)}">${content}</a>`;
  return content;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
