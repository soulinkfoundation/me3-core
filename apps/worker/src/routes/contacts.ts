import {
  createAgentContact,
  deleteAgentContact,
  listAgentContacts,
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

  app.delete("/api/contacts/:id", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await deleteAgentContact(c.env, ownerId, c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, result.status as any);
    return c.json(result);
  });
}
