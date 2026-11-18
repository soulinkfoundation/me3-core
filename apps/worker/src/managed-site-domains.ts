import { buildApiUrl, getMe3CloudApiOrigin, normalizeDomain } from "./sites";
import type { DbSite, Env } from "./types";

const CORE_INSTALL_ID_SECRET = "ME3_CORE_INSTALL_ID";
const CORE_UPDATE_TOKEN_SECRET = "ME3_CLOUD_CORE_TOKEN";
const CORE_INSTALL_ID_PATTERN =
  /^core_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ManagedSiteDomainStatus = {
  connected: boolean;
  domain?: string;
  status?: "pending" | "active" | "failed";
  ssl_status?: string;
  verification_records?: Array<{
    type: "cname" | "txt";
    name: string;
    value: string;
  }>;
  registrar_guides?: Array<{
    name: string;
    url: string;
    icon: string;
  }>;
  url?: string;
  instructions?: string[];
};

type ManagedDomainSite = Pick<DbSite, "id" | "username" | "site_role">;

export class ManagedSiteDomainError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ManagedSiteDomainError";
    this.status = status;
  }
}

export function isManagedSiteDomainDeployment(env: Env): boolean {
  return (
    String(env.ME3_DEPLOYMENT_MODE || "").trim().toLowerCase() === "managed" &&
    Boolean(env.ME3_MANAGED_INSTALLATION_ID?.trim())
  );
}

export async function getManagedSiteDomainStatus(
  env: Env,
  site: ManagedDomainSite,
): Promise<ManagedSiteDomainStatus> {
  return requestManagedSiteDomain(env, site, "GET");
}

export async function connectManagedSiteDomain(
  env: Env,
  site: ManagedDomainSite,
  domain: string,
): Promise<ManagedSiteDomainStatus & { ok: true }> {
  const status = await requestManagedSiteDomain(env, site, "POST", {
    domain: normalizeDomain(domain),
  });
  return { ok: true, ...status };
}

export async function disconnectManagedSiteDomain(
  env: Env,
  site: ManagedDomainSite,
): Promise<{ ok: true }> {
  await requestManagedSiteDomain(env, site, "DELETE");
  return { ok: true };
}

