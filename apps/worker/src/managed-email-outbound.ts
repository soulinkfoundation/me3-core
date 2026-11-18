import { originFromUrl } from "./sites";
import type { EmailProviderAttachment, EmailSendPurpose } from "./email-providers";
import type { Env } from "./types";

export const MANAGED_EMAIL_PROVIDER_ID = "managed_gateway" as const;

export const MANAGED_EMAIL_MAX_REQUEST_BYTES = 5 * 1024 * 1024;

const CORE_INSTALL_ID_SECRET = "ME3_CORE_INSTALL_ID";

const CORE_UPDATE_TOKEN_SECRET = "ME3_CLOUD_CORE_TOKEN";

const CLOUD_OWNER_ID_SECRET = "ME3_CLOUD_OWNER_ID";

const MANAGED_INSTALLATION_ID = /^mi-[A-Za-z0-9][A-Za-z0-9._:-]{2,198}$/;

const CORE_INSTALL_ID = /^core_[A-Za-z0-9][A-Za-z0-9._:-]{2,198}$/;

const AMBIGUOUS_GATEWAY_ERROR_CODES = new Set([
  "delivery_processing",
  "delivery_unknown",
]);

export type ManagedEmailGatewaySendInput = {
  auditId: string;
  purpose: EmailSendPurpose;
  fromAddress: string;
  fromName: string;
  replyToAddress: string;
  toAddress: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject: string;
  textBody: string;
  htmlBody: string | null;
  attachments: EmailProviderAttachment[];
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  approvedByUserId: string | null;
  metadata: Record<string, string>;
};

export type ManagedEmailGatewaySendResult = {
  providerMessageId: string | null;
  providerStatus: string;
  raw: unknown;
};

export class ManagedEmailGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly definitive: boolean,
    readonly raw: unknown = null,
  ) {
    super(message);
    this.name = "ManagedEmailGatewayError";
  }
}

type ManagedEmailRuntimeIdentity = {
  managedInstallationId: string;
  coreInstallId: string;
};

type ManagedEmailGatewayConfig = ManagedEmailRuntimeIdentity & {
  origin: string;
  coreUpdateToken: string;
  cloudOwnerId: string;
};

export function isManagedEmailDeployment(env: Env): boolean {
  return String(env.ME3_DEPLOYMENT_MODE || "").trim().toLowerCase() === "managed";
}

export function hasManagedEmailGatewayCapability(env: Env): boolean {
  return Boolean(
    isManagedEmailDeployment(env) &&
      normalizedManagedInstallationId(env.ME3_MANAGED_INSTALLATION_ID) &&
      managedEmailGatewayOrigin(env),
  );
}

