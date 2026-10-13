import {
  clearContactReminder,
  createAgentContact,
  deleteAgentContact,
  listAgentContacts,
  markAgentContactInTouch,
  setContactReminder,
  updateAgentContact,
} from "../agent-chat";
import type { AppContext, AppHono } from "../http/types";

type ContactsRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

export function registerContactsRoutes(app: AppHono, deps: ContactsRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.get("/api/contacts", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    return c.json(await listAgentContacts(c.env, ownerId));
  });

  app.post("/api/contacts", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const contact = await createAgentContact(c.env, ownerId, await c.req.json().catch(() => null));
    if ("error" in contact) return c.json({ error: contact.error }, contact.status as any);
    return c.json({ ok: true, contact }, 201);
  });

  app.put("/api/contacts/:id", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const contact = await updateAgentContact(
      c.env,
      ownerId,
      c.req.param("id"),
      await c.req.json().catch(() => null),
    );
    if ("error" in contact) return c.json({ error: contact.error }, contact.status as any);
    return c.json({ ok: true, contact });
  });

  // "We talked": the owner was in touch outside ME3 (phone, WhatsApp, in person).
  app.post("/api/contacts/:id/in-touch", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const contact = await markAgentContactInTouch(c.env, ownerId, c.req.param("id"));
    if ("error" in contact) return c.json({ error: contact.error }, contact.status as any);
    return c.json({ ok: true, contact });
  });

  // "Remind me to get in touch": one reminder per person on the owner's calendar.
  app.put("/api/contacts/:id/reminder", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req
      .json<{ date?: unknown; timezone?: unknown }>()
      .catch((): { date?: unknown; timezone?: unknown } => ({}));
    const result = await setContactReminder(c.env, ownerId, c.req.param("id"), body);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, reminderAt: result.remindAt });
  });

  app.delete("/api/contacts/:id/reminder", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    await clearContactReminder(c.env, ownerId, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.delete("/api/contacts/:id", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await deleteAgentContact(c.env, ownerId, c.req.param("id"));
    if (!("error" in result)) await clearContactReminder(c.env, ownerId, c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });
}
