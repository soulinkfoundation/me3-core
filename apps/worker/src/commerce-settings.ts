import type { Env } from "./types";
import {
  getOrCreateInstallEncryptionKey,
  hasInstallEncryptionKey,
} from "./install-secrets";
import {
  getManagedCommerceBridgeConfig,
  getManagedCommerceConnectionStatus,
  type ManagedCommerceConnectionStatus,
} from "./commerce-bridge";

type CommerceSettingsRow = {
  user_id: string;
  encrypted_stripe_secret_key: string | null;
  stripe_key_hint: string | null;
  stripe_key_updated_at: string | null;
  preferred_stripe_provider: string | null;
  default_currency: string | null;
  created_at: string;
  updated_at: string;
};

export type CommerceSettingsResponse = {
  encryptionConfigured: boolean;
  defaultCurrency: string;
  stripe: {
    configured: boolean;
    source: "environment" | "stored" | "managed" | "not_configured";
    keyHint: string | null;
    keyUpdatedAt: string | null;
    mode: "direct" | "managed";
    preferredProvider: StripeProviderPreference;
    directConfigured: boolean;
    directKeySetupAllowed: boolean;
    directSource: "environment" | "stored" | "not_configured";
    managedAvailable: boolean;
    connectionStatus: ManagedCommerceConnectionStatus["status"] | "unavailable" | null;
    connected: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    requirementsDue: string[];
  };
};

type StripeProviderPreference = "auto" | "direct" | "managed";

export class CommerceSettingsInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "CommerceSettingsInputError";
  }
}

const DEFAULT_COMMERCE_CURRENCY = "USD";
const DEFAULT_CURRENCY_REGEX = /^[A-Z]{3}$/;

export async function getCommerceSettings(
  env: Env,
  ownerId: string,
): Promise<CommerceSettingsResponse> {
  const row = await getCommerceSettingsRow(env, ownerId);
  const envKey = normalizeSecret(env.STRIPE_SECRET_KEY);
  const hasEnvKey = Boolean(envKey);
  const hasStoredKey = Boolean(row?.encrypted_stripe_secret_key);
  const directConfigured = hasEnvKey || hasStoredKey;
  const hasManagedBridge = Boolean(await getManagedCommerceBridgeConfig(env));
  const preferredProvider = normalizeStripeProviderPreference(
    row?.preferred_stripe_provider,
  );
  const mode = resolveStripeProviderMode(
    preferredProvider,
    directConfigured,
    hasManagedBridge,
  );
  let managedStatus: ManagedCommerceConnectionStatus | null = null;
  let managedStatusUnavailable = false;
  if (hasManagedBridge) {
    try {
      managedStatus = await getManagedCommerceConnectionStatus(env);
    } catch (error) {
      managedStatusUnavailable = true;
      console.error("Managed Stripe connection status failed:", error);
    }
  }
  const managedReady = managedStatus?.connected === true && managedStatus.status === "active" &&
    managedStatus.chargesEnabled && managedStatus.payoutsEnabled;

  return {
    encryptionConfigured: await hasInstallEncryptionKey(env),
    defaultCurrency: await resolveDefaultCurrency(env, ownerId, row),
    stripe: {
      configured: mode === "managed" ? managedReady : directConfigured,
      source: mode === "managed"
        ? "managed"
        : hasEnvKey
          ? "environment"
          : hasStoredKey
            ? "stored"
            : "not_configured",
      keyHint: hasEnvKey
        ? getSecretHint(envKey)
        : row?.stripe_key_hint || null,
      keyUpdatedAt: hasEnvKey ? null : row?.stripe_key_updated_at || null,
      mode,
      preferredProvider,
      directConfigured,
      directKeySetupAllowed: env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() !== "managed",
      directSource: hasEnvKey
        ? "environment"
        : hasStoredKey
          ? "stored"
          : "not_configured",
      managedAvailable: hasManagedBridge,
      connectionStatus: hasManagedBridge
        ? managedStatusUnavailable
          ? "unavailable"
          : managedStatus?.status || "not_connected"
        : null,
      connected: managedStatus?.connected === true,
      chargesEnabled: managedStatus?.chargesEnabled === true,
      payoutsEnabled: managedStatus?.payoutsEnabled === true,
      requirementsDue: managedStatus?.requirementsDue || [],
    },
  };
}

