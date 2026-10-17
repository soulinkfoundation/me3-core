import type { Context, Hono } from "hono";
import type { Env } from "../types";

export type AppBindings = { Bindings: Env };
export type AppContext = Context<AppBindings>;
export type AppHono = Hono<AppBindings>;

export type OwnerRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
  /** Issue time (unix seconds) of the owner's web session cookie, or null for bearer-token clients. */
  ownerSessionIssuedAt?(c: AppContext): Promise<number | null>;
};
