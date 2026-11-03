import { describe, expect, it } from "vitest";
import {
  createAgentLandingPageDraft,
  listAgentLandingPages,
  updateAgentLandingPageDraft,
} from "@me3-core/plugin-agent-chat";
import {
  normalizeLandingPageDocument,
  type LandingPageDocumentV3,
} from "@me3-core/plugin-landing-pages";

type PageRow = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  template_id: string;
  draft_json: string;
  published_revision_id: string | null;
  updated_at: string;
  published_at: string | null;
};

type SiteRow = {
  id: string;
  username: string;
  site_role: "profile" | "organization";
  template_id: string | null;
  custom_domain: string | null;
  updated_at: string;
};

describe("landing-page Agent runtime", () => {
  it("creates, lists, and revises a versioned draft without publishing it", async () => {
    const database = createLandingPageAgentDb();
    const first = await createAgentLandingPageDraft(
      { DB: database.db },
      "owner",
      {
        site: "owner-site",
        purpose: "service",
        brief: "A focused positioning sprint for independent consultants.",
        headline: "Make the offer obvious",
        subheadline: "A focused sprint that turns expertise into a clear offer.",
        highlights: "Positioning: Choose a sharp promise\nPage: Write the sales story",
        ctaLabel: "Book the sprint",
      },
    );
    const second = await createAgentLandingPageDraft(
      { DB: database.db },
      "owner",
      {
        site: "owner-site",
        purpose: "service",
        brief: "A focused positioning sprint for independent consultants.",
        headline: "Make the offer obvious",
      },
    );

    expect(first).toMatchObject({
      siteUsername: "owner-site",
      slug: "make-the-offer-obvious",
      designPackId: "starter-service-01",
      published: false,
    });
    expect(first.editorPath).toContain(first.id);
    expect(first.previewPath).toContain(first.id);
    expect(second.slug).toBe("make-the-offer-obvious-2");

    const listed = await listAgentLandingPages(
      { DB: database.db },
      "owner",
    );
    expect(listed).toHaveLength(2);

    const updated = await updateAgentLandingPageDraft(
      { DB: database.db },
      "owner",
      {
        pageId: first.id,
        headline: "A clearer offer in one focused sprint",
        accentColor: "#7c3aed",
        backgroundColor: "#fffaf2",
        textColor: "#211a2c",
        fontPreset: "editorial",
        actionType: "subscribe",
      },
    );
    expect(updated).toMatchObject({
      id: first.id,
      title: "A clearer offer in one focused sprint",
      published: false,
    });

    const document = normalizeLandingPageDocument(
      JSON.parse(database.pages.find((page) => page.id === first.id)!.draft_json),
    ) as LandingPageDocumentV3;
    expect(document.hero.headline).toBe("A clearer offer in one focused sprint");
    expect(document.actions[0]?.label).toBe("Join the list");
    expect(document.actions[0]).toMatchObject({
      kind: "subscribe",
    });
    expect(document.actions[0]).not.toHaveProperty("href");
    expect(document.design.customization).toEqual({
      accentColor: "#7c3aed",
      backgroundColor: "#fffaf2",
      textColor: "#211a2c",
      fontPreset: "editorial",
    });
    expect(document.content.sections.find((section) => section.type === "feature-list"))
      .toMatchObject({
        items: [
          { title: "Positioning", body: "Choose a sharp promise" },
          { title: "Page", body: "Write the sales story" },
        ],
      });
  });

  it("rejects a design intended for a different page purpose", async () => {
    const database = createLandingPageAgentDb();
    await expect(
      createAgentLandingPageDraft(
        { DB: database.db },
        "owner",
        {
          site: "owner-site",
          purpose: "event",
          designPackId: "starter-waitlist-01",
          brief: "A small Saturday workshop.",
        },
      ),
    ).rejects.toThrow(/does not support event pages/);
    expect(database.pages).toHaveLength(0);
  });

  it("puts a new page on the owner's site and stores a relevant Pexels image", async () => {
    const database = createLandingPageAgentDb({ pluginEnabled: false });
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.pexels.com/v1/search")) {
        return new Response(
          JSON.stringify({
            photos: [
              {
                id: 42,
                url: "https://www.pexels.com/photo/bright-studio-42/",
                photographer: "Ada Camera",
                photographer_url: "https://www.pexels.com/@ada-camera/",
                src: {
                  landscape:
                    "https://images.pexels.com/photos/42/pexels-photo-42.jpeg",
                },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "Content-Type": "image/jpeg" },
      });
    };

    const created = await createAgentLandingPageDraft(
      {
        DB: database.db,
        PEXELS_API_KEY: "test-key",
        fetch: fetcher as typeof fetch,
      },
      "owner",
      {
        purpose: "service",
        brief: "A product studio helping small teams turn bright ideas into useful software.",
        headline: "Make bright ideas real",
        imageQuery: "creative product studio natural light",
      },
    );

    expect(created).toMatchObject({
      siteUsername: "owner-site",
      slug: "make-bright-ideas-real",
      isSiteHomepage: false,
      imageProvider: "pexels",
      publicPath: "/make-bright-ideas-real/",
      published: false,
    });
    expect(created).not.toHaveProperty("siteCreated");
    expect(database.sites).toHaveLength(1);
    expect(database.files).toHaveLength(1);
    const document = normalizeLandingPageDocument(
      JSON.parse(database.pages[0]!.draft_json),
    ) as LandingPageDocumentV3;
    expect(document.hero.image).toMatch(/^files\/.+-hero\.jpg$/);
    expect(document.actions[0]).toMatchObject({
      kind: "link",
      href: "/me",
    });
    expect(document.assets.heroImageAttribution).toMatchObject({
      provider: "pexels",
      photographer: "Ada Camera",
    });

    const originalImage = document.hero.image;
    const updated = await updateAgentLandingPageDraft(
      {
        DB: database.db,
        PEXELS_API_KEY: "test-key",
        fetch: fetcher as typeof fetch,
      },
      "owner",
      {
        site: "owner-site",
        pageId: created.id,
        imageQuery: "Mallorca yoga retreat by the sea",
        actionType: "subscribe",
        ctaLabel: "Join the retreat list",
        fontPreset: "modern",
      },
    );
    expect(updated.imageProvider).toBe("pexels");
    const updatedDocument = normalizeLandingPageDocument(
      JSON.parse(database.pages[0]!.draft_json),
    ) as LandingPageDocumentV3;
    expect(updatedDocument.hero.image).not.toBe(originalImage);
    expect(updatedDocument.actions[0]).toMatchObject({
      kind: "subscribe",
      label: "Join the retreat list",
    });
    expect(updatedDocument.design.customization?.fontPreset).toBe("modern");
    expect(updatedDocument.assets.heroImageAttribution).toMatchObject({
      provider: "pexels",
      photographer: "Ada Camera",
    });
    expect(database.pluginEnabled()).toBe(true);
  });

  it("never creates another site, even with one already on the installation", async () => {
    const database = createLandingPageAgentDb();
    database.sites.push({
      id: "site-2",
      username: "old-studio",
      site_role: "organization",
      template_id: "agent-landing-page",
      custom_domain: "studio.example",
      updated_at: "2026-07-21T12:00:00.000Z",
    });

    const page = await createAgentLandingPageDraft({ DB: database.db }, "owner", {
      purpose: "waitlist",
      brief: "A waitlist for my new course.",
    });
    expect(page.siteUsername).toBe("owner-site");
    expect(database.sites).toHaveLength(2);

    await expect(
      createAgentLandingPageDraft({ DB: database.db }, "owner", {
        site: "@old-studio",
        purpose: "waitlist",
        brief: "A second waitlist.",
      }),
    ).rejects.toThrow(/New pages go on your website, @owner-site/);
    expect(database.pages).toHaveLength(1);
  });

  it("asks for an ME3 website before making a page", async () => {
    const database = createLandingPageAgentDb();
    database.sites.length = 0;
    await expect(
      createAgentLandingPageDraft({ DB: database.db }, "owner", {
        purpose: "waitlist",
        brief: "A waitlist.",
      }),
    ).rejects.toThrow(/Create your ME3 website/);
  });

  it("keeps a page that was already on an older site editable and correctly addressed", async () => {
    const database = createLandingPageAgentDb();
    database.sites.push({
      id: "site-2",
      username: "old-studio",
      site_role: "organization",
      template_id: "agent-landing-page",
      custom_domain: null,
      updated_at: "2026-07-21T12:00:00.000Z",
    });
    const owned = await createAgentLandingPageDraft({ DB: database.db }, "owner", {
      purpose: "waitlist",
      brief: "Seed page.",
      slug: "home-page",
    });
    database.pages[0]!.site_id = "site-2";
    database.pages[0]!.slug = "home";

    const updated = await updateAgentLandingPageDraft({ DB: database.db }, "owner", {
      site: "old-studio",
      pageId: owned.id,
      headline: "Still editable",
    });
    expect(updated).toMatchObject({ isSiteHomepage: true, publicPath: "/site/old-studio/" });
  });

  it("gives a new page a path nothing else on the site is using", async () => {
    const database = createLandingPageAgentDb();
    database.generatedFiles.push("public/coaching.html", "public/shop/index.html", "public/index.html");
    const env = { DB: database.db };
    const input = { purpose: "waitlist" as const, brief: "A waitlist." };

    expect((await createAgentLandingPageDraft(env, "owner", { ...input, slug: "coaching" })).slug).toBe("coaching-2");
    expect((await createAgentLandingPageDraft(env, "owner", { ...input, slug: "shop" })).slug).toBe("shop-2");
    expect((await createAgentLandingPageDraft(env, "owner", { ...input, slug: "login" })).slug).toBe("login-2");
    expect((await createAgentLandingPageDraft(env, "owner", { ...input, slug: "workshop" })).slug).toBe("workshop");
  });

  it("drafts a service page that can publish before a booking is chosen", async () => {
    const database = createLandingPageAgentDb();
    await createAgentLandingPageDraft({ DB: database.db }, "owner", {
      site: "owner-site",
      purpose: "service",
      brief: "A focused sprint.",
    });
    const document = normalizeLandingPageDocument(
      JSON.parse(database.pages[0]!.draft_json),
    ) as LandingPageDocumentV3;
    expect(document.actions[0]).toMatchObject({ kind: "link", href: "/me" });
    expect(document.content.sections.find((section) => section.type === "profile"))
      .toMatchObject({ profileLink: "/me" });
  });
});

function createLandingPageAgentDb(options: { pluginEnabled?: boolean } = {}) {
  const pages: PageRow[] = [];
  const sites: SiteRow[] = [
    {
      id: "site-1",
      username: "owner-site",
      site_role: "profile",
      template_id: "me3",
      custom_domain: null,
      updated_at: "2026-07-20T12:00:00.000Z",
    },
  ];
  const files: Array<{ siteId: string; path: string; bytes: ArrayBuffer }> = [];
  const generatedFiles: string[] = [];
  let pluginEnabled = options.pluginEnabled !== false;
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM plugin_installations")) {
                return {
                  enabled: pluginEnabled ? 1 : 0,
                  status: pluginEnabled ? "installed" : "disabled",
                } as T;
              }
              if (sql.includes("FROM owner_profile")) {
                return {
                  name: "Owner Name",
                  bio: "A thoughtful independent consultant.",
                  avatar_url: null,
                } as T;
              }
              if (sql.includes("FROM site_pages") && sql.includes("id = ?")) {
                const [siteId, pageId] = values as [string, string];
                return (pages.find(
                  (page) => page.site_id === siteId && page.id === pageId,
                ) || null) as T | null;
              }
              return null;
            },
            async all<T>() {
              if (sql.includes("FROM sites")) {
                return {
                  results: sites as T[],
                };
              }
              if (sql.includes("FROM site_files")) {
                return { results: generatedFiles.map((path) => ({ path })) as T[] };
              }
              if (sql.includes("SELECT slug FROM site_pages")) {
                return {
                  results: pages.map((page) => ({ slug: page.slug })) as T[],
                };
              }
              if (sql.includes("FROM site_pages")) {
                return { results: [...pages].reverse() as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
              if (sql.includes("INSERT INTO plugin_installations")) {
                pluginEnabled = true;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("INSERT INTO site_files")) {
                files.push({
                  siteId: String(values[0]),
                  path: String(values[1]),
                  bytes: values[2] as ArrayBuffer,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("INSERT INTO site_pages")) {
                const [id, siteId, slug, title, templateId, draftJson] =
                  values as [string, string, string, string, string, string];
                pages.push({
                  id,
                  site_id: siteId,
                  slug,
                  title,
                  template_id: templateId,
                  draft_json: draftJson,
                  published_revision_id: null,
                  updated_at: "2026-07-20T12:00:00.000Z",
                  published_at: null,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE site_pages")) {
                const [title, templateId, draftJson, id, siteId] =
                  values as [string, string, string, string, string];
                const page = pages.find(
                  (candidate) => candidate.id === id && candidate.site_id === siteId,
                );
                if (page) {
                  page.title = title;
                  page.template_id = templateId;
                  page.draft_json = draftJson;
                }
                return { meta: { changes: page ? 1 : 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
  return {
    db,
    pages,
    sites,
    files,
    generatedFiles,
    pluginEnabled: () => pluginEnabled,
  };
}
