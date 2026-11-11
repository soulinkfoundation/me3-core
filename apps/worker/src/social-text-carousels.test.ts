import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCarouselTemplate,
  getTextCarousel,
  listCarouselTemplates,
  normalizeCarouselTemplateSettings,
  saveTextCarousel,
  updateCarouselTemplate,
} from "@me3-core/plugin-social-publishing";

const migrationSql = readFileSync(new URL("../migrations/0099_social_text_carousels.sql", import.meta.url), "utf8");

function createEnv() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, user_id TEXT, username TEXT);
    CREATE TABLE social_packages (id TEXT PRIMARY KEY, site_id TEXT);
    INSERT INTO sites VALUES ('site-1', 'owner', 'kieran'), ('site-2', 'someone-else', 'other');
    INSERT INTO social_packages VALUES ('post-1', 'site-1'), ('post-2', 'site-2');
    ${migrationSql}
  `);
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

describe("text carousel templates and slides", () => {
  let fixture: ReturnType<typeof createEnv>;
  beforeEach(() => {
    fixture = createEnv();
  });
  afterEach(() => fixture.close());

  it("creates the two site-linked default templates once", async () => {
    const first = await listCarouselTemplates(fixture.env, "owner", "site-1");
    expect(first.map((template) => template.name)).toEqual(["My site", "My site, dark"]);
    expect(first[0]!.settings).toMatchObject({ background: "site-light", accent: "site", font: "site", logo: true, cornerLeft: "@kieran" });
    expect(first[1]!.settings).toMatchObject({ background: "site-dark", position: "bottom", cornerRight: "Swipe →" });
    expect(await listCarouselTemplates(fixture.env, "owner", "site-1")).toHaveLength(2);
    await expect(listCarouselTemplates(fixture.env, "owner", "site-2")).rejects.toMatchObject({ status: 404 });
  });

  it("saves template edits and new templates", async () => {
    const [mine] = await listCarouselTemplates(fixture.env, "owner", "site-1");
    const updated = await updateCarouselTemplate(fixture.env, "owner", mine!.id, {
      settings: { ...mine!.settings, background: "#1F6F56", weight: "bold", cornerLeft: "  kieran.me3.app  " },
    });
    expect(updated.settings).toMatchObject({ background: "#1f6f56", weight: "bold", cornerLeft: "kieran.me3.app" });
    const created = await createCarouselTemplate(fixture.env, "owner", { siteId: "site-1", name: "Green bold", settings: updated.settings });
    const list = await listCarouselTemplates(fixture.env, "owner", "site-1");
    expect(list.map((template) => template.name)).toEqual(["My site", "My site, dark", "Green bold"]);
    expect(list.find((template) => template.id === created.id)?.settings.background).toBe("#1f6f56");
    await expect(updateCarouselTemplate(fixture.env, "someone-else", mine!.id, { name: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a post's slides and rendered files so Edit slides reopens them", async () => {
    const [template] = await listCarouselTemplates(fixture.env, "owner", "site-1");
    expect(await getTextCarousel(fixture.env, "owner", "post-1")).toBeNull();
    await saveTextCarousel(fixture.env, "owner", "post-1", {
      templateId: template!.id,
      slides: [
        { id: "a", main: "Write before you scroll.", small: "", swap: false, photoFileId: null },
        { id: "b", main: "Read the full piece", small: "Link in bio", swap: true, photoFileId: "file-9" },
      ],
      fileIds: ["f1", "f2"],
    });
    const saved = await getTextCarousel(fixture.env, "owner", "post-1");
    expect(saved).toMatchObject({ templateId: template!.id, fileIds: ["f1", "f2"] });
    expect(saved!.slides[1]).toEqual({ id: "b", main: "Read the full piece", small: "Link in bio", swap: true, photoFileId: "file-9" });
    await saveTextCarousel(fixture.env, "owner", "post-1", { templateId: null, slides: [], fileIds: [] });
    expect(await getTextCarousel(fixture.env, "owner", "post-1")).toMatchObject({ templateId: null, slides: [] });
    await expect(getTextCarousel(fixture.env, "owner", "post-2")).rejects.toMatchObject({ status: 404 });
    await expect(saveTextCarousel(fixture.env, "owner", "post-1", { templateId: "missing", slides: [] })).rejects.toMatchObject({ status: 404 });
  });

  it("drops unknown template values instead of storing them", () => {
    expect(normalizeCarouselTemplateSettings({ background: "url(x)", accent: "red", dim: 400, font: "comic" })).toMatchObject({
      background: "site-light",
      accent: "site",
      dim: 80,
      font: "site",
    });
  });
});
