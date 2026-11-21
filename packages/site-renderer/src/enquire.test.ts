import { describe, expect, it } from "vitest";
import { generateSiteHtml } from "./index";

// Failure modes: a paid offer nobody can pay for yet still shows Book or Buy and sends buyers into
// a checkout that fails; the Enquire offer stays in the booking widget, so the Book buttons beside it
// open the wrong offer; an enquireUrl on a free offer hides its booking; a crafted enquireUrl
// (javascript:) lands in the page; once the offer can be paid for, Book and Buy don't come back.

const ENQUIRE = "/api/enquire/maya?about=Retreat";

const site = (enquire: boolean) => ({
  name: "Maya", handle: "maya",
  extensions: { "me3.app/site": { sections: [{ id: "offers", visible: true }], primaryAction: { kind: "offer", id: "dartmoor" } } },
  intents: { book: {
    enabled: true,
    bookingTypes: [
      { id: "retreat", type: "retreat", retreats: [
        { id: "dartmoor", title: "Retreat", startDate: "2027-03-13", endDate: "2027-03-15", pageSlug: "dartmoor", pricing: { enabled: true, suggestedAmount: 40000, currency: "GBP" }, ...(enquire ? { enquireUrl: ENQUIRE } : {}) },
        { id: "workshop", title: "Workshop", startDate: "2027-04-10", endDate: "2027-04-10", pricing: { enabled: true, suggestedAmount: 4000, currency: "GBP" } },
      ] },
    ],
  } },
  products: [{ slug: "kit", title: "Kit", price: 4900, currency: "GBP", ...(enquire ? { enquireUrl: "/api/enquire/maya?about=Kit" } : {}) }],
});

describe("Enquire for paid offers nobody can pay for yet", () => {
  it("lays Enquire cards out two to a row, one per row on phones", async () => {
    const files = await generateSiteHtml(site(true) as any, [], { offerPagesEnabled: true });
    const css = Object.values(files).join("\n");
    expect(css).toContain(".booking-enquire-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(css).toContain(".booking-enquire-list:has(.booking-card:only-child){grid-template-columns:1fr}");
    expect(css).toContain("@media (max-width:560px){.booking-enquire-list{grid-template-columns:1fr}}");
    // Full-width cards with padding would spill into the next column without border-box.
    expect(css).toContain(".booking-card.booking-card--enquire{box-sizing:border-box;");
  });

  it("replaces Book and Buy with Enquire, and keeps the other offers bookable", async () => {
    const files = await generateSiteHtml(site(true) as any, [], { offerPagesEnabled: true });
    const home = files["index.html"];
    expect(home).toContain(`<a class="site-offer__enquire" href="${ENQUIRE}" rel="nofollow" aria-label="Enquire: Retreat">Enquire</a>`);
    // The workshop is the only offer left in the widget, so its Book button opens card 0.
    expect(home).toContain('data-offer-book-type="retreat" data-offer-book="0" aria-label="Reserve a place: Workshop"');
    expect(home).toMatch(/<div class="booking-enquire-list"><div class="booking-card booking-card--enquire"><strong>Retreat<\/strong>/);
    expect(home).not.toMatch(/data-event-booking-config>[^<]*"dartmoor"/);
    expect(home).toMatch(new RegExp(`href="${ENQUIRE.replace(/[?]/g, "\\?")}"[^>]*>Enquire</a>`));
    expect(files["dartmoor.html"]).toContain(`<a class="offer-page__cta" href="${ENQUIRE}" rel="nofollow">Enquire</a>`);
    expect(files["dartmoor.html"]).not.toContain("data-event-booking-widget");

    const product = files["shop/kit.html"];
    expect(product).toContain('<a class="product-buy" href="/api/enquire/maya?about=Kit" rel="nofollow">Enquire</a>');
    expect(product).toContain('<a class="site-action-dock__button" href="/api/enquire/maya?about=Kit" rel="nofollow">Enquire</a>');
    // Must out-specify the shared `.content a{color:var(--accent)}` link rule, or the label is accent-on-accent.
    expect(product).toContain(".content a.product-buy");
    expect(product).not.toContain("data-product-checkout");
  });

  it("shows Book and Buy again once the offer can be paid for", async () => {
    const files = await generateSiteHtml(site(false) as any, [], { offerPagesEnabled: true });
    const home = files["index.html"];
    expect(home).not.toContain("/api/enquire/");
    expect(home).not.toContain('<div class="booking-enquire-list">');
    expect(home).toContain('data-offer-book-type="retreat" data-offer-book="0" aria-label="Reserve a place: Retreat"');
    expect(home).toContain('data-offer-book-type="retreat" data-offer-book="1" aria-label="Reserve a place: Workshop"');
    expect(files["dartmoor.html"]).toContain('<a class="offer-page__cta" href="#booking">');
    expect(files["shop/kit.html"]).toContain("data-product-checkout");
    expect(files["shop/kit.html"]).toContain("Buy now · £49");
  });

  it("ignores enquireUrl on free offers and unsafe links", async () => {
    const files = await generateSiteHtml({
      name: "Maya", handle: "maya",
      extensions: { "me3.app/site": { sections: [{ id: "offers", visible: true }] } },
      intents: { book: { enabled: true, bookingTypes: [{ id: "one_to_one", type: "one_to_one", offers: [
        { id: "free", title: "Intro call", duration: 20, enquireUrl: ENQUIRE },
        { id: "paid", title: "Session", duration: 60, pricing: { enabled: true, suggestedAmount: 5000, currency: "GBP" }, enquireUrl: "javascript:alert(1)" },
      ] }] } },
      products: [{ slug: "kit", title: "Kit", price: 4900, currency: "GBP", enquireUrl: "https://evil.example" }],
    } as any, []);
    expect(files["index.html"]).not.toContain("/api/enquire/");
    expect(files["index.html"]).not.toContain("javascript:alert");
    expect(files["shop/kit.html"]).not.toContain("evil.example");
    expect(files["shop/kit.html"]).toContain("data-product-checkout");
  });
});
