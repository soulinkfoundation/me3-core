import { describe, expect, it } from "vitest";
import {
  buildLandingPageDocument,
  getLandingPageDesignPackId,
  getLandingPageRecipe,
  getLandingPageTemplateId,
  getSelectableLandingPageDesignPacks,
  normalizeLandingPageDocument,
  normalizeBusinessSiteDocument,
  normalizeLandingRecipe,
  normalizeLandingTemplate,
  renderLandingPageHtml,
  setLandingPageDesignPack,
} from "./index";

describe("landing pages package", () => {
  it("builds a structured service page with a booking action slot", () => {
    const page = buildLandingPageDocument({
      username: "owner",
      brief:
        "Leadership sprint for creative founders.\n- Audit the offer\n- Rewrite the page\n- Build a launch plan",
      template: "service",
      profile: {
        name: "ME3 Owner",
        bio: "A calm operator for creative businesses.",
        avatar: null,
        profileUrl: "https://core.example/sites/owner",
      },
    });

    expect(page.version).toBe(3);
    if (page.version !== 3) throw new Error("Expected v3 service page");
    expect(page.recipe.id).toBe("service-offer");
    expect(getLandingPageDesignPackId(page)).toBe("starter-service-01");
    expect(page.actions[0]).toMatchObject({
      id: "primary-action",
      kind: "booking",
      label: "Book a Call",
    });
    expect(page.content.sections.at(-1)?.type).toBe("action");
  });

  it("normalizes known templates and rejects malformed documents", () => {
    expect(normalizeLandingTemplate("event")).toBe("event");
    expect(normalizeLandingTemplate("wedding")).toBeNull();
    expect(normalizeLandingRecipe("event-invite")).toBe("event-invite");
    expect(normalizeLandingRecipe("wedding-invite")).toBeNull();
    expect(normalizeLandingPageDocument({ version: 1, template: "event" })).toBeNull();
  });

  it("builds a richer v3 event recipe document", () => {
    const page = buildLandingPageDocument({
      username: "owner",
      brief:
        "Spring studio dinner.\nWhen: June 14 at 7pm\nWhere: The Warehouse Room\n- Seasonal food\n- A guided conversation\n- Limited seats",
      template: "event",
      sectionImage: "/files/table.jpg",
      profile: {
        name: "ME3 Owner",
        bio: "A host for thoughtful rooms.",
        avatar: null,
        profileUrl: "https://core.example/sites/owner",
      },
    });

    expect(page.version).toBe(3);
    expect(getLandingPageTemplateId(page)).toBe("event");
    expect(getLandingPageRecipe("event-invite").sectionOrder).toContain("details");
    expect(page.assets.sectionImage).toBe("/files/table.jpg");
    expect(normalizeLandingPageDocument(page)).toEqual(page);
    expect(getLandingPageDesignPackId(page)).toBe("starter-event-01");
  });

  it("renders accessible event actions and replaces platform profile placeholders", () => {
    const page = buildLandingPageDocument({
      username: "owner",
      brief: "A small coastal gathering for thoughtful founders.",
      template: "event",
      profile: {
        name: "ME3 Owner",
        bio: "Personal AI assistant powered by ME3 Core.",
        avatar: "/files/owner.jpg",
        profileUrl: "/me",
      },
    });
    if (page.version !== 3) throw new Error("Expected v3 event page");
    page.actions[0] = {
      ...page.actions[0],
      kind: "subscribe",
      label: "Join the guest list",
    };

    const html = renderLandingPageHtml(page, "owner", { pageId: "event-1" });
    expect(html).not.toContain("Personal AI assistant powered by ME3 Core");
    expect(html).toContain(
      "Add a short bio to introduce the person behind this page.",
    );
    expect(html).toContain('src="/files/owner.jpg"');
    expect(html).toContain('alt="ME3 Owner profile photo"');
    expect(html).toContain('href="/me"');
    expect(html).toContain(
      "border:2px solid var(--field-border,var(--line,var(--border)))",
    );
    expect(html).toContain(
      ".page-action-form .button{width:fit-content;min-height:50px",
    );
    expect(html).toContain(
      ".pack-action{background:#f2664a;color:#ffffff",
    );
  });

  it("renders a stored Pexels image without adding attribution to the public footer", () => {
    const page = buildLandingPageDocument({
      username: "bright-ideas",
      brief: "A product studio for thoughtful teams.",
      template: "service",
      heroImage: "files/page-hero.jpg",
      heroImageAttribution: {
        provider: "pexels",
        photographer: "Ada Camera",
        photographerUrl: "https://www.pexels.com/@ada-camera/",
        sourceUrl: "https://www.pexels.com/photo/bright-studio-42/",
      },
      profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
    });

    const html = renderLandingPageHtml(page, "bright-ideas");
    expect(html).toContain('src="files/page-hero.jpg"');
    expect(html).toContain("Built with ME3");
    expect(html).not.toContain("Photo by");
    expect(html).not.toContain("Ada Camera");
  });

  it("renders validated color and font customizations over a starter design", () => {
    const page = buildLandingPageDocument({
      username: "studio",
      brief: "A concise creative studio offer.",
      template: "service",
      profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
    });
    if (page.version !== 3) throw new Error("Expected v3 page");
    page.design.customization = {
      accentColor: "#7c3aed",
      backgroundColor: "#fffaf2",
      textColor: "#211a2c",
      fontPreset: "editorial",
    };

    const html = renderLandingPageHtml(page, "studio");
    expect(normalizeLandingPageDocument(page)).toEqual(page);
    expect(html).toContain("family=Newsreader");
    expect(html).toContain("--accent:#7c3aed");
    expect(html).toContain("--bg:#fffaf2");
    expect(html).toContain('--display-font:"Newsreader"');
  });

  it("keeps selectable starter designs separate and purpose-specific", () => {
    const packs = getSelectableLandingPageDesignPacks();
    expect(packs.map((pack) => pack.id)).toEqual([
      "starter-event-01",
      "starter-service-01",
      "starter-waitlist-01",
      "clinical-editorial-01",
      "retreat-01",
    ]);
    expect(packs.every((pack) => pack.version === 1)).toBe(true);
    expect(packs.every((pack) => pack.selectable)).toBe(true);
    expect(packs.find((pack) => pack.id === "clinical-editorial-01")?.name).toBe(
      "Natural Editorial",
    );
  });

  it("reads published Business Site settings and rejects unsafe redirects", () => {
    const settings = {
      version: 1,
      name: "Harbour Practice",
      homepageSlug: "home",
      navigation: { items: [{ id: "home", label: "Home", pageSlug: "home", visible: true }] },
      footer: { note: "", links: [] },
      seo: { titleSuffix: "", description: "", indexing: "noindex" },
      organization: {},
      redirects: [{ id: "old", from: "/old/", to: "/start/" }],
      connectedResources: { collectionIds: [], productIds: [], bookingOfferIds: [] },
      design: { packId: "clinical-editorial-01", packVersion: 1 },
      updatedAt: "2026-08-31T10:00:00Z",
    };

    expect(normalizeBusinessSiteDocument(settings)).toEqual(settings);
    expect(
      normalizeBusinessSiteDocument({
        ...settings,
        redirects: [{ id: "bad", from: "/old/", to: "https://evil.example/" }],
      }),
    ).toBeNull();
  });

  it("renders allowed rich section copy and removes unsafe editor markup", () => {
    const page = buildLandingPageDocument({
      username: "harbour-practice",
      brief: "A calm, expert-led health practice.",
      template: "service",
      designPackId: "clinical-editorial-01",
      profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
    });
    if (page.version !== 3) throw new Error("Expected v3 service page");
    const story = page.content.sections.find((section) => section.type === "story");
    if (!story || story.type !== "story") throw new Error("Expected story section");
    story.body =
      '<p>Calm <strong>care</strong> with <a href="https://example.com" onclick="alert(1)">clear next steps</a>.</p><img src=x onerror=alert(1)><script>alert(1)</script>';

    const html = renderLandingPageHtml(page, "harbour-practice");
    expect(html).toContain("<strong>care</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("requires a complete design-pack identity while accepting pre-pack v3 pages", () => {
    const page = buildLandingPageDocument({
      username: "owner",
      brief: "A private launch list.",
      template: "waitlist",
      profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
    });
    if (page.version !== 3) throw new Error("Expected v3 waitlist page");

    const prePack = structuredClone(page);
    delete prePack.design.packId;
    delete prePack.design.packVersion;
    expect(normalizeLandingPageDocument(prePack)).toEqual(prePack);
    expect(getLandingPageDesignPackId(prePack)).toBe("starter-waitlist-01");
    expect(renderLandingPageHtml(prePack, "owner")).toContain(
      'data-design-pack="starter-waitlist-01"',
    );

    const legacyPack = structuredClone(page) as unknown as {
      design: { packId?: string; packVersion?: number };
    };
    legacyPack.design.packId = "legacy-standard";
    legacyPack.design.packVersion = 1;
    const normalizedLegacyPack = normalizeLandingPageDocument(legacyPack);
    expect(normalizedLegacyPack?.design.packId).toBeUndefined();
    expect(normalizedLegacyPack?.design.packVersion).toBeUndefined();

    const missingVersion = structuredClone(page);
    delete missingVersion.design.packVersion;
    expect(normalizeLandingPageDocument(missingVersion)).toBeNull();

    const invalidHeroLayout = structuredClone(page);
    invalidHeroLayout.hero.imageLayout = "cinematic" as "split";
    expect(normalizeLandingPageDocument(invalidHeroLayout)).toBeNull();
  });

  it("renders escaped HTML for persisted previews", () => {
    const page = buildLandingPageDocument({
      username: "owner",
      brief: "<Launch> the thing.",
      template: "waitlist",
      feedback: "CTA as Join <now>",
      profile: {
        name: "Owner",
        bio: null,
        avatar: null,
        profileUrl: null,
      },
    });

    const html = renderLandingPageHtml(page, "owner");
    expect(html).toContain("&lt;Launch&gt;");
    expect(html).toContain("Join &lt;now&gt;");
    expect(html).toContain("data-theme=\"signal-waitlist\"");
    expect(html).toContain('data-design-pack="starter-waitlist-01"');
    expect(html).toContain('data-design-pack-version="1"');
    expect(html).not.toContain("<Launch>");
  });

  it("can switch to a compatible versioned design without changing page content", () => {
    const page = buildLandingPageDocument({
      username: "owner",
      brief: "A focused advisory offer.",
      template: "service",
      profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
    });
    if (page.version !== 3) throw new Error("Expected v3 service page");
    const switched = setLandingPageDesignPack(page, "clinical-editorial-01");

    expect(switched.hero).toEqual(page.hero);
    expect(switched.content).toEqual(page.content);
    expect(getLandingPageDesignPackId(switched)).toBe("clinical-editorial-01");
    expect(renderLandingPageHtml(switched, "owner")).toContain(
      'data-design-pack="clinical-editorial-01"',
    );
    expect(() =>
      setLandingPageDesignPack(page, "starter-event-01"),
    ).toThrow(/does not support service pages/);
  });

  it("renders functional subscribe and booking widgets without embedding credentials", () => {
    const waitlist = buildLandingPageDocument({
      username: "owner",
      brief: "A private launch list for thoughtful founders.",
      template: "waitlist",
      profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
    });
    const waitlistHtml = renderLandingPageHtml(waitlist, "owner", {
      pageId: "page-1",
      slug: "private-launch",
    });
    expect(waitlistHtml).toContain("/api/sites/owner/subscribe");
    expect(waitlistHtml).toContain('name="pageId" value="page-1"');

    const service = buildLandingPageDocument({
      username: "owner",
      brief: "A strategy session for independent consultants.",
      template: "service",
      profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
    });
    if (service.version !== 3) throw new Error("Expected v3 service page");
    service.actions[0].resourceId = "strategy-session";
    const serviceHtml = renderLandingPageHtml(service, "owner", {
      pageId: "page-2",
      bookingPaymentMethods: { "strategy-session": "manual" },
      marketingOptIn: true,
    });
    expect(serviceHtml).toContain('data-offer="strategy-session"');
    expect(serviceHtml).toContain('data-payment-method="manual"');
    expect(serviceHtml).toContain(
      "Payment is not taken now. You’ll receive payment details by email after booking.",
    );
    expect(serviceHtml).toContain("/api/book/");
    expect(serviceHtml).toContain('name="marketingOptIn"');
    expect(serviceHtml).toContain("/api/sites/'+encodeURIComponent(username)+'/subscribe");
    expect(serviceHtml).not.toContain("sk_test_");

    service.actions[0] = {
      ...service.actions[0],
      kind: "product",
      resourceId: "clarity-kit",
    };
    const productHtml = renderLandingPageHtml(service, "owner", {
      pageId: "page-3",
      productPaymentMethods: { "clarity-kit": "manual" },
    });
    expect(productHtml).toContain('data-product="clarity-kit"');
    expect(productHtml).toContain("/order");
    expect(productHtml).toContain(
      "Payment is not taken now. You’ll receive payment details by email after ordering.",
    );
    expect(productHtml).not.toContain('name="marketingOptIn"');
  });

  it("rejects pre-v3 documents instead of upgrading them", () => {
    expect(
      normalizeLandingPageDocument({
        version: 1,
        template: "waitlist",
        title: "Legacy launch",
        brief: "A legacy page",
        meta: { description: "Join the launch" },
        hero: {
          headline: "Legacy launch",
          subheadline: "Join the launch",
          cta: { label: "Join", href: "#signup" },
        },
        sections: [],
        footer: {},
        style: { vibe: "minimal", accentColor: "#0f766e" },
      }),
    ).toBeNull();
    expect(
      normalizeLandingPageDocument({
        version: 2,
        intent: { type: "event", audience: "", goal: "", offerName: "Dinner" },
        recipe: { id: "event-invite", template: "event", name: "Event invite" },
        brief: "A dinner",
        seo: { title: "Dinner", description: "A dinner" },
        hero: { headline: "Dinner", subheadline: "A dinner", cta: { label: "RSVP", href: "#rsvp" } },
        content: { sections: [] },
        design: { theme: "editorial-event", accentColor: "#f2664a", backgroundColor: "#fff", textColor: "#111" },
        assets: {},
        publish: { status: "draft" },
      }),
    ).toBeNull();
  });
});
