import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeStarterProfileHandoff,
  importManagedStarterProfile,
} from "./managed-starter-profile";
import type { DbSite, Env } from "./types";

type OnboardingState = {
  profile_site_id: string;
  current_step: number | null;
  completed_at: string | null;
};

class StarterProfileDb {
  site: DbSite | null = null;
  onboarding: OnboardingState | null = null;
  owner = {
    name: "Claimed owner",
    username: "connie",
    bio: null as string | null,
    avatar_url: null as string | null,
  };
  files = new Map<string, { content: ArrayBuffer; contentType: string }>();

  prepare(sql: string) {
    return new StarterProfileStatement(this, sql);
  }
}

class StarterProfileStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: StarterProfileDb,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM owner_onboarding")) {
      return this.db.onboarding as T | null;
    }
    if (this.sql.includes("FROM sites")) {
      return this.db.site as T | null;
    }
    return null as T | null;
  }

  async all() {
    if (this.sql.includes("FROM site_files")) {
      const prefix = `${this.values[0]}:${String(this.values[1]).replace(/%$/, "")}`;
      return { results: [...this.db.files.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, file]) => ({
        site_id: this.values[0], path: key.slice(key.indexOf(":") + 1), content: file.content, content_type: file.contentType,
      })) };
    }
    return { results: [] };
  }

  async run() {
    if (this.sql.includes("INSERT INTO owner_onboarding")) {
      this.db.onboarding = {
        profile_site_id: String(this.values[1]),
        current_step: null,
        completed_at: null,
      };
    } else if (this.sql.includes("INSERT INTO sites")) {
      const now = new Date().toISOString();
      this.db.site = {
        id: String(this.values[0]),
        user_id: String(this.values[1]),
        username: String(this.values[2]),
        site_type: "profile",
        site_role: "profile",
        template_id: null,
        custom_domain: null,
        custom_domain_status: null,
        custom_domain_cf_id: null,
        created_at: now,
        updated_at: now,
        published_at: null,
      };
    } else if (this.sql.includes("INSERT INTO site_files")) {
      this.db.files.set(`${this.values[0]}:${this.values[1]}`, {
        content: this.values[2] as ArrayBuffer,
        contentType: String(this.values[3]),
      });
    } else if (this.sql.includes("UPDATE owner_profile")) {
      this.db.owner = {
        name: String(this.values[0]),
        username: String(this.values[1]),
        bio: this.values[2] == null ? null : String(this.values[2]),
        avatar_url: this.values[3] == null ? null : String(this.values[3]),
      };
    } else if (this.sql.includes("UPDATE sites SET published_at")) {
      if (this.db.site) this.db.site.published_at = new Date().toISOString();
    } else if (this.sql.includes("UPDATE owner_onboarding")) {
      if (this.db.onboarding) this.db.onboarding.current_step = 2;
    } else if (this.sql.includes("DELETE FROM sites")) {
      this.db.site = null;
      this.db.files.clear();
    } else if (this.sql.includes("DELETE FROM owner_onboarding")) {
      this.db.onboarding = null;
    }
    return { success: true, meta: { changes: 1 } };
  }
}

function createEnv(db: StarterProfileDb): Env {
  return {
    DB: db as unknown as D1Database,
    ME3_CLOUD_API_ORIGIN: "https://api.me3.example",
  } as Env;
}