export async function isCommerceReady(env: Env, ownerId: string): Promise<boolean> {
  const row = await getCommerceSettingsRow(env, ownerId);
  const directConfigured = Boolean(
    normalizeSecret(env.STRIPE_SECRET_KEY) || row?.encrypted_stripe_secret_key,
  );
  const hasManagedBridge = Boolean(await getManagedCommerceBridgeConfig(env));
  const mode = resolveStripeProviderMode(
    normalizeStripeProviderPreference(row?.preferred_stripe_provider),
    directConfigured,
    hasManagedBridge,
  );
  if (mode === "direct") return directConfigured;

  try {
    const status = await getManagedCommerceConnectionStatus(env);
    return isManagedCommerceReady(status);
  } catch {
    return false;
  }
}

export async function updateCommerceSettings(
  env: Env,
  ownerId: string,
  input: unknown,
): Promise<CommerceSettingsResponse> {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const existingRow = await getCommerceSettingsRow(env, ownerId);
  const stripeSecretKey = normalizeSecret(body.stripeSecretKey);
  const clearStripeSecretKey = body.clearStripeSecretKey === true;
  const hasPreferredProviderInput = Object.prototype.hasOwnProperty.call(
    body,
    "preferredStripeProvider",
  );
  const preferredProviderInput = hasPreferredProviderInput
    ? parseStripeProviderPreference(body.preferredStripeProvider)
    : null;
  if (env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed" &&
      (stripeSecretKey || preferredProviderInput === "direct")) {
    throw new CommerceSettingsInputError("Use Stripe Connect for payments on managed hosting.", 400);
  }
  const hasDefaultCurrencyInput = Object.prototype.hasOwnProperty.call(body, "defaultCurrency");
  const defaultCurrencyInput = hasDefaultCurrencyInput
    ? normalizeDefaultCurrency(body.defaultCurrency)
    : null;

  if (hasDefaultCurrencyInput && !defaultCurrencyInput) {
    throw new CommerceSettingsInputError("Use a three-letter default currency code.");
  }

  if (hasPreferredProviderInput && !preferredProviderInput) {
    throw new CommerceSettingsInputError("Choose direct or managed Stripe payments.");
  }

  if (
    !stripeSecretKey &&
    !clearStripeSecretKey &&
    !hasDefaultCurrencyInput &&
    !hasPreferredProviderInput
  ) {
    return getCommerceSettings(env, ownerId);
  }

  let encryptedStripeSecretKey = existingRow?.encrypted_stripe_secret_key || null;
  let stripeKeyHint = existingRow?.stripe_key_hint || null;
  let stripeKeyUpdatedAt = existingRow?.stripe_key_updated_at || null;
  let preferredProvider = normalizeStripeProviderPreference(
    existingRow?.preferred_stripe_provider,
  );
  const defaultCurrency =
    defaultCurrencyInput || await resolveDefaultCurrency(env, ownerId, existingRow);

  if (clearStripeSecretKey) {
    encryptedStripeSecretKey = null;
    stripeKeyHint = null;
    stripeKeyUpdatedAt = null;
  }

  if (stripeSecretKey) {
    validateStripeSecretKey(stripeSecretKey);
    const installKey = await getOrCreateInstallEncryptionKey(env);
    encryptedStripeSecretKey = await encryptSecret(stripeSecretKey, installKey);
    stripeKeyHint = getSecretHint(stripeSecretKey);
    stripeKeyUpdatedAt = new Date().toISOString();
    preferredProvider = "direct";
  }

  if (preferredProviderInput) preferredProvider = preferredProviderInput;

  const directConfigured = Boolean(
    normalizeSecret(env.STRIPE_SECRET_KEY) || encryptedStripeSecretKey,
  );
  if (clearStripeSecretKey && preferredProvider === "direct" && !directConfigured) {
    preferredProvider = "auto";
  }
  if (preferredProvider === "direct" && !directConfigured) {
    throw new CommerceSettingsInputError(
      "Add a Stripe secret key before selecting direct payments.",
    );
  }
  if (preferredProvider === "managed") {
    if (!(await getManagedCommerceBridgeConfig(env))) {
      throw new CommerceSettingsInputError(
        "Stripe Connect is not available for this installation.",
        503,
      );
    }
    let status: ManagedCommerceConnectionStatus | null = null;
    try {
      status = await getManagedCommerceConnectionStatus(env);
    } catch {
      throw new CommerceSettingsInputError(
        "ME3 could not verify the Stripe Connect account. Try again.",
        502,
      );
    }
    if (!isManagedCommerceReady(status)) {
      throw new CommerceSettingsInputError(
        "Finish Stripe Connect setup before using it for payments.",
        409,
      );
    }
  }

  await env.DB.prepare(
    `INSERT INTO commerce_settings (
       user_id, encrypted_stripe_secret_key, stripe_key_hint,
       stripe_key_updated_at, preferred_stripe_provider, default_currency,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_stripe_secret_key = excluded.encrypted_stripe_secret_key,
       stripe_key_hint = excluded.stripe_key_hint,
       stripe_key_updated_at = excluded.stripe_key_updated_at,
       preferred_stripe_provider = excluded.preferred_stripe_provider,
       default_currency = excluded.default_currency,
       updated_at = datetime('now')`,
  )
    .bind(
      ownerId,
      encryptedStripeSecretKey,
      stripeKeyHint,
      stripeKeyUpdatedAt,
      preferredProvider,
      defaultCurrency,
    )
    .run();

  return getCommerceSettings(env, ownerId);
}

