import { getSiteImageMetadata } from "./site-images";
import { generateSiteHtml, type Me3SiteProfile } from "@me3-core/site-renderer";
import { buildPublicMe3Profile } from "./public-me-profile";
import {
  USERNAME_REGEX,
  createEmptyPublishManifest,
  getContentType,
  getGeneratedSiteContentType,
  getMe3CloudApiOrigin,
  getPublicSiteOrigin,
  getPublishedSiteBaseUrl,
  getR2SiteFileKey,
  getSiteFileText,
  normalizeSiteFileName,
  normalizeUsername,
  putSiteFile,
  putSiteMediaFile,
  savePublishManifest,
  sha256Buffer,
  sha256Text,
} from "./sites";
import type { DbSite, Env } from "./types";

const HANDOFF_TIMEOUT_MS = 15_000;
const MAX_HANDOFF_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_HANDOFF_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_HANDOFF_TOTAL_ASSET_BYTES = 10 * 1024 * 1024;
const PROFILE_ASSET_PATTERN = /^files\/[a-z0-9][a-z0-9._-]*\.(?:jpg|jpeg|png|webp|gif)$/i;

type StarterProfileAsset = {
  path: string;
  contentType: string;
  content: ArrayBuffer;
};

type StarterProfile = {
  profile: Me3SiteProfile & { handle: string; name: string };
  assets: StarterProfileAsset[];
};

type OwnerOnboardingRow = {
  profile_site_id: string;
  current_step: number | null;
  completed_at: string | null;
};

export type ManagedStarterProfileImportResult = {
  imported: boolean;
  reason: "imported" | "already_imported" | "existing_profile";
  visibility: "public" | "private";
};

