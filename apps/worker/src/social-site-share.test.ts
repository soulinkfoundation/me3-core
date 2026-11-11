import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSitePostShareVersions,
  findSitePostShare,
  shareSitePost,
  sitePostShareTargets,
  type SitePostSnapshot,
} from "@me3-core/plugin-social-publishing";
import { firstParagraph, markdownImages } from "./social-site-share";

const migrationsDir = new URL("../migrations/", import.meta.url);

function createEnv() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO owner_profile (id, email) VALUES ('owner', 'owner@example.test');
    INSERT INTO sites (id, user_id, username, site_role) VALUES ('site-1', 'owner', 'kieran', 'profile');
  `);
  for (const [id, platform] of [["acct-x", "x"], ["acct-li", "linkedin"], ["acct-ig", "instagram"]] as const) {
    sqlite.prepare(
      `INSERT INTO social_accounts (id, user_id, site_id, platform, platform_account_id, platform_handle,
         display_name, access_token_ciphertext, scopes_json, status, metadata_json, created_at, updated_at)
       VALUES (?, 'owner', 'site-1', ?, ?, 'kieran', 'Kieran', '', '[]', 'active', '{}', datetime('now'), datetime('now'))`,
    ).run(id, platform, `${platform}-1`);
  }
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (sqlite.prepare(sql).get(...(values as never[])) as T) ?? null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => sqlite.prepare(sql).run(...(values as never[])),
  });
  const env = {
    DB: {
      prepare: (sql: string) => statement(sql),
      batch: async (statements: Array<{ run(): Promise<unknown> }>) => {
        for (const item of statements) await item.run();
        return [];
      },
    },
  };
  return { env: env as never, close: () => sqlite.close() };
}

const article: SitePostSnapshot = {
  siteId: "site-1",
  siteUsername: "kieran",
  slug: "write-before-you-scroll",
  title: "Write before you scroll",
  excerpt: "Ten minutes, first thing, phone in another room.",
  type: "article",
  canonicalUrl: "https://kieran.me3.app/blog/write-before-you-scroll",
  images: [],
  video: null,
};

const targets = [
  { platform: "x" as const, accountId: "acct-x" },
  { platform: "linkedin" as const, accountId: "acct-li" },
  { platform: "instagram" as const, accountId: "acct-ig" },
];

describe("sharing a site post", () => {
  it("shares an article as link posts and skips Instagram without a picture", () => {
    const versions = buildSitePostShareVersions(article, targets);
    expect(versions.map((version) => version.platform)).toEqual(["x", "linkedin"]);
    expect(versions[0]).toMatchObject({ format: "post", targetAccountId: "acct-x" });
    expect(versions[0]!.bodyText).toBe(
      "Write before you scroll\n\nTen minutes, first thing, phone in another room.\n\nhttps://kieran.me3.app/blog/write-before-you-scroll",
    );
  });

  it("keeps X within 280 characters, counting the link as 23", () => {
    const long = { ...article, excerpt: "word ".repeat(120).trim() };
    const [x] = buildSitePostShareVersions(long, [targets[0]!]);
    const text = x!.bodyText.replace(article.canonicalUrl, "x".repeat(23));
    expect(text.length).toBeLessThanOrEqual(280);
    expect(x!.bodyText.endsWith(`…\n\n${article.canonicalUrl}`)).toBe(true);
  });

  it("gives Instagram the article's picture, and image posts carry their images everywhere", () => {
    const withPicture = { ...article, images: [{ url: "https://kieran.me3.app/a.jpg", altText: "Desk" }] };
    const instagram = buildSitePostShareVersions(withPicture, targets).find((version) => version.platform === "instagram");
    expect(instagram).toMatchObject({ format: "image", assetManifest: [{ url: "https://kieran.me3.app/a.jpg", kind: "image", altText: "Desk" }] });

    const gallery = {
      ...article,
      type: "image",
      images: ["1", "2", "3", "4", "5"].map((n) => ({ url: `https://kieran.me3.app/${n}.jpg` })),
    };
    const versions = buildSitePostShareVersions(gallery, targets);
    expect(versions.find((version) => version.platform === "x")).toMatchObject({ format: "carousel" });
    expect(versions.find((version) => version.platform === "x")!.assetManifest).toHaveLength(4);
    expect(versions.find((version) => version.platform === "instagram")!.assetManifest).toHaveLength(5);
  });

  it("shares a hosted video as a Short and a Reel", () => {
    const video = { ...article, type: "video", video: { url: "https://kieran.me3.app/clip.mp4" } };
    const versions = buildSitePostShareVersions(video, [
      ...targets,
      { platform: "youtube" as const, accountId: "acct-yt" },
    ]);
    expect(versions.find((version) => version.platform === "youtube")).toMatchObject({
      format: "short_video",
      title: "Write before you scroll",
      assetManifest: [{ url: "https://kieran.me3.app/clip.mp4", kind: "video" }],
    });
    expect(versions.find((version) => version.platform === "instagram")).toMatchObject({ format: "short_video" });
    expect(versions.find((version) => version.platform === "linkedin")).toMatchObject({ format: "post" });
  });

  it("picks one active account per platform and never TikTok", () => {
    expect(sitePostShareTargets([
      { id: "t", platform: "tiktok", status: "active" },
      { id: "x-old", platform: "x", status: "revoked" },
      { id: "x-new", platform: "x", status: "active" },
      { id: "li", platform: "linkedin", status: "active" },
    ])).toEqual([
      { platform: "x", accountId: "x-new" },
      { platform: "linkedin", accountId: "li" },
    ]);
  });

  it("reads images and the first paragraph from the post's markdown", () => {
    const markdown = '# Heading\n\n![Desk](assets/desk.jpg)\n\nMost **mornings** I [wrote](https://a.test).\n\n<img src="/b.png" alt="B">';
    expect(markdownImages(markdown, "https://kieran.me3.app")).toEqual([
      { url: "https://kieran.me3.app/assets/desk.jpg", altText: "Desk" },
      { url: "https://kieran.me3.app/b.png", altText: "B" },
    ]);
    expect(firstParagraph(markdown)).toBe("Heading");
    expect(firstParagraph("![x](y.jpg)\n\nMost **mornings** I [wrote](https://a.test).")).toBe("Most mornings I wrote.");
  });

  describe("with a database", () => {
    let fixture: ReturnType<typeof createEnv>;
    beforeEach(() => {
      fixture = createEnv();
    });
    afterEach(() => fixture.close());

    it("creates one site-sourced Post and returns the same one when shared again", async () => {
      const first = await shareSitePost(fixture.env, "owner", article, targets);
      expect(first.created).toBe(true);
      expect(first.post.post).toMatchObject({
        sourceType: "site",
        sourceRef: "post:kieran/write-before-you-scroll",
        sourceTitle: "Write before you scroll",
        createdBy: "user",
      });
      expect(first.post.versions.map((version) => version.platform).sort()).toEqual(["linkedin", "x"]);

      const again = await shareSitePost(fixture.env, "owner", article, targets);
      expect(again).toMatchObject({ created: false });
      expect(again.post.post.id).toBe(first.post.post.id);

      const found = await findSitePostShare(fixture.env, "owner", "site-1", "post:kieran/write-before-you-scroll");
      expect(found?.post.id).toBe(first.post.post.id);
      expect(await findSitePostShare(fixture.env, "someone-else", "site-1", "post:kieran/write-before-you-scroll")).toBeNull();
    });

    it("asks for a connected account when nothing can take the post", async () => {
      await expect(shareSitePost(fixture.env, "owner", article, [targets[2]!])).rejects.toMatchObject({ status: 409 });
    });
  });
});
