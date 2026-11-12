import { describe, expect, it } from "vitest";
import {
  looksLikeMailMarkdown,
  mailMarkdownToPlainText,
  renderMailMarkdown,
  renderMailMarkdownFragment,
} from "../../../../../shared/mail-markdown";
import {
  mailEditorHtmlToMarkdown,
  mailMarkdownToEditorHtml,
  pastedHtmlNeedsMarkdown,
} from "./mailComposeMarkdown";

const outreach = `Hi Aoife,

I'm building **ME3**, an all-in-one tool for one-person practices:

- Website and bookings
- Email and campaigns
* Accounts

1. Reply to this email
2. Book a call at https://me3.app/demo.

Thanks,
Kieran`;

describe("mail markdown", () => {
  it("renders bold, lists, links and line breaks as email HTML", () => {
    const html = renderMailMarkdownFragment(outreach, { inlineStyles: false });
    expect(html).toContain("<strong>ME3</strong>");
    expect(html).toContain("<ul><li>Website and bookings</li><li>Email and campaigns</li><li>Accounts</li></ul>");
    expect(html).toContain("<ol><li>Reply to this email</li>");
    expect(html).toContain('<a href="https://me3.app/demo"');
    expect(html).toContain("</a>.</li>");
    expect(html).toContain("<p>Thanks,<br>Kieran</p>");
  });

  it("escapes HTML and drops unsafe link protocols", () => {
    const html = renderMailMarkdownFragment("<script>x</script> [click](javascript:alert(1))");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript');
  });

  it("produces a clean plain-text alternative", () => {
    const { text, html } = renderMailMarkdown(outreach);
    expect(html).toMatch(/^<!doctype html>/);
    expect(text).toContain("I'm building ME3, an all-in-one");
    expect(text).toContain("- Accounts");
    expect(text).not.toContain("**");
    expect(mailMarkdownToPlainText("See [the demo](https://me3.app)")).toBe("See the demo (https://me3.app)");
  });

  it("renders quoted reply text as a blockquote", () => {
    const html = renderMailMarkdownFragment("Sounds good.\n\n> On Monday, Kim wrote:\n> Hello", { inlineStyles: false });
    expect(html).toContain("<blockquote><p>On Monday, Kim wrote:<br>Hello</p></blockquote>");
  });

  it("detects pasted Markdown", () => {
    expect(looksLikeMailMarkdown("Some **bold** text")).toBe(true);
    expect(looksLikeMailMarkdown("- one\n- two")).toBe(true);
    expect(looksLikeMailMarkdown("Plain sentence, nothing else.")).toBe(false);
    expect(pastedHtmlNeedsMarkdown("<p>**bold**</p>")).toBe(true);
    expect(pastedHtmlNeedsMarkdown("<p><strong>bold</strong></p>")).toBe(false);
  });

  it("round-trips editor HTML through the stored Markdown body", () => {
    const editorHtml =
      "<p>Hi <strong>Kim</strong>, see <a href=\"https://me3.app\">ME3</a>.</p><ul><li><p>One</p></li><li><p>Two <em>now</em></p></li></ul><p>Thanks,<br>Kieran</p>";
    const markdown = mailEditorHtmlToMarkdown(editorHtml);
    expect(markdown).toBe("Hi **Kim**, see [ME3](https://me3.app).\n\n- One\n- Two *now*\n\nThanks,\nKieran");
    const reloaded = mailMarkdownToEditorHtml(markdown);
    expect(reloaded).toContain("<strong>Kim</strong>");
    expect(reloaded).toContain("<li>Two <em>now</em></li>");
    expect(reloaded).toContain("Thanks,<br>");
  });
});
