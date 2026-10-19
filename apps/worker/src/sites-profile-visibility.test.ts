import { describe, expect, it } from "vitest";
import { serveMeJsonResponse } from "./sites";
import type { DbSite, Env } from "./types";

function createVisibilityEnv(input: {
  published: boolean;
  sourceVisibility: "public" | "private";
  storedPublic?: Record<string, unknown>;
}): Env {
  const site: DbSite = {
    id: "site-1",
    user_id: "owner",
    username: "connie",
    site_type: "profile",
    site_role: "profile",
    template_id: null,
    custom_domain: null,
    custom_domain_status: null,
    custom_domain_cf_id: null,
    created_at: "2026-08-24T09:00:00.000Z",
    updated_at: "2026-08-24T09:00:00.000Z",
    published_at: input.published ? "2026-08-24T09:00:00.000Z" : null,
  };
  const source = JSON.stringify({
    version: "0.1",
    visibility: input.sourceVisibility,
    handle: "connie",
    name: "Connie",
    bio: "Private source biography",
  });
  const files = new Map([
    ["src/me.json", source],
    ["public/me.json", input.storedPublic ? JSON.stringify(input.storedPublic) : source],
  ]);

  return {
    ME3_SITE_USERNAME: "connie",
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...bound: unknown[]) {
            values = bound;
            return this;
          },
          async first<T>() {
            if (sql.includes("lower(custom_domain)")) return null;
            if (sql.includes("FROM sites")) return site as T;
            if (sql.includes("FROM site_files")) {
              const path = String(values[1]);
              const content = files.get(path);
              if (!content) return null;
              const bytes = new TextEncoder().encode(content);
              return {
                site_id: site.id,
                path,
                content: bytes,
                content_type: "application/json",
                size: bytes.byteLength,
                sha256: null,
                updated_at: site.updated_at,
              } as T;
            }
            return null;
          },
        };
      },
    } as D1Database,
  } as Env;
}

describe("public me.json visibility", () => {
  // The Mission moved out of the public protocol. A site published before the move still has it in its stored
  // public me.json, so it has to be left out when served, not only when the site is next published.
  it("leaves the Mission out of a site published before it became private", async () => {
    const response = await serveMeJsonResponse(
      createVisibilityEnv({ published: true, sourceVisibility: "public", storedPublic: {
        version: "0.3", kind: "person", visibility: "public", name: "Connie", handle: "connie",
        business: { positioningStatement: "I help makers ship.", audience: "makers" },
      } }),
      new Request("https://connie.example/.well-known/me.json"),
    );
    const profile = (await response.json()) as Record<string, unknown>;

    expect(profile).toMatchObject({ visibility: "public", handle: "connie" });
    expect(profile).not.toHaveProperty("business");
  });

  it("forces an unpublished profile to a minimal private projection", async () => {
    const response = await serveMeJsonResponse(
      createVisibilityEnv({ published: false, sourceVisibility: "public" }),
      new Request("https://connie.example/.well-known/me.json"),
    );
    const profile = (await response.json()) as Record<string, unknown>;

    expect(profile).toMatchObject({ visibility: "private", handle: "connie" });
    expect(profile).not.toHaveProperty("bio");
  });

  it("serves the full public projection only while the site is published", async () => {
    const response = await serveMeJsonResponse(
      createVisibilityEnv({ published: true, sourceVisibility: "public" }),
      new Request("https://connie.example/.well-known/me.json"),
    );
    const profile = (await response.json()) as Record<string, unknown>;

    expect(profile).toMatchObject({
      visibility: "public",
      handle: "connie",
      bio: "Private source biography",
    });
  });
});
