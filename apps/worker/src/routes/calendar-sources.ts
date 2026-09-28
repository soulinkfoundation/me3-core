import {
  CalendarSourceInputError,
  acknowledgeSoulinkCalendarSource,
  handleSoulinkCalendarSourceAction,
  importIcsUpload,
  removeImportedCalendarEvent,
  removeCalendarSource,
  refreshCalendarSource,
  subscribeIcsUrl,
} from "../calendar-sources";
import type { AppHono, OwnerRouteDeps } from "../http/types";

export function registerCalendarSourceRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.post("/api/calendar/import/ics", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await importIcsUpload(c.env, ownerId, await c.req.formData()),
        201,
      );
    } catch (error) {
      if (error instanceof CalendarSourceInputError) {
        return c.json({ error: error.message }, error.status as any);
      }
      throw error;
    }
  });

  app.post("/api/calendar/sources/ics-url", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      const body = await c.req.json<{ url?: string }>().catch(() => null);
      const result = await subscribeIcsUrl(c.env, ownerId, body);
      try {
        if (body?.url) await acknowledgeSoulinkCalendarSource(body.url, result.source.id);
      } catch (error) {
        await removeCalendarSource(c.env, ownerId, result.source.id);
        throw error;
      }
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof CalendarSourceInputError) {
        return c.json({ error: error.message }, error.status as any);
      }
      throw error;
    }
  });

  for (const action of ["refresh", "disconnect"] as const) {
    app.post(`/api/calendar/sources/:sourceId/soulink-${action}`, async (c) => {
      const body = await c.req.json<{ token?: string }>().catch((): { token?: string } => ({}));
      if (!body.token) return c.json({ error: "Calendar source not found" }, 404);
      try {
        return c.json(await handleSoulinkCalendarSourceAction(c.env, c.req.param("sourceId"), body.token, action));
      } catch (error) {
        if (error instanceof CalendarSourceInputError) return c.json({ error: error.message }, error.status as any);
        throw error;
      }
    });
  }

  app.post("/api/calendar/sources/:sourceId/refresh", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await refreshCalendarSource(c.env, ownerId, c.req.param("sourceId")),
      );
    } catch (error) {
      if (error instanceof CalendarSourceInputError) {
        return c.json({ error: error.message }, error.status as any);
      }
      throw error;
    }
  });

  app.delete("/api/calendar/sources/:sourceId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await removeCalendarSource(c.env, ownerId, c.req.param("sourceId")),
      );
    } catch (error) {
      if (error instanceof CalendarSourceInputError) {
        return c.json({ error: error.message }, error.status as any);
      }
      throw error;
    }
  });

  app.delete("/api/calendar/imported-events/:eventId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await removeImportedCalendarEvent(
          c.env,
          ownerId,
          c.req.param("eventId"),
        ),
      );
    } catch (error) {
      if (error instanceof CalendarSourceInputError) {
        return c.json({ error: error.message }, error.status as any);
      }
      throw error;
    }
  });
}
