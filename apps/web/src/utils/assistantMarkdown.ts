type ListKind = "ol" | "ul";

const SAFE_HREF_PATTERN =
  /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#|[A-Za-z0-9._~!$&'()*+,;=@%-]+(?:\/|$))/i;

export function renderAssistantMarkdown(text: string): string {
  text = normalizeAssistantHtml(text);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraphLines: string[] = [];
  let listLines: string[] = [];
  let blockquoteLines: string[] = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    html.push(
      `<p>${renderInlineMarkdown(paragraphLines.join("\n")).replace(/\n/g, "<br>")}</p>`,
    );
    paragraphLines = [];
  }

  function flushList() {
    if (listLines.length) html.push(renderListLines(listLines));
    listLines = [];
  }

  function flushBlockquote() {
    if (!blockquoteLines.length) return;
    html.push(
      `<blockquote>${renderAssistantMarkdown(blockquoteLines.join("\n"))}</blockquote>`,
    );
    blockquoteLines = [];
  }

  function flushBlocks() {
    flushParagraph();
    flushList();
    flushBlockquote();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushBlocks();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushBlocks();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      html.push(
        `<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`,
      );
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushBlocks();
      html.push("<hr>");
      continue;
    }

    if (/^\s*(?:[-*+]|\d+[.)])\s+.+$/.test(line)) {
      flushParagraph();
      flushBlockquote();
      listLines.push(line);
      continue;
    }
    if (listLines.length && /^\s+\S/.test(line)) {
      listLines.push(line);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blockquoteLines.push(quote[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraphLines.push(line);
  }

  flushBlocks();
  return html.join("");
}

// Keep list children and continuation lines inside their parent <li>.
function renderListLines(lines: string[]): string {
  let index = 0;
  const matchItem = (line: string) => line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
  function renderLevel(indent: number): string {
    let output = "";
    while (index < lines.length) {
      const first = matchItem(lines[index]);
      if (!first || first[1].length !== indent) break;
      const kind: ListKind = /^\d/.test(first[2]) ? "ol" : "ul";
      output += `<${kind}>`;
      while (index < lines.length) {
        const item = matchItem(lines[index]);
        if (!item || item[1].length !== indent || (/^\d/.test(item[2]) ? "ol" : "ul") !== kind) break;
        output += `<li>${renderInlineMarkdown(item[3])}`;
        index += 1;
        while (index < lines.length) {
          const child = matchItem(lines[index]);
          if (child) {
            if (child[1].length <= indent) break;
            output += renderLevel(child[1].length);
          } else {
            output += `<br>${renderInlineMarkdown(lines[index].trim())}`;
            index += 1;
          }
        }
        output += "</li>";
      }
      output += `</${kind}>`;
    }
    return output;
  }
  return renderLevel(matchItem(lines[0])?.[1].length || 0);
}

function normalizeAssistantHtml(text: string): string {
  if (!/<\s*(?:p|div|br|h[1-6]|ul|ol|li|strong|b|em|i|del|s|a|pre|code)(?:\s|\/?>)/i.test(text)) {
    return text;
  }

  const document = new DOMParser().parseFromString(`<body>${text}</body>`, "text/html");
  const body = document.body;

  function visit(node: Node, inPre = false, inListItem = false): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return "";
    if (tag === "br") return "\n";
    if (tag === "pre") return `\n\n\`\`\`\n${visitChildren(element, true).trim()}\n\`\`\`\n\n`;
    if (tag === "li") return `\n- ${visitChildren(element, false, true).trim()}\n`;

    const content = visitChildren(element, inPre, inListItem);
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `_${content}_`;
    if (tag === "del" || tag === "s") return `~~${content}~~`;
    if (tag === "code" && !inPre) return `\`${content}\``;
    if (tag === "a") {
      const href = element.getAttribute("href") || "";
      return `[${content}](${href})`;
    }
    if (/^h[1-6]$/.test(tag)) return `\n${"#".repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === "p") return `${content.trim()} `;
    if (tag === "div" && inListItem) return content;
    if (["p", "div", "ul", "ol"].includes(tag)) return `\n${content.trim()}\n\n`;
    return content;
  }

  function visitChildren(element: Element, inPre = false, inListItem = false): string {
    return Array.from(element.childNodes).map((child) => visit(child, inPre, inListItem)).join("");
  }

  return visitChildren(body).replace(/\n{3,}/g, "\n\n").trim();
}

function renderInlineMarkdown(text: string): string {
  const parts = text.split(/(`[^`\n]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return renderInlineLinks(part);
    })
    .join("");
}

function renderInlineLinks(text: string): string {
  const pieces: string[] = [];
  const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text))) {
    pieces.push(renderInlineMarks(text.slice(lastIndex, match.index)));
    const href = sanitizeHref(match[2]);
    if (href) {
      pieces.push(
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${renderInlineMarks(match[1])}</a>`,
      );
    } else {
      pieces.push(renderInlineMarks(match[0]));
    }
    lastIndex = match.index + match[0].length;
  }

  pieces.push(renderInlineMarks(text.slice(lastIndex)));
  return pieces.join("");
}

function renderInlineMarks(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n][\s\S]*?[^_\n])__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n][\s\S]*?[^~\n])~~/g, "<del>$1</del>")
    .replace(/\*([^*\n][^*\n]*?[^*\n])\*/g, "<em>$1</em>")
    .replace(/_([^_\n][^_\n]*?[^_\n])_/g, "<em>$1</em>");
}

function sanitizeHref(value: string): string | null {
  const href = value.trim();
  const explicitProtocol = href.match(/^([a-z][a-z0-9+.-]*):/i);
  if (
    explicitProtocol &&
    !["http:", "https:", "mailto:", "tel:"].includes(
      explicitProtocol[0].toLowerCase(),
    )
  ) {
    return null;
  }
  if (!href || !SAFE_HREF_PATTERN.test(href)) return null;
  return href;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
