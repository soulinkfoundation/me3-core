import TurndownService from "turndown";
import { renderMailMarkdownFragment } from "../../../../../shared/mail-markdown";

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    br: "",
  });
  // Keep list items tight ("- item", not "-   item") so the stored body reads
  // like a normal plain-text email.
  turndown.addRule("mailListItem", {
    filter: "li",
    replacement(content, node) {
      const parent = node.parentNode as HTMLElement | null;
      let prefix = "- ";
      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start") || 1);
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
      return `${prefix}${body}${node.nextSibling ? "\n" : ""}`;
    },
  });
  return turndown;
}

/** Editor HTML (from Tiptap) → stored Markdown body. */
export function mailEditorHtmlToMarkdown(html: string): string {
  return getTurndown()
    .turndown(html)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Stored Markdown body → HTML the editor can load. */
export function mailMarkdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return renderMailMarkdownFragment(markdown, { inlineStyles: false });
}

/**
 * Some apps put Markdown into the HTML clipboard as plain paragraphs. Only
 * prefer our Markdown conversion when the HTML has no real formatting.
 */
export function pastedHtmlNeedsMarkdown(html: string): boolean {
  return !/<(strong|b|em|i|ul|ol|li|a|h[1-6]|blockquote)[\s>]/i.test(html);
}
