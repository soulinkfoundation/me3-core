import { describe, expect, it } from "vitest";
import {
  deleteJournalDay,
  getJournalMedia,
  getJournalDay,
  listJournalArchive,
  uploadJournalMedia,
  updateJournalDay,
} from "./journal";
import type { Env } from "./types";

type StoredJournalRow = {
  id: string;
  user_id: string;
  entry_date: string;
  title: string | null;
  body: string;
  body_format: "plain_text" | "markdown" | "html";
  metadata_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  revision?: number;
};

function createJournalEnv(rows: StoredJournalRow[] = []) {
  for (const row of rows) row.revision ??= 1;
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (!sql.includes("FROM journal_entries")) return null;
              const [userId, date] = values;
              return (rows.find(
                (row) =>
                  row.user_id === userId &&
                  row.entry_date === date &&
                  row.archived_at === null,
              ) || null) as T | null;
            },
            async all<T>() {
              if (!sql.includes("FROM journal_entries")) {
                return { results: [] as T[] };
              }
              const [userId, limit] = values;
              const results = rows
                .filter(
                  (row) =>
                    row.user_id === userId &&
                    row.archived_at === null,
                )
                .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
                .slice(0, Number(limit || 100));
              return { results: results as T[] };
            },
            async run() {
              if (sql.includes("UPDATE journal_entries") && sql.includes("SET title")) {
                const [title, body, bodyFormat, updatedAt, userId, date, revision] = values;
                const existing = rows.find(
                  (row) =>
                    row.user_id === userId &&
                    row.entry_date === date &&
                    row.archived_at === null &&
                    row.revision === revision,
                );
                if (existing) {
                  existing.title = (title as string | null) || null;
                  existing.body = body as string;
                  existing.body_format = bodyFormat as StoredJournalRow["body_format"];
                  existing.updated_at = updatedAt as string;
                  existing.revision = (existing.revision || 1) + 1;
                }
                return { meta: { changes: existing ? 1 : 0 } };
              }
              if (sql.includes("UPDATE journal_entries")) {
                const [archivedAt, updatedAt, userId, date, revision] = values;
                const existing = rows.find(
                  (row) =>
                    row.user_id === userId &&
                    row.entry_date === date &&
                    row.archived_at === null &&
                    (revision === undefined || row.revision === revision),
                );
                if (existing) {
                  existing.archived_at = archivedAt as string;
                  existing.updated_at = updatedAt as string;
                  existing.revision = (existing.revision || 1) + 1;
                }
                return { meta: { changes: existing ? 1 : 0 } };
              }
              if (!sql.includes("INSERT INTO journal_entries")) return {};
              const [id, userId, date, title, body, bodyFormat, createdAt, updatedAt] =
                values as string[];
              const existingIndex = rows.findIndex(
                (row) => row.user_id === userId && row.entry_date === date,
              );
              const nextRow: StoredJournalRow = {
                id,
                user_id: userId,
                entry_date: date,
                title: title || null,
                body,
                body_format: bodyFormat as StoredJournalRow["body_format"],
                metadata_json: "{}",
                created_at: createdAt,
                updated_at: updatedAt,
                archived_at: null,
                revision: 1,
              };
              if (existingIndex >= 0) {
                if (sql.includes("WHERE journal_entries.archived_at IS NOT NULL")) {
                  if (rows[existingIndex].archived_at === null) {
                    return { meta: { changes: 0 } };
                  }
                  rows[existingIndex] = {
                    ...rows[existingIndex],
                    ...nextRow,
                    id: rows[existingIndex].id,
                    created_at: rows[existingIndex].created_at,
                    revision: (rows[existingIndex].revision || 1) + 1,
                  };
                  return { meta: { changes: 1 } };
                }
                rows[existingIndex] = {
                  ...rows[existingIndex],
                  ...nextRow,
                  id: rows[existingIndex].id,
                  created_at: rows[existingIndex].created_at,
                  revision: (rows[existingIndex].revision || 1) + 1,
                };
              } else {
                rows.push(nextRow);
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };

  return { DB: db } as unknown as Env;
}

