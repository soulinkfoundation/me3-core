import {
  clearContactReminder,
  createAgentContact,
  deleteAgentContact,
  listAgentContacts,
  markAgentContactInTouch,
  OUTREACH_IMPORT_BATCH,
  saveOutreachProspects,
  setContactReminder,
  updateAgentContact,
} from "@me3-core/plugin-agent-chat";
import { listContactMailHistory } from "../mailbox-outreach";
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

  // A pasted or uploaded list of prospects. Nothing is sent, and a status is
  // only what the list itself says. The web app sends long lists in batches.
  app.post("/api/contacts/outreach/import", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const body = await c.req.json<{ prospects?: unknown }>().catch((): { prospects?: unknown } => ({}));
    const prospects = Array.isArray(body.prospects)
      ? body.prospects.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      : null;
    if (!prospects || prospects.length === 0) return c.json({ error: "Add at least one person to import." }, 400);
    if (prospects.length > OUTREACH_IMPORT_BATCH) {
      return c.json({ error: `Import up to ${OUTREACH_IMPORT_BATCH} people at a time.` }, 400);
    }
    // A list names people; it never picks them by contact ID.
    const rows = prospects.map(({ name, email, organisation, offer, status, followUpAt, notes }) => ({
      name, email, organisation, offer, status, followUpAt, notes,
    }));
    const result = await saveOutreachProspects(c.env, ownerId, rows, new Date(), {
      limit: OUTREACH_IMPORT_BATCH,
      keepClosed: true,
      source: "outreach",
    });
    return c.json({
      ok: true,
      created: result.saved.filter((prospect) => prospect.created).length,
      updated: result.saved.filter((prospect) => !prospect.created).length,
      skipped: result.skipped,
    });
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

  // What ME3 Email holds for this person: subjects and dates, for the prospect panel.
  app.get("/api/contacts/:id/email-history", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await listContactMailHistory(c.env, ownerId, c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result);
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
