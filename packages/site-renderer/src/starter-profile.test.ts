import { describe, expect, it } from "vitest";
import { renderStarterProfileHtml, siteThemes, type Me3SiteProfile, type SiteLayout } from "./index";

// Failure modes: forbidden authoring fields reaching HTML, lost/reordered links,
// private content leaking, and an unsupported combination of theme/layout.
describe("starter profile rendering", () => {
  const layouts: SiteLayout[] = ["classic", "portrait", "card", "split", "cover", "minimal"];
  const forbidden: Me3SiteProfile = {
    pages: [{ slug: "secret-page", title: "Secret page", file: "page.md" }],
    posts: [{ slug: "secret-post", title: "Secret post" }],
    products: [{ slug: "secret-product", title: "Secret product", regionalPrices: [{ country: "IE", currency: "EUR", amount: 100 }] }],
    testimonials: [{ quote: "Secret testimonial" }],
    intents: { book: { enabled: true }, subscribe: { enabled: true }, gift: { enabled: true } },
    business: { positioningStatement: "Secret business" },
    footer: { text: "Secret footer" },
  };

  for (const theme of Object.keys(siteThemes) as Array<keyof typeof siteThemes>) {
    it.each(layouts)(`renders ${theme}/%s without installation features`, async (layout) => {
      for (const buttons of [[], Array.from({ length: 100 }, (_, index) => ({ text: `Button ${index}`, url: `https://example.com/${index}` }))]) {
        const profile: Me3SiteProfile = {
          ...forbidden, name: "Starter", buttons, links: { website: "https://example.com", _blog_path: "secret-path" },
          extensions: { "me3.app/site": { theme, layout, sections: [{ id: "testimonials", visible: true }], primaryAction: { kind: "subscribe" } } },
        };
        const output = await renderStarterProfileHtml(profile, { baseUrl: "https://example.com/starter" });
        expect(Object.keys(output)).toEqual(["index.html"]);
        const html = output["index.html"];
        const renderedLayout = layout === "classic" ? "card" : layout === "portrait" ? "split" : layout;
        expect(html).toContain(`data-layout="${renderedLayout}"`);
        expect(html).toContain(`data-vibe="${theme}"`);
        expect(html).toContain('href="https://example.com/starter/me.json"');
        // Shared CSS contains installation selectors; the actual markup must not.
        const markup = html.replace(/<style>[\s\S]*?<\/style>/g, "");
        expect(markup.match(/Secret|secret-path|<form\b|data-booking|data-product-checkout|href="[^\"]*(?:blog|shop|testimonials)/)).toBeNull();
        if (buttons.length) {
          const rendered = [...html.matchAll(/class="cta-button [^\"]*" href="https:\/\/example.com\/(\d+)"/g)].map(match => Number(match[1]));
          expect(rendered).toEqual(Array.from({ length: 100 }, (_, index) => index));
        }
      }
    });
  }

  it("renders a name-only profile and protects private profiles", async () => {
    expect((await renderStarterProfileHtml({ name: "Starter" }))["index.html"]).toContain("Starter");
    expect(await renderStarterProfileHtml({ name: "Private", visibility: "private" })).toEqual({});
  });

  it("keeps safe bio formatting and rejects executable links", async () => {
    const output = await renderStarterProfileHtml({ name: "<script>unsafe-name()</script>", bio: '<p>Hi<script>unsafe-bio()</script></p>', buttons: [{ text: "<img onerror=unsafe-label()>", url: "javascript:unsafe-link()" }] });
    const html = output["index.html"];
    expect(html).not.toContain('<script>unsafe-name()');
    expect(html).not.toContain('unsafe-bio()');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img onerror=');
  });
});