export type StarterProfileAcknowledgement =
  | {
      outcome: "starter_imported" | "existing_profile";
      visibility: "public" | "private";
    }
  | { outcome: "failed"; errorCode: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function profileAssetPath(value: unknown): string | null {
  const path = text(value, 256).replace(/^\/?/, "");
  return PROFILE_ASSET_PATTERN.test(path) ? path : null;
}

function profileImage(value: unknown): string | undefined {
  const raw = text(value, 2048);
  if (!raw) return undefined;
  const assetPath = profileAssetPath(raw);
  if (assetPath) return `/${assetPath}`;
  return raw.startsWith("https://") ? raw : undefined;
}

function profileLinks(value: unknown): Record<string, string> | undefined {
  const source = record(value);
  if (!source) return undefined;
  const links = Object.fromEntries(
    Object.entries(source)
      .filter(([key, entry]) => key !== "_avatar_variants" && Boolean(text(entry, 500)))
      .slice(0, 20)
      .map(([key, entry]) => [key.slice(0, 80), text(entry, 500)]),
  );
  return Object.keys(links).length > 0 ? links : undefined;
}

function decodeBase64(value: unknown): ArrayBuffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_HANDOFF_ASSET_BYTES * 4) / 3) + 4
  ) {
    throw new Error("Managed starter profile asset is invalid");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Managed starter profile asset is invalid");
  }
  if (binary.length > MAX_HANDOFF_ASSET_BYTES) {
    throw new Error("Managed starter profile asset is too large");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function normalizeStarterProfile(value: unknown, expectedHandle: string): StarterProfile {
  const source = record(value);
  const profileSource = record(source?.profile);
  if (!source || source.ok !== true || !profileSource || !Array.isArray(source.assets)) {
    throw new Error("Managed starter profile response is invalid");
  }

  const handle = normalizeUsername(profileSource.handle);
  if (handle !== expectedHandle || !USERNAME_REGEX.test(handle)) {
    throw new Error("Managed starter profile handle does not match the install claim");
  }

  const name = text(profileSource.name, 100) || handle;
  const avatar = profileImage(profileSource.avatar);
  const banner = profileImage(profileSource.banner);
  const links = profileLinks(profileSource.links);
  const profile: StarterProfile["profile"] = {
    version: text(profileSource.version, 20) || "0.1",
    visibility: profileSource.visibility === "public" ? "public" : "private",
    handle,
    name,
    ...(text(profileSource.bio, 500) ? { bio: text(profileSource.bio, 500) } : {}),
    ...(avatar ? { avatar } : {}),
    ...(banner ? { banner } : {}),
    ...(links ? { links } : {}),
  };

  const assets: StarterProfileAsset[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;
  for (const entry of source.assets) {
    const asset = record(entry);
    const path = profileAssetPath(asset?.path);
    const contentType = text(asset?.contentType, 80).toLowerCase();
    if (
      !asset ||
      !path ||
      contentType !== getContentType(path) ||
      seenPaths.has(path)
    ) {
      throw new Error("Managed starter profile asset metadata is invalid");
    }
    const content = decodeBase64(asset.base64);
    totalBytes += content.byteLength;
    if (totalBytes > MAX_HANDOFF_TOTAL_ASSET_BYTES) {
      throw new Error("Managed starter profile assets exceed the import limit");
    }
    seenPaths.add(path);
    assets.push({ path, contentType, content });
  }

  for (const image of [avatar, banner]) {
    const localPath = profileAssetPath(image);
    if (localPath && !seenPaths.has(localPath)) {
      throw new Error(`Managed starter profile asset is missing: ${localPath}`);
    }
  }

  return { profile, assets };
}

async function fetchStarterProfile(
  env: Env,
  claimToken: string,
  expectedHandle: string,
): Promise<StarterProfile> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HANDOFF_TIMEOUT_MS);
  try {
    const response = await fetch(`${getMe3CloudApiOrigin(env)}/core/claim/starter-profile`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${claimToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Managed starter profile request failed (${response.status})`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HANDOFF_RESPONSE_BYTES) {
      throw new Error("Managed starter profile response is too large");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_HANDOFF_RESPONSE_BYTES) {
      throw new Error("Managed starter profile response is too large");
    }
    return normalizeStarterProfile(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      expectedHandle,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function acknowledgeStarterProfileHandoff(
  env: Env,
  claimToken: string,
  acknowledgement: StarterProfileAcknowledgement,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HANDOFF_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${getMe3CloudApiOrigin(env)}/core/claim/starter-profile/acknowledge`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${claimToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(acknowledgement),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Starter profile acknowledgement failed (${response.status})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function getProfileSite(env: Env, ownerId: string): Promise<DbSite | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, username, site_type, site_role, template_id, custom_domain,
              custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
       FROM sites
       WHERE user_id = ? AND site_role = 'profile'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
      .bind(ownerId)
      .first<DbSite>()) || null
  );
}

async function getOnboardingState(
  env: Env,
  ownerId: string,
): Promise<OwnerOnboardingRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT profile_site_id, current_step, completed_at
       FROM owner_onboarding
       WHERE user_id = ?`,
    )
      .bind(ownerId)
      .first<OwnerOnboardingRow>()) || null
  );
}

async function getExistingProfileVisibility(
  env: Env,
  site: DbSite,
): Promise<"public" | "private"> {
  const source =
    (await getSiteFileText(env, site.id, "src/me.json")) ||
    (await getSiteFileText(env, site.id, "public/me.json"));
  if (source) {
    try {
      const profile = JSON.parse(source) as { visibility?: unknown };
      if (profile.visibility === "public" || profile.visibility === "private") {
        return profile.visibility;
      }
    } catch {
      // Preserve the local profile without trusting malformed visibility data.
    }
  }
  return site.published_at ? "public" : "private";
}

async function cleanupPartialImport(
  env: Env,
  site: DbSite,
  assetPaths: string[],
): Promise<void> {
  if (env.SITE_ASSETS) {
    await Promise.all(
      assetPaths.map((path) =>
        env
          .SITE_ASSETS!.delete(getR2SiteFileKey(site, `public/${path}`))
          .catch(() => undefined),
      ),
    );
  }
  await env.DB.prepare("DELETE FROM sites WHERE id = ? AND user_id = ?")
    .bind(site.id, site.user_id)
    .run();
  await env.DB.prepare(
    "DELETE FROM owner_onboarding WHERE user_id = ? AND current_step IS NULL",
  )
    .bind(site.user_id)
    .run();
}

export async function importManagedStarterProfile(
  env: Env,
  input: { claimToken: string; handle: string },
): Promise<ManagedStarterProfileImportResult> {
  const handle = normalizeUsername(input.handle);
  if (!handle || !USERNAME_REGEX.test(handle)) {
    throw new Error("Managed starter profile handle is invalid");
  }

  const priorOnboarding = await getOnboardingState(env, "owner");
  if (
    priorOnboarding?.current_step === 2 ||
    priorOnboarding?.current_step === 3 ||
    priorOnboarding?.completed_at
  ) {
    const existing = await getProfileSite(env, "owner");
    if (existing?.id === priorOnboarding.profile_site_id) {
      return {
        imported: true,
        reason: "already_imported",
        visibility: await getExistingProfileVisibility(env, existing),
      };
    }
    await env.DB.prepare("DELETE FROM owner_onboarding WHERE user_id = ?")
      .bind("owner")
      .run();
  } else if (!priorOnboarding) {
    const existing = await getProfileSite(env, "owner");
    if (existing) {
      return {
        imported: false,
        reason: "existing_profile",
        visibility: await getExistingProfileVisibility(env, existing),
      };
    }
  }

  const handoff = await fetchStarterProfile(env, input.claimToken, handle);
  if (priorOnboarding) {
    const partialSite: DbSite = {
      id: priorOnboarding.profile_site_id,
      user_id: "owner",
      username: handle,
      site_type: "profile",
      site_role: "profile",
      template_id: null,
      custom_domain: null,
      custom_domain_status: null,
      custom_domain_cf_id: null,
      created_at: "",
      updated_at: "",
      published_at: null,
    };
    await cleanupPartialImport(env, partialSite, handoff.assets.map((asset) => asset.path));
  }

  const existingAfterCleanup = await getProfileSite(env, "owner");
  if (existingAfterCleanup) {
    return {
      imported: false,
      reason: "existing_profile",
      visibility: await getExistingProfileVisibility(env, existingAfterCleanup),
    };
  }

  const site: DbSite = {
    id: crypto.randomUUID(),
    user_id: "owner",
    username: handle,
    site_type: "profile",
    site_role: "profile",
    template_id: null,
    custom_domain: null,
    custom_domain_status: null,
    custom_domain_cf_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_at: null,
  };

  await env.DB.prepare(
    `INSERT INTO owner_onboarding
       (user_id, profile_source, profile_site_id, current_step, completed_at, created_at, updated_at)
     VALUES (?, 'hosted_starter', ?, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind("owner", site.id)
    .run();

  try {
    await env.DB.prepare(
      `INSERT INTO sites (id, user_id, username, site_type, site_role, template_id)
       VALUES (?, ?, ?, 'profile', 'profile', NULL)`,
    )
      .bind(site.id, site.user_id, site.username)
      .run();

    const profileJson = JSON.stringify(handoff.profile, null, 2);
    const manifest = createEmptyPublishManifest();
    await putSiteFile(env, site.id, "src/me.json", profileJson, "application/json");
    manifest.sourceFiles["me.json"] = await sha256Text(profileJson);

    for (const asset of handoff.assets) {
      await putSiteMediaFile(
        env,
        site,
        `public/${asset.path}`,
        asset.content,
        asset.contentType,
      );
      manifest.assetFiles[asset.path] = await sha256Buffer(asset.content);
    }

    const publicProfileJson = JSON.stringify(
      buildPublicMe3Profile(handoff.profile, await getPublishedSiteBaseUrl(env, site)),
      null,
      2,
    );
    const generatedFiles =
      handoff.profile.visibility === "public"
        ? await generateSiteHtml(handoff.profile, [
            { name: "me.json", content: profileJson },
          ], undefined, { baseUrl: await getPublishedSiteBaseUrl(env, site), images: await getSiteImageMetadata(env, site, [profileJson]) })
        : {};
    generatedFiles["me.json"] = publicProfileJson;
    for (const [name, content] of Object.entries(generatedFiles)) {
      await putSiteFile(
        env,
        site.id,
        `public/${normalizeSiteFileName(name)}`,
        content,
        getGeneratedSiteContentType(name),
      );
    }
    manifest.updatedAt = new Date().toISOString();
    await savePublishManifest(env, site.id, manifest);

    await env.DB.prepare(
      `UPDATE owner_profile
       SET name = ?, username = ?, bio = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(
        handoff.profile.name,
        handoff.profile.handle,
        handoff.profile.bio || null,
        handoff.profile.avatar || null,
        "owner",
      )
      .run();
    if (handoff.profile.visibility === "public") {
      await env.DB.prepare(
        "UPDATE sites SET published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
        .bind(site.id)
        .run();
    }
    await env.DB.prepare(
      `UPDATE owner_onboarding
       SET current_step = 2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND profile_site_id = ? AND current_step IS NULL`,
    )
      .bind("owner", site.id)
      .run();

    return {
      imported: true,
      reason: "imported",
      visibility: handoff.profile.visibility === "public" ? "public" : "private",
    };
  } catch (error) {
    await cleanupPartialImport(env, site, handoff.assets.map((asset) => asset.path));
    throw error;
  }
}
