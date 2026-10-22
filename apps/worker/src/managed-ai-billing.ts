import { getManagedCommerceBridgeConfig } from "./commerce-bridge";
import { reconcileUnknownManagedAiCosts } from "./managed-ai-reconciliation";
import type { Env } from "./types";

export const MANAGED_AI_BILLING_POLICY_SECRET = "ME3_MANAGED_AI_BILLING_POLICY";
const INCLUDED_MONTHLY_CENTS = 1000;
const DEFAULT_MANAGED_MODEL = "openai/gpt-6.1-sol";
const MANAGED_MODELS = [
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
  "zai-org/glm-4.7-flash",
  "moonshotai/kimi-k3",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.5",
  "openai/gpt-6.1-sol",
  "openai/gpt-6-astra",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-haiku-5.5",
  "zai-org/glm-5.3-flash",
] as const;
// Used once the monthly allowance is spent. The 15 Oct 2026 fallback eval had
// GLM 4.7 Flash create an unrequested calendar event; Haiku made no unsafe writes.
export const MANAGED_AI_FALLBACK_MODEL = "anthropic/claude-haiku-5.5";
// GLM stays billable so usage reported by older installs still reconciles.
const MANAGED_FALLBACK_MODELS = ["anthropic/claude-haiku-5.5", "zai-org/glm-4.7-flash"] as const;
const MANAGED_BILLABLE_TEXT_MODELS = [...new Set<string>([
  ...MANAGED_MODELS,
  ...MANAGED_FALLBACK_MODELS,
  // Clef routing was removed (me3-ahsk.45); receipts from installs that ran it still reconcile.
  "cloudflare/clef",
  "cloudflare/clef-flash",
])];
const MANAGED_IMAGE_MODELS = [
  "black-forest-labs/flux-2-klein-4b",
  "gpt-image-2",
  "openai/gpt-image-2",
  "openai/gpt-image-2.5-sunburst",
] as const;

export type ManagedAiModelOption = {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
};

export type ManagedAiBillingSettings = {
  available: boolean;
  managed: boolean;
  currency: "usd";
  // ME3 Cloud reports the owner's entitlement source.
  billingSource: "internal" | "storekit" | "stripe" | "google_play" | "trial" | "complimentary" | null;
  defaultModel: string;
  models: ManagedAiModelOption[];
  eligible: boolean;
  ineligibleReason: string | null;
  overagesEnabled: boolean;
  includedMonthlyCents: number;
  monthlyMaximumCents: number;
  minimumMonthlyMaximumCents: number;
  maximumMonthlyMaximumCents: number;
  currentMonth: string;
  currentMonthUsageMicrousd: number;
  currentMonthBillableMicrousd: number;
  effectiveMaximumCents: number;
  fallbackActive: boolean;
};

type LocalUsageRow = {
  id: string;
  provider: string;
  model: string;
  kind: "text" | "image";
  tokens_in: number;
  tokens_out: number;
  estimated_cost_usd: number;
  metadata_json: string;
  created_at: string;
};

export async function getManagedAiBillingSettings(
  env: Env,
  options: { syncUsage?: boolean } = {},
): Promise<ManagedAiBillingSettings> {
  if (!isManaged(env)) return unavailableSettings(false, null);

  const synced = options.syncUsage === false ? null : await syncManagedAiUsage(env);
  if (synced) return synced;

  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) return unavailableSettings(true, "Managed billing connection is unavailable");
  try {
    const response = await fetch(`${bridge.origin}/v1/ai-billing/settings`, {
      headers: bridge.headers,
    });
    const payload = await response.json<unknown>().catch(() => null);
    if (!response.ok || !isManagedAiBillingSettings(payload)) {
      return unavailableSettings(true, apiError(payload));
    }
    await cacheManagedAiBillingPolicy(env, payload);
    return payload;
  } catch (error) {
    console.error("Managed AI billing settings request failed", error);
    return unavailableSettings(true, "Managed billing is temporarily unavailable");
  }
}