export async function getDefaultCommerceCurrency(
  env: Env,
  ownerId: string,
): Promise<string> {
  const row = await getCommerceSettingsRow(env, ownerId);
  return resolveDefaultCurrency(env, ownerId, row);
}

export async function getStripeSecretKey(
  env: Env,
  ownerId: string,
): Promise<string | null> {
  const row = await getCommerceSettingsRow(env, ownerId);
  const envKey = normalizeSecret(env.STRIPE_SECRET_KEY);
  const hasManagedBridge = Boolean(await getManagedCommerceBridgeConfig(env));
  const directConfigured = Boolean(envKey || row?.encrypted_stripe_secret_key);
  const mode = resolveStripeProviderMode(
    normalizeStripeProviderPreference(row?.preferred_stripe_provider),
    directConfigured,
    hasManagedBridge,
  );
  if (mode === "managed") return null;
  if (envKey) return envKey;
  if (!row?.encrypted_stripe_secret_key) return null;

  const installKey = await getOrCreateInstallEncryptionKey(env);
  return decryptSecret(row.encrypted_stripe_secret_key, installKey);
}

async function getCommerceSettingsRow(
  env: Env,
  ownerId: string,
): Promise<CommerceSettingsRow | null> {
  try {
    return (
      (await env.DB.prepare(
        `SELECT user_id, encrypted_stripe_secret_key, stripe_key_hint,
                stripe_key_updated_at, preferred_stripe_provider,
                default_currency, created_at, updated_at
         FROM commerce_settings
         WHERE user_id = ?`,
      )
        .bind(ownerId)
        .first<CommerceSettingsRow>()) || null
    );
  } catch (error) {
    if (isMissingCommerceSettingsTableError(error)) return null;
    throw error;
  }
}

function parseStripeProviderPreference(value: unknown): "direct" | "managed" | null {
  return value === "direct" || value === "managed" ? value : null;
}

