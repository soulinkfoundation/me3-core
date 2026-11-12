// Mail bodies are stored as light Markdown (what people and the agent write).
// This renders that Markdown into safe email HTML and a clean plain-text
// alternative. Shared by the web compose editor and the Worker send path, so
// what the owner sees while writing is what the recipient gets.

export interface RenderedMailBody {
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^www\./i.test(href)) return `https://${href}`;
  return null;
}

const LINK_STYLE = "color:#1a73e8;";

function renderInline(value: string): string {
  // Pull out links first so their URLs are not touched by emphasis rules.
  const tokens: string[] = [];
  const stash = (html: string) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };
  let source = value.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
    const href = safeHref(url);
    if (!href) return match;
    return stash(`<a href="${escapeHtml(href)}" style="${LINK_STYLE}">${renderEmphasis(escapeHtml(label))}</a>`);
  });
  source = source.replace(/<((?:https?:\/\/|mailto:)[^\s>]+)>/g, (_match, url: string) =>
    stash(`<a href="${escapeHtml(url)}" style="${LINK_STYLE}">${escapeHtml(url)}</a>`),
  );
  source = source.replace(/\b(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (_match, url: string) =>
    stash(`<a href="${escapeHtml(url)}" style="${LINK_STYLE}">${escapeHtml(url)}</a>`),
  );
  const html = renderEmphasis(escapeHtml(source));
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] || "");
}

function renderEmphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/\\([*_\\[\]()#>\-+.!`])/g, "$1");
}

type Block =
  | { type: "p"; lines: string[] }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "h"; level: number; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "hr" };

const BULLET = /^\s*[-*+•]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      // A blank line ends the block; "loose" lists are re-joined below.
      flush();
      continue;
    }
    const quote = line.match(QUOTE);
    if (quote) {
      if (current?.type !== "quote") {
        flush();
        current = { type: "quote", lines: [] };
      }
      current.lines.push(quote[1]);
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "hr" });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({ type: "h", level: heading[1].length, text: heading[2] });
      continue;
    }
    const bullet = line.match(BULLET);
    const ordered = bullet ? null : line.match(ORDERED);
    if (bullet || ordered) {
      const type = bullet ? "ul" : "ol";
      const text = (bullet || ordered)![1];
      const previous = blocks[blocks.length - 1];
      if (current?.type !== type) {
        flush();
        // Re-join a list that was split by a single blank line.
        if (previous?.type === type) {
          blocks.pop();
          current = previous;
        } else {
          current = { type, items: [] };
        }
      }
      (current as { items: string[] }).items.push(text);
      continue;
    }
    if ((current?.type === "ul" || current?.type === "ol") && /^\s{2,}\S/.test(rawLine)) {
      const items = current.items;
      items[items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    if (current?.type !== "p") {
      flush();
      current = { type: "p", lines: [] };
    }
    current.lines.push(line.trim());
  }
  flush();
  return blocks;
}

const P_STYLE = "margin:0 0 14px;";
const LIST_STYLE = "margin:0 0 14px;padding-left:24px;";
const LI_STYLE = "margin:0 0 4px;";
const QUOTE_STYLE = "margin:0 0 14px;padding:0 0 0 12px;border-left:3px solid #d0d4da;color:#555b66;";

function renderLines(lines: string[]): string {
  return lines.map(renderInline).join("<br>");
}

/** Render a Markdown mail body to an HTML fragment (no document wrapper). */
export function renderMailMarkdownFragment(markdown: string, options: { inlineStyles?: boolean } = {}): string {
  const styled = options.inlineStyles !== false;
  const style = (value: string) => (styled ? ` style="${value}"` : "");
  return parseBlocks(markdown)
    .map((block) => {
      switch (block.type) {
        case "p":
          return `<p${style(P_STYLE)}>${renderLines(block.lines)}</p>`;
        case "ul":
        case "ol":
          return `<${block.type}${style(LIST_STYLE)}>${block.items
            .map((item) => `<li${style(LI_STYLE)}>${renderLines(item.split("\n"))}</li>`)
            .join("")}</${block.type}>`;
        case "h": {
          const level = Math.min(Math.max(block.level, 2), 4);
          const size = level === 2 ? 20 : level === 3 ? 17 : 15;
          return `<h${level}${style(`margin:18px 0 10px;font-size:${size}px;line-height:1.3;`)}>${renderInline(block.text)}</h${level}>`;
        }
        case "quote":
          return `<blockquote${style(QUOTE_STYLE)}>${renderMailMarkdownFragment(block.lines.join("\n"), options)}</blockquote>`;
        case "hr":
          return `<hr${style("border:0;border-top:1px solid #e3e5e8;margin:18px 0;")}>`;
      }
    })
    .join("\n");
}

/** Plain-text alternative: keeps list markers and links, drops emphasis syntax. */
export function mailMarkdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)[*+•]\s+/, "$1- ")
        .replace(/^#{1,6}\s+(.+?)\s*#*\s*$/, "$1")
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) =>
          label.trim() === url.trim() ? url : `${label} (${url})`,
        )
        .replace(/\*\*(?=\S)(.*?\S)\*\*/g, "$1")
        .replace(/__(?=\S)(.*?\S)__/g, "$1")
        .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1$2")
        .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, "$1$2")
        .replace(/\\([*_\\[\]()#>\-+.!`])/g, "$1"),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Full outbound body: HTML document + plain-text alternative. */
export function renderMailMarkdown(markdown: string): RenderedMailBody {
  const fragment = renderMailMarkdownFragment(markdown);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;"><div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2328;">${fragment}</div></body></html>`;
  return { html, text: mailMarkdownToPlainText(markdown) };
}

/** True when pasted plain text carries Markdown worth converting. */
export function looksLikeMailMarkdown(text: string): boolean {
  return (
    /\*\*[^*\n]+\*\*/.test(text) ||
    /^\s*[-*+•]\s+\S/m.test(text) ||
    /^\s*\d+[.)]\s+\S/m.test(text) ||
    /^#{1,6}\s+\S/m.test(text) ||
    /\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/.test(text)
  );
}
