import { describe, expect, it } from "vitest";
import { findInlineImageIds, normalizeContentId, replaceInlineImages } from "./inlineImages";

// Guards against: a sender's embedded logo or screenshot never showing, because the HTML points at
// cid:<id> while the attachment carries Content-ID "<id>".
describe("inline email images", () => {
  const html = `<p>Hi</p><img src="cid:Logo%40example.com"><img src='cid:shot-1'><div style="background:url(cid:shot-1)"></div><img src="https://example.com/a.png">`;

  it("matches a cid reference to its attachment's Content-ID", () => {
    expect(normalizeContentId("<Logo@example.com>")).toBe("logo@example.com");
    expect(findInlineImageIds(html)).toEqual(["logo@example.com", "shot-1"]);
  });

  it("swaps loaded pictures in and leaves everything else untouched", () => {
    const rendered = replaceInlineImages(html, { "logo@example.com": "blob:logo" });
    expect(rendered).toContain(`<img src="blob:logo">`);
    expect(rendered).toContain(`<img src='cid:shot-1'>`);
    expect(rendered).toContain(`https://example.com/a.png`);
    expect(replaceInlineImages(html, undefined)).toBe(html);
  });
});