export async function sendManagedEmailThroughGateway(
  env: Env,
  input: ManagedEmailGatewaySendInput,
): Promise<ManagedEmailGatewaySendResult> {
  const config = await getManagedEmailGatewayConfig(env);
  const path = `/v1/installs/${encodeURIComponent(config.coreInstallId)}/email/send`;
  const payload = {
    from: {
      address: input.fromAddress,
      name: input.fromName,
    },
    ...managedGatewayRecipients(input),
    subject: input.subject,
    text: input.textBody,
    ...(input.htmlBody ? { html: input.htmlBody } : {}),
    ...(input.replyToAddress ? { replyTo: input.replyToAddress } : {}),
    attachments: input.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.mimeType,
      contentBase64: encodeBase64Bytes(attachment.content),
    })),
    ...(input.messageIdHeader || input.inReplyTo || input.referencesHeader
      ? {
          threading: {
            ...(input.messageIdHeader ? { messageId: input.messageIdHeader } : {}),
            ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
            ...(input.referencesHeader ? { references: input.referencesHeader } : {}),
          },
        }
      : {}),
    purpose: input.purpose,
    approval: {
      auditId: input.auditId,
      ownerApproved: Boolean(input.approvedByUserId),
      approvedByMe3OwnerId: input.approvedByUserId ? config.cloudOwnerId : null,
    },
    metadata: input.metadata,
  };
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > MANAGED_EMAIL_MAX_REQUEST_BYTES) {
    throw new ManagedEmailGatewayError(
      "Managed email message exceeds the encoded request limit",
      413,
      "request_too_large",
      true,
    );
  }

  let response: Response;
  try {
    response = await fetch(new URL(path, config.origin), {
      method: "POST",
      // Cloudflare Workers accepts only "follow" or "manual". Never follow a
      // redirect with the signed Core token or owner-approved message body.
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "X-ME3-Core-Install-ID": config.coreInstallId,
        "X-ME3-Core-Update-Token": config.coreUpdateToken,
        "Idempotency-Key": input.auditId,
      },
      body,
    });
  } catch (error) {
    throw new ManagedEmailGatewayError(
      error instanceof Error ? error.message : "Managed email gateway request failed",
      502,
      "gateway_unreachable",
      false,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ManagedEmailGatewayError(
      "Managed email gateway returned an unexpected redirect",
      502,
      "gateway_redirect",
      true,
      { status: response.status },
    );
  }

  const responseBody = await safeJson(response);
  if (!response.ok) {
    const message =
      isRecord(responseBody) && typeof responseBody.error === "string"
        ? responseBody.error
        : "Managed email gateway rejected the message";
    const code =
      isRecord(responseBody) && typeof responseBody.code === "string"
        ? responseBody.code
        : `gateway_${response.status}`;
    throw new ManagedEmailGatewayError(
      message,
      response.status || 502,
      code,
      response.status >= 400 &&
        response.status < 500 &&
        !AMBIGUOUS_GATEWAY_ERROR_CODES.has(code),
      responseBody,
    );
  }

  const status =
    isRecord(responseBody) && typeof responseBody.status === "string"
      ? responseBody.status
      : "accepted";
  if (status !== "accepted" && status !== "duplicate") {
    throw new ManagedEmailGatewayError(
      "Managed email gateway returned an invalid acceptance response",
      502,
      "invalid_gateway_response",
      false,
      responseBody,
    );
  }
  const providerMessageId = isRecord(responseBody)
    ? typeof responseBody.providerMessageId === "string"
      ? responseBody.providerMessageId
      : typeof responseBody.messageId === "string"
        ? responseBody.messageId
        : null
    : null;
  return {
    providerMessageId,
    providerStatus: status,
    raw: { status, providerMessageId },
  };
}

/**
 * A single recipient stays a plain `to` string. Any multi-recipient send puts
 * `to` in an array, even with one To address, so a gateway that predates Cc
 * and Bcc rejects it as an invalid `to` instead of silently dropping copies.
 */
function managedGatewayRecipients(input: ManagedEmailGatewaySendInput): {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
} {
  const to = input.toAddresses?.length ? input.toAddresses : [input.toAddress];
  const cc = input.ccAddresses || [];
  const bcc = input.bccAddresses || [];
  if (to.length === 1 && !cc.length && !bcc.length) return { to: to[0]! };
  return {
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
  };
}

export type ManagedEmailAddress = {
  address: string;
  kind: "me3" | "custom_domain";
  receiving: boolean;
  sending: boolean;
  default: boolean;
  status?: "active" | "pending" | "failed";
};

/**
 * The owner's addresses on ME3 hosting: handle@me3.app and hello@ each domain ME3 registered for them
 * (any address there receives). Empty off hosting or when ME3 Cloud can't be reached.
 */
export async function listManagedEmailAddresses(env: Env): Promise<ManagedEmailAddress[]> {
  if (!hasManagedEmailGatewayCapability(env)) return [];
  try {
    const config = await getManagedEmailGatewayConfig(env);
    const response = await fetch(
      new URL(`/v1/installs/${encodeURIComponent(config.coreInstallId)}/email/addresses`, config.origin),
      {
        method: "GET",
        redirect: "manual",
        headers: {
          "X-ME3-Core-Install-ID": config.coreInstallId,
          "X-ME3-Core-Update-Token": config.coreUpdateToken,
        },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!response.ok) return [];
    const body = await safeJson(response);
    const list = isRecord(body) && Array.isArray(body.addresses) ? body.addresses : [];
    const addresses = list.flatMap((entry): ManagedEmailAddress[] => {
      if (!isRecord(entry) || typeof entry.address !== "string") return [];
      const address = entry.address.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return [];
      const status = entry.status === "active" || entry.status === "pending" || entry.status === "failed" ? entry.status : undefined;
      return [{
        address,
        kind: entry.kind === "custom_domain" ? "custom_domain" : "me3",
        receiving: entry.receiving === true,
        sending: entry.sending === true,
        default: entry.default === true,
        ...(status ? { status } : {}),
      }];
    });
    await rememberManagedEmailAddresses(env, addresses);
    return addresses;
  } catch {
    return [];
  }
}

const MANAGED_EMAIL_ADDRESSES_KEY = "ME3_MANAGED_EMAIL_ADDRESSES";

/** Sending reads this copy, saved whenever the mailbox lists addresses, so a send never waits on ME3 Cloud. */
async function rememberManagedEmailAddresses(env: Env, addresses: ManagedEmailAddress[]): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO install_secrets (name, value, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(MANAGED_EMAIL_ADDRESSES_KEY, JSON.stringify(addresses))
      .run();
  } catch {
    // The copy is a convenience; sending falls back to handle@me3.app without it.
  }
}

