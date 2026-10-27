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
    expect(page).toContain("35.00 GBP");
    expect(files["shop/index.html"]).toContain("from 20.00 GBP");
    expect(files["shop/index.html"]).toContain("3 options");
  });
});
