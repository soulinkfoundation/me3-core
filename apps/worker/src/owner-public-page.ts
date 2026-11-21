// Hooks the hosted free runtime sets on Env (see apps/free-runtime). A Core install has neither, so these
// answer as a Core install always did: no public page beyond its site, and the fast model always allowed.
import type { Env, OwnerPublicPage } from "./types";

/** The free owner's public page (bio and town), or null: not a free ME3, page private, or Cloud unreachable. */
export async function ownerPublicPage(env: Env): Promise<OwnerPublicPage | null> {
  if (!env.ME3_OWNER_PUBLIC_PAGE) return null;
  try { return await env.ME3_OWNER_PUBLIC_PAGE(); } catch { return null; }
}

/** Whether a background fast-model call may run now. Fails closed when the free runtime cannot tell. */
export async function fastModelAllowed(env: Env): Promise<boolean> {
  if (!env.ME3_FAST_MODEL_ALLOWED) return true;
  try { return await env.ME3_FAST_MODEL_ALLOWED(); } catch { return false; }
}
