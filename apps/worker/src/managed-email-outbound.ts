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
    to: input.toAddress,
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
