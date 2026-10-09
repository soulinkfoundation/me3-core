import type { DbSite, Env, SiteRole } from "./types";

export const PROFILE_SITE_LIMIT = 1;
export const ADDITIONAL_SITE_LIMIT = 3;
export const PERSISTENT_SITE_LIMIT = PROFILE_SITE_LIMIT + ADDITIONAL_SITE_LIMIT;

const SITE_COLUMNS = `id, user_id, username, site_type, site_role, template_id,
  profile_site_id,
  custom_domain, custom_domain_status, custom_domain_cf_id,
  created_at, updated_at, published_at`;

export type SiteQuota = {
  current: number;
  limit: number;
  tier: "core";
  profile: SiteRoleQuota;
  additional_sites: SiteRoleQuota;
  remaining_additional_sites: number;
  can_create: boolean;
  can_create_profile: boolean;
  can_create_additional_site: boolean;
  capabilities: {
    maxSites: number;
    maxProfileSites: number;
    maxAdditionalSites: number;
    mailboxAlias: true;
    approvalFirstOutbound: true;
    soulinkAgentAccess: true;
    telegramAgentAccess: true;
  };
};

type SiteRoleQuota = {
  current: number;
  limit: number;
  remaining: number;
  can_create: boolean;
};

type SiteCountRow = {
  profile_count: number | string | null;
  organization_count: number | string | null;
};

export type SiteLifecycleErrorCode =
  | "profile_limit"
  | "profile_required"
  | "profile_invalid"
  | "organization_limit"
  | "username_conflict"
  | "site_not_found"
  | "profile_delete_forbidden"
  | "profile_rename_required"
  | "site_storage_conflict";

export class SiteLifecycleError extends Error {
  constructor(
    readonly code: SiteLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SiteLifecycleError";
  }
}

export function parseSiteRole(value: unknown): SiteRole | null {
  return value === "profile" || value === "organization" ? value : null;
}

