import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";

const importFreeContent = vi.fn(async (_env: unknown, _input: unknown) => ({ tables: {}, ownerFieldsFilled: [] }));
vi.mock("../free-import", () => ({ importFreeContent: (env: unknown, input: unknown) => importFreeContent(env, input) }));
const { freeImportState, runFreeImport } = await import("./free-import");

// Failure modes: a self-hosted ME3, or one not linked to ME3 Cloud, calls Cloud or offers a copy; Cloud is asked
// without this ME3's own credential; an import that threw is reported as done (the Settings row vanishes with
// content missing); a failure is never reported, so the user waits ten minutes to retry; Cloud being down
// breaks the screen that asks.
const secrets: Record<string, string> = { ME3_CLOUD_OWNER_ID: "user_1", ME3_CORE_INSTALL_ID: "core_1", ME3_CLOUD_CORE_TOKEN: "token-1" };
const env = (managed = true, values = secrets) =>
  ({
    ME3_DEPLOYMENT_MODE: managed ? "managed" : undefined,
    ME3_CLOUD_API_ORIGIN: "https://cloud.example.test",
    DB: { prepare: () => ({ bind: (name: string) => ({ first: async () => values[name] ?? null }) }) },
  }) as unknown as Env;
const cloud = (replies: Record<string, () => Response>) =>
  vi.fn(async (url: string | URL | Request, _init?: RequestInit) => replies[new URL(String(url)).pathname.split("/").pop()!]?.() ?? new Response(null, { status: 404 }));
const paths = (fetcher: ReturnType<typeof cloud>) => fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname);

describe("bringing over a free ME3", () => {
  beforeEach(() => importFreeContent.mockClear());

  it("asks Cloud with this ME3's own credential and reports what it says", async () => {
    const fetcher = cloud({ status: () => Response.json({ ok: true, available: true, status: "ready", deleteOn: "2026-12-21T10:00:00.000Z" }) });
    expect(await freeImportState(env(), fetcher)).toEqual({ available: true, status: "ready", deleteOn: "2026-12-21T10:00:00.000Z" });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://cloud.example.test/api/free-upgrade/status");
    const headers = new Headers(init?.headers);
    expect([headers.get("X-ME3-Core-Owner-ID"), headers.get("X-ME3-Core-Install-ID"), headers.get("X-ME3-Core-Update-Token")]).toEqual(["user_1", "core_1", "token-1"]);
  });

  it("offers nothing on a self-hosted or unlinked ME3, or when Cloud is down or answers oddly", async () => {
    const fetcher = cloud({ status: () => Response.json({ available: true, status: "ready" }) });
    const nothing = { available: false, status: null, deleteOn: null };
    expect(await freeImportState(env(false), fetcher)).toEqual(nothing);
    expect(await freeImportState(env(true, { ...secrets, ME3_CLOUD_CORE_TOKEN: "" }), fetcher)).toEqual(nothing);
    expect(await runFreeImport(env(false), fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await freeImportState(env(), cloud({ status: () => new Response("no", { status: 500 }) }))).toEqual(nothing);
    expect(await freeImportState(env(), vi.fn(async () => { throw new Error("down"); }) as typeof fetch)).toEqual(nothing);
    expect(await freeImportState(env(), cloud({ status: () => Response.json({ available: "yes", status: "weird", deleteOn: 5 }) }))).toEqual(nothing);
  });

  it("imports what Cloud passes on and reports success", async () => {
    const fetcher = cloud({ export: () => Response.json({ format: "me3-free-export-v1", tables: {} }), result: () => Response.json({ ok: true }) });
    expect(await runFreeImport(env(), fetcher)).toBe(true);
    expect(importFreeContent.mock.calls[0][1]).toEqual({ format: "me3-free-export-v1", tables: {} });
    expect(paths(fetcher)).toEqual(["/api/free-upgrade/export", "/api/free-upgrade/result"]);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ ok: true });
  });

  it("reports a failed import as failed, never as done", async () => {
    importFreeContent.mockRejectedValueOnce(new Error("bad export"));
    const fetcher = cloud({ export: () => Response.json({ format: "nope" }), result: () => Response.json({ ok: true }) });
    expect(await runFreeImport(env(), fetcher)).toBe(false);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ ok: false });
  });

  it("fails without importing when Cloud has nothing to pass on, and survives Cloud missing the report", async () => {
    const refused = cloud({ export: () => Response.json({ ok: false }, { status: 404 }) });
    expect(await runFreeImport(env(), refused)).toBe(false);
    expect(importFreeContent).not.toHaveBeenCalled();
    expect(paths(refused)).toEqual(["/api/free-upgrade/export"]);
    const lostReport = cloud({ export: () => Response.json({ format: "me3-free-export-v1", tables: {} }), result: () => { throw new Error("down"); } });
    expect(await runFreeImport(env(), lostReport)).toBe(true);
  });
});
