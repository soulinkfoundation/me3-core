import type { Hono } from "hono";
import { FreeImportInputError, importFreeContent } from "../free-import";
import { getManagedInstallationId, isManagedRuntime } from "../managed-runtime-lifecycle";
import { Me3CloudJwtVerificationError, verifyMe3CloudJwt } from "../me3-cloud-jwt";
import type { Env } from "../types";

export const FREE_IMPORT_PATH = "/api/managed/free-import";
export const FREE_IMPORT_AUDIENCE = "me3-managed-free-import";
export const FREE_IMPORT_TOKEN_TYPE = "managed_free_import";
const TOKEN_MAX_AGE_SECONDS = 300;

export type FreeImportClaims = {
  iss?: unknown; aud?: unknown; typ?: unknown; sub?: unknown; installation_id?: unknown; owner_id?: unknown; iat?: unknown; exp?: unknown;
};

/** The token must be for this ME3 and for the ME3 account that owns it, and be freshly issued. */
export function freeImportClaimsAccepted(claims: FreeImportClaims, installationId: string | null, ownerId: string | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const iat = typeof claims.iat === "number" ? claims.iat : NaN;
  const exp = typeof claims.exp === "number" ? claims.exp : NaN;
  return Boolean(
    installationId && ownerId &&
    claims.aud === FREE_IMPORT_AUDIENCE && claims.typ === FREE_IMPORT_TOKEN_TYPE &&
    claims.sub === installationId && claims.installation_id === installationId && claims.owner_id === ownerId &&
    Number.isInteger(iat) && Number.isInteger(exp) && iat <= nowSeconds + 30 && exp > nowSeconds && exp - iat <= TOKEN_MAX_AGE_SECONDS,
  );
}

/**
 * ME3 Cloud delivers the content of a user's closed free ME3 here when the user asks to bring it over
 * (free-import.ts). Paid hosted ME3s only; the caller is ME3 Cloud, proven by a short-lived signed token.
 */
export function registerFreeImportRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post(FREE_IMPORT_PATH, async (c) => {
    if (!isManagedRuntime(c.env)) return c.json({ ok: false, error: "Not found" }, 404);
    const token = /^Bearer\s+([^\s]+)$/i.exec(c.req.header("Authorization")?.trim() ?? "")?.[1];
    if (!token) return c.json({ ok: false, code: "free_import_authentication_required", error: "Authentication is required" }, 401);
    try {
      const claims = await verifyMe3CloudJwt<FreeImportClaims>(c.env, token);
      const ownerId = await c.env.DB.prepare("SELECT value FROM install_secrets WHERE name = 'ME3_CLOUD_OWNER_ID'").first<string>("value");
      if (!freeImportClaimsAccepted(claims, getManagedInstallationId(c.env), ownerId)) {
        return c.json({ ok: false, code: "free_import_token_invalid", error: "The import token was not accepted" }, 403);
      }
      const result = await importFreeContent(c.env, await c.req.json().catch(() => null));
      c.header("Cache-Control", "no-store");
      return c.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof FreeImportInputError) return c.json({ ok: false, code: "free_import_invalid", error: error.message }, 400);
      if (error instanceof Me3CloudJwtVerificationError) {
        return error.kind === "unavailable"
          ? c.json({ ok: false, code: "free_import_verification_unavailable", error: "ME3 could not verify the request; try again" }, 503)
          : c.json({ ok: false, code: "free_import_token_invalid", error: "The import token was not accepted" }, 403);
      }
      throw error;
    }
  });
}
