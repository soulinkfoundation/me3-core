import { describe, expect, it } from "vitest";
import { generateSiteHtml } from "./index";

type Node = Record<string, any>;

const baseUrl = "https://niamh.example";
const hairdresser = {
  name: "Niamh Byrne Hair",
  handle: "niamh",
  bio: "Colour, cuts and blow-dries in a calm little studio.",
  avatar: "./files/avatar.jpg",
  location: "Galway, County Galway, Éire / Ireland",
  locationData: { label: "Galway, County Galway, Éire / Ireland", latitude: 53.27, longitude: -9.05, precision: "city", locality: "Galway", region: "County Galway", country: "Éire / Ireland", countryCode: "IE" },
  links: { instagram: "niamhbyrnehair", email: "niamh@example.com", _layout: "card" },
  shopTitle: "Products",
  intents: { book: {
    enabled: true,
    availability: { timezone: "Europe/Dublin", windows: { tuesday: ["09:00-13:00", "14:00-18:00"], wednesday: ["09:00-13:00", "14:00-18:00"], saturday: ["10:00-16:00"] } },
    offers: [
      { id: "cut", title: "Cut & blow-dry", description: "Wash, cut and finish.", duration: 60, pricing: { enabled: true, suggestedAmount: 55, currency: "EUR", allowFlexiblePricing: false } },
      { id: "colour", title: "Full colour", description: "Root to tip, with a toner.", duration: 120, pricing: { enabled: true, suggestedAmount: 95, currency: "EUR", allowFlexiblePricing: false } },
    ],
  } },
  products: [
    { slug: "argan-finishing-oil", title: "Argan finishing oil", excerpt: "The one I use on every blow-dry.", price: 2400, currency: "EUR", images: ["files/content/oil.webp"], available: true },
    { slug: "gift-voucher", title: "Gift voucher", excerpt: "For a cut, colour or treat of their choice.", price: 5000, currency: "EUR", available: true },
  ],
};

/** Every JSON-LD block on a page, parsed. */
function blocks(html: string): Node[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) => JSON.parse(match[1]));
}

function graph(html: string): Node[] {
  const [block] = blocks(html);
  return block["@graph"];
}

const ofType = (nodes: Node[], type: string) => nodes.filter((node) => node["@type"] === type);
const render = (profile: object, capabilities?: object) => generateSiteHtml(profile as never, [], capabilities as never, { baseUrl });

