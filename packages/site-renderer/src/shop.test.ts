import { describe, expect, it } from "vitest";
import { generateSiteHtml } from "./index";

const base = { name: "Kieran", handle: "kieran" };
const pdf = { id: "0f1e2d3c-aaaa-bbbb-cccc-111122223333", name: "prompts.pdf", size: 4_200_000, type: "application/pdf" };
const setAt = "2026-10-27T10:00:00.000Z";

describe("shop for real products", () => {
  it("leads shop cards and product pages with the cover photo", async () => {
    const files = await generateSiteHtml({ ...base, products: [{ slug: "log", title: "The Captain's Log", price: 3500, currency: "GBP", images: ["files/content/log-cover.jpg", "files/content/log-inside.jpg"] }] }, []);
    expect(files["shop/index.html"]).toMatch(/class="shop-item-cover"[^>]*src="\.\.\/files\/content\/log-cover\.jpg"/);
    expect(files["shop/log.html"]).toContain('src="../files/content/log-cover.jpg"');
    expect(files["shop/log.html"]).toContain('src="../files/content/log-inside.jpg"');
    expect(files["shop/log.html"]).toContain("data-product-gallery");
  });

  it("keeps cover photos at their card shape when publish adds the photo's real width and height", async () => {
    const files = await generateSiteHtml({ ...base, products: [{ slug: "log", title: "The Captain's Log", price: 3500, currency: "GBP", images: ["files/content/log-cover.jpg"] }] }, []);
    // Published tags carry width="1024" height="1024"; without height:auto that height wins over aspect-ratio.
    expect(files["shop/index.html"]).toMatch(/\.shop-items \.shop-item-cover\{[^}]*width:100%;height:auto;aspect-ratio:4\/5/);
  });

  it("ignores unsafe photo paths", async () => {
    const files = await generateSiteHtml({ ...base, products: [{ slug: "x", title: "X", price: 500, currency: "GBP", images: ["javascript:alert(1)", "https://evil.example/a.jpg"] }] }, []);
    expect(files["shop/x.html"]).not.toContain("javascript:alert");
    expect(files["shop/x.html"]).not.toContain("evil.example");
  });

  it("links out for products sold on another platform", async () => {
    const files = await generateSiteHtml({ ...base, products: [{ slug: "book", title: "Book", price: 999, currency: "GBP", delivery: { kind: "external", instructions: "", url: "https://www.etsy.com/listing/1" } }] }, []);
    expect(files["shop/book.html"]).toContain('href="https://www.etsy.com/listing/1"');
    expect(files["shop/book.html"]).toContain("Buy on etsy.com");
    expect(files["shop/book.html"]).not.toContain("data-product-checkout");
    expect(files["shop/index.html"]).toContain("etsy.com");
  });

  it("sells downloads without asking for an address", async () => {
    const files = await generateSiteHtml({ ...base, products: [{ slug: "pdf", title: "Prompts", price: 500, currency: "GBP", delivery: { kind: "digital", instructions: "", file: pdf } }] }, []);
    expect(files["shop/pdf.html"]).toContain("data-product-checkout");
    expect(files["shop/pdf.html"]).not.toContain("Delivery address");
    expect(files["shop/pdf.html"]).toMatch(/PDF · 4\.2 MB/);
    expect(files["shop/index.html"]).toContain("Instant download");
  });

  it("shows copies left and sells out at zero", async () => {
    const few = await generateSiteHtml({ ...base, products: [{ slug: "log", title: "Log", price: 3500, currency: "GBP", stock: 3, stockSetAt: setAt }] }, []);
    expect(few["shop/log.html"]).toContain("Only 3 left");
    expect(few["shop/index.html"]).toContain("3 left");
    expect(few["shop/log.html"]).toContain("data-product-availability");
    const none = await generateSiteHtml({ ...base, products: [{ slug: "log", title: "Log", price: 3500, currency: "GBP", stock: 0, stockSetAt: setAt }] }, []);
    expect(none["shop/log.html"]).toContain("Sold out");
    expect(none["shop/index.html"]).toContain("Sold out");
  });

  it("lets buyers pick an option with its own price", async () => {
    const files = await generateSiteHtml({ ...base, products: [{ slug: "print", title: "Sunrise", price: 2000, currency: "GBP", stockSetAt: setAt, options: [{ id: "a4", label: "A4", price: 2000 }, { id: "a3", label: "A3", price: 3500 }, { id: "a2", label: "A2", price: 6000, stock: 0 }] }] }, []);
    const page = files["shop/print.html"];
    expect(page).toMatch(/name="optionId" value="a4"/);
    expect(page).toMatch(/value="a2"[^>]*disabled/);
    expect(page).toContain("£35");
    expect(files["shop/index.html"]).toContain("from £20");
    expect(files["shop/index.html"]).toContain("3 options");
  });

  // Failure modes: buyers face the details form before deciding to buy; the photo and the buy panel
  // don't sit side by side; prices read like ledger entries; phones lose the Buy action below the fold.
  it("leads the product page with the photo beside a buy panel and asks for details only after Buy", async () => {
    const tea = { slug: "tea", title: "Ceremony Tea", price: 1400, currency: "EUR", images: ["files/products/tea.jpg"], options: [{ id: "100g", label: "100 g pouch", price: 1400 }, { id: "250g", label: "250 g tin", price: 2850 }], delivery: { kind: "physical" as const, instructions: "Ships in 3 days.", shippingCost: 450, countries: ["IE"] } };
    const files = await generateSiteHtml({ ...base, products: [tea], extensions: { "me3.app/site": { theme: "me3" } } }, [{ name: "tea.md", content: "A calming blend." }]);
    const page = files["shop/tea.html"];
    expect(page).toMatch(/<div class="product"><div class="product__media">[\s\S]*data-product-gallery[\s\S]*<\/div><div class="product__panel"><h1>Ceremony Tea<\/h1>/);
    expect(page).toContain(">€14</p>");
    expect(page).toContain("€28.50");
    expect(page).toContain("€4.50");
    const start = page.indexOf("data-product-start");
    expect(start).toBeGreaterThan(-1);
    expect(page.indexOf('name="buyerEmail"')).toBeGreaterThan(start);
    expect(page).toMatch(/class="product-step" data-product-step hidden/);
    expect(page).toMatch(/class="site-action-dock"><button type="button" class="site-action-dock__button" data-product-dock>Buy now · €14<\/button>/);
    expect(files["shop/index.html"]).toContain("from €14");
  });

  it("shows no phone Buy bar when a product can't be bought", async () => {
    const files = await generateSiteHtml({ ...base, buttons: [{ text: "Say hello", url: "https://example.com" }], products: [{ slug: "mug", title: "Mug", price: 1800, currency: "EUR", stock: 0, stockSetAt: setAt }], extensions: { "me3.app/site": { theme: "me3" } } }, []);
    expect(files["shop/mug.html"]).not.toContain("data-product-dock");
    expect(files["shop/mug.html"]).toContain("Say hello");
  });

  // Failure modes: products never reach the home page; an owner can't hide them; sites saved before the
  // Shop section existed lose it; the shop page stays squeezed into the text column.
  describe("home Shop section", () => {
    const products = [1, 2, 3, 4, 5].map((n) => ({ slug: `p${n}`, title: `Product ${n}`, price: n * 1000, currency: "EUR", images: [`files/products/p${n}.jpg`] }));
    const site = (sections?: Array<{ id: string; visible: boolean }>) => generateSiteHtml({ ...base, products, shopTitle: "Shop", extensions: { "me3.app/site": { theme: "me3", ...(sections ? { sections } : {}) } } } as never, []);

    it("shows the first products with prices and a link to the whole shop", async () => {
      const home = (await site())["index.html"];
      expect(home).toContain('<section class="site-shop">');
      expect(home).toMatch(/<h2>Shop<\/h2><a href="\.\/shop\/">All products →<\/a>/);
      expect(home).toContain('href="./shop/p1"');
      expect(home).toContain('src="./files/products/p1.jpg"');
      expect(home).toContain("€1");
      expect(home).toContain('href="./shop/p3"');
      expect(home).not.toContain('href="./shop/p4"');
    });

    it("lets the owner hide or move it, and adds it after offers on sites saved without it", async () => {
      expect((await site([{ id: "shop", visible: false }, { id: "writing", visible: true }]))["index.html"]).not.toContain('<section class="site-shop">');
      const older = (await site([{ id: "writing", visible: true }, { id: "offers", visible: true }, { id: "newsletter", visible: true }]))["index.html"];
      expect(older).toContain('<section class="site-shop">');
      const moved = (await site([{ id: "shop", visible: true }, { id: "writing", visible: true }]))["index.html"];
      expect(moved).toContain('<section class="site-shop">');
    });

    it("leaves the home page alone when there are no products", async () => {
      const home = (await generateSiteHtml({ ...base, extensions: { "me3.app/site": { theme: "me3" } } }, []))["index.html"];
      expect(home).not.toContain('<section class="site-shop">');
    });

    it("gives the shop page its own wide layout", async () => {
      expect((await site())["shop/index.html"]).toContain('<main class="content content--shop">');
    });
  });

  // Failure modes: the chooser is missing on a "let them choose" offer, or appears on a card-only
  // or pay-directly one; the buyer's choice is not sent with the order or booking.
  it("asks how to pay only on a product that lets the buyer choose", async () => {
    const product = { slug: "print", title: "Print", price: 2500, currency: "EUR", delivery: { kind: "manual", instructions: "" } };
    const page = async (extra: Record<string, unknown>) => (await generateSiteHtml({ ...base, products: [{ ...product, ...extra }] } as never, []))["shop/print.html"];
    const choose = await page({ paymentMethod: "stripe", allowPayDirectly: true });
    expect(choose).toContain("How would you like to pay?");
    expect(choose).toContain('name="payChoice" value="direct"');
    expect(choose).toContain('"choose":true');
    expect(choose).toContain("payDirectly: direct || undefined");
    expect(await page({ paymentMethod: "stripe" })).not.toContain("data-pay-choice>");
    expect(await page({ paymentMethod: "stripe" })).toContain('"choose":false');
    // The flag means nothing on a pay-directly product.
    expect(await page({ paymentMethod: "manual", allowPayDirectly: true })).toContain('"choose":false');
  });

  it("offers the chooser on a booking that lets the buyer choose, and sends the choice", async () => {
    const book = (pricing: Record<string, unknown>) => ({ enabled: true, offers: [{ id: "intro", title: "Intro call", duration: 30, pricing: { enabled: true, suggestedAmount: 60, currency: "EUR", ...pricing } }], availability: { timezone: "Europe/Dublin", windows: { monday: ["09:00-12:00"] } } });
    const home = async (pricing: Record<string, unknown>) => (await generateSiteHtml({ ...base, intents: { book: book(pricing) } } as never, []))["index.html"];
    const choose = await home({ paymentMethod: "stripe", allowPayDirectly: true });
    expect(choose).toContain("data-pay-choice hidden");
    expect(choose).toContain('"paymentMethod":"stripe","allowPayDirectly":true');
    expect(choose).toContain("payload.payDirectly=true");
    expect(await home({ paymentMethod: "stripe" })).toContain('"paymentMethod":"stripe","allowPayDirectly":false');
    expect(await home({ paymentMethod: "manual", allowPayDirectly: true })).toContain('"paymentMethod":"manual","allowPayDirectly":false');
  });
});
