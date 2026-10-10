import { getManagedCommerceBridgeConfig } from "./commerce-bridge";
import type { Env } from "./types";

export const MANAGED_AI_BILLING_POLICY_SECRET = "ME3_MANAGED_AI_BILLING_POLICY";
const INCLUDED_MONTHLY_CENTS = 500;
const DEFAULT_MANAGED_MODEL = "openai/gpt-5.4-mini";
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
  "zai-org/glm-5.3-flash",
] as const;
export const MANAGED_AI_FALLBACK_MODEL = "@cf/zai-org/glm-4.7-flash";
const MANAGED_FALLBACK_MODELS = ["zai-org/glm-4.7-flash"] as const;
const MANAGED_BILLABLE_TEXT_MODELS = [...new Set<string>([
  ...MANAGED_MODELS,
  ...MANAGED_FALLBACK_MODELS,
])];
const MANAGED_IMAGE_MODELS = [
  "black-forest-labs/flux-2-klein-4b",
  "gpt-image-2",
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
  billingSource: "internal" | "storekit" | "stripe" | null;
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

export async function syncManagedAiUsage(
  env: Env,
): Promise<ManagedAiBillingSettings | null> {
  if (!isManaged(env)) return null;
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) return null;

  let rows: LocalUsageRow[];
  try {
    const result = await env.DB.prepare(
      `SELECT id, provider, model, kind, tokens_in, tokens_out,
              estimated_cost_usd, metadata_json, created_at
       FROM ai_usage_events
       WHERE (
           (kind = 'text' AND lower(replace(model, '@cf/', '')) IN (${MANAGED_BILLABLE_TEXT_MODELS.map(() => "?").join(", ")}))
           OR
           (kind = 'image' AND lower(replace(model, '@cf/', '')) IN (?, ?))
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
      model: row.model.replace(/^@cf\//i, ""),
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
        cachedAt: new Date().toISOString(),
      }),
    )
    .run();
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
    minimumMonthlyMaximumCents: 600,
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