export async function updateManagedAiBillingSettings(
  env: Env,
  input: {
    defaultModel: string;
    overagesEnabled: boolean;
    monthlyMaximumCents: number;
  },
): Promise<ManagedAiBillingSettings> {
  if (!isManaged(env)) throw new ManagedAiBillingInputError("Managed AI billing is unavailable", 404);
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) {
    throw new ManagedAiBillingInputError("Managed billing connection is unavailable", 503);
  }

  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(`${bridge.origin}/v1/ai-billing/settings`, {
      method: "PUT",
      headers: { ...bridge.headers, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    payload = await response.json<unknown>().catch(() => null);
  } catch (error) {
    console.error("Managed AI billing settings update failed", error);
    throw new ManagedAiBillingInputError("Managed billing is temporarily unavailable", 503);
  }
  if (!response.ok) {
    throw new ManagedAiBillingInputError(apiError(payload), response.status);
  }
  if (!isManagedAiBillingSettings(payload)) {
    throw new ManagedAiBillingInputError("Managed billing returned an invalid response", 502);
  }
  await cacheManagedAiBillingPolicy(env, payload);
  return payload;
}

export async function syncManagedAiUsage(env: Env): Promise<ManagedAiBillingSettings | null> {
  if (!isManaged(env)) return null;
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) return null;
  // Settled receipts join this outbox and report under their original ids below.
  await reconcileUnknownManagedAiCosts(env, bridge);

  let rows: LocalUsageRow[];
  try {
    const result = await env.DB.prepare(
      `SELECT id, provider, model, kind, tokens_in, tokens_out,
              estimated_cost_usd, metadata_json, created_at
       FROM ai_usage_events
       WHERE (
           (kind = 'text' AND lower(replace(model, '@cf/', '')) IN (${MANAGED_BILLABLE_TEXT_MODELS.map(() => "?").join(", ")}))
           OR
           (kind = 'image' AND lower(replace(model, '@cf/', '')) IN (${MANAGED_IMAGE_MODELS.map(() => "?").join(", ")}))
         )
         AND created_at >= datetime('now', '-35 days')
         AND json_extract(metadata_json, '$.managedBillingReportedAt') IS NULL
         AND coalesce(json_extract(metadata_json, '$.costKnown'), 1) != 0
         AND (coalesce(json_extract(metadata_json, '$.me3_runtime'), '') != 'agent'
              OR coalesce(json_extract(metadata_json, '$.billingManaged'), 1) != 0)
         AND estimated_cost_usd >= 0
       ORDER BY created_at ASC
       LIMIT 100`,
    )
      .bind(...MANAGED_BILLABLE_TEXT_MODELS, ...MANAGED_IMAGE_MODELS)
      .all<LocalUsageRow>();
    rows = (result.results || []).filter(row => {
      const metadata = parseMetadata(row.metadata_json);
      return metadata.costKnown !== false && Number.isFinite(row.estimated_cost_usd) && row.estimated_cost_usd >= 0 && !(metadata.me3_runtime === "agent" && metadata.billingManaged === false);
    });
  } catch (error) {
    console.error("Managed AI usage outbox query failed", error);
    return null;
  }
  if (rows.length === 0) return null;

  const events = rows.map((row) => {
    const metadata = parseMetadata(row.metadata_json);
    return {
      id: row.id,
      provider: row.provider,
      model: row.kind === "image" && row.model.toLowerCase() === "openai/gpt-image-2" ? "gpt-image-2" : row.model.replace(/^@cf\//i, ""),
      kind: row.kind,
      inputTokens: Math.max(0, Math.trunc(Number(row.tokens_in) || 0)),
      cachedInputTokens: Math.max(
        0,
        Math.trunc(Number(metadata.cachedInputTokens) || 0),
      ),
      outputTokens: Math.max(0, Math.trunc(Number(row.tokens_out) || 0)),
      costMicrousd: Math.max(
        0,
        Math.round((Number(row.estimated_cost_usd) || 0) * 1_000_000),
      ),
      occurredAt: new Date(row.created_at).toISOString(),
    };
  });

  try {
    const response = await fetch(`${bridge.origin}/v1/ai-billing/usage`, {
      method: "POST",
      headers: { ...bridge.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    const payload = await response.json<unknown>().catch(() => null);
    const root = asRecord(payload);
    const settings = root?.settings;
    if (!response.ok || !Array.isArray(root?.acceptedEventIds)) {
      console.error("Managed AI usage sync rejected", response.status, apiError(payload));
      return null;
    }

    const acceptedIds = new Set(
      root.acceptedEventIds.filter((value): value is string => typeof value === "string"),
    );
    const reportedAt = new Date().toISOString();
    for (const row of rows) {
      if (!acceptedIds.has(row.id)) continue;
      const metadata = parseMetadata(row.metadata_json);
      metadata.managedBillingReportedAt = reportedAt;
      await env.DB.prepare(
        "UPDATE ai_usage_events SET metadata_json = ? WHERE id = ?",
      )
        .bind(JSON.stringify(metadata), row.id)
        .run();
    }
    if (isManagedAiBillingSettings(settings)) {
      await cacheManagedAiBillingPolicy(env, settings);
      return settings;
    }
  } catch (error) {
    console.error("Managed AI usage sync failed", error);
  }
  return null;
}

async function cacheManagedAiBillingPolicy(
  env: Env,
  settings: ManagedAiBillingSettings,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO install_secrets (name, value, created_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      MANAGED_AI_BILLING_POLICY_SECRET,
      JSON.stringify({
        defaultModel: settings.defaultModel,
        overagesEnabled: settings.overagesEnabled,
        monthlyMaximumCents: settings.monthlyMaximumCents,
        billingSource: settings.billingSource,
        cachedAt: new Date().toISOString(),
      }),
    )
    .run();
}

async function readCachedManagedBillingPolicy(
  env: Env,
): Promise<{ billingSource: ManagedAiBillingSettings["billingSource"]; cachedAt: string | null } | null> {
  try {
    const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
      .bind(MANAGED_AI_BILLING_POLICY_SECRET)
      .first<{ value: string }>();
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as { billingSource?: unknown; cachedAt?: unknown };
    const sources = ["internal", "storekit", "stripe", "google_play", "trial", "complimentary"];
    return {
      billingSource: typeof parsed.billingSource === "string" && sources.includes(parsed.billingSource)
        ? parsed.billingSource as ManagedAiBillingSettings["billingSource"]
        : null,
      cachedAt: typeof parsed.cachedAt === "string" ? parsed.cachedAt : null,
    };
  } catch {
    return null;
  }
}

/** The owner's last known entitlement source, from the local cache (no network call). */
export async function readCachedManagedBillingSource(
  env: Env,
): Promise<ManagedAiBillingSettings["billingSource"]> {
  return (await readCachedManagedBillingPolicy(env))?.billingSource ?? null;
}

const BILLING_POLICY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the cached billing source fresh for decisions made on public requests
 * (such as the site badge) without calling ME3 Cloud from those requests.
 */
export async function refreshManagedBillingPolicyIfStale(env: Env, now = Date.now()): Promise<void> {
  if (!isManaged(env)) return;
  const cached = await readCachedManagedBillingPolicy(env);
  const cachedAt = cached?.cachedAt ? Date.parse(cached.cachedAt) : NaN;
  if (cached?.billingSource && Number.isFinite(cachedAt) && now - cachedAt < BILLING_POLICY_MAX_AGE_MS) return;
  await getManagedAiBillingSettings(env, { syncUsage: false });
}

function unavailableSettings(
  managed: boolean,
  reason: string | null,
): ManagedAiBillingSettings {
  const month = new Date().toISOString().slice(0, 7);
  return {
    available: false,
    managed,
    currency: "usd",
    billingSource: null,
    defaultModel: DEFAULT_MANAGED_MODEL,
    models: [],
    eligible: false,
    ineligibleReason: reason,
    overagesEnabled: false,
    includedMonthlyCents: INCLUDED_MONTHLY_CENTS,
    monthlyMaximumCents: INCLUDED_MONTHLY_CENTS,
    minimumMonthlyMaximumCents: 1100,
    maximumMonthlyMaximumCents: 50_000,
    currentMonth: month,
    currentMonthUsageMicrousd: 0,
    currentMonthBillableMicrousd: 0,
    effectiveMaximumCents: INCLUDED_MONTHLY_CENTS,
    fallbackActive: false,
  };
}

function isManaged(env: Env): boolean {
  return env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed";
}

export type ManagedAllowanceNotice = {
  kind: "allowance_used";
  title: string;
  message: string;
  resetsOn: string;
  action: { kind: "enable_overages" | "subscribe"; label: string } | null;
};

/**
 * Shown under a reply that ran on the fallback model because the monthly
 * allowance is spent. Stripe owners can enable overages; trial and
 * complimentary owners can subscribe; App Store and internal (demo) owners
 * only get the notice.
 */
export function managedAllowanceNotice(policy: ManagedAiBillingSettings, now = new Date()): ManagedAllowanceNotice {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const resetsOn = reset.toISOString().slice(0, 10);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(reset);
  const action = policy.billingSource === "stripe" && policy.eligible && !policy.overagesEnabled
    ? { kind: "enable_overages" as const, label: "Turn on extra usage" }
    : policy.billingSource === "trial" || policy.billingSource === "complimentary"
      ? { kind: "subscribe" as const, label: "Subscribe" }
      : null;
  return {
    kind: "allowance_used",
    title: "This month's AI allowance is used",
    message: `Replies now use a lighter model until ${day}.`,
    resetsOn,
    action,
  };
}

/** Accepts only the server-authored notice shape when replaying saved messages. */
export function readManagedAllowanceNotice(value: unknown): ManagedAllowanceNotice | null {
  const root = asRecord(value);
  if (!root || root.kind !== "allowance_used" || typeof root.title !== "string" || typeof root.message !== "string" || typeof root.resetsOn !== "string") return null;
  const action = asRecord(root.action);
  const kind = action?.kind;
  if (root.action !== null && !(action && (kind === "enable_overages" || kind === "subscribe") && typeof action.label === "string")) return null;
  return { kind: "allowance_used", title: root.title, message: root.message, resetsOn: root.resetsOn, action: action ? { kind: kind as "enable_overages" | "subscribe", label: action.label as string } : null };
}

function isManagedAiBillingSettings(value: unknown): value is ManagedAiBillingSettings {
  const root = asRecord(value);
  return Boolean(
    root &&
    typeof root.available === "boolean" &&
    root.managed === true &&
    typeof root.overagesEnabled === "boolean" &&
    typeof root.defaultModel === "string" &&
    Array.isArray(root.models) &&
    typeof root.eligible === "boolean" &&
    typeof root.fallbackActive === "boolean" &&
    typeof root.effectiveMaximumCents === "number" && Number.isFinite(root.effectiveMaximumCents) && root.effectiveMaximumCents >= 0 &&
    typeof root.includedMonthlyCents === "number" &&
    typeof root.monthlyMaximumCents === "number" &&
    typeof root.currentMonthUsageMicrousd === "number" && Number.isFinite(root.currentMonthUsageMicrousd) && root.currentMonthUsageMicrousd >= 0,
  );
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) || {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function apiError(value: unknown): string {
  const root = asRecord(value);
  return typeof root?.error === "string" && root.error.trim()
    ? root.error.trim()
    : "Managed billing request failed";
}

export class ManagedAiBillingInputError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
