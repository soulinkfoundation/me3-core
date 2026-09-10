import { describe, expect, it } from "vitest";
import { validateProfile } from "me3-protocol";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import { buildPublicMe3Profile } from "./public-me-profile";

describe("public me.json profile", () => {
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
