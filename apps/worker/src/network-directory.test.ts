import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizePublicProfileSchedulingTarget,
  getSoulinkDirectoryBridgeConfig,
  removePublishedProfileFromSoulinkDirectory,
  searchPeople,
  searchPublicSoulinkDirectory,
  syncPublishedProfileToSoulinkDirectory,
} from "./network-directory";
import type { Env } from "./types";
import { ensureSoulinkContactsFresh } from "./routes/channels";

vi.mock("./routes/channels", () => ({ ensureSoulinkContactsFresh: vi.fn().mockResolvedValue(null) }));

const SECRETS = {
  ME3_CLOUD_OWNER_ID: "owner-1",
  ME3_CORE_INSTALL_ID: "core_11111111-1111-4111-8111-111111111111",
  ME3_CLOUD_CORE_TOKEN: "secret-token",
};

afterEach(() => vi.unstubAllGlobals());

describe("Soulink directory bridge", () => {
  it("uses only the linked installation identity", async () => {
    await expect(getSoulinkDirectoryBridgeConfig(createEnv(SECRETS))).resolves.toEqual({
      origin: "https://api.me3.app",
      headers: {
        "X-ME3-Core-Owner-ID": "owner-1",
        "X-ME3-Core-Install-ID": "core_11111111-1111-4111-8111-111111111111",
        "X-ME3-Core-Update-Token": "secret-token",
      },
    });
  });

  it("reports private visibility so Cloud can purge stale public data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { code: "profile_private" },
        { status: 422 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncPublishedProfileToSoulinkDirectory(createEnv(SECRETS), {
        version: "0.3",
        kind: "person",
        visibility: "private",
        name: "Owner",
      }),
    ).resolves.toBe("not_listed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.me3.app/v1/network/profile");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  });

  it("removes the indexed profile when publication ends", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(removePublishedProfileFromSoulinkDirectory(createEnv(SECRETS)))
      .resolves.toBe("removed");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.me3.app/v1/network/profile",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("normalizes bounded public search results and drops precise coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      query: "event photographer",
      results: [{
        profileId: "profile-aoife",
        name: "Aoife Lens",
        handle: "aoife",
        kind: "person",
        bio: "Documentary event photographer",
        avatarUrl: "https://aoife.example/avatar.jpg",
        profileUrl: "https://aoife.example/.well-known/me.json",
        publicUrl: "https://aoife.example/",
        location: {
          label: "Galway, Ireland",
          precision: "city",
          countryCode: "IE",
          latitude: 53.2707,
          longitude: -9.0568,
        },
        offerings: [{
          type: "service",
          id: "event-photo",
          title: "Event photography",
          description: "Candid event coverage",
          url: "https://aoife.example/services/event-photo",
          durationMinutes: 120,
          price: { amount: "450", currency: "EUR" },
        }],
        reasons: ["Offers Event photography"],
        indexedAt: "2026-08-19T12:00:00.000Z",
      }],
    })));

    const result = await searchPublicSoulinkDirectory(createEnv(SECRETS), {
      query: "event photographer",
      offeringType: "service",
      countryCode: "ie",
    });

    expect(result.results[0]).toMatchObject({
      relationshipTier: "public",
      profileId: "profile-aoife",
      name: "Aoife Lens",
      location: { label: "Galway, Ireland", countryCode: "IE" },
      offerings: [{ type: "service", title: "Event photography" }],
    });
    expect(result.results[0].location).not.toHaveProperty("latitude");
  });

  it("asks Cloud for the owner's own listing only when they want to see how they are found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ query: "career coach in Leeds", results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchPeople(createEnv(SECRETS), "owner-1", { query: "career coach in Leeds" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).not.toHaveProperty("includeSelf");
    await searchPeople(createEnv(SECRETS), "owner-1", { query: "career coach in Leeds", includeMe: true });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({ includeSelf: true });
  });

  it("searches the local directory on a local install instead of asking the owner to link Cloud", async () => {
    const standin = {
      version: "0.3", kind: "person", visibility: "public", name: "Kieran (stand-in)", handle: "kieran", url: "http://127.0.0.1:8788/",
      bio: "Builds ME3.", services: [{ id: "service:intro-call", title: "Free 20-minute call", durationMinutes: 20, status: "active" }],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "http://127.0.0.1:8788/me.json" ? Response.json(standin) : new Response("", { status: 404 })));
    const env = { ...createEnv({}), ENVIRONMENT: "local", ME3_LOCAL_DIRECTORY_ORIGINS: "http://127.0.0.1:8788" } as Env;

    const result = await searchPeople(env, "owner-1", { query: "Kieran" });
    expect(result.results).toEqual([expect.objectContaining({ relationshipTier: "public", profileId: "local:http://127.0.0.1:8788", name: "Kieran (stand-in)", publicUrl: "http://127.0.0.1:8788/" })]);
    expect(result.warnings).toEqual([]);

    const deployed = await searchPeople(createEnv({}), "owner-1", { query: "Kieran" });
    expect(deployed.results).toEqual([]);
    expect(deployed.warnings).toEqual(["Public Soulink profiles are unavailable until this installation is linked to me3.app."]);
  });

  it("authorizes one exact stable profile for the private Soulink relay", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      profileId: "profile-aoife",
      name: "Aoife Lens",
      handle: "aoife",
      authorization: "signed-network-authorization",
      expiresAt: "2026-08-27T12:00:00.000Z",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      authorizePublicProfileSchedulingTarget(
        createEnv(SECRETS),
        "profile-aoife",
        "schedule-request",
      ),
    ).resolves.toEqual({
      profileId: "profile-aoife",
      name: "Aoife Lens",
      handle: "aoife",
      authorization: "signed-network-authorization",
      expiresAt: "2026-08-27T12:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.me3.app/v1/network/scheduling/authorize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          profileId: "profile-aoife",
          requestId: "schedule-request",
        }),
      }),
    );
  });
});