export async function getSiteQuota(env: Env, ownerId: string): Promise<SiteQuota> {
  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN site_role = 'profile' THEN 1 ELSE 0 END) AS profile_count,
       SUM(CASE WHEN site_role = 'organization' THEN 1 ELSE 0 END) AS organization_count
     FROM sites
     WHERE user_id = ?`,
  )
    .bind(ownerId)
    .first<SiteCountRow>();

  const profileCount = Number(counts?.profile_count || 0);
  const organizationCount = Number(counts?.organization_count || 0);
  const profile = buildRoleQuota(profileCount, PROFILE_SITE_LIMIT);
  const additionalSites = buildRoleQuota(organizationCount, ADDITIONAL_SITE_LIMIT);

  return {
    current: profileCount + organizationCount,
    limit: PERSISTENT_SITE_LIMIT,
    tier: "core",
    profile,
    additional_sites: additionalSites,
    remaining_additional_sites: additionalSites.remaining,
    can_create: profile.can_create || additionalSites.can_create,
    can_create_profile: profile.can_create,
    can_create_additional_site: additionalSites.can_create,
    capabilities: {
      maxSites: PERSISTENT_SITE_LIMIT,
      maxProfileSites: PROFILE_SITE_LIMIT,
      maxAdditionalSites: ADDITIONAL_SITE_LIMIT,
      mailboxAlias: true,
      approvalFirstOutbound: true,
      soulinkAgentAccess: true,
      telegramAgentAccess: true,
    },
  };
}

export async function createPersistentSite(
  env: Env,
  input: {
    id: string;
    ownerId: string;
    username: string;
    role: SiteRole;
    templateId: string | null;
    profileSiteId?: string | null;
  },
): Promise<DbSite> {
  const profileSiteId =
    input.role === "organization"
      ? await resolveProfileSiteId(env, input.ownerId, input.profileSiteId)
      : null;
  try {
    await env.DB.prepare(
      `INSERT INTO sites
         (id, user_id, username, site_type, site_role, template_id, profile_site_id)
       VALUES (?, ?, ?, 'profile', ?, ?, ?)`,
    )
      .bind(
        input.id,
        input.ownerId,
        input.username,
        input.role,
        input.templateId,
        profileSiteId,
      )
      .run();
  } catch (error) {
    throw mapSiteWriteError(error);
  }

  const site = await getSiteById(env, input.id, input.ownerId);
  if (!site) {
    throw new Error("Created site could not be loaded");
  }
  return site;
}

export async function assignBusinessSiteProfile(
  env: Env,
  input: {
    ownerId: string;
    username: string;
    profileSiteId: string;
  },
): Promise<DbSite> {
  const site = await getSiteByUsername(env, input.ownerId, input.username);
  if (!site || site.site_role !== "organization") {
    throw new SiteLifecycleError("site_not_found", "Business Site not found");
  }
  const profileSiteId = await resolveProfileSiteId(
    env,
    input.ownerId,
    input.profileSiteId,
  );
  try {
    await env.DB.prepare(
      `UPDATE sites
       SET profile_site_id = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND site_role = 'organization'`,
    )
      .bind(profileSiteId, site.id, input.ownerId)
      .run();
  } catch (error) {
    throw mapSiteWriteError(error);
  }
  const updated = await getSiteById(env, site.id, input.ownerId);
  if (!updated) throw new Error("Updated Business Site could not be loaded");
  return updated;
}

export async function renameProfileSite(
  env: Env,
  input: {
    ownerId: string;
    fromUsername: string;
    toUsername: string;
  },
): Promise<DbSite> {
  const site = await getSiteByUsername(env, input.ownerId, input.fromUsername);
  if (!site) {
    throw new SiteLifecycleError("site_not_found", "Site not found");
  }
  if (site.site_role !== "profile") {
    throw new SiteLifecycleError(
      "profile_rename_required",
      "Only the ME3 Profile can be renamed through this flow.",
    );
  }
  return renamePersistentSite(env, {
    ownerId: input.ownerId,
    siteId: site.id,
    expectedRole: "profile",
    toUsername: input.toUsername,
  });
}

export async function renamePersistentSite(
  env: Env,
  input: {
    ownerId: string;
    siteId: string;
    expectedRole: SiteRole;
    toUsername: string;
  },
): Promise<DbSite> {
  const site = await getSiteById(env, input.siteId, input.ownerId);
  if (!site || site.site_role !== input.expectedRole) {
    throw new SiteLifecycleError("site_not_found", "Site not found");
  }
  if (site.username === input.toUsername) return site;

  const usernameOwner = await getSiteByUsername(env, input.ownerId, input.toUsername);
  if (usernameOwner) {
    throw new SiteLifecycleError("username_conflict", "Username is already in use");
  }

  const copiedAssetKeys = await copySiteAssetsForRename(
    env,
    site.username,
    input.toUsername,
  );

  try {
    await env.DB.prepare(
      `UPDATE sites
       SET username = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND site_role = ?`,
    )
      .bind(input.toUsername, site.id, input.ownerId, input.expectedRole)
      .run();
  } catch (error) {
    await deleteSiteAssetKeys(env, copiedAssetKeys).catch((cleanupError) => {
      console.error("Failed to roll back copied site assets after rename:", cleanupError);
    });
    throw mapSiteWriteError(error);
  }

  const renamed = await getSiteById(env, site.id, input.ownerId);
  if (!renamed) {
    throw new Error("Renamed site could not be loaded");
  }
  await deleteSiteAssetKeys(
    env,
    copiedAssetKeys.map((key) =>
      key.replace(siteAssetPrefix(input.toUsername), siteAssetPrefix(site.username)),
    ),
  ).catch((error) => {
    console.warn("Site rename left obsolete site asset copies:", error);
  });
  return renamed;
}

export async function deleteAdditionalSite(
  env: Env,
  ownerId: string,
  username: string,
): Promise<DbSite> {
  const site = await getSiteByUsername(env, ownerId, username);
  if (!site) {
    throw new SiteLifecycleError("site_not_found", "Site not found");
  }
  if (site.site_role === "profile") {
    throw new SiteLifecycleError(
      "profile_delete_forbidden",
      "The ME3 Profile cannot be deleted separately. Unpublish it instead.",
    );
  }

  const assetKeys = await listSiteAssetKeys(env, site.username);

  const result = await env.DB.prepare("DELETE FROM sites WHERE id = ? AND user_id = ?")
    .bind(site.id, ownerId)
    .run();
  if (Number(result.meta?.changes || 0) === 0) {
    throw new SiteLifecycleError("site_not_found", "Site not found");
  }
  await deleteSiteAssetKeys(env, assetKeys).catch((error) => {
    console.warn("Deleted site left obsolete site assets:", error);
  });
  return site;
}

async function getSiteById(env: Env, siteId: string, ownerId: string): Promise<DbSite | null> {
  return (
    (await env.DB.prepare(
      `SELECT ${SITE_COLUMNS}
       FROM sites
       WHERE id = ? AND user_id = ?`,
    )
      .bind(siteId, ownerId)
      .first<DbSite>()) || null
  );
}

async function getSiteByUsername(
  env: Env,
  ownerId: string,
  username: string,
): Promise<DbSite | null> {
  return (
    (await env.DB.prepare(
      `SELECT ${SITE_COLUMNS}
       FROM sites
       WHERE user_id = ? AND username = ?`,
    )
      .bind(ownerId, username)
      .first<DbSite>()) || null
  );
}

async function resolveProfileSiteId(
  env: Env,
  ownerId: string,
  requestedId?: string | null,
): Promise<string> {
  const profile = requestedId
    ? await env.DB.prepare(
        `SELECT id FROM sites
         WHERE id = ? AND user_id = ? AND site_role = 'profile'`,
      )
        .bind(requestedId, ownerId)
        .first<{ id: string }>()
    : await env.DB.prepare(
        `SELECT id FROM sites
         WHERE user_id = ? AND site_role = 'profile'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      )
        .bind(ownerId)
        .first<{ id: string }>();

  if (!profile) {
    throw new SiteLifecycleError(
      requestedId ? "profile_invalid" : "profile_required",
      requestedId
        ? "Choose a ME3 Profile owned by this account."
        : "Create your ME3 Profile before creating a Business Site.",
    );
  }
  return profile.id;
}