function normalizeStripeProviderPreference(value: unknown): StripeProviderPreference {
  return value === "direct" || value === "managed" ? value : "auto";
}

function resolveStripeProviderMode(
  preference: StripeProviderPreference,
  directConfigured: boolean,
  managedAvailable: boolean,
): "direct" | "managed" {
  if (preference === "managed" && managedAvailable) return "managed";
  if (preference === "direct") return "direct";
  if (directConfigured) return "direct";
  return managedAvailable ? "managed" : "direct";
}

function isManagedCommerceReady(
  status: ManagedCommerceConnectionStatus | null,
): boolean {
  return status?.connected === true && status.status === "active" &&
    status.chargesEnabled && status.payoutsEnabled;
}

function normalizeDefaultCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return DEFAULT_CURRENCY_REGEX.test(currency) ? currency : null;
}

async function resolveDefaultCurrency(
  env: Env,
  ownerId: string,
  row: CommerceSettingsRow | null,
): Promise<string> {
  return (
    normalizeDefaultCurrency(row?.default_currency) ||
    inferDefaultCurrencyFromTimezone(await getOwnerTimezone(env, ownerId)) ||
    DEFAULT_COMMERCE_CURRENCY
  );
}

async function getOwnerTimezone(env: Env, ownerId: string): Promise<string | null> {
  try {
    const owner = await env.DB.prepare("SELECT timezone FROM owner_profile WHERE id = ?")
      .bind(ownerId)
      .first<{ timezone: string | null }>();
    return typeof owner?.timezone === "string" ? owner.timezone : null;
  } catch (error) {
    if (isMissingOwnerProfileTableError(error)) return null;
    throw error;
  }
}

function inferDefaultCurrencyFromTimezone(timezone: string | null): string | null {
  if (!timezone) return null;
  if (timezone === "Europe/London") return "GBP";
  if (timezone === "Europe/Zurich") return "CHF";
  if (timezone.startsWith("Europe/")) return "EUR";
  if (timezone.startsWith("Australia/")) return "AUD";
  if (timezone === "Pacific/Auckland") return "NZD";
  if (timezone === "Asia/Singapore") return "SGD";
  if (timezone === "Asia/Hong_Kong") return "HKD";
  if (timezone === "Asia/Tokyo") return "JPY";
  if (timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta") return "INR";
  if (timezone === "Asia/Karachi") return "PKR";
  if (
    timezone === "America/Toronto" ||
    timezone === "America/Vancouver" ||
    timezone === "America/Edmonton" ||
    timezone === "America/Winnipeg" ||
    timezone === "America/Halifax" ||
    timezone === "America/St_Johns"
  ) {
    return "CAD";
  }
  if (timezone.startsWith("America/")) return "USD";
  return null;
}

function normalizeSecret(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateStripeSecretKey(value: string): void {
  if (!/^sk_(test|live)_[A-Za-z0-9_]+$/.test(value)) {
    throw new CommerceSettingsInputError(
      "Use a Stripe secret key that starts with sk_test_ or sk_live_.",
    );
  }
}

function getSecretHint(secret: string): string {
  return `***${secret.slice(-4)}`;
}

async function encryptSecret(secret: string, installKey: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importSecretCryptoKey(installKey, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

async function decryptSecret(encrypted: string, installKey: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = encrypted.split(".");
  if (version !== "v1" || !ivBase64 || !ciphertextBase64) {
    throw new CommerceSettingsInputError("Stored Stripe key is invalid", 500);
  }
  const key = await importSecretCryptoKey(installKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(ivBase64) },
    key,
    decodeBase64Url(ciphertextBase64),
  );
  return new TextDecoder().decode(plaintext);
}

async function importSecretCryptoKey(
  installKey: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(installKey),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function isMissingCommerceSettingsTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("commerce_settings") &&
    /no such table|does not exist/i.test(message)
  );
}

function isMissingOwnerProfileTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("owner_profile") &&
    /no such table|does not exist/i.test(message)
  );
}
