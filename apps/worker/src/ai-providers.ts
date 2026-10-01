import type { DbAiModelDefault, Env } from "./types";
import {
  DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
  DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
  normalizeMe3DeploymentMode,
} from "@me3-core/plugin-agent-chat";
import { hasInstallEncryptionKey } from "./install-secrets";
import {
  getAiGatewayRuntimeConfig,
  type AiGatewayRuntimeConfig,
} from "./ai-gateway";

export const DEFAULT_WORKERS_AI_TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";

export const AI_ROUTE_IDS = [
  "default",
  "chat",
  "reasoning",
  "extraction",
  "image_generation",
] as const;

export type AiRouteId = (typeof AI_ROUTE_IDS)[number];
type AiTextRouteId = Exclude<AiRouteId, "image_generation">;
export type AiProviderId = "workers-ai" | "openai" | "anthropic" | "executor";

type AiProviderAdapter = {
  id: AiProviderId;
  label: string;
  description: string;
  setupLabel: string;
  supportsApiKey: boolean;
  secretLabel: string | null;
  secretEnv?: keyof Env;
  bindingEnv?: keyof Env;
  recommendedModels: Record<AiRouteId, string>;
};

export type AiProviderSettingsRecord = {
  id: AiProviderId;
  label: string;
  description: string;
  setupLabel: string;
  supportsApiKey: boolean;
  secretLabel: string | null;
  configured: boolean;
  setupRequired: boolean;
  statusLabel: string;
  source: "binding" | "environment" | "stored" | "not_configured";
  keyHint: string | null;
  keyUpdatedAt: string | null;
  recommendedModels: Record<AiRouteId, string>;
};

export type AiModelRouteRecord = {
  id: AiRouteId;
  label: string;
  providerId: AiProviderId;
  providerLabel: string;
  model: string;
  configured: boolean;
  setupRequired: boolean;
  source: "stored" | "environment" | "recommended";
};

export type AiSettingsResponse = {
  deploymentMode: "managed" | "self_hosted";
  encryptionConfigured: boolean;
  providers: AiProviderSettingsRecord[];
  routes: AiModelRouteRecord[];
  defaults: Record<AiRouteId, AiModelRouteRecord>;
};

export type AiTextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiTextGenerationSelection = {
  providerId?: unknown;
  model?: unknown;
};

export type AiTextGenerationResult = {
  text: string;
  providerId: Exclude<AiProviderId, "executor">;
  model: string;
};

type AiProviderUpdate = {
  id?: unknown;
  apiKey?: unknown;
  clearApiKey?: unknown;
};

type AiRouteUpdate = {
  providerId?: unknown;
  model?: unknown;
};

