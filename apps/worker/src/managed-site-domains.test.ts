import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ManagedSiteDomainError,
  connectManagedSiteDomain,
  disconnectManagedSiteDomain,
  getManagedSiteDomainStatus,
  isManagedSiteDomainDeployment,
  requestManagedSiteDomainRegistration,
} from "./managed-site-domains";
import type { Env } from "./types";

const CORE_INSTALL_ID = "core_11111111-1111-4111-8111-111111111111";

describe("managed site domains", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("connects through ME3 Cloud using the existing install identity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        connected: true,
        domain: "www.example.com",
        status: "pending",
        ssl_status: "pending_validation",
        verification_records: [
          {
            type: "cname",
            name: "www.example.com",
            value: "sites.me3.app",
          },
        ],
        instructions: ["Add the CNAME record shown below."],
      }),
    );

    const result = await connectManagedSiteDomain(
      createEnv({
        ME3_CLOUD_API_ORIGIN: "https://api.me3.example/",
      }),
      managedSite("studio", "organization"),
      "WWW.Example.com",
    );

    expect(result).toMatchObject({
      ok: true,
      connected: true,
      domain: "www.example.com",
      status: "pending",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.me3.example/v1/installs/${CORE_INSTALL_ID}/sites/site-studio/domain`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-ME3-Core-Install-ID": CORE_INSTALL_ID,
          "X-ME3-Core-Update-Token": "core-update-token",
          "X-ME3-Core-Site-ID": "site-studio",
          "X-ME3-Core-Site-Username": "studio",
          "X-ME3-Core-Site-Role": "organization",
        }),
        body: JSON.stringify({ domain: "www.example.com" }),
      }),
    );
  });

  it("loads and disconnects the control-plane domain", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          connected: true,
          domain: "www.example.com",
          status: "active",
          ssl_status: "active",
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, connected: false }));
    const env = createEnv();
    const site = managedSite("owner", "profile");

    await expect(getManagedSiteDomainStatus(env, site)).resolves.toMatchObject({
      connected: true,
      url: "https://www.example.com",
    });
    await expect(disconnectManagedSiteDomain(env, site)).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("uses the legacy installation endpoint only for a profile during rollout", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "Not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ connected: false }));

    await expect(
      getManagedSiteDomainStatus(
        createEnv(),
        managedSite("owner", "profile"),
      ),
    ).resolves.toMatchObject({ connected: false });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.me3.app/v1/installs/${CORE_INSTALL_ID}/sites/site-owner/domain`,
      `https://api.me3.app/v1/installs/${CORE_INSTALL_ID}/domain`,
    ]);
  });

  it("fails closed instead of mapping an additional site to the legacy endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ error: "Not found" }, { status: 404 }));

    await expect(
      getManagedSiteDomainStatus(
        createEnv(),
        managedSite("studio", "organization"),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the managed install credentials are missing", async () => {
    const env = createEnv();
    env.DB = secretDb(new Map());

    await expect(
      getManagedSiteDomainStatus(env, managedSite("owner", "profile")),
    ).rejects.toMatchObject({
      name: "ManagedSiteDomainError",
      status: 503,
    });
  });

  it("keeps the control-plane error and status actionable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: "Only www subdomains are supported." },
        { status: 400 },
      ),
    );

    await expect(
      connectManagedSiteDomain(
        createEnv(),
        managedSite("studio", "organization"),
        "example.com",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ManagedSiteDomainError>>({
        message: "Only www subdomains are supported.",
        status: 400,
      }),
    );
  });

  it("passes domain search and registration through to the site's Cloud endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ options: [{ domain: "river.com" }] }))
      .mockResolvedValueOnce(
        Response.json({ domain: "river.com", state: "succeeded" }, { status: 201 }),
      );
    const env = createEnv();
    const site = managedSite("studio", "organization");

    await expect(
      requestManagedSiteDomainRegistration(env, site, "GET", { search: "river bakery" }),
    ).resolves.toEqual({ status: 200, body: { options: [{ domain: "river.com" }] } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.me3.app/v1/installs/${CORE_INSTALL_ID}/sites/site-studio/domain/registration/search?q=river+bakery`,
    );

    const registrant = { name: "River Owner", email: "river@example.test" };
    await expect(
      requestManagedSiteDomainRegistration(env, site, "POST", {
        body: { domain: "river.com", registrant },
      }),
    ).resolves.toMatchObject({ status: 201, body: { state: "succeeded" } });
    expect(fetchMock.mock.calls[1]).toEqual([
      `https://api.me3.app/v1/installs/${CORE_INSTALL_ID}/sites/site-studio/domain/registration`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ domain: "river.com", registrant }),
      }),
    ]);
  });

  it("keeps Cloud's registration refusal message and status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: "Your included domain is ready after your first Business payment." },
        { status: 403 },
      ),
    );
    await expect(
      requestManagedSiteDomainRegistration(createEnv(), managedSite("owner", "profile"), "GET"),
    ).rejects.toMatchObject({
      message: "Your included domain is ready after your first Business payment.",
      status: 403,
    });
  });

  it("only enables the bridge for identified managed installations", () => {
    expect(isManagedSiteDomainDeployment(createEnv())).toBe(true);
    expect(
      isManagedSiteDomainDeployment({
        ...createEnv(),
        ME3_DEPLOYMENT_MODE: "self_hosted",
      }),
    ).toBe(false);
  });
});

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: secretDb(
      new Map([
        ["ME3_CORE_INSTALL_ID", CORE_INSTALL_ID],
        ["ME3_CLOUD_CORE_TOKEN", "core-update-token"],
      ]),
    ),
    ME3_DEPLOYMENT_MODE: "managed",
    ME3_MANAGED_INSTALLATION_ID: "mi-1234567890abcdef",
    ...overrides,
  } as Env;
}

function managedSite(
  username: string,
  siteRole: "profile" | "organization",
) {
  return {
    id: `site-${username}`,
    username,
    site_role: siteRole,
  } as const;
}

function secretDb(values: Map<string, string>): D1Database {
  return {
    prepare() {
      return {
        bind(name: string) {
          return {
            async first() {
              const value = values.get(name);
              return value ? { value } : null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}