async function requestManagedSiteDomain(
  env: Env,
  site: ManagedDomainSite,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<ManagedSiteDomainStatus> {
  const { coreInstallId, requestInit } = await managedDomainRequest(
    env,
    site,
    method,
    body,
  );
  let response = await fetch(
    buildApiUrl(
      getMe3CloudApiOrigin(env),
      `/v1/installs/${encodeURIComponent(coreInstallId)}/sites/${encodeURIComponent(site.id)}/domain`,
    ),
    requestInit,
  );
  let result = await readJson(response);
  if (
    (response.status === 404 || response.status === 405) &&
    site.site_role === "profile"
  ) {
    response = await fetch(
      buildApiUrl(
        getMe3CloudApiOrigin(env),
        `/v1/installs/${encodeURIComponent(coreInstallId)}/domain`,
      ),
      requestInit,
    );
    result = await readJson(response);
  }
  if (!response.ok) {
    throw new ManagedSiteDomainError(
      normalizeMessage(result.error) ||
        "ME3 Cloud could not update this custom domain.",
      response.status,
    );
  }
  return validateStatus(result);
}

/**
 * "Get your domain" (included with Business): Cloud checks eligibility, searches
 * Cloudflare Registrar and registers the domain to the owner, then connects it.
 * Core passes the owner's request through; Cloud owns policy and validation.
 */
export async function requestManagedSiteDomainRegistration(
  env: Env,
  site: ManagedDomainSite,
  method: "GET" | "POST",
  options: { search?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { coreInstallId, requestInit } = await managedDomainRequest(
    env,
    site,
    method,
    options.body,
  );
  const path = `/v1/installs/${encodeURIComponent(coreInstallId)}/sites/${encodeURIComponent(site.id)}/domain/registration${
    options.search !== undefined
      ? `/search?${new URLSearchParams({ q: options.search })}`
      : ""
  }`;
  const response = await fetch(
    buildApiUrl(getMe3CloudApiOrigin(env), path),
    requestInit,
  );
  const result = await readJson(response);
  if (!response.ok) {
    throw new ManagedSiteDomainError(
      normalizeMessage(result.error) ||
        "ME3 Cloud could not set up this domain.",
      response.status,
    );
  }
  return { status: response.status, body: result };
}

async function managedDomainRequest(
  env: Env,
  site: ManagedDomainSite,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<{ coreInstallId: string; requestInit: RequestInit }> {
  const [coreInstallId, coreUpdateToken] = await Promise.all([
    getInstallSecret(env, CORE_INSTALL_ID_SECRET),
    getInstallSecret(env, CORE_UPDATE_TOKEN_SECRET),
  ]);
  if (
    !CORE_INSTALL_ID_PATTERN.test(coreInstallId) ||
    !coreUpdateToken ||
    coreUpdateToken.length > 1024
  ) {
    throw new ManagedSiteDomainError(
      "Managed custom domains are not configured for this installation.",
      503,
    );
  }

  const requestInit: RequestInit = {
      method,
      headers: {
        "X-ME3-Core-Install-ID": coreInstallId,
        "X-ME3-Core-Update-Token": coreUpdateToken,
        "X-ME3-Core-Site-ID": site.id,
        "X-ME3-Core-Site-Username": site.username,
        "X-ME3-Core-Site-Role": site.site_role || "profile",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
  return { coreInstallId, requestInit };
}

function validateStatus(value: Record<string, unknown>): ManagedSiteDomainStatus {
  const connected = value.connected === true;
  if (!connected) {
    return {
      connected: false,
      registrar_guides: normalizeGuides(value.registrar_guides),
      instructions: normalizeInstructions(value.instructions),
    };
  }

  const domain = normalizeDomain(value.domain);
  const status = normalizeStatus(value.status);
  if (!domain || !status) {
    throw new ManagedSiteDomainError(
      "ME3 Cloud returned an invalid custom-domain response.",
    );
  }

  return {
    connected: true,
    domain,
    status,
    ssl_status: normalizeMessage(value.ssl_status) || undefined,
    verification_records: normalizeRecords(value.verification_records),
    registrar_guides: normalizeGuides(value.registrar_guides),
    url:
      typeof value.url === "string" && value.url === `https://${domain}`
        ? value.url
        : status === "active"
          ? `https://${domain}`
          : undefined,
    instructions: normalizeInstructions(value.instructions),
  };
}

function normalizeInstructions(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value
        .map(normalizeMessage)
        .filter((instruction): instruction is string => Boolean(instruction))
    : undefined;
}

function normalizeStatus(
  value: unknown,
): ManagedSiteDomainStatus["status"] | null {
  return value === "pending" || value === "active" || value === "failed"
    ? value
    : null;
}

function normalizeRecords(
  value: unknown,
): ManagedSiteDomainStatus["verification_records"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const type = record.type === "cname" || record.type === "txt"
      ? record.type
      : null;
    const name = normalizeMessage(record.name);
    const recordValue = normalizeMessage(record.value);
    return type && name && recordValue
      ? [{ type, name, value: recordValue }]
      : [];
  });
}

function normalizeGuides(
  value: unknown,
): ManagedSiteDomainStatus["registrar_guides"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const guide = entry as Record<string, unknown>;
    const name = normalizeMessage(guide.name);
    const url = normalizeMessage(guide.url);
    const icon = normalizeMessage(guide.icon);
    return name && url && icon ? [{ name, url, icon }] : [];
  });
}

async function getInstallSecret(env: Env, name: string): Promise<string> {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM install_secrets WHERE name = ?",
    )
      .bind(name)
      .first<{ value: string }>();
    return normalizeMessage(row?.value);
  } catch {
    return "";
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().then(
    (value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {},
    () => ({}),
  );
}

function normalizeMessage(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