describe("Journal plugin entries", () => {
  it("does not create an entry when reading an empty day", async () => {
    const env = createJournalEnv();

    await expect(getJournalDay(env, "owner", "2026-06-02")).resolves.toEqual({
      entry: null,
    });
  });

  it("upserts a titled rich-text daily entry", async () => {
    const env = createJournalEnv();

    const result = await updateJournalDay(env, "owner", "2026-06-02", {
      title: "Launch notes",
      body: "<p>Remember this.</p>",
      bodyFormat: "html",
    });

    expect(result.entry.title).toBe("Launch notes");
    expect(result.entry.body).toBe("<p>Remember this.</p>");
    expect(result.entry.bodyFormat).toBe("html");
    await expect(getJournalDay(env, "owner", "2026-06-02")).resolves.toMatchObject({
      entry: {
        title: "Launch notes",
        body: "<p>Remember this.</p>",
      },
    });
  });

  it("atomically rejects stale saves and deletes by revision", async () => {
    const env = createJournalEnv();
    const created = await updateJournalDay(
      env,
      "owner",
      "2026-06-02",
      { title: "First", body: "one", bodyFormat: "markdown" },
      null,
    );
    expect(created.entry.revision).toBe(1);

    await expect(
      updateJournalDay(
        env,
        "owner",
        "2026-06-02",
        { title: "Stale create", body: "lost", bodyFormat: "markdown" },
        null,
      ),
    ).rejects.toMatchObject({ status: 409 });

    const updated = await updateJournalDay(
      env,
      "owner",
      "2026-06-02",
      { title: "Second", body: "two", bodyFormat: "markdown" },
      1,
    );
    expect(updated.entry.revision).toBe(2);

    await expect(
      updateJournalDay(
        env,
        "owner",
        "2026-06-02",
        { title: "Stale", body: "must not win", bodyFormat: "markdown" },
        1,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(deleteJournalDay(env, "owner", "2026-06-02", 1)).rejects.toMatchObject({
      status: 409,
    });
    await expect(getJournalDay(env, "owner", "2026-06-02")).resolves.toMatchObject({
      entry: { title: "Second", body: "two", revision: 2 },
    });

    await expect(deleteJournalDay(env, "owner", "2026-06-02", 2)).resolves.toEqual({
      ok: true,
    });
    const recreated = await updateJournalDay(
      env,
      "owner",
      "2026-06-02",
      { title: "Recreated", body: "four", bodyFormat: "markdown" },
      null,
    );
    expect(recreated.entry).toMatchObject({ title: "Recreated", body: "four", revision: 4 });
  });

  it("lists non-empty archive entries newest first", async () => {
    const env = createJournalEnv([
      {
        id: "old",
        user_id: "owner",
        entry_date: "2026-05-20",
        title: null,
        body: "Older entry",
        body_format: "html",
        metadata_json: "{}",
        created_at: "2026-05-20T09:00:00Z",
        updated_at: "2026-05-20T09:00:00Z",
        archived_at: null,
      },
      {
        id: "blank",
        user_id: "owner",
        entry_date: "2026-05-21",
        title: "",
        body: "<p></p>",
        body_format: "html",
        metadata_json: "{}",
        created_at: "2026-05-21T09:00:00Z",
        updated_at: "2026-05-21T09:00:00Z",
        archived_at: null,
      },
      {
        id: "title-only",
        user_id: "owner",
        entry_date: "2026-05-23",
        title: "Title only",
        body: "<p></p>",
        body_format: "html",
        metadata_json: "{}",
        created_at: "2026-05-23T09:00:00Z",
        updated_at: "2026-05-23T09:00:00Z",
        archived_at: null,
      },
      {
        id: "new",
        user_id: "owner",
        entry_date: "2026-05-22",
        title: "Newer",
        body: "<p>A newer entry.</p>",
        body_format: "html",
        metadata_json: "{}",
        created_at: "2026-05-22T09:00:00Z",
        updated_at: "2026-05-22T09:00:00Z",
        archived_at: null,
      },
    ]);

    await expect(listJournalArchive(env, "owner")).resolves.toMatchObject({
      entries: [
        { id: "title-only", title: "Title only", preview: "" },
        { id: "new", title: "Newer", preview: "A newer entry." },
        { id: "old", title: null, preview: "Older entry" },
      ],
    });
  });

  // Failure mode: escaped markup in a body reaches the Library list as literal HTML.
  it("keeps escaped HTML out of archive previews", async () => {
    const env = createJournalEnv([
      { id: "escaped", user_id: "owner", entry_date: "2026-05-22", title: null, body: "&lt;p&gt;Escaped &lt;em&gt;markup&lt;/em&gt;&lt;/p&gt;&amp;lt;br&amp;gt;5 &amp;lt; 6", body_format: "html", metadata_json: "{}", created_at: "2026-05-22T09:00:00Z", updated_at: "2026-05-22T09:00:00Z", archived_at: null },
    ]);
    await expect(listJournalArchive(env, "owner")).resolves.toMatchObject({ entries: [{ id: "escaped", preview: "Escaped markup 5 < 6" }] });
  });

  it("soft-deletes an entry from day reads and archive lists", async () => {
    const env = createJournalEnv([
      {
        id: "entry",
        user_id: "owner",
        entry_date: "2026-05-24",
        title: "Delete me",
        body: "<p>Gone soon.</p>",
        body_format: "html",
        metadata_json: "{}",
        created_at: "2026-05-24T09:00:00Z",
        updated_at: "2026-05-24T09:00:00Z",
        archived_at: null,
      },
    ]);

    await expect(
      deleteJournalDay(env, "owner", "2026-05-24"),
    ).resolves.toEqual({ ok: true });

    await expect(getJournalDay(env, "owner", "2026-05-24")).resolves.toEqual({
      entry: null,
    });
    await expect(listJournalArchive(env, "owner")).resolves.toEqual({
      entries: [],
    });
  });

  it("returns an inline image fallback when R2 is not configured", async () => {
    const env = createJournalEnv();
    const file = new File([new Uint8Array([1, 2, 3])], "note.png", {
      type: "image/png",
    });

    const result = await uploadJournalMedia(env, "owner", {
      date: "2026-06-02",
      file,
    });

    expect(result).toMatchObject({
      ok: true,
      mimeType: "image/png",
      size: 3,
      storage: "inline",
    });
    expect(result.filename).toMatch(/^[0-9a-f-]+\.png$/);
    expect(result.src).toBe("data:image/png;base64,AQID");
  });

  it("stores journal images in SITE_ASSETS when R2 is configured", async () => {
    const putCalls: Array<{
      key: string;
      value: ArrayBuffer | ReadableStream | string;
      options?: R2PutOptions;
    }> = [];
    const env = {
      ...createJournalEnv(),
      SITE_ASSETS: {
        put: async (
          key: string,
          value: ArrayBuffer | ReadableStream | string,
          options?: R2PutOptions,
        ) => {
          putCalls.push({ key, value, options });
          return null;
        },
      },
    } as unknown as Env;
    const file = new File([new Uint8Array([4, 5, 6])], "note.webp", {
      type: "image/webp",
    });

    const result = await uploadJournalMedia(env, "owner", {
      date: "2026-06-02",
      file,
    });

    expect(result.storage).toBe("r2");
    expect(result.src).toBe(`/api/journal/media/2026-06-02/${result.filename}`);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].key).toBe(`journal/owner/2026-06-02/${result.filename}`);
    expect(putCalls[0].options?.httpMetadata).toEqual({ contentType: "image/webp" });
    expect(putCalls[0].options?.customMetadata).toMatchObject({
      feature: "journal",
      ownerId: "owner",
      date: "2026-06-02",
      originalName: "note.webp",
    });
  });

  it("reads journal images back from SITE_ASSETS", async () => {
    const env = {
      ...createJournalEnv(),
      SITE_ASSETS: {
        get: async (key: string) => {
          expect(key).toBe("journal/owner/2026-06-02/image.png");
          return {
            body: new ReadableStream(),
            size: 3,
            httpMetadata: { contentType: "image/png" },
            customMetadata: {},
          };
        },
      },
    } as unknown as Env;

    await expect(
      getJournalMedia(env, "owner", "2026-06-02", "image.png"),
    ).resolves.toMatchObject({
      mimeType: "image/png",
      size: 3,
    });
  });
});