const AI_PROVIDER_ADAPTERS: readonly AiProviderAdapter[] = [
  {
    id: "workers-ai",
    label: "Cloudflare Workers AI",
    description:
      "Uses the Workers AI binding for installs that want no external API key.",
    setupLabel: "AI binding",
    supportsApiKey: false,
    secretLabel: null,
    bindingEnv: "AI",
    recommendedModels: {
      default: DEFAULT_WORKERS_AI_TEXT_MODEL,
      chat: DEFAULT_WORKERS_AI_TEXT_MODEL,
      reasoning: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      extraction: DEFAULT_WORKERS_AI_TEXT_MODEL,
      image_generation: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    description:
      "Uses OpenAI models through Cloudflare AI Gateway and Cloudflare billing.",
    setupLabel: "Cloudflare AI binding",
    supportsApiKey: false,
    secretLabel: null,
    bindingEnv: "AI",
    recommendedModels: {
      default: "gpt-4o",
      chat: "gpt-4o",
      reasoning: "gpt-5.5",
      extraction: "gpt-4o",
      image_generation: DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
    },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description:
      "Uses Anthropic models through Cloudflare AI Gateway and Cloudflare billing.",
    setupLabel: "Cloudflare AI binding",
    supportsApiKey: false,
    secretLabel: null,
    bindingEnv: "AI",
    recommendedModels: {
      default: "claude-sonnet-4-6",
      chat: "claude-sonnet-4-6",
      reasoning: "claude-opus-4-8",
      extraction: "claude-sonnet-4-6",
      image_generation: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
    },
  },
  {
    id: "executor",
    label: "External executor",
    description:
      "Placeholder adapter for future executor-style providers owned by plugins or local tools.",
    setupLabel: "Executor adapter",
    supportsApiKey: false,
    secretLabel: null,
    recommendedModels: {
      default: "executor-default",
      chat: "executor-chat",
      reasoning: "executor-reasoning",
      extraction: "executor-extraction",
      image_generation: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
    },
  },
];

const ROUTE_LABELS: Record<AiRouteId, string> = {
  default: "Default",
  chat: "Chat",
  reasoning: "Reasoning",
  extraction: "Extraction",
  image_generation: "Image generation",
};

const ROUTE_ENV_KEYS: Record<
  AiRouteId,
  { provider: keyof Env; model: keyof Env }
> = {
  default: {
    provider: "ME3_AI_DEFAULT_PROVIDER",
    model: "ME3_AI_DEFAULT_MODEL",
  },
  chat: {
    provider: "ME3_AI_CHAT_PROVIDER",
    model: "ME3_AI_CHAT_MODEL",
  },
  reasoning: {
    provider: "ME3_AI_REASONING_PROVIDER",
    model: "ME3_AI_REASONING_MODEL",
  },
  extraction: {
    provider: "ME3_AI_EXTRACTION_PROVIDER",
    model: "ME3_AI_EXTRACTION_MODEL",
  },
  image_generation: {
    provider: "ME3_AI_IMAGE_GENERATION_PROVIDER",
    model: "ME3_AI_IMAGE_GENERATION_MODEL",
  },
};

const PROVIDER_ALIASES: Record<string, AiProviderId> = {
  anthropic: "anthropic",
  claude: "anthropic",
  cloudflare: "workers-ai",
  "cloudflare-workers-ai": "workers-ai",
  executor: "executor",
  openai: "openai",
  workers: "workers-ai",
  "workers-ai": "workers-ai",
  workers_ai: "workers-ai",
};

export class AiSettingsInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AiSettingsInputError";
  }
}

export async function getAiSettings(env: Env, ownerId: string): Promise<AiSettingsResponse> {
  const storedDefaults = await listAiModelDefaults(env, ownerId);
  const encryptionConfigured = await hasInstallEncryptionKey(env);
  const providers = AI_PROVIDER_ADAPTERS.map((adapter) =>
    serializeProvider(adapter, env),
  );
  const defaultRoute = resolveRoute(
    "default",
    providers,
    storedDefaults.get("default") || null,
    env,
  );
  const defaults = Object.fromEntries(
    AI_ROUTE_IDS.map((routeId) => [
      routeId,
      routeId === "default"
        ? defaultRoute
        : resolveRoute(routeId, providers, storedDefaults.get(routeId) || null, env, defaultRoute),
    ]),
  ) as Record<AiRouteId, AiModelRouteRecord>;

  return {
    deploymentMode:
      normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed"
        ? "managed"
        : "self_hosted",
    encryptionConfigured,
    providers,
    routes: AI_ROUTE_IDS.map((routeId) => defaults[routeId]),
    defaults,
  };
}

export async function updateAiSettings(
  env: Env,
  ownerId: string,
  input: unknown,
): Promise<AiSettingsResponse> {
  if (!isRecord(input)) {
    throw new AiSettingsInputError("AI settings payload is required");
  }

  let changed = false;
  const providerUpdates = input.providers;
  if (providerUpdates !== undefined) {
    if (!Array.isArray(providerUpdates)) {
      throw new AiSettingsInputError("providers must be an array");
    }
    for (const update of providerUpdates) {
      await applyProviderUpdate(env, ownerId, update as AiProviderUpdate);
      changed = true;
    }
  }

  const routeUpdates = input.defaults;
  if (routeUpdates !== undefined) {
    if (!isRecord(routeUpdates)) {
      throw new AiSettingsInputError("defaults must be an object");
    }
    for (const routeId of AI_ROUTE_IDS) {
      if (Object.prototype.hasOwnProperty.call(routeUpdates, routeId)) {
        await applyRouteUpdate(
          env,
          ownerId,
          routeId,
          routeUpdates[routeId] as AiRouteUpdate | null,
        );
        changed = true;
      }
    }
  }

  if (!changed) {
    throw new AiSettingsInputError("providers or defaults is required");
  }

  return getAiSettings(env, ownerId);
}

