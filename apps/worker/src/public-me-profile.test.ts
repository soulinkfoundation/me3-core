import { describe, expect, it } from "vitest";
import { validateProfile } from "me3-protocol";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import { buildPublicMe3Profile, withoutAgentCheckout } from "./public-me-profile";

describe("public me.json profile", () => {
  it("publishes the owner's trade, or the headline their starter site saved, and nothing otherwise", () => {
    const stated = buildPublicMe3Profile({ name: "Niamh", trade: " Hairdresser ", bio: "**Stylist in Galway**\n\nHello." } as Me3SiteProfile, "https://example.com");
    expect(stated).toMatchObject({ trade: "Hairdresser" });
    expect(validateProfile(stated).valid).toBe(true);
    const headline = buildPublicMe3Profile({ name: "Niamh", bio: "**Hairdresser in Galway**\n\nColour and cuts." }, "https://example.com");
    expect(headline).toMatchObject({ trade: "Hairdresser in Galway" });
    expect(validateProfile(headline).valid).toBe(true);
    expect(buildPublicMe3Profile({ name: "Niamh", bio: "Colour and cuts." }, "https://example.com")).not.toHaveProperty("trade");
    expect(buildPublicMe3Profile({ name: "Niamh", visibility: "private", trade: "Hairdresser" } as Me3SiteProfile, "https://example.com")).not.toHaveProperty("trade");
  });
  it("links YouTube and TikTok handles to their profiles", () => {
    const profile = buildPublicMe3Profile({
      name: "Social links",
      links: { youtube: "@creator", tiktok: "creator", custom_youtube: "https://youtube.com/@full-url" },
    }, "https://example.com");
    expect(profile).toMatchObject({ links: expect.arrayContaining([
      expect.objectContaining({ href: "https://youtube.com/@creator" }),
      expect.objectContaining({ href: "https://tiktok.com/@creator" }),
      expect.objectContaining({ href: "https://youtube.com/@full-url" }),
    ]) });
  });
  it("preserves username paths in public identity and action destinations", () => {
    const profile = buildPublicMe3Profile({ name: "Alex", intents: { subscribe: { enabled: true } } }, "https://example.com/site/alex/");
    expect(profile).toMatchObject({ id: "https://example.com/site/alex/me.json", url: "https://example.com/site/alex/" });
    expect(JSON.stringify(profile)).toContain("https://example.com/site/alex/#newsletter");
  });
  it("converts legacy site configuration into a public protocol 0.3 manifest", () => {
    const source: Me3SiteProfile = {
      version: "0.1",
      name: "Kieran Butler",
      handle: "kieran",
      bio: "Builder",
      avatar: "./files/avatar.jpg",
      location: "Ireland",
      locationData: {
        label: "Ireland",
        latitude: 53.4,
        longitude: -8.2,
        precision: "country",
        country: "Ireland",
        countryCode: "IE",
      },
      links: {
        twitter: "kieranofearth",
        email: "hey@example.com",
        _vibe: "me3",
      },
      pages: [
        { slug: "about", title: "About", file: "about.md", visible: true },
        { slug: "hidden", title: "Hidden", file: "hidden.md", visible: false },
        { slug: "unpublished", title: "Unpublished", file: "unpublished.md", draft: true },
      ],
      posts: [
        { slug: "public", title: "Public", file: "blog/public.md" },
        { slug: "draft", title: "Draft", file: "blog/draft.md", draft: true },
      ],
      products: [
        {
          slug: "guide",
          title: "Guide",
          file: "shop/guide.md",
          price: 2900,
          currency: "EUR",
          available: true,
        },
      ],
      business: {
        positioningStatement: "I help founders clarify their offer.",
      },
      intents: {
        subscribe: {
          enabled: true,
          title: "Newsletter",
          description: "A useful weekly note.",
        },
        book: {
          enabled: true,
          title: "Book a session",
          offers: [
            {
              id: "coaching",
              title: "Coaching",
              description: "<p>A calm conversation.</p>",
              duration: 60,
              pricing: {
                enabled: true,
                suggestedAmount: 90,
                currency: "EUR",
                minimumAmount: 5,
                allowFlexiblePricing: true,
                allowFree: false,
              },
            },
          ],
        },
      },
    };

    const profile = buildPublicMe3Profile(source, "https://kieranbutler.com");

    expect(validateProfile(profile).valid).toBe(true);
    if (profile.visibility !== "public") throw new Error("Expected a public profile");
    expect(profile).toMatchObject({
      version: "0.3",
      visibility: "public",
      kind: "person",
      id: "https://kieranbutler.com/me.json",
      url: "https://kieranbutler.com/",
      links: [
        { rel: "twitter", href: "https://x.com/kieranofearth" },
        { rel: "email", href: "mailto:hey@example.com" },
      ],
      products: [
        {
          id: "product:guide",
          price: { amount: "29.00", currency: "EUR" },
        },
      ],
      services: [
        {
          id: "service:coaching",
          description: "A calm conversation.",
          price: { amount: "90.00", currency: "EUR" },
        },
      ],
      capabilities: {
        subscribe: { action: "subscribe" },
        book: {
          action: "book",
          offeringIds: ["service:coaching"],
        },
        purchase: {
          action: "purchase",
          offeringIds: ["product:guide"],
        },
      },
    });
    expect(profile.pages?.map((page) => page.id)).toEqual(["about"]);
    expect(profile.posts?.map((post) => post.id)).toEqual(["public"]);
    expect(JSON.stringify(profile)).not.toContain("minimumAmount");
    expect(JSON.stringify(profile)).not.toContain("allowFlexiblePricing");
    expect(JSON.stringify(profile)).not.toContain("_vibe");
    // The Mission is private to Core: neither the statement nor the answers behind it are public.
    expect(profile).not.toHaveProperty("business");
    expect(JSON.stringify(profile)).not.toContain("clarify their offer");
  });

  it("tells AI assistants where to book or buy only on a published public site", () => {
    const published = buildPublicMe3Profile({ name: "Niamh" }, "https://niamh.me3.app");
    expect(validateProfile(published).valid).toBe(true);
    if (published.visibility !== "public") throw new Error("Expected a public profile");
    expect(published.extensions?.["me3.app/connector"]).toEqual({
      mcp: "https://api.me3.app/mcp",
      description: "To book or buy through an AI, use api.me3.app/mcp.",
    });
    expect(withoutAgentCheckout(published)).toMatchObject({ extensions: { "me3.app/connector": { mcp: "https://api.me3.app/mcp" } } });
    expect(buildPublicMe3Profile({ name: "Niamh" })).not.toHaveProperty("extensions");
    expect(buildPublicMe3Profile({ name: "Niamh", visibility: "private" }, "https://niamh.me3.app")).not.toHaveProperty("extensions");
  });
  it("points Enquire offers and products at the site's enquiry form", () => {
    const profile = buildPublicMe3Profile({
      name: "Niamh",
      intents: { book: { enabled: true, offers: [
        { id: "cut", title: "Cut", duration: 45, pricing: { enabled: true, amount: 45, currency: "EUR" }, enquireUrl: "/api/enquire/niamh?about=Cut" },
        { id: "colour", title: "Colour", duration: 90 },
        { id: "evil", title: "Evil", enquireUrl: "https://evil.example/api/enquire/x" },
      ] } },
      products: [{ slug: "oil", title: "Hair oil", price: 20, currency: "EUR", enquireUrl: "/api/enquire/niamh?about=Hair%20oil" }],
    } as Me3SiteProfile, "https://niamh.me3.app");
    expect(validateProfile(profile).valid).toBe(true);
    if (profile.visibility !== "public") throw new Error("Expected a public profile");
    const byTitle = Object.fromEntries((profile.services || []).map((service) => [service.title, service]));
    expect(byTitle.Cut).toMatchObject({ availability: "manual", url: "https://niamh.me3.app/api/enquire/niamh?about=Cut" });
    expect(byTitle.Colour).toMatchObject({ availability: "calendar" });
    expect(byTitle.Colour).not.toHaveProperty("url");
    expect(byTitle.Evil).not.toHaveProperty("url");
    expect(profile.products?.[0].url).toBe("https://niamh.me3.app/api/enquire/niamh?about=Hair%20oil");
  });
  it("publishes a valid identity-only profile when no public HTTPS origin exists", () => {
    const profile = buildPublicMe3Profile({
      version: "0.1",
      name: "Local Owner",
      handle: "owner",
      intents: { book: { enabled: true, title: "Local booking" } },
    });

    expect(validateProfile(profile).valid).toBe(true);
    expect(profile.version).toBe("0.3");
    if (profile.visibility !== "public") throw new Error("Expected a public profile");
    expect(profile.actions).toBeUndefined();
    expect(profile.capabilities).toBeUndefined();
  });

  it("publishes only safe identity fields for a private profile", () => {
    const profile = buildPublicMe3Profile(
      {
        version: "0.1",
        visibility: "private",
        name: "Private Owner",
        handle: "owner",
        avatar: "./files/avatar.jpg",
        bio: "Must not be public",
        banner: "./files/banner.jpg",
        links: { website: "https://private.example.com" },
        pages: [{ slug: "private", title: "Private", file: "private.md" }],
      },
      "https://owner.example",
    );

    expect(validateProfile(profile).valid).toBe(true);
    expect(profile).toEqual({
      $schema: expect.any(String),
      version: "0.3",
      kind: "person",
      visibility: "private",
      name: "Private Owner",
      handle: "owner",
      avatar: "./files/avatar.jpg",
      banner: "./files/banner.jpg",
    });
  });
});
