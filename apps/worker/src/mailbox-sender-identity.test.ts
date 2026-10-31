import { describe, expect, it } from "vitest";
import { cleanMailPreview, stripLeakedStyles } from "./mailbox-sender-identity";

// Failure modes: an ordinary email with one stray brace (a GitHub comment
// quoting code) makes the preview take seconds, so a page of inbound mail
// times out the Worker and Home's Inbox stays empty; or leaked stylesheets
// stop being removed from list previews.

// The pattern this replaced, kept as the reference for short inputs where it is still fast.
const PREVIOUS_CSS_AT_RULE = /@[a-z-]+[^{};]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi;
const PREVIOUS_CSS_RULE = /(?:^|\s)[^\s{};]+(?:\s*[,>+~]\s*[^\s{};]+|\s+[^\s{};]+)*\s*\{[^{}]*:[^{}]*\}/g;
const previousStrip = (text: string) => text.includes("{") ? text.replace(PREVIOUS_CSS_AT_RULE, " ").replace(PREVIOUS_CSS_RULE, " ") : text;

describe("stripLeakedStyles", () => {
  it("removes leaked rules and media queries", () => {
    const text = "@media (max-width: 600px) { .a { color: red } } body, td > p { margin: 0; } Hello Sam, your order shipped.";
    expect(cleanMailPreview(text)).toBe("Hello Sam, your order shipped.");
  });

  it("strips exactly what the previous pattern stripped", () => {
    const pieces = ["a", "b,c", "x+y", " ", "  ", "\n", "{", "}", ";", ":", "p", "color: red", "@media"];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 3000; run += 1) {
      const text = Array.from({ length: 1 + Math.floor(next() * 14) }, () => pieces[Math.floor(next() * pieces.length)]).join("");
      expect(stripLeakedStyles(text), JSON.stringify(text)).toBe(previousStrip(text));
    }
  });

  it("stays fast on prose with a stray brace", () => {
    const words = Array.from({ length: 600 }, (_, index) => `word${index},a+b`).join(" ");
    const text = `${words} \`{ "handled": true }\` ${words} {`;
    const started = performance.now();
    cleanMailPreview(text);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
