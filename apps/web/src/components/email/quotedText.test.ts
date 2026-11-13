import { describe, expect, it } from "vitest";
import { collapseQuotedHtml, isEmbeddedPicture, splitQuotedText } from "./quotedText";

// Failure modes (me3-kvu8.22): every message repeats the whole conversation below it; a message
// that is only a forward or a quote shows nothing at all; a blockquote the sender used for
// ordinary content is hidden; the sender's signature disappears with the quote; a picture the
// email shows in place is listed again as an attachment, or a real attachment is hidden.
describe("trimmed quoted text", () => {
  it("splits a plain reply from the history under it", () => {
    const text = "Yes, the terms work.\n\nJordan\n\nOn 13 Nov 2026, Rosa Alvarez wrote:\n> Here is the floor plan.\n> Reply to confirm.";
    expect(splitQuotedText(text)).toEqual({ body: "Yes, the terms work.\n\nJordan", quoted: "On 13 Nov 2026, Rosa Alvarez wrote:\n> Here is the floor plan.\n> Reply to confirm." });
    // A quote line with no "wrote:" line still counts when it runs to the end.
    expect(splitQuotedText("Thanks.\n\n> earlier words\n> more")).toEqual({ body: "Thanks.", quoted: "> earlier words\n> more" });
  });

  it("leaves a message alone when there is nothing above the quote, or the quote is in the middle", () => {
    const onlyQuote = "On 13 Nov 2026, Rosa wrote:\n> Here is the floor plan.";
    expect(splitQuotedText(onlyQuote)).toEqual({ body: onlyQuote, quoted: "" });
    const inline = "You asked:\n> can we paint it?\nYes, go ahead.";
    expect(splitQuotedText(inline)).toEqual({ body: inline, quoted: "" });
    expect(splitQuotedText("No quote here.")).toEqual({ body: "No quote here.", quoted: "" });
  });

  it("folds a mail client's quoted history behind a toggle and keeps the signature", () => {
    const html = `<div>Yes, that works.</div><div class="signature">Rosa · Harbour Lets</div><div class="gmail_quote"><div>On 13 Nov, Jordan wrote:</div><blockquote>Can we move it?</blockquote></div>`;
    const folded = collapseQuotedHtml(html);
    expect(folded).toContain("<details");
    expect(folded.indexOf("Rosa · Harbour Lets")).toBeLessThan(folded.indexOf("<details"));
    expect(folded.indexOf("Can we move it?")).toBeGreaterThan(folded.indexOf("<details"));
    expect(folded).toContain("Show quoted text");
    // Apple Mail and Thunderbird mark the quote on the blockquote itself.
    expect(collapseQuotedHtml(`<p>Sure.</p><blockquote type="cite"><p>Earlier</p></blockquote>`)).toMatch(/<p>Sure\.<\/p>\s*<details[\s\S]*Earlier/);
  });

  it("does not fold ordinary blockquotes, or a message that is nothing but the quote", () => {
    const pullQuote = `<p>Our founder says:</p><blockquote>Ship it.</blockquote><p>More news below.</p>`;
    expect(collapseQuotedHtml(pullQuote)).toBe(pullQuote);
    const forwardOnly = `<div class="gmail_quote"><div>---------- Forwarded message ---------</div><p>The original</p></div>`;
    expect(collapseQuotedHtml(forwardOnly)).toBe(forwardOnly);
  });

  it("knows a picture the email shows in place from a real attachment", () => {
    const html = `<p>Plan:</p><img src="cid:plan@harbour">`;
    expect(isEmbeddedPicture({ filename: "plan.png", mimeType: "image/png", contentId: "<plan@harbour>" }, html)).toBe(true);
    expect(isEmbeddedPicture({ filename: "terms.pdf", mimeType: "application/pdf", contentId: "<plan@harbour>" }, html)).toBe(false);
    expect(isEmbeddedPicture({ filename: "photo.jpg", mimeType: "image/jpeg", contentId: "<other@harbour>" }, html)).toBe(false);
    expect(isEmbeddedPicture({ filename: "photo.jpg", mimeType: "image/jpeg", contentId: null }, html)).toBe(false);
    expect(isEmbeddedPicture({ filename: "plan.png", mimeType: "image/png", contentId: "<plan@harbour>" }, null)).toBe(false);
  });
});