export async function getAiRoutingSummary(
  env: Env,
  ownerId: string,
): Promise<Record<AiRouteId, AiModelRouteRecord>> {
  const settings = await getAiSettings(env, ownerId);
  return settings.defaults;
}

export async function hasConfiguredAiProvider(env: Env, ownerId: string): Promise<boolean> {
  try {
    const settings = await getAiSettings(env, ownerId);
    return settings.providers.some((provider) => provider.configured);
  } catch {
    return Boolean(env.AI);
  }
}

export async function generateAiText(
  env: Env,
  ownerId: string,
  input: {
    routeId?: AiTextRouteId;
    selectedModel?: AiTextGenerationSelection | null;
    messages: AiTextMessage[];
    temperature?: number;
    maxTokens?: number;
  },
): Promise<AiTextGenerationResult> {
  const route = await resolveTextGenerationRoute(
    env,
    ownerId,
    input.routeId || "chat",
    input.selectedModel || null,
  );
  const temperature =
    typeof input.temperature === "number" && Number.isFinite(input.temperature)
      ? input.temperature
      : 0.4;
  const maxTokens =
    typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens)
      ? Math.max(64, Math.min(Math.round(input.maxTokens), 4000))
      : 1200;

  const text = await runWorkersAiText(route, input.messages, { temperature, maxTokens });

  return {
    text,
    providerId: route.model.startsWith("openai/")
      ? "openai"
      : route.model.startsWith("anthropic/")
        ? "anthropic"
        : "workers-ai",
    model: route.model,
  };
}

async function applyProviderUpdate(
  env: Env,
  ownerId: string,
  update: AiProviderUpdate,
) {
  if (!isRecord(update)) {
    throw new AiSettingsInputError("provider updates must be objects");
  }

  const providerId = normalizeProviderId(update.id);
  const adapter = providerId ? getProviderAdapter(providerId) : null;
  if (!providerId || !adapter) {
    throw new AiSettingsInputError("Unknown AI provider");
  }

  if (update.clearApiKey === true || update.apiKey === null) {
    await env.DB.prepare(
      "DELETE FROM ai_provider_credentials WHERE user_id = ? AND provider_id = ?",
    )
      .bind(ownerId, providerId)
      .run();
    return;
  }

  if (update.apiKey === undefined || update.apiKey === "") {
    return;
  }

  throw new AiSettingsInputError(`${adapter.label} does not accept an API key`);
}