function starterProfileResponse(visibility: "public" | "private" = "public") {
  return new Response(
    JSON.stringify({
      ok: true,
      profile: {
        version: "0.1",
        visibility,
        handle: "connie",
        name: "Connie",
        bio: "A useful bio.",
        avatar: "/files/avatar.jpg",
        banner: "/files/banner.webp",
        links: { website: "https://example.com/" },
      },
      assets: [
        {
          path: "files/avatar.jpg",
          contentType: "image/jpeg",
          base64: btoa("avatar-bytes"),
        },
        {
          path: "files/banner.webp",
          contentType: "image/webp",
          base64: btoa("banner-bytes"),
        },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function fileText(db: StarterProfileDb, path: string): string | null {
  const siteId = db.site?.id;
  if (!siteId) return null;
  const file = db.files.get(`${siteId}:${path}`);
  return file ? new TextDecoder().decode(file.content) : null;
}

describe("managed starter profile import", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("acknowledges the adopted profile and visibility with the bounded claim", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await acknowledgeStarterProfileHandoff(createEnv(new StarterProfileDb()), "signed-claim", {
      outcome: "starter_imported",
      visibility: "private",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.me3.example/core/claim/starter-profile/acknowledge",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer signed-claim" }),
        body: JSON.stringify({
          outcome: "starter_imported",
          visibility: "private",
        }),
      }),
    );
  });

  it("imports and publishes the hosted profile once, then resumes at Wheel", async () => {
    const db = new StarterProfileDb();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(starterProfileResponse()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      importManagedStarterProfile(createEnv(db), {
        claimToken: "signed-claim",
        handle: "connie",
      }),
    ).resolves.toEqual({
      imported: true,
      reason: "imported",
      visibility: "public",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.me3.example/core/claim/starter-profile",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer signed-claim" }),
      }),
    );
    expect(db.site).toMatchObject({ username: "connie", published_at: expect.any(String) });
    expect(db.onboarding).toMatchObject({ current_step: 2 });
    expect(db.owner).toEqual({
      name: "Connie",
      username: "connie",
      bio: "A useful bio.",
      avatar_url: "/files/avatar.jpg",
    });
    expect(JSON.parse(fileText(db, "src/me.json") || "{}")).toMatchObject({
      handle: "connie",
      bio: "A useful bio.",
      avatar: "/files/avatar.jpg",
      banner: "/files/banner.webp",
    });
    expect(fileText(db, "public/files/avatar.jpg")).toBe("avatar-bytes");
    expect(fileText(db, "public/files/banner.webp")).toBe("banner-bytes");
    expect(fileText(db, "public/index.html")).toContain("Connie");

    const fileCount = db.files.size;
    await expect(
      importManagedStarterProfile(createEnv(db), {
        claimToken: "signed-claim",
        handle: "connie",
      }),
    ).resolves.toEqual({
      imported: true,
      reason: "already_imported",
      visibility: "public",
    });
    expect(db.files.size).toBe(fileCount);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite an existing local profile", async () => {
    const db = new StarterProfileDb();
    db.site = {
      id: "existing-site",
      user_id: "owner",
      username: "connie",
      site_type: "profile",
      site_role: "profile",
      template_id: null,
      custom_domain: null,
      custom_domain_status: null,
      custom_domain_cf_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(starterProfileResponse()));

    await expect(
      importManagedStarterProfile(createEnv(db), {
        claimToken: "signed-claim",
        handle: "connie",
      }),
    ).resolves.toEqual({
      imported: false,
      reason: "existing_profile",
      visibility: "public",
    });
    expect(db.site.id).toBe("existing-site");
    expect(db.files.size).toBe(0);
    expect(db.onboarding).toBeNull();
  });

  it("keeps an imported private profile unpublished with only a minimal public manifest", async () => {
    const db = new StarterProfileDb();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(starterProfileResponse("private")));

    await expect(
      importManagedStarterProfile(createEnv(db), {
        claimToken: "signed-claim",
        handle: "connie",
      }),
    ).resolves.toEqual({
      imported: true,
      reason: "imported",
      visibility: "private",
    });

    expect(db.site).toMatchObject({ username: "connie", published_at: null });
    expect(fileText(db, "public/index.html")).toBeNull();
    expect(JSON.parse(fileText(db, "public/me.json") || "{}")).toMatchObject({
      visibility: "private",
      handle: "connie",
    });
    expect(fileText(db, "public/me.json")).not.toContain("A useful bio.");
  });
});