describe("schema.org structured data", () => {
  it("emits exactly one JSON-LD block per page, with every @id used once", async () => {
    const output = await render(hairdresser);
    for (const [file, html] of Object.entries(output)) {
      if (!file.endsWith(".html")) continue;
      expect(blocks(html), file).toHaveLength(1);
      const ids = graph(html).map((node) => node["@id"]).filter(Boolean);
      expect(new Set(ids).size, file).toBe(ids.length);
    }
  });

  it("describes a business with bookable services as a ProfessionalService the profile page is about", async () => {
    const nodes = graph((await render(hairdresser))["index.html"]);
    const [page] = ofType(nodes, "ProfilePage");
    const [business] = ofType(nodes, "ProfessionalService");
    expect(page.mainEntity).toEqual({ "@id": `${baseUrl}/#identity` });
    expect(business).toMatchObject({ "@id": `${baseUrl}/#identity`, name: "Niamh Byrne Hair", url: `${baseUrl}/`, image: `${baseUrl}/files/avatar.jpg` });
    expect(ofType(nodes, "Person")).toHaveLength(0);
    expect(business.makesOffer).toHaveLength(4);
    for (const ref of business.makesOffer) expect(nodes.flatMap((node) => [node.offers?.["@id"]])).toContain(ref["@id"]);
  });

  it("gives the address and area served from the location, and sameAs from social links", async () => {
    const [business] = ofType(graph((await render(hairdresser))["index.html"]), "ProfessionalService");
    expect(business.address).toEqual({ "@type": "PostalAddress", addressLocality: "Galway", addressRegion: "County Galway", addressCountry: "IE" });
    expect(business.areaServed).toEqual({ "@type": "City", name: "Galway" });
    expect(business.sameAs).toEqual(["https://instagram.com/niamhbyrnehair"]);
    expect(business.email).toBe("niamh@example.com");
  });

  it("gives a price range from its services and a phone number from a phone link", async () => {
    const [business] = ofType(graph((await render({ ...hairdresser, links: { ...hairdresser.links, phone: "tel:+35391000000" } }))["index.html"]), "ProfessionalService");
    expect(business.priceRange).toBe("EUR 55-95");
    expect(business.telephone).toBe("+35391000000");
    expect(business.sameAs).toEqual(["https://instagram.com/niamhbyrnehair"]);
  });

  it("lists opening hours from booking availability, one entry per window", async () => {
    const [business] = ofType(graph((await render(hairdresser))["index.html"]), "ProfessionalService");
    expect(business.openingHoursSpecification).toHaveLength(5);
    expect(business.openingHoursSpecification[0]).toEqual({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Tuesday", opens: "09:00", closes: "13:00" });
    expect(business.openingHoursSpecification[4]).toMatchObject({ dayOfWeek: "https://schema.org/Saturday", opens: "10:00", closes: "16:00" });
  });

  it("describes each bookable offer as a Service with a priced Offer, its duration and a ReserveAction", async () => {
    const services = ofType(graph((await render(hairdresser))["index.html"]), "Service");
    expect(services.map((service) => service.name)).toEqual(["Cut & blow-dry", "Full colour"]);
    const [cut] = services;
    expect(cut).toMatchObject({ description: "Wash, cut and finish.", provider: { "@id": `${baseUrl}/#identity` } });
    expect(cut.offers).toMatchObject({ "@type": "Offer", price: "55.00", priceCurrency: "EUR", url: `${baseUrl}/#booking` });
    expect(cut.offers.priceSpecification).toMatchObject({ "@type": "UnitPriceSpecification", price: "55.00", priceCurrency: "EUR", referenceQuantity: { "@type": "QuantitativeValue", value: 60, unitCode: "MIN" } });
    expect(cut.potentialAction).toMatchObject({ "@type": "ReserveAction", target: { "@type": "EntryPoint", urlTemplate: `${baseUrl}/#booking` } });
    expect(cut.hoursAvailable).toHaveLength(5);
  });

  it("describes each product as a Product with a priced Offer and a BuyAction at its own page", async () => {
    const products = ofType(graph((await render(hairdresser))["index.html"]), "Product");
    expect(products.map((product) => product.name)).toEqual(["Argan finishing oil", "Gift voucher"]);
    const [oil] = products;
    const url = `${baseUrl}/products/argan-finishing-oil`;
    expect(oil).toMatchObject({ description: "The one I use on every blow-dry.", url, image: [`${baseUrl}/files/content/oil.webp`] });
    expect(oil.offers).toMatchObject({ "@type": "Offer", price: "24.00", priceCurrency: "EUR", availability: "https://schema.org/InStock", url, seller: { "@id": `${baseUrl}/#identity` } });
    expect(oil.potentialAction).toMatchObject({ "@type": "BuyAction", target: { "@type": "EntryPoint", urlTemplate: url } });
  });

  it("makes the product the main entity of its own page", async () => {
    const nodes = graph((await render(hairdresser))["products/argan-finishing-oil.html"]);
    const [page] = ofType(nodes, "WebPage");
    expect(page.mainEntity).toEqual({ "@id": `${baseUrl}/products/argan-finishing-oil#product` });
    expect(ofType(nodes, "Product")).toHaveLength(1);
    expect(ofType(nodes, "ProfessionalService")[0]).toMatchObject({ "@id": `${baseUrl}/#identity`, name: "Niamh Byrne Hair" });
    expect(ofType(nodes, "Service")).toHaveLength(0);
  });

  it("prices products with options as a range and marks sold-out and unavailable products", async () => {
    const setAt = "2026-10-27T10:00:00.000Z";
    const nodes = graph((await render({ name: "Shop", handle: "shop", products: [
      { slug: "print", title: "Print", price: 1500, currency: "GBP", options: [{ id: "a4", label: "A4", price: 1500 }, { id: "a3", label: "A3", price: 2500 }] },
      { slug: "gone", title: "Gone", price: 900, currency: "GBP", stock: 0, stockSetAt: setAt },
      { slug: "paused", title: "Paused", price: 900, currency: "GBP", available: false },
    ] }))["index.html"]);
    const [print, gone, paused] = ofType(nodes, "Product");
    expect(print.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: "15.00", highPrice: "25.00", priceCurrency: "GBP", offerCount: 2 });
    expect(gone.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(gone.potentialAction).toBeUndefined();
    expect(paused.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(paused.potentialAction).toBeUndefined();
  });

  it("points products sold elsewhere at the other shop", async () => {
    const [book] = ofType(graph((await render({ name: "Shop", handle: "shop", products: [
      { slug: "book", title: "Book", price: 999, currency: "GBP", delivery: { kind: "external", instructions: "", url: "https://www.etsy.com/listing/1" } },
    ] }))["index.html"]), "Product");
    expect(book.offers.url).toBe("https://www.etsy.com/listing/1");
    expect(book.potentialAction.target.urlTemplate).toBe("https://www.etsy.com/listing/1");
  });

  it("keeps a person who sells without a place a Person with makesOffer", async () => {
    const nodes = graph((await render({ name: "Kieran", handle: "kieran", products: [{ slug: "log", title: "Log", price: 3500, currency: "GBP" }] }))["index.html"]);
    const [person] = ofType(nodes, "Person");
    expect(person.makesOffer).toEqual([{ "@id": `${baseUrl}/shop/log#offer` }]);
    expect(person.openingHoursSpecification).toBeUndefined();
    expect(ofType(nodes, "ProfessionalService")).toHaveLength(0);
  });

  it("keeps someone whose sessions are all online or by phone a Person, with hours on the service", async () => {
    const nodes = graph((await render({ ...hairdresser, products: [], intents: { book: { ...hairdresser.intents.book, offers: [
      { id: "call", title: "Coaching call", duration: 45, location: { mode: "online" } },
    ] } } }))["index.html"]);
    const [person] = ofType(nodes, "Person");
    const [call] = ofType(nodes, "Service");
    expect(person.openingHoursSpecification).toBeUndefined();
    expect(person.address).toMatchObject({ addressLocality: "Galway" });
    expect(call.hoursAvailable).toHaveLength(5);
    expect(call.offers).toMatchObject({ price: "0.00", priceCurrency: "USD" });
  });

  it("offers no ReserveAction or BuyAction for what can't be booked or bought on the site", async () => {
    const enquire = { ...hairdresser, products: [{ ...hairdresser.products[0], paymentMethod: "stripe", enquireUrl: "/api/enquire/niamh?offer=oil" }], intents: { book: { ...hairdresser.intents.book, offers: [
      { ...hairdresser.intents.book.offers[0], enquireUrl: "/api/enquire/niamh?offer=cut" },
    ] } } };
    const nodes = graph((await render(enquire))["index.html"]);
    expect(ofType(nodes, "Service")[0].offers.price).toBe("55.00");
    expect(ofType(nodes, "Service")[0].potentialAction).toBeUndefined();
    expect(ofType(nodes, "Product")[0].potentialAction).toBeUndefined();

    const locked = graph((await render(hairdresser, { bookingsEnabled: false, productCheckoutEnabled: false }))["index.html"]);
    expect(ofType(locked, "Service")).toHaveLength(0);
    expect(ofType(locked, "Product")[0].potentialAction).toBeUndefined();
  });

  it("uses each offer's own page and hours when it has them, and lists unpriced manual services", async () => {
    const nodes = graph((await render({ ...hairdresser, services: [{ id: "bridal", title: "Bridal hair", description: "Ask about dates." }], intents: { book: { ...hairdresser.intents.book, offers: [
      { ...hairdresser.intents.book.offers[0], pageSlug: "cut", availability: { windows: { friday: ["12:00-20:00"] } } },
    ] } } }, { offerPagesEnabled: true }))["index.html"]);
    const [cut, bridal] = ofType(nodes, "Service");
    expect(cut.url).toBe(`${baseUrl}/cut`);
    expect(cut.potentialAction.target.urlTemplate).toBe(`${baseUrl}/cut`);
    expect(cut.hoursAvailable).toEqual([{ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Friday", opens: "12:00", closes: "20:00" }]);
    expect(bridal).toMatchObject({ name: "Bridal hair", description: "Ask about dates." });
    expect(bridal.offers).toBeUndefined();
    expect(bridal.potentialAction).toBeUndefined();
  });

  it("prices flexible offers from their minimum and keeps author text inert", async () => {
    const html = (await render({ name: "A", handle: "a", intents: { book: { enabled: true, availability: { windows: { monday: ["09:00-17:00", "not a window"] } }, offers: [
      { id: "x", title: "</script><script>alert(1)</script>", description: "Costs $' and $& more", duration: 30, pricing: { enabled: true, suggestedAmount: 40, minimumAmount: 20, currency: "eur" } },
    ] } } }))["index.html"];
    expect(html).not.toContain("</script><script>alert(1)</script>");
    const [service] = ofType(graph(html), "Service");
    expect(service.description).toBe("Costs $' and $& more");
    expect(service.offers).toMatchObject({ price: "40.00", priceCurrency: "EUR" });
    expect(service.offers.priceSpecification.minPrice).toBe("20.00");
    expect(service.hoursAvailable).toHaveLength(1);
  });

  it("stays a plain Person profile when there is nothing to sell", async () => {
    const nodes = graph((await render({ name: "Alex", handle: "alex", bio: "Hello", links: { github: "alex" } }))["index.html"]);
    expect(nodes.map((node) => node["@type"])).toEqual(["ProfilePage", "Person"]);
    expect(nodes[1]).toEqual({ "@type": "Person", "@id": `${baseUrl}/#identity`, name: "Alex", url: `${baseUrl}/`, description: "Hello", sameAs: ["https://github.com/alex"] });
  });
});