describe("unified people search", () => {
  it("ranks a matching direct Link before an unknown public profile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      query: "developer",
      results: [
        publicProfile({
          profileId: "profile-public",
          name: "Public Developer",
          handle: "public-dev",
          profileUrl: "https://public.example/me.json",
          publicUrl: "https://public.example/",
        }),
        publicProfile({
          profileId: "profile-link",
          name: "Linked Developer",
          handle: "linked-dev",
          profileUrl: "https://linked.example/me.json",
          publicUrl: "https://linked.example/",
        }),
      ],
    })));

    const result = await searchPeople(
      createEnv(SECRETS, [soulinkContact({
        name: "Linked Developer",
        handle: "linked-dev",
        me3Url: "https://linked.example/",
      })]),
      "owner",
      { query: "developer" },
    );

    expect(result.results.map((item) => [item.name, item.relationshipTier])).toEqual([
      ["Linked Developer", "link"],
      ["Public Developer", "public"],
    ]);
    expect(result.results[0]).toMatchObject({
      contactName: "Linked Developer",
      profileId: "profile-link",
      reasons: ["One of your Soulink Links", "Offers Software development"],
    });
  });

  it("searches the Links it has instead of waiting on a slow Links refresh", async () => {
    vi.useFakeTimers();
    vi.mocked(ensureSoulinkContactsFresh).mockReturnValueOnce(new Promise(() => {}));
    const search = searchPeople(
      createEnv({}, [soulinkContact({ name: "Sarah Byrne", handle: "sarah", me3Url: "https://sarah.example/" })]),
      "owner",
      { query: "Sarah" },
    );
    await vi.advanceTimersByTimeAsync(1_600);
    const result = await search;
    vi.useRealTimers();
    expect(result.results.map((item) => item.name)).toEqual(["Sarah Byrne"]);
  });

  it("still finds a named Link when public search is unavailable", async () => {
    const result = await searchPeople(
      createEnv({}, [soulinkContact({
        name: "Sarah Byrne",
        handle: "sarah",
        me3Url: "https://sarah.example/",
      })]),
      "owner",
      { query: "Sarah" },
    );

    expect(result.results).toEqual([
      expect.objectContaining({
        name: "Sarah Byrne",
        relationshipTier: "link",
        profileId: null,
      }),
    ]);
    expect(result.warnings).toContain(
      "Public Soulink profiles are unavailable until this installation is linked to me3.app.",
    );
  });
});

function createEnv(
  secrets: Record<string, string>,
  contacts: Array<Record<string, unknown>> = [],
): Env {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first<T>() {
                if (!sql.includes("install_secrets")) return null as T;
                const value = secrets[String(values[0])];
                return value ? ({ value } as T) : null;
              },
              async all<T>() {
                return {
                  results: sql.includes("FROM contacts") ? contacts as T[] : [],
                };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  } as Env;
}

function publicProfile(input: {
  profileId: string;
  name: string;
  handle: string;
  profileUrl: string;
  publicUrl: string;
}) {
  return {
    ...input,
    kind: "person",
    bio: "Software developer",
    location: null,
    offerings: [{
      type: "service",
      id: "software-development",
      title: "Software development",
      description: "Web application development",
    }],
    reasons: ["Offers Software development"],
    indexedAt: "2026-08-31T12:00:00.000Z",
  };
}

function soulinkContact(input: { name: string; handle: string; me3Url: string }) {
  return {
    id: `contact-${input.handle}`,
    user_id: "owner",
    name: input.name,
    email: null,
    phone: null,
    source: "soulink",
    source_ref: `node-${input.handle}`,
    relationship: "contact",
    status: "active",
    notes: null,
    tags: "[]",
    last_interaction_at: "2026-08-31T12:00:00.000Z",
    next_followup_at: null,
    outreach_status: null,
    social_handles: JSON.stringify({ soulink: input.handle, me3: input.me3Url }),
    metadata: JSON.stringify({ me3Url: input.me3Url, soulinkHandle: input.handle }),
    created_at: "2026-08-01T12:00:00.000Z",
    updated_at: "2026-08-31T12:00:00.000Z",
  };
}

function createExecutionDb() {
  const executions: Array<Record<string, unknown>> = [];
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (!sql.includes("FROM agent_tool_executions")) return null as T;
              return (executions.find((item) =>
                item.user_id === values[0] &&
                item.request_id === values[1] &&
                item.tool_call_id === values[2]) || null) as T;
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO agent_tool_executions")) {
                executions.push({
                  id: values[0],
                  user_id: values[1],
                  request_id: values[2],
                  tool_call_id: values[3],
                  tool_name: values[4],
                  status: "running",
                });
              }
              if (sql.includes("UPDATE agent_tool_executions")) {
                const execution = executions.find((item) => item.id === values[1]);
                if (execution) execution.status = sql.includes("status = 'succeeded'")
                  ? "succeeded"
                  : "failed";
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