export async function cachedManagedEmailAddresses(env: Env): Promise<ManagedEmailAddress[]> {
  if (!isManagedEmailDeployment(env)) return [];
  const raw = await getInstallSecret(env, MANAGED_EMAIL_ADDRESSES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is ManagedEmailAddress =>
          isRecord(entry) && typeof entry.address === "string" && typeof entry.sending === "boolean")
      : [];
  } catch {
    return [];
  }
}

/** Mail goes out from the address the owner chose when it's one ME3 can send from, else their default. */
export function chooseManagedSendAddress(
  addresses: ManagedEmailAddress[],
  requested: string | null | undefined,
): string | null {
  const wanted = requested?.trim().toLowerCase();
  const sendable = addresses.filter((entry) => entry.sending);
  const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);
  if (wanted) {
    if (sendable.some((entry) => entry.address === wanted)) return wanted;
    // Any address at one of the owner's own domains can send once that domain can.
    if (sendable.some((entry) => entry.kind === "custom_domain" && domainOf(entry.address) === domainOf(wanted))) return wanted;
  }
  return sendable.find((entry) => entry.default && entry.kind === "custom_domain")?.address ?? null;
}

async function getManagedEmailGatewayConfig(env: Env): Promise<ManagedEmailGatewayConfig> {
  if (!isManagedEmailDeployment(env)) {
    throw new ManagedEmailGatewayError(
      "ME3 managed email is unavailable on self-hosted installations",
      503,
      "managed_email_unavailable",
      true,
    );
  }
  const origin = managedEmailGatewayOrigin(env);
  const managedInstallationId = normalizedManagedInstallationId(
    env.ME3_MANAGED_INSTALLATION_ID,
  );
  const [coreInstallIdValue, coreUpdateToken, cloudOwnerId] = await Promise.all([
    getInstallSecret(env, CORE_INSTALL_ID_SECRET),
    getInstallSecret(env, CORE_UPDATE_TOKEN_SECRET),
    getInstallSecret(env, CLOUD_OWNER_ID_SECRET),
  ]);
  const coreInstallId = normalizeCoreInstallId(coreInstallIdValue);
  if (
    !origin ||
    !managedInstallationId ||
    !coreInstallId ||
    !coreUpdateToken ||
    !cloudOwnerId
  ) {
    throw new ManagedEmailGatewayError(
      "ME3 managed email gateway is not configured",
      503,
      "managed_email_not_configured",
      true,
    );
  }
  return {
    origin,
    managedInstallationId,
    coreInstallId,
    coreUpdateToken,
    cloudOwnerId,
  };
}

function managedEmailGatewayOrigin(env: Env): string {
  const origin = originFromUrl(env.ME3_MANAGED_EMAIL_GATEWAY_ORIGIN);
  if (!origin) return "";
  const url = new URL(origin);
  if (url.protocol === "https:") return origin;
  const environment = String(env.ENVIRONMENT || "").trim().toLowerCase();
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return environment !== "production" && loopback && url.protocol === "http:" ? origin : "";
}

function normalizedManagedInstallationId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return MANAGED_INSTALLATION_ID.test(normalized) ? normalized : "";
}

function normalizeCoreInstallId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return CORE_INSTALL_ID.test(normalized) ? normalized : "";
}

async function getInstallSecret(env: Env, name: string): Promise<string> {
  try {
    const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?")
      .bind(name)
      .first<{ value: string }>();
    return typeof row?.value === "string" ? row.value.trim() : "";
  } catch {
    return "";
  }
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