function buildRoleQuota(current: number, limit: number): SiteRoleQuota {
  const remaining = Math.max(0, limit - current);
  return {
    current,
    limit,
    remaining,
    can_create: remaining > 0,
  };
}

async function copySiteAssetsForRename(
  env: Env,
  fromUsername: string,
  toUsername: string,
): Promise<string[]> {
  if (!env.SITE_ASSETS) return [];

  const existingTargetKeys = await listSiteAssetKeys(env, toUsername);
  if (existingTargetKeys.length) {
    throw new SiteLifecycleError(
      "site_storage_conflict",
      "That username still has stored site assets. Choose another username.",
    );
  }

  const sourcePrefix = siteAssetPrefix(fromUsername);
  const targetPrefix = siteAssetPrefix(toUsername);
  const sourceKeys = await listSiteAssetKeys(env, fromUsername);
  const copiedKeys: string[] = [];
  try {
    for (const sourceKey of sourceKeys) {
      const source = await env.SITE_ASSETS.get(sourceKey);
      if (!source) throw new Error(`Site asset disappeared during rename: ${sourceKey}`);
      const targetKey = `${targetPrefix}${sourceKey.slice(sourcePrefix.length)}`;
      await env.SITE_ASSETS.put(targetKey, source.body, {
        httpMetadata: source.httpMetadata,
        customMetadata: source.customMetadata,
      });
      copiedKeys.push(targetKey);
    }
  } catch (error) {
    await deleteSiteAssetKeys(env, copiedKeys).catch(() => undefined);
    throw error;
  }
  return copiedKeys;
}

async function listSiteAssetKeys(env: Env, username: string): Promise<string[]> {
  if (!env.SITE_ASSETS) return [];
  const keys: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await env.SITE_ASSETS.list({
      prefix: siteAssetPrefix(username),
      ...(cursor ? { cursor } : {}),
    });
    if (page.truncated) {
      if (!page.cursor || seenCursors.has(page.cursor)) {
        throw new Error("R2 object listing did not advance");
      }
      seenCursors.add(page.cursor);
    }
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function deleteSiteAssetKeys(env: Env, keys: string[]): Promise<void> {
  if (!env.SITE_ASSETS || !keys.length) return;
  for (let index = 0; index < keys.length; index += 1000) {
    await env.SITE_ASSETS.delete(keys.slice(index, index + 1000));
  }
}

function siteAssetPrefix(username: string): string {
  return `sites/${username}/`;
}

function mapSiteWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("ME3_SITE_PROFILE_LIMIT") ||
    message.includes("idx_sites_one_profile_per_owner")
  ) {
    return new SiteLifecycleError(
      "profile_limit",
      "This installation already has its ME3 Profile.",
    );
  }
  if (message.includes("ME3_SITE_PROFILE_OWNERSHIP")) {
    return new SiteLifecycleError(
      "profile_invalid",
      "Choose a ME3 Profile owned by this account.",
    );
  }
  if (message.includes("ME3_SITE_ORGANIZATION_LIMIT")) {
    return new SiteLifecycleError(
      "organization_limit",
      "This installation already has three additional sites.",
    );
  }
  if (/UNIQUE constraint failed:\s*sites\.username/i.test(message)) {
    return new SiteLifecycleError("username_conflict", "Username is already in use");
  }
  return error instanceof Error ? error : new Error(message);
}
