import { importFreeContent } from "../free-import";
import type { AppHono, OwnerRouteDeps } from "../http/types";
import { isManagedRuntime } from "../managed-runtime-lifecycle";
import { getMe3CloudApiOrigin } from "../sites";
import type { Env } from "../types";

/**
 * Bringing over the content of the owner's old free ME3 (free-import.ts). The owner asks from the apps, as
 * often as they like until the free ME3 is deleted. This ME3 fetches the content from ME3 Cloud with its own
 * credential, imports it, and tells Cloud how it went. Paid hosted ME3s only.
 */
export type FreeImportState = { available: boolean; status: "ready" | "copying" | "done" | "failed" | null; deleteOn: string | null };
const NOTHING: FreeImportState = { available: false, status: null, deleteOn: null };
const STATUSES = ["ready", "copying", "done", "failed"];
type Fetcher = typeof fetch;

async function cloud(env: Env, path: string, init: RequestInit, fetcher: Fetcher): Promise<Response | null> {
  if (!isManagedRuntime(env)) return null;
  const secret = (name: string) => env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?").bind(name).first<string>("value");
  const [ownerId, installId, token] = await Promise.all([secret("ME3_CLOUD_OWNER_ID"), secret("ME3_CORE_INSTALL_ID"), secret("ME3_CLOUD_CORE_TOKEN")]);
  if (!ownerId?.trim() || !installId?.trim() || !token?.trim()) return null;
  return fetcher(new URL(`/api/free-upgrade/${path}`, getMe3CloudApiOrigin(env)), {
    ...init,
    headers: { "Content-Type": "application/json", "X-ME3-Core-Owner-ID": ownerId.trim(), "X-ME3-Core-Install-ID": installId.trim(), "X-ME3-Core-Update-Token": token.trim() },
  });
}

/** Never throws: when Cloud cannot be asked, there is simply nothing to offer right now. */
export async function freeImportState(env: Env, fetcher: Fetcher = fetch): Promise<FreeImportState> {
  try {
    const response = await cloud(env, "status", { signal: AbortSignal.timeout(10_000) }, fetcher);
    if (!response?.ok) return NOTHING;
    const body = (await response.json()) as Record<string, unknown>;
    return {
      available: body.available === true,
      status: STATUSES.includes(body.status as string) ? (body.status as FreeImportState["status"]) : null,
      deleteOn: typeof body.deleteOn === "string" ? body.deleteOn : null,
    };
  } catch {
    return NOTHING;
  }
}

/** Fetches, imports and reports. True when everything the free ME3 had is now here. Safe to run again. */
export async function runFreeImport(env: Env, fetcher: Fetcher = fetch): Promise<boolean> {
  let imported = false;
  let started = false;
  try {
    const response = await cloud(env, "export", { method: "POST", signal: AbortSignal.timeout(40_000) }, fetcher);
    started = Boolean(response?.ok);
    if (response?.ok) {
      await importFreeContent(env, await response.json());
      imported = true;
    }
  } catch (error) {
    console.error("Free ME3 import failed", error instanceof Error ? error.message : error);
  }
  // Cloud already knows about an export it could not serve; a report is only owed for one it did.
  if (started) {
    await cloud(env, "result", { method: "POST", body: JSON.stringify({ ok: imported }), signal: AbortSignal.timeout(10_000) }, fetcher).catch(() => null);
  }
  return imported;
}

export function registerFreeImportRoutes(app: AppHono, deps: OwnerRouteDeps): void {
  app.get("/api/free-import", async (c) => {
    if (!(await deps.requireOwner(c))) return deps.unauthorized(c);
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, ...(await freeImportState(c.env)) });
  });

  app.post("/api/free-import", async (c) => {
    if (!(await deps.requireOwner(c))) return deps.unauthorized(c);
    // The copy carries on if the app goes away mid-request.
    const job = runFreeImport(c.env);
    c.executionCtx.waitUntil(job);
    const imported = await job;
    c.header("Cache-Control", "no-store");
    return c.json({ ok: imported, status: imported ? "done" : "failed" });
  });
}
