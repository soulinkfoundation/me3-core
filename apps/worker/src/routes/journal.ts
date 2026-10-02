import { JOURNAL_PLUGIN_ID } from "@me3-core/plugin-journal";
import { createJournalArticle, deleteJournalArticle, getJournalArticle, listJournalArticles, updateJournalArticle } from "../journal-articles";
import { runJournalAssist } from "../journal-assist";
import {
  JournalConflictError,
  JournalInputError,
  deleteJournalDay,
  getJournalMedia,
  getJournalDay,
  listJournalArchive,
  uploadJournalMedia,
  updateJournalDay,
} from "../journal";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import { isCorePluginEnabled } from "../plugins";

export function registerJournalRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/journal/articles", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;
    try { return c.json(await listJournalArticles(c.env, ownerId)); }
    catch (error) { return journalErrorResponse(c, error); }
  });

  app.post("/api/journal/articles", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;
    try {
      const result = await createJournalArticle(c.env, ownerId, await c.req.json().catch(() => ({})));
      c.header("ETag", journalRevisionETag(result.article.revision));
      return c.json(result, 201);
    } catch (error) { return journalErrorResponse(c, error); }
  });

  app.get("/api/journal/articles/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;
    try {
      const result = await getJournalArticle(c.env, ownerId, c.req.param("id"));
      c.header("ETag", journalRevisionETag(result.article.revision));
      c.header("Cache-Control", "private, no-cache");
      c.header("Vary", "Authorization");
      return c.json(result);
    } catch (error) { return journalErrorResponse(c, error); }
  });

  app.patch("/api/journal/articles/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;
    try {
      const revision = parseJournalIfMatch(c.req.header("If-Match"));
      if (revision === undefined || revision === null) throw new JournalConflictError();
      const result = await updateJournalArticle(c.env, ownerId, c.req.param("id"), await c.req.json().catch(() => ({})), revision);
      c.header("ETag", journalRevisionETag(result.article.revision));
      return c.json(result);
    } catch (error) { return journalErrorResponse(c, error); }
  });

  app.delete("/api/journal/articles/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;
    try {
      const revision = parseJournalIfMatch(c.req.header("If-Match"));
      if (revision === undefined || revision === null) throw new JournalConflictError();
      return c.json(await deleteJournalArticle(c.env, ownerId, c.req.param("id"), revision));
    } catch (error) { return journalErrorResponse(c, error); }
  });

  app.post("/api/journal/assist", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;
    try { return c.json(await runJournalAssist(c.env, ownerId, await c.req.json().catch(() => ({})))); }
    catch (error) { return journalErrorResponse(c, error); }
  });

  app.get("/api/journal/days/:date", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      const result = await getJournalDay(c.env, ownerId, c.req.param("date"));
      c.header("ETag", journalRevisionETag(result.entry?.revision));
      c.header("Cache-Control", "private, no-cache");
      c.header("Vary", "Authorization");
      return c.json(result);
    } catch (error) {
      return journalErrorResponse(c, error);
    }
  });

  app.patch("/api/journal/days/:date", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      const result = await updateJournalDay(
        c.env,
        ownerId,
        c.req.param("date"),
        await c.req.json().catch(() => ({})),
        parseJournalIfMatch(c.req.header("If-Match")),
      );
      c.header("ETag", journalRevisionETag(result.entry.revision));
      return c.json(result);
    } catch (error) {
      return journalErrorResponse(c, error);
    }
  });

  app.delete("/api/journal/days/:date", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      const expectedRevision = parseJournalIfMatch(c.req.header("If-Match"));
      if (expectedRevision === null) throw new JournalConflictError();
      return c.json(
        await deleteJournalDay(c.env, ownerId, c.req.param("date"), expectedRevision),
      );
    } catch (error) {
      return journalErrorResponse(c, error);
    }
  });

  app.get("/api/journal/archive", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await listJournalArchive(c.env, ownerId, {
          limit: c.req.query("limit"),
        }),
      );
    } catch (error) {
      return journalErrorResponse(c, error);
    }
  });

  app.post("/api/journal/media", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      const form = await c.req.formData();
      const file = form.get("image") || form.get("file");
      if (!(file instanceof File)) {
        throw new JournalInputError("Journal image upload is required");
      }
      const date = form.get("date");
      return c.json(
        await uploadJournalMedia(c.env, ownerId, {
          date,
          file,
        }),
        201,
      );
    } catch (error) {
      return journalErrorResponse(c, error);
    }
  });

  app.get("/api/journal/media/:date/:filename", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      const media = await getJournalMedia(
        c.env,
        ownerId,
        c.req.param("date"),
        c.req.param("filename"),
      );
      return new Response(media.body, {
        headers: {
          "content-type": media.mimeType,
          "cache-control": "private, max-age=31536000, immutable",
          ...(media.size ? { "content-length": String(media.size) } : {}),
        },
      });
    } catch (error) {
      return journalErrorResponse(c, error);
    }
  });
}

function journalRevisionETag(revision: number | undefined): string {
  return revision === undefined ? '"journal-missing"' : `"journal-${revision}"`;
}

function parseJournalIfMatch(header: string | undefined): number | null | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (value === '"journal-missing"') return null;
  const match = /^"journal-(\d+)"$/.exec(value);
  if (!match) throw new JournalInputError("Journal If-Match validator is invalid");
  const revision = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new JournalInputError("Journal If-Match validator is invalid");
  }
  return revision;
}

async function requireJournalPlugin(c: AppContext) {
  if (await isCorePluginEnabled(c.env, JOURNAL_PLUGIN_ID)) return null;
  return c.json({ ok: false, error: "ME3 Journal is disabled" }, 403);
}

function journalErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof JournalInputError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
