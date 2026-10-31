import {
  createEmailSendIdentity,
  deleteEmailSendIdentity,
  listEmailSendIdentities,
  sendEmailSendIdentityCode,
  verifyEmailSendIdentity,
} from "../email-send-identities";
import { EmailProviderDeliveryUnknownError, EmailProviderInputError } from "../email-providers";
import type { AppContext, AppHono } from "../http/types";

type EmailSendIdentityRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

export function registerEmailSendIdentityRoutes(app: AppHono, deps: EmailSendIdentityRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  const handle = async (c: AppContext, work: (ownerId: string) => Promise<unknown>, status: 200 | 201 = 200) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);
    try {
      return c.json(await work(ownerId), status);
    } catch (error) {
      if (error instanceof EmailProviderInputError || error instanceof EmailProviderDeliveryUnknownError) {
        return c.json({ error: error.message }, error.status as any);
      }
      throw error;
    }
  };

  app.get("/api/email-send-identities", (c) =>
    handle(c, async (ownerId) => ({ identities: await listEmailSendIdentities(c.env, ownerId) })));

  app.post("/api/email-send-identities", (c) =>
    handle(c, async (ownerId) => {
      const body = await c.req.json<unknown>().catch((): unknown => ({}));
      return { identity: await createEmailSendIdentity(c.env, ownerId, body) };
    }, 201));

  app.post("/api/email-send-identities/:id/code", (c) =>
    handle(c, async (ownerId) => ({
      identity: await sendEmailSendIdentityCode(c.env, ownerId, c.req.param("id")),
    })));

  app.post("/api/email-send-identities/:id/verify", (c) =>
    handle(c, async (ownerId) => {
      const body = await c.req.json<unknown>().catch((): unknown => ({}));
      return { identity: await verifyEmailSendIdentity(c.env, ownerId, c.req.param("id"), body) };
    }));

  app.delete("/api/email-send-identities/:id", (c) =>
    handle(c, async (ownerId) => {
      if (!(await deleteEmailSendIdentity(c.env, ownerId, c.req.param("id")))) {
        throw new EmailProviderInputError("Send-as address not found", 404);
      }
      return { ok: true };
    }));
}