async function applyRouteUpdate(
  env: Env,
  ownerId: string,
  routeId: AiRouteId,
  update: AiRouteUpdate | null,
) {
  if (update === null) {
    await env.DB.prepare(
      "DELETE FROM ai_model_defaults WHERE user_id = ? AND use_case = ?",
    )
      .bind(ownerId, routeId)
      .run();
    return;
  }

  if (!isRecord(update)) {
    throw new AiSettingsInputError(`${ROUTE_LABELS[routeId]} defaults must be an object`);
  }

  const providerId = normalizeProviderId(update.providerId);
  if (!providerId || !getProviderAdapter(providerId)) {
    throw new AiSettingsInputError(`Unknown provider for ${ROUTE_LABELS[routeId]} route`);
  }

  const model = normalizeModel(update.model);
  if (!model) {
    throw new AiSettingsInputError(`Model is required for ${ROUTE_LABELS[routeId]} route`);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ai_model_defaults (
       user_id, use_case, provider_id, model, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, use_case) DO UPDATE SET
       provider_id = excluded.provider_id,
       model = excluded.model,
       updated_at = excluded.updated_at`,
  )
    .bind(ownerId, routeId, providerId, model, now, now)
    .run();
}

async function listAiModelDefaults(
  env: Env,
  ownerId: string,
): Promise<Map<AiRouteId, DbAiModelDefault>> {
  let rows: D1Result<DbAiModelDefault>;
  try {
    rows = await env.DB.prepare(
      `SELECT user_id, use_case, provider_id, model, created_at, updated_at
       FROM ai_model_defaults
       WHERE user_id = ?`,
    )
      .bind(ownerId)
      .all<DbAiModelDefault>();
  } catch (error) {
    if (isMissingAiSettingsTableError(error)) return new Map();
    throw error;
  }

  return new Map(
    (rows.results || [])
      .map((row) => [normalizeRouteId(row.use_case), row] as const)
      .filter((entry): entry is readonly [AiRouteId, DbAiModelDefault] =>
        Boolean(entry[0]),
      ),
  );
}

function serializeProvider(adapter: AiProviderAdapter, env: Env): AiProviderSettingsRecord {
  const hasBinding = Boolean(adapter.bindingEnv && env[adapter.bindingEnv]);
  const configured = hasBinding;
  const source = hasBinding ? "binding" : "not_configured";

  return {
    id: adapter.id,
    label: adapter.label,
    description: adapter.description,
    setupLabel: adapter.setupLabel,
    supportsApiKey: adapter.supportsApiKey,
    secretLabel: adapter.secretLabel,
    configured,
    setupRequired: !configured,
    statusLabel: configured ? "Ready" : "Setup required",
    source,
    keyHint: null,
    keyUpdatedAt: null,
    recommendedModels: adapter.recommendedModels,
  };
}

function resolveRoute(
  routeId: AiRouteId,
  providers: AiProviderSettingsRecord[],
  storedDefault: DbAiModelDefault | null,
  env: Env,
  fallbackRoute?: AiModelRouteRecord,
): AiModelRouteRecord {
  if (
    routeId === "image_generation" &&
    normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed"
  ) {
    const adapter = getProviderAdapter("openai")!;
    const provider = providers.find((candidate) => candidate.id === adapter.id);
    const configured = Boolean(provider?.configured);
    return {
      id: routeId,
      label: ROUTE_LABELS[routeId],
      providerId: adapter.id,
      providerLabel: adapter.label,
      model: DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
      configured,
      setupRequired: !configured,
      source: "recommended",
    };
  }

  const envKeys = ROUTE_ENV_KEYS[routeId];
  const envModel = normalizeModel(env[envKeys.model]) || normalizeModel(env.ME3_AI_MODEL);
  const storedProviderId = normalizeProviderId(storedDefault?.provider_id);
  const envProviderId = normalizeProviderId(env[envKeys.provider]) || (envModel ? "workers-ai" : null);
  const inheritedRoute = routeId === "image_generation" ? undefined : fallbackRoute;
  const firstConfiguredProvider =
    routeId === "image_generation"
      ? undefined
      : providers.find((provider) => provider.configured)?.id;
  const providerId =
    storedProviderId ||
    envProviderId ||
    inheritedRoute?.providerId ||
    firstConfiguredProvider ||
    "workers-ai";
  const adapter = getProviderAdapter(providerId) || getProviderAdapter("workers-ai")!;
  const provider = providers.find((candidate) => candidate.id === adapter.id);
  const source = storedProviderId
    ? "stored"
    : envProviderId || envModel
      ? "environment"
      : "recommended";
  const model =
    normalizeModel(storedDefault?.model) ||
    envModel ||
    inheritedRoute?.model ||
    adapter.recommendedModels[routeId];
  const configured = Boolean(provider?.configured && model);

  return {
    id: routeId,
    label: ROUTE_LABELS[routeId],
    providerId: adapter.id,
    providerLabel: adapter.label,
    model,
    configured,
    setupRequired: !configured,
    source,
  };
}

function getProviderAdapter(providerId: AiProviderId): AiProviderAdapter | null {
  return AI_PROVIDER_ADAPTERS.find((adapter) => adapter.id === providerId) || null;
}

function normalizeProviderId(value: unknown): AiProviderId | null {
  if (typeof value !== "string") return null;
  return PROVIDER_ALIASES[value.trim().toLowerCase()] || null;
}

function normalizeRouteId(value: unknown): AiRouteId | null {
  return typeof value === "string" && AI_ROUTE_IDS.includes(value as AiRouteId)
    ? (value as AiRouteId)
    : null;
}

function normalizeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > 160) return null;
  return model;
}

type ResolvedTextGenerationRoute = {
  providerId: Exclude<AiProviderId, "executor">;
  model: string;
  apiKey: string | null;
  ai: Ai | null;
  aiGateway: AiGatewayRuntimeConfig | null;
};

async function resolveTextGenerationRoute(
  env: Env,
  ownerId: string,
  routeId: AiTextRouteId,
  selectedModel: AiTextGenerationSelection | null,
): Promise<ResolvedTextGenerationRoute> {
  const settings = await getAiSettings(env, ownerId);
  const selectedProviderId = normalizeProviderId(selectedModel?.providerId);
  const selectedModelName = normalizeModel(selectedModel?.model);
  const defaultRoute = settings.defaults[routeId] || settings.defaults.chat;
  const providerId = selectedProviderId || defaultRoute.providerId;
  if (providerId === "executor") {
    throw new Error("External executor models cannot generate text in Core yet.");
  }

  const model = selectedModelName || defaultRoute.model;
  if (!model) throw new Error("AI model is not configured.");

  if (!env.AI) throw new Error("Cloudflare AI binding is not configured.");

  const configuredGateway = await getAiGatewayRuntimeConfig(env, ownerId).catch(() => null);
  const aiGateway = {
    accountId: configuredGateway?.accountId ?? null,
    gatewayId: normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed"
      ? env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || "default"
      : configuredGateway?.gatewayId || "default",
    apiToken: configuredGateway?.apiToken ?? null,
    routeWorkersAi: true,
    routeExternalProviders: false,
  };

  return {
    providerId: "workers-ai",
    model: providerId === "workers-ai" || model.startsWith(`${providerId}/`)
      ? model
      : `${providerId}/${model}`,
    apiKey: null,
    ai: env.AI,
    aiGateway,
  };
}

async function runWorkersAiText(
  route: ResolvedTextGenerationRoute,
  messages: AiTextMessage[],
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  if (!route.ai) throw new Error("Workers AI binding is not configured.");
  const requestOptions =
    route.aiGateway?.routeWorkersAi && route.aiGateway.gatewayId
      ? {
          gateway: {
            id: route.aiGateway.gatewayId,
          },
        }
      : undefined;
  const result = await route.ai.run(
    route.model,
    route.model.startsWith("anthropic/")
      ? {
          system: messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"),
          messages: messages.filter((message) => message.role !== "system"),
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        }
      : isOpenAiReasoningModel(route.model.replace(/^openai\//, ""))
        ? { messages, max_completion_tokens: options.maxTokens }
        : { messages, temperature: options.temperature, max_tokens: options.maxTokens },
    requestOptions,
  );
  const text = extractAiText(result);
  if (!text) throw new Error(`Workers AI (${route.model}) returned an empty reply.`);
  return text;
}

function isOpenAiReasoningModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /^gpt-5(?:[.-]|$)/.test(normalized) || /^o\d(?:[.-]|$)/.test(normalized);
}

function extractAiText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((part) => extractAiText(part)).join("").trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return (
    extractAiText(record.text) ||
    extractAiText(record.output_text) ||
    extractAiText(record.response) ||
    extractAiText(record.content) ||
    extractAiText(record.message) ||
    extractAiText(record.choices) ||
    extractAiText(record.result) ||
    extractAiText(record.output)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingAiSettingsTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("ai_provider_credentials") ||
    message.includes("ai_model_defaults")
  ) && /no such table|does not exist/i.test(message);
}
