import {
  getOrCreateInstallEncryptionKey,
  hasInstallEncryptionKey,
} from "./install-secrets";
import {
  hasManagedEmailGatewayCapability,
  isManagedEmailDeployment,
  ManagedEmailGatewayError,
  MANAGED_EMAIL_PROVIDER_ID,
  sendManagedEmailThroughGateway,
} from "./managed-email-outbound";
import type { DbEmailProviderSetting, Env } from "./types";

export const EMAIL_PROVIDER_IDS = [
  MANAGED_EMAIL_PROVIDER_ID,
  "cloudflare-email",
  "smtp",
  "mailgun",
  "postmark",
] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDER_IDS)[number];
export type EmailSendPurpose = "test" | "draft" | "reply" | "workflow";

const DEFAULT_EMAIL_PROVIDER_ID: EmailProviderId = "smtp";

type EmailProviderSource = "managed" | "binding" | "stored" | "manual" | "not_configured";
type EmailProviderStatus = "not_configured" | "ready" | "failed";
type SmtpSecurity = "starttls" | "tls" | "none";
type MailgunRegion = "us" | "eu";

type EmailProviderConfig = {
  transport: "binding" | "rest" | "smtp";
  fromAddress: string;
  fromName: string;
  replyToAddress: string;
  sendingDomain: string;
  accountId: string;
  messageStream: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUsername: string;
  mailgunRegion: MailgunRegion;
};

export type EmailProviderSettingsRecord = {
  id: EmailProviderId;
  label: string;
  description: string;
  recommended: boolean;
  stable: boolean;
  configured: boolean;
  setupRequired: boolean;
  statusLabel: string;
  source: EmailProviderSource;
  secretLabel: string | null;
  keyHint: string | null;
  keyUpdatedAt: string | null;
  lastStatus: EmailProviderStatus;
  lastStatusCheckedAt: string | null;
  lastTestSentAt: string | null;
  lastTestError: string | null;
  setupRequirements: Array<{
    id: string;
    label: string;
    required: boolean;
    configured: boolean;
    note?: string;
  }>;
  config: EmailProviderConfig;
};

export type FutureEmailProviderRecord = {
  id: "ses" | "resend" | "sendgrid";
  label: string;
  description: string;
};

export type EmailProviderSettingsResponse = {
  encryptionConfigured: boolean;
  activeProviderId: EmailProviderId;
  providers: EmailProviderSettingsRecord[];
  futureProviders: FutureEmailProviderRecord[];
};

export type EmailProviderSendRequest = {
  providerId?: EmailProviderId | null;
  purpose: EmailSendPurpose;
  mailboxId?: string | null;
  mailboxMessageId?: string | null;
  operationId?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  replyToAddress?: string | null;
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody?: string | null;
  attachments?: EmailProviderAttachment[];
  threadKey?: string | null;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
  approvedByUserId?: string | null;
};

export type EmailProviderAttachment = {
  filename: string;
  mimeType: string;
  content: Uint8Array;
};

export type EmailProviderSendResponse = {
  auditId: string;
  providerId: EmailProviderId;
  providerLabel: string;
  providerMessageId: string | null;
  providerStatus: string | null;
  sentAt: string;
};

type EmailProviderUpdate = {
  id?: unknown;
  transport?: unknown;
  fromAddress?: unknown;
  fromName?: unknown;
  replyToAddress?: unknown;
  sendingDomain?: unknown;
  accountId?: unknown;
  messageStream?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  smtpSecurity?: unknown;
  smtpUsername?: unknown;
  mailgunRegion?: unknown;
  apiToken?: unknown;
  serverToken?: unknown;
  clearSecret?: unknown;
};

type EmailProviderSendMessage = {
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

type EmailProviderSendResult = {
  providerMessageId: string | null;
  providerStatus: string | null;
  raw: unknown;
};

type ResolvedEmailProvider = {
  adapter: EmailProviderAdapter;
  providerId: EmailProviderId;
  row: DbEmailProviderSetting | null;
  config: EmailProviderConfig;
  source: EmailProviderSource;
  secret: string | null;
};

type EmailProviderAdapter = {
  id: EmailProviderId;
  label: string;
  description: string;
  recommended: boolean;
  stable: boolean;
  secretLabel: string | null;
  defaultConfig: EmailProviderConfig;
  isConfigured(
    row: DbEmailProviderSetting | null,
    config: EmailProviderConfig,
    env: Env,
  ): boolean;
  source(
    row: DbEmailProviderSetting | null,
    config: EmailProviderConfig,
    env: Env,
  ): EmailProviderSource;
  setupRequirements(
    row: DbEmailProviderSetting | null,
    config: EmailProviderConfig,
    env: Env,
  ): EmailProviderSettingsRecord["setupRequirements"];
  send(
    env: Env,
    config: EmailProviderConfig,
    secret: string | null,
    message: EmailProviderSendMessage,
  ): Promise<EmailProviderSendResult>;
};

const MANAGED_GATEWAY_PROVIDER: EmailProviderAdapter = {
  id: MANAGED_EMAIL_PROVIDER_ID,
  label: "ME3 managed email",
  description:
    "Managed @me3.app delivery through the shared ME3 gateway without provider credentials in this installation.",
  recommended: true,
  stable: false,
  secretLabel: null,
  defaultConfig: createDefaultConfig("rest", ""),
  isConfigured(_row, _config, env) {
    return hasManagedEmailGatewayCapability(env);
  },
  source(_row, _config, env) {
    return hasManagedEmailGatewayCapability(env) ? "managed" : "not_configured";
  },
  setupRequirements(_row, _config, env) {
    return [
      {
        id: "managed-deployment",
        label: "Managed ME3 installation",
        required: true,
        configured: isManagedEmailDeployment(env),
        note: "This capability is provisioned by ME3 Cloud and is unavailable to self-hosted deployments.",
      },
      {
        id: "managed-email-gateway",
        label: "Managed email gateway",
        required: true,
        configured: hasManagedEmailGatewayCapability(env),
        note: "ME3 Cloud provisions the gateway origin and logical managed installation ID.",
      },
    ];
  },
  async send(env, _config, _secret, message) {
    try {
      return await sendManagedEmailThroughGateway(env, {
        auditId: message.auditId,
        purpose: message.purpose,
        fromAddress: message.fromAddress,
        fromName: message.fromName,
        replyToAddress: message.replyToAddress,
        toAddress: message.toAddress,
        subject: message.subject,
        textBody: message.textBody,
        htmlBody: message.htmlBody,
        attachments: message.attachments,
        messageIdHeader: message.messageIdHeader,
        inReplyTo: message.inReplyTo,
        referencesHeader: message.referencesHeader,
        approvedByUserId: message.approvedByUserId,
        metadata: message.metadata,
      });
    } catch (error) {
      if (error instanceof ManagedEmailGatewayError && error.definitive) {
        throw new EmailProviderSendError(
          error.message,
          error.status,
          error.code,
          error.raw,
        );
      }
      throw error;
    }
  },
};

const CLOUDFLARE_EMAIL_PROVIDER: EmailProviderAdapter = {
  id: "cloudflare-email",
  label: "Cloudflare Email Service",
  description:
    "Optional Workers-native sender using an Email Service binding first, with REST API credentials as a fallback.",
  recommended: false,
  stable: false,
  secretLabel: "Cloudflare API token",
  defaultConfig: createDefaultConfig("binding", ""),
  isConfigured(row, config, env) {
    const hasRestCredentials = Boolean(row?.encrypted_secret && config.accountId);
    return Boolean(
      config.fromAddress &&
        (config.transport === "rest"
          ? hasRestCredentials
          : env.EMAIL || hasRestCredentials),
    );
  },
  source(row, config, env) {
    if (config.transport !== "rest" && env.EMAIL) return "binding";
    if (row?.encrypted_secret && config.accountId) return "stored";
    if (config.fromAddress || config.sendingDomain) return "manual";
    return "not_configured";
  },
  setupRequirements(row, config, env) {
    const hasBinding = Boolean(env.EMAIL);
    const hasRestCredentials = Boolean(row?.encrypted_secret && config.accountId);
    const hasTransport =
      config.transport === "rest" ? hasRestCredentials : hasBinding || hasRestCredentials;
    return [
      {
        id: "workers-paid",
        label: "Workers Paid plan",
        required: true,
        configured: hasTransport,
        note: "Cloudflare outbound Email Service requires Workers Paid.",
      },
      {
        id: "cloudflare-dns",
        label: "Domain on Cloudflare DNS",
        required: true,
        configured: Boolean(config.sendingDomain || domainFromEmail(config.fromAddress)),
        note: "Cloudflare Email Service sender domains must use Cloudflare DNS.",
      },
      {
        id: "verified-sender",
        label: "Sending address or domain verified",
        required: true,
        configured: Boolean(config.fromAddress),
        note: "Verify SPF, DKIM, and sending records in Cloudflare Email Service.",
      },
      {
        id: "binding-or-api",
        label: "Email Service binding or REST API configured",
        required: true,
        configured: hasTransport,
        note: "Use a send_email binding named EMAIL, or store a Cloudflare account ID and API token.",
      },
    ];
  },
  async send(env, config, secret, message) {
    const headers = cloudflareEmailHeaders(message);
    if (config.transport !== "rest" && env.EMAIL) {
      const result = await env.EMAIL.send({
        from: message.fromName
          ? { email: message.fromAddress, name: message.fromName }
          : message.fromAddress,
        to: message.toAddress,
        replyTo: message.replyToAddress || undefined,
        subject: message.subject,
        text: message.textBody,
        html: message.htmlBody || undefined,
        attachments: serializeCloudflareAttachments(message.attachments),
        headers,
      });
      return {
        providerMessageId: result.messageId || null,
        providerStatus: "sent",
        raw: { messageId: result.messageId || null },
      };
    }
    if (!config.accountId || !secret) {
      throw new EmailProviderInputError(
        "Cloudflare Email Service needs an EMAIL binding or REST API account ID and token.",
        503,
      );
    }
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        config.accountId,
      )}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: message.toAddress,
          from: message.fromName
            ? { address: message.fromAddress, name: message.fromName }
            : message.fromAddress,
          reply_to: message.replyToAddress || undefined,
          subject: message.subject,
          text: message.textBody,
          html: message.htmlBody || undefined,
          attachments: serializeCloudflareAttachments(message.attachments),
          headers,
        }),
      },
    );
    const body = await safeJson(response);
    if (!response.ok || !isCloudflareSuccess(body)) {
      throw new EmailProviderSendError(
        cloudflareErrorMessage(body, response.statusText),
        response.status || 500,
        cloudflareErrorCode(body),
        body,
      );
    }
    return { providerMessageId: null, providerStatus: "accepted", raw: body };
  },
};

function cloudflareEmailHeaders(message: EmailProviderSendMessage) {
  return {
    "X-ME3-Audit-ID": message.auditId,
    "X-ME3-Provider": "cloudflare-email",
    ...(message.messageIdHeader
      ? { "X-ME3-Requested-Message-ID": message.messageIdHeader }
      : {}),
    ...(message.inReplyTo ? { "In-Reply-To": message.inReplyTo } : {}),
    ...(message.referencesHeader ? { References: message.referencesHeader } : {}),
  };
}

function serializeCloudflareAttachments(attachments: EmailProviderAttachment[]) {
  if (attachments.length === 0) return undefined;
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    type: attachment.mimeType,
    contentType: attachment.mimeType,
    disposition: "attachment",
    content: encodeBase64Bytes(attachment.content),
  }));
}

const POSTMARK_PROVIDER: EmailProviderAdapter = {
  id: "postmark",
  label: "Postmark",
  description:
    "Stable external sender using a Postmark Server API token and a confirmed sender signature or verified domain.",
  recommended: false,
  stable: true,
  secretLabel: "Server API token",
  defaultConfig: createDefaultConfig("rest", "outbound"),
  isConfigured(row, config) {
    return Boolean(row?.encrypted_secret && config.fromAddress);
  },
  source(row, config) {
    if (row?.encrypted_secret) return "stored";
    if (config.fromAddress || config.messageStream !== "outbound") return "manual";
    return "not_configured";
  },
  setupRequirements(row, config) {
    return [
      {
        id: "server-token",
        label: "Postmark Server API token",
        required: true,
        configured: Boolean(row?.encrypted_secret),
        note: "Owner-supplied tokens are encrypted in Core and never returned to the browser.",
      },
      {
        id: "sender-signature",
        label: "Confirmed sender signature or verified domain",
        required: true,
        configured: Boolean(config.fromAddress),
        note: "Postmark rejects mail from unconfirmed senders.",
      },
      {
        id: "message-stream",
        label: "Transactional message stream",
        required: true,
        configured: Boolean(config.messageStream),
        note: "Defaults to Postmark's outbound transactional stream.",
      },
    ];
  },
  async send(_env, config, secret, message) {
    if (!secret) {
      throw new EmailProviderInputError("Postmark Server API token is required.", 503);
    }
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": secret,
      },
      body: JSON.stringify({
        From: formatAddress(message.fromAddress, message.fromName),
        To: message.toAddress,
        Subject: message.subject,
        TextBody: message.textBody,
        HtmlBody: message.htmlBody || undefined,
        Attachments: message.attachments.map((attachment) => ({
          Name: attachment.filename,
          Content: encodeBase64Bytes(attachment.content),
          ContentType: attachment.mimeType,
        })),
        ReplyTo: message.replyToAddress || undefined,
        MessageStream: config.messageStream || "outbound",
        Metadata: message.metadata,
        Headers: [
          { Name: "X-ME3-Audit-ID", Value: message.auditId },
          { Name: "X-ME3-Provider", Value: "postmark" },
          ...(message.messageIdHeader
            ? [{ Name: "Message-ID", Value: message.messageIdHeader }]
            : []),
          ...(message.inReplyTo ? [{ Name: "In-Reply-To", Value: message.inReplyTo }] : []),
          ...(message.referencesHeader
            ? [{ Name: "References", Value: message.referencesHeader }]
            : []),
        ],
      }),
    });
    const body = await safeJson(response);
    if (!response.ok || !isPostmarkSuccess(body)) {
      throw new EmailProviderSendError(
        postmarkErrorMessage(body, response.statusText),
        response.status || 500,
        postmarkErrorCode(body),
        body,
      );
    }
    return {
      providerMessageId:
        isRecord(body) && typeof body.MessageID === "string" ? body.MessageID : null,
      providerStatus:
        isRecord(body) && typeof body.Message === "string" ? body.Message : "OK",
      raw: body,
    };
  },
};

const SMTP_PROVIDER: EmailProviderAdapter = {
  id: "smtp",
  label: "SMTP",
  description:
    "Generic authenticated SMTP sender for submission relays that support TLS or STARTTLS.",
  recommended: true,
  stable: true,
  secretLabel: "SMTP password",
  defaultConfig: createDefaultConfig("smtp", ""),
  isConfigured(row, config) {
    return Boolean(
      row?.encrypted_secret &&
        config.fromAddress &&
        config.smtpHost &&
        config.smtpPort > 0 &&
        config.smtpPort !== 25 &&
        config.smtpUsername,
    );
  },
  source(row, config) {
    if (row?.encrypted_secret && config.smtpHost) return "stored";
    if (config.fromAddress || config.smtpHost || config.smtpUsername) return "manual";
    return "not_configured";
  },
  setupRequirements(row, config) {
    return [
      {
        id: "smtp-host",
        label: "SMTP host",
        required: true,
        configured: Boolean(config.smtpHost),
        note: "Use the authenticated submission host from your email provider.",
      },
      {
        id: "submission-port",
        label: "SMTP submission port",
        required: true,
        configured: config.smtpPort > 0 && config.smtpPort !== 25,
        note: "Cloudflare Workers cannot connect to SMTP port 25. Use 587, 465, or 2525.",
      },
      {
        id: "smtp-auth",
        label: "SMTP username and password",
        required: true,
        configured: Boolean(config.smtpUsername && row?.encrypted_secret),
        note: "The password is encrypted in Core and never returned to the browser.",
      },
      {
        id: "verified-sender",
        label: "Verified sender address",
        required: true,
        configured: Boolean(config.fromAddress),
        note: "Most SMTP providers only allow mail from verified addresses or domains.",
      },
    ];
  },
  async send(env, config, secret, message) {
    return sendSmtpMessage(env, config, secret, message);
  },
};

const MAILGUN_PROVIDER: EmailProviderAdapter = {
  id: "mailgun",
  label: "Mailgun",
  description:
    "Optional Mailgun REST API sender using an owner-supplied sending domain and API key.",
  recommended: false,
  stable: true,
  secretLabel: "Mailgun API key",
  defaultConfig: createDefaultConfig("rest", ""),
  isConfigured(row, config) {
    return Boolean(row?.encrypted_secret && config.fromAddress && config.sendingDomain);
  },
  source(row, config) {
    if (row?.encrypted_secret && config.sendingDomain) return "stored";
    if (config.fromAddress || config.sendingDomain) return "manual";
    return "not_configured";
  },
  setupRequirements(row, config) {
    return [
      {
        id: "api-key",
        label: "Mailgun API key",
        required: true,
        configured: Boolean(row?.encrypted_secret),
        note: "Owner-supplied API keys are encrypted in Core and never returned to the browser.",
      },
      {
        id: "sending-domain",
        label: "Mailgun sending domain",
        required: true,
        configured: Boolean(config.sendingDomain),
        note: "Use the domain name from Mailgun, such as mg.example.com.",
      },
      {
        id: "verified-sender",
        label: "Verified sender address",
        required: true,
        configured: Boolean(config.fromAddress),
        note: "Mailgun requires a verified domain before production sending.",
      },
    ];
  },
  async send(_env, config, secret, message) {
    if (!secret) {
      throw new EmailProviderInputError("Mailgun API key is required.", 503);
    }
    if (!config.sendingDomain) {
      throw new EmailProviderInputError("Mailgun sending domain is required.", 503);
    }

    const form = new FormData();
    form.append("from", formatAddress(message.fromAddress, message.fromName));
    form.append("to", message.toAddress);
    form.append("subject", message.subject);
    form.append("text", message.textBody);
    if (message.htmlBody) form.append("html", message.htmlBody);
    for (const attachment of message.attachments) {
      const content = attachment.content.slice();
      form.append(
        "attachment",
        new Blob([content.buffer as ArrayBuffer], { type: attachment.mimeType }),
        attachment.filename,
      );
    }
    if (message.replyToAddress) form.append("h:Reply-To", message.replyToAddress);
    form.append("h:X-ME3-Audit-ID", message.auditId);
    form.append("h:X-ME3-Provider", "mailgun");
    if (message.messageIdHeader) form.append("h:Message-ID", message.messageIdHeader);
    if (message.inReplyTo) form.append("h:In-Reply-To", message.inReplyTo);
    if (message.referencesHeader) form.append("h:References", message.referencesHeader);
    for (const [key, value] of Object.entries(message.metadata)) {
      const variableName = normalizeMailgunVariableName(key);
      if (variableName) form.append(`v:${variableName}`, value);
    }

    const response = await fetch(
      `${mailgunBaseUrl(config)}/v3/${encodeURIComponent(config.sendingDomain)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${encodeBase64Utf8(`api:${secret}`)}`,
        },
        body: form,
      },
    );
    const body = await safeJson(response);
    if (!response.ok || !isMailgunSuccess(body)) {
      throw new EmailProviderSendError(
        mailgunErrorMessage(body, response.statusText),
        response.status || 500,
        mailgunErrorCode(body),
        body,
      );
    }
    return {
      providerMessageId:
        isRecord(body) && typeof body.id === "string" ? body.id : null,
      providerStatus:
        isRecord(body) && typeof body.message === "string" ? body.message : "Queued",
      raw: body,
    };
  },
};

const EMAIL_PROVIDER_ADAPTERS = [
  MANAGED_GATEWAY_PROVIDER,
  SMTP_PROVIDER,
  MAILGUN_PROVIDER,
  POSTMARK_PROVIDER,
  CLOUDFLARE_EMAIL_PROVIDER,
] as const;
const PROVIDER_ALIASES: Record<string, EmailProviderId> = {
  managed: MANAGED_EMAIL_PROVIDER_ID,
  managed_gateway: MANAGED_EMAIL_PROVIDER_ID,
  "managed-gateway": MANAGED_EMAIL_PROVIDER_ID,
  "me3-managed-email": MANAGED_EMAIL_PROVIDER_ID,
  cloudflare: "cloudflare-email",
  "cloudflare-email": "cloudflare-email",
  "cloudflare-email-service": "cloudflare-email",
  "email-service": "cloudflare-email",
  smtp: "smtp",
  mailgun: "mailgun",
  postmark: "postmark",
};

const FUTURE_EMAIL_PROVIDERS: readonly FutureEmailProviderRecord[] = [
  { id: "ses", label: "Amazon SES", description: "Future AWS sender." },
  { id: "resend", label: "Resend", description: "Future API sender." },
  { id: "sendgrid", label: "SendGrid", description: "Future transactional sender." },
];

export class EmailProviderInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "EmailProviderInputError";
  }
}

export class EmailProviderDeliveryUnknownError extends Error {
  constructor(
    message = "Email delivery could not be confirmed. Check delivery status before retrying.",
    public readonly status = 502,
  ) {
    super(message);
    this.name = "EmailProviderDeliveryUnknownError";
  }
}

class EmailProviderSendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = "EmailProviderSendError";
  }
}

export async function getEmailProviderSettings(
  env: Env,
  ownerId: string,
): Promise<EmailProviderSettingsResponse> {
  const settings = await listEmailProviderRows(env, ownerId);
  const activeProviderId =
    getActiveProviderId(settings) ||
    getDefaultEmailProviderId(env);

  return {
    encryptionConfigured: await hasInstallEncryptionKey(env),
    activeProviderId,
    providers: EMAIL_PROVIDER_ADAPTERS.filter(
      (adapter) => adapter.id !== MANAGED_EMAIL_PROVIDER_ID || isManagedEmailDeployment(env),
    ).map((adapter) => serializeProvider(adapter, settings.get(adapter.id) || null, env)),
    futureProviders: [...FUTURE_EMAIL_PROVIDERS],
  };
}

export async function getConfiguredEmailIdentity(
  env: Env,
  ownerId: string,
): Promise<{ id: string; address: string } | null> {
  const settings = await getEmailProviderSettings(env, ownerId);
  const provider = settings.providers.find(
    (candidate) => candidate.id === settings.activeProviderId,
  );
  const address = provider?.config.fromAddress.trim().toLowerCase() || "";
  if (
    !provider?.configured ||
    !isValidEmail(address) ||
    address.endsWith("@me3.local")
  ) {
    return null;
  }
  return { id: `email-provider:${provider.id}`, address };
}

export async function updateEmailProviderSettings(
  env: Env,
  ownerId: string,
  input: unknown,
): Promise<EmailProviderSettingsResponse> {
  if (!isRecord(input)) {
    throw new EmailProviderInputError("Email provider settings payload is required");
  }
  const existing = await listEmailProviderRows(env, ownerId);
  const activeProviderId =
    normalizeEmailProviderId(input.activeProviderId) ||
    getActiveProviderId(existing) ||
    getDefaultEmailProviderId(env);
  let changed = false;

  if (input.providers !== undefined) {
    if (!Array.isArray(input.providers)) {
      throw new EmailProviderInputError("providers must be an array");
    }
    for (const update of input.providers) {
      await applyProviderUpdate(
        env,
        ownerId,
        update as EmailProviderUpdate,
        existing,
        activeProviderId,
      );
      changed = true;
    }
  }
  if (input.activeProviderId !== undefined || changed) {
    await setActiveProvider(env, ownerId, activeProviderId, existing);
    changed = true;
  }
  if (!changed) {
    throw new EmailProviderInputError("providers or activeProviderId is required");
  }
  return getEmailProviderSettings(env, ownerId);
}

export async function sendEmailProviderTest(
  env: Env,
  ownerId: string,
  ownerEmail: string | null | undefined,
  input: unknown,
): Promise<EmailProviderSendResponse & { ok: true; sentTo: string }> {
  const body = isRecord(input) ? input : {};
  const toAddress =
    typeof body.to === "string" && body.to.trim()
      ? body.to.trim().toLowerCase()
      : ownerEmail?.trim().toLowerCase() || "";
  if (!isValidEmail(toAddress)) {
    throw new EmailProviderInputError("Enter a valid test recipient email address");
  }

  const providerId = normalizeEmailProviderId(body.providerId) || null;
  try {
    const result = await sendEmailWithProvider(env, ownerId, {
      providerId,
      purpose: "test",
      operationId: typeof body.operationId === "string" ? body.operationId : null,
      toAddress,
      subject: "ME3 test email",
      textBody: "This is a test email from your ME3 outbound sender settings.",
      htmlBody: "<p>This is a test email from your ME3 outbound sender settings.</p>",
      metadata: { test: true },
      approvedByUserId: ownerId,
    });
    await updateProviderTestStatus(env, ownerId, result.providerId, "ready", result.sentAt, null);
    return { ok: true, sentTo: toAddress, ...result };
  } catch (error) {
    const sendError = normalizeSendError(error);
    if (error instanceof EmailProviderDeliveryUnknownError) throw error;
    if (providerId) {
      await updateProviderTestStatus(
        env,
        ownerId,
        providerId,
        "failed",
        null,
        sendError.message,
      );
    }
    throw new EmailProviderInputError(sendError.message, sendError.status);
  }
}

export async function sendEmailWithProvider(
  env: Env,
  ownerId: string,
  input: EmailProviderSendRequest,
): Promise<EmailProviderSendResponse> {
  const resolved = await resolveReadyProvider(env, ownerId, input.providerId || null);
  const managedGateway = resolved.providerId === MANAGED_EMAIL_PROVIDER_ID;
  if (managedGateway && input.purpose !== "workflow" && !input.approvedByUserId) {
    throw new EmailProviderInputError(
      "ME3 managed email requires explicit owner approval",
      403,
    );
  }
  const operationId = input.operationId?.trim();
  if (managedGateway && !input.mailboxMessageId && (!operationId || operationId.length > 500)) {
    throw new EmailProviderInputError("Managed email requires a stable operation ID before sending", 409);
  }
  const operationAuditId = managedGateway && !input.mailboxMessageId
    ? await managedEmailOperationAuditId(ownerId, input.purpose, operationId!)
    : null;
  const fromAddress = (
    managedGateway
      ? await getManagedEmailFromAddress(env, ownerId)
      : input.fromAddress || resolved.config.fromAddress
  )
    .trim()
    .toLowerCase();
  const fromName = (
    input.fromName ||
    (managedGateway ? await getManagedEmailFromName(env, ownerId) : resolved.config.fromName) ||
    "ME3"
  ).trim();
  const replyToAddress = (
    managedGateway
      ? fromAddress
      : input.replyToAddress || resolved.config.replyToAddress || ""
  )
    .trim()
    .toLowerCase();
  const toAddress = input.toAddress.trim().toLowerCase();
  const subject = input.subject.trim() || "(no subject)";
  const attachments = input.attachments || [];
  const requestedAt = new Date().toISOString();

  if (!isValidEmail(fromAddress)) {
    throw new EmailProviderInputError("Configured sender email address is invalid", 503);
  }
  if (!isValidEmail(toAddress)) {
    throw new EmailProviderInputError("Enter a valid recipient email address");
  }
  if (replyToAddress && !isValidEmail(replyToAddress)) {
    throw new EmailProviderInputError("Configured reply-to email address is invalid", 503);
  }

  const managedRequestFingerprint =
    managedGateway
      ? await createManagedEmailRequestFingerprint(input, {
          fromAddress,
          fromName,
          replyToAddress,
          toAddress,
          subject,
          attachments,
        })
      : null;
  const pendingAudit =
    managedRequestFingerprint && input.mailboxMessageId
      ? await findPendingManagedEmailAudit(
          env,
          ownerId,
          input.mailboxMessageId,
          managedRequestFingerprint,
        )
      : null;
  const auditId = operationAuditId || pendingAudit?.id || crypto.randomUUID();
  const message: EmailProviderSendMessage = {
    auditId,
    purpose: input.purpose,
    fromAddress,
    fromName,
    replyToAddress,
    toAddress,
    subject,
    textBody: input.textBody,
    htmlBody: input.htmlBody || null,
    attachments,
    messageIdHeader: input.messageIdHeader || null,
    inReplyTo: input.inReplyTo || null,
    referencesHeader: input.referencesHeader || null,
    approvedByUserId: input.approvedByUserId || null,
    metadata: stringifyMetadata({
      me3_audit_id: auditId,
      me3_purpose: input.purpose,
      ...(input.metadata || {}),
    }),
  };
  const auditDetails = {
    auditId,
    ownerId,
    mailboxId: input.mailboxId || null,
    mailboxMessageId: input.mailboxMessageId || null,
    providerId: resolved.providerId,
    purpose: input.purpose,
    fromAddress,
    toAddress,
    subject,
    threadKey: input.threadKey || null,
    messageIdHeader: input.messageIdHeader || null,
    inReplyTo: input.inReplyTo || null,
    referencesHeader: input.referencesHeader || null,
    createdBy: input.createdBy || "owner",
    approvedByUserId: input.approvedByUserId || null,
    requestedAt,
  };

  if (managedGateway) {
    if (pendingAudit) {
      await refreshPendingEmailSendAudit(
        env,
        auditId,
        ownerId,
        requestedAt,
        input.approvedByUserId || null,
      );
    } else {
      await insertEmailSendAudit(env, {
        ...auditDetails,
        providerMessageId: null,
        providerStatus: "pending",
        status: "pending",
        metadata: {
          source: resolved.source,
          ...(input.metadata || {}),
          managed_request_fingerprint: managedRequestFingerprint,
        },
        errorMessage: null,
        sentAt: null,
      }, Boolean(operationAuditId));
    }
    if (operationAuditId) {
      const existing = await env.DB.prepare(
        `SELECT id, metadata_json, status, provider_message_id, provider_status, sent_at, error_message
         FROM email_send_audit WHERE id = ? AND user_id = ? AND provider_id = ?`,
      ).bind(auditId, ownerId, MANAGED_EMAIL_PROVIDER_ID).first<{
        metadata_json: string | null; status: string; provider_message_id: string | null;
        provider_status: string | null; sent_at: string | null; error_message: string | null;
      }>();
      if (!existing || parseJsonObject(existing.metadata_json).managed_request_fingerprint !== managedRequestFingerprint) {
        throw new EmailProviderInputError("This email operation already exists with different content; reconcile it before starting another send", 409);
      }
      if (existing.status === "sent") return {
        auditId, providerId: resolved.providerId, providerLabel: resolved.adapter.label,
        providerMessageId: existing.provider_message_id, providerStatus: existing.provider_status,
        sentAt: existing.sent_at!,
      };
      if (existing.status === "failed") {
        throw new EmailProviderInputError(existing.error_message || "This email operation failed", 422);
      }
    }
  }

  let result: EmailProviderSendResult;
  try {
    result = await resolved.adapter.send(
      env,
      resolved.config,
      resolved.secret,
      message,
    );
  } catch (error) {
    if (!isDefinitiveProviderFailure(error)) {
      throw new EmailProviderDeliveryUnknownError();
    }

    const sendError = normalizeSendError(error);
    const failedAudit = {
      ...auditDetails,
      providerMessageId: null,
      providerStatus: sendError.code,
      status: "failed" as const,
      metadata: { raw: sendError.raw, source: resolved.source, ...(input.metadata || {}), managed_request_fingerprint: managedRequestFingerprint },
      errorMessage: sendError.message,
      sentAt: null,
    };
    if (managedGateway) {
      await updatePendingEmailSendAudit(env, failedAudit);
    } else {
      await insertEmailSendAudit(env, failedAudit);
    }
    throw new EmailProviderInputError(sendError.message, operationAuditId ? 422 : sendError.status);
  }

  const sentAt = new Date().toISOString();
  const sentAudit = {
    ...auditDetails,
    providerMessageId: result.providerMessageId,
    providerStatus: result.providerStatus,
    status: "sent" as const,
    metadata: { raw: result.raw, source: resolved.source, ...(input.metadata || {}), managed_request_fingerprint: managedRequestFingerprint },
    errorMessage: null,
    sentAt,
  };
  try {
    if (managedGateway) {
      await updatePendingEmailSendAudit(env, sentAudit);
    } else {
      await insertEmailSendAudit(env, sentAudit);
    }
  } catch {
    throw new EmailProviderDeliveryUnknownError(
      "The email provider accepted the message, but ME3 could not confirm delivery. Check delivery status before retrying.",
    );
  }

  return {
    auditId,
    providerId: resolved.providerId,
    providerLabel: resolved.adapter.label,
    providerMessageId: result.providerMessageId,
    providerStatus: result.providerStatus,
    sentAt,
  };
}

async function applyProviderUpdate(
  env: Env,
  ownerId: string,
  update: EmailProviderUpdate,
  existing: Map<EmailProviderId, DbEmailProviderSetting>,
  activeProviderId: EmailProviderId,
) {
  if (!isRecord(update)) throw new EmailProviderInputError("provider updates must be objects");
  const providerId = normalizeEmailProviderId(update.id);
  if (!providerId) throw new EmailProviderInputError("Unknown email provider");
  if (providerId === MANAGED_EMAIL_PROVIDER_ID) {
    throw new EmailProviderInputError(
      "ME3 managed email is provisioned by the managed deployment and cannot be edited here",
      409,
    );
  }
  const adapter = getProviderAdapter(providerId);
  const current = existing.get(providerId) || null;
  const config = normalizeProviderConfigUpdate(
    normalizeProviderConfig(current, adapter),
    update,
    providerId,
  );
  const now = new Date().toISOString();
  const secretInput = normalizeSecretInput(update);
  let encryptedSecret = current?.encrypted_secret || null;
  let secretHint = current?.secret_hint || null;
  let secretUpdatedAt = current?.secret_updated_at || null;

  if (update.clearSecret === true || secretInput === null) {
    encryptedSecret = null;
    secretHint = null;
    secretUpdatedAt = null;
  } else if (secretInput) {
    encryptedSecret = await encryptProviderSecret(
      secretInput,
      await getOrCreateInstallEncryptionKey(env),
    );
    secretHint = getSecretHint(secretInput);
    secretUpdatedAt = now;
  }

  await upsertEmailProviderRow(env, {
    userId: ownerId,
    providerId,
    isActive: providerId === activeProviderId,
    encryptedSecret,
    secretHint,
    secretUpdatedAt,
    config,
    now,
  });
  existing.set(providerId, {
    user_id: ownerId,
    provider_id: providerId,
    is_active: providerId === activeProviderId ? 1 : 0,
    encrypted_secret: encryptedSecret,
    secret_hint: secretHint,
    secret_updated_at: secretUpdatedAt,
    config_json: JSON.stringify(config),
    last_status: current?.last_status || null,
    last_status_checked_at: current?.last_status_checked_at || null,
    last_test_sent_at: current?.last_test_sent_at || null,
    last_test_error: current?.last_test_error || null,
    created_at: current?.created_at || now,
    updated_at: now,
  });
}

async function setActiveProvider(
  env: Env,
  ownerId: string,
  providerId: EmailProviderId,
  existing: Map<EmailProviderId, DbEmailProviderSetting>,
) {
  await env.DB.prepare("UPDATE email_provider_settings SET is_active = 0 WHERE user_id = ?")
    .bind(ownerId)
    .run();
  if (existing.has(providerId)) {
    await env.DB.prepare(
      `UPDATE email_provider_settings
       SET is_active = 1, updated_at = ?
       WHERE user_id = ? AND provider_id = ?`,
    )
      .bind(new Date().toISOString(), ownerId, providerId)
      .run();
    return;
  }
  const adapter = getProviderAdapter(providerId);
  const now = new Date().toISOString();
  await upsertEmailProviderRow(env, {
    userId: ownerId,
    providerId,
    isActive: true,
    encryptedSecret: null,
    secretHint: null,
    secretUpdatedAt: null,
    config: normalizeProviderConfig(null, adapter),
    now,
  });
}

async function resolveReadyProvider(
  env: Env,
  ownerId: string,
  requestedProviderId: EmailProviderId | null,
): Promise<ResolvedEmailProvider> {
  const settings = await listEmailProviderRows(env, ownerId);
  const providerId =
    requestedProviderId ||
    getActiveProviderId(settings) ||
    getDefaultEmailProviderId(env);
  const adapter = getProviderAdapter(providerId);
  const row = settings.get(providerId) || null;
  const config = normalizeProviderConfig(row, adapter);
  if (!adapter.isConfigured(row, config, env)) {
    throw new EmailProviderInputError(`${adapter.label} is not ready to send yet`, 503);
  }
  const secret = row?.encrypted_secret
    ? await decryptProviderSecret(
        row.encrypted_secret,
        await getOrCreateInstallEncryptionKey(env),
      )
    : null;
  return {
    adapter,
    providerId,
    row,
    config,
    source: adapter.source(row, config, env),
    secret,
  };
}

async function listEmailProviderRows(
  env: Env,
  ownerId: string,
): Promise<Map<EmailProviderId, DbEmailProviderSetting>> {
  try {
    const rows = await env.DB.prepare(
      `SELECT user_id, provider_id, is_active, encrypted_secret, secret_hint,
              secret_updated_at, config_json, last_status, last_status_checked_at,
              last_test_sent_at, last_test_error, created_at, updated_at
       FROM email_provider_settings
       WHERE user_id = ?`,
    )
      .bind(ownerId)
      .all<DbEmailProviderSetting>();
    return new Map(
      (rows.results || [])
        .map((row) => [normalizeEmailProviderId(row.provider_id), row] as const)
        .filter((entry): entry is readonly [EmailProviderId, DbEmailProviderSetting] =>
          Boolean(entry[0]),
        ),
    );
  } catch (error) {
    if (isMissingEmailProviderTableError(error)) return new Map();
    throw error;
  }
}

async function upsertEmailProviderRow(
  env: Env,
  row: {
    userId: string;
    providerId: EmailProviderId;
    isActive: boolean;
    encryptedSecret: string | null;
    secretHint: string | null;
    secretUpdatedAt: string | null;
    config: EmailProviderConfig;
    now: string;
  },
) {
  await env.DB.prepare(
    `INSERT INTO email_provider_settings (
       user_id, provider_id, is_active, encrypted_secret, secret_hint,
       secret_updated_at, config_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider_id) DO UPDATE SET
       is_active = excluded.is_active,
       encrypted_secret = excluded.encrypted_secret,
       secret_hint = excluded.secret_hint,
       secret_updated_at = excluded.secret_updated_at,
       config_json = excluded.config_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      row.userId,
      row.providerId,
      row.isActive ? 1 : 0,
      row.encryptedSecret,
      row.secretHint,
      row.secretUpdatedAt,
      JSON.stringify(row.config),
      row.now,
      row.now,
    )
    .run();
}

type EmailSendAuditWrite = {
  auditId: string;
  ownerId: string;
  mailboxId: string | null;
  mailboxMessageId: string | null;
  providerId: EmailProviderId;
  providerMessageId: string | null;
  providerStatus: string | null;
  status: "pending" | "sent" | "failed";
  purpose: EmailSendPurpose;
  fromAddress: string;
  toAddress: string;
  subject: string;
  threadKey: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  createdBy: string;
  approvedByUserId: string | null;
  requestedAt: string;
  sentAt: string | null;
};

async function findPendingManagedEmailAudit(
  env: Env,
  ownerId: string,
  mailboxMessageId: string,
  requestFingerprint: string,
): Promise<{ id: string } | null> {
  const row = await env.DB.prepare(
    `SELECT id, metadata_json
     FROM email_send_audit
     WHERE user_id = ?
       AND mailbox_message_id = ?
       AND provider_id = ?
       AND status = 'pending'
     ORDER BY requested_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(ownerId, mailboxMessageId, MANAGED_EMAIL_PROVIDER_ID)
    .first<{ id: string; metadata_json: string | null }>();
  if (!row) return null;
  const metadata = parseJsonObject(row.metadata_json);
  return metadata.managed_request_fingerprint === requestFingerprint
    ? { id: row.id }
    : null;
}

async function refreshPendingEmailSendAudit(
  env: Env,
  auditId: string,
  ownerId: string,
  requestedAt: string,
  approvedByUserId: string | null,
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE email_send_audit
     SET requested_at = ?, approved_by_user_id = ?, error_message = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND provider_id = ? AND status = 'pending'`,
  )
    .bind(
      requestedAt,
      approvedByUserId,
      requestedAt,
      auditId,
      ownerId,
      MANAGED_EMAIL_PROVIDER_ID,
    )
    .run();
  if ((result.meta?.changes || 0) === 0) {
    throw new Error("Managed email pending audit could not be reclaimed");
  }
}

async function updatePendingEmailSendAudit(
  env: Env,
  input: EmailSendAuditWrite,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE email_send_audit
     SET provider_message_id = ?, provider_status = ?, status = ?,
         metadata_json = ?, error_message = ?, approved_by_user_id = ?,
         requested_at = ?, sent_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND provider_id = ? AND status = 'pending'`,
  )
    .bind(
      input.providerMessageId,
      input.providerStatus,
      input.status,
      JSON.stringify(input.metadata),
      input.errorMessage,
      input.approvedByUserId,
      input.requestedAt,
      input.sentAt,
      updatedAt,
      input.auditId,
      input.ownerId,
      input.providerId,
    )
    .run();
  if ((result.meta?.changes || 0) === 0) {
    throw new Error("Managed email audit state changed before delivery was recorded");
  }
}

async function insertEmailSendAudit(
  env: Env,
  input: EmailSendAuditWrite,
  ignoreExisting = false,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO email_send_audit (
       id, user_id, mailbox_id, mailbox_message_id, provider_id,
       provider_message_id, provider_status, status, purpose, from_address,
       to_address, subject, thread_key, message_id_header, in_reply_to,
       references_header, metadata_json, error_message, created_by,
       approved_by_user_id, requested_at, sent_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ${ignoreExisting ? "ON CONFLICT(id) DO NOTHING" : ""}`,
  )
    .bind(
      input.auditId,
      input.ownerId,
      input.mailboxId,
      input.mailboxMessageId,
      input.providerId,
      input.providerMessageId,
      input.providerStatus,
      input.status,
      input.purpose,
      input.fromAddress,
      input.toAddress,
      input.subject,
      input.threadKey,
      input.messageIdHeader,
      input.inReplyTo,
      input.referencesHeader,
      JSON.stringify(input.metadata),
      input.errorMessage,
      input.createdBy,
      input.approvedByUserId,
      input.requestedAt,
      input.sentAt,
      now,
      now,
    )
    .run();
}

async function updateProviderTestStatus(
  env: Env,
  ownerId: string,
  providerId: EmailProviderId,
  status: "ready" | "failed",
  sentAt: string | null,
  error: string | null,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE email_provider_settings
     SET last_status = ?,
         last_status_checked_at = ?,
         last_test_sent_at = COALESCE(?, last_test_sent_at),
         last_test_error = ?,
         updated_at = ?
     WHERE user_id = ? AND provider_id = ?`,
  )
    .bind(status, now, sentAt, error, now, ownerId, providerId)
    .run();
}

type SmtpReply = {
  code: number;
  lines: string[];
  message: string;
};

type SmtpConnect = NonNullable<Env["SMTP_CONNECT"]>;

class SmtpSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private buffer = "";

  constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async command(command: string, expectedCodes: number[], label: string): Promise<SmtpReply> {
    await this.writer.write(this.encoder.encode(`${command}\r\n`));
    return this.readResponse(expectedCodes, label);
  }

  async data(data: string, expectedCodes: number[], label: string): Promise<SmtpReply> {
    await this.writer.write(this.encoder.encode(`${dotStuffSmtpData(data)}\r\n.\r\n`));
    return this.readResponse(expectedCodes, label);
  }

  async readResponse(expectedCodes: number[], label: string): Promise<SmtpReply> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine(label);
      lines.push(line);
      const match = line.match(/^(\d{3})([\s-]?)(.*)$/);
      if (!match) continue;
      if (match[2] === "-") continue;

      const code = Number(match[1]);
      const reply = {
        code,
        lines,
        message: match[3]?.trim() || lines.join(" "),
      };
      if (!expectedCodes.includes(code)) {
        throw new EmailProviderSendError(
          `${label} failed: ${reply.message || line}`,
          smtpHttpStatus(code),
          String(code),
          reply,
        );
      }
      return reply;
    }
  }

  upgradeTls(expectedServerHostname: string) {
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.socket = this.socket.startTls({ expectedServerHostname });
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.buffer = "";
  }

  async close() {
    try {
      await this.socket.close();
    } catch {
      // The connection may already be closed by the provider.
    }
  }

  private async readLine(label: string): Promise<string> {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newlineIndex + 1);
        return line;
      }

      const chunk = await this.reader.read();
      if (chunk.done) {
        throw new EmailProviderSendError(
          `${label} failed: SMTP server closed the connection`,
          502,
          "CONNECTION_CLOSED",
          { lines: this.buffer ? [this.buffer] : [] },
        );
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }
}

async function sendSmtpMessage(
  env: Env,
  config: EmailProviderConfig,
  secret: string | null,
  message: EmailProviderSendMessage,
): Promise<EmailProviderSendResult> {
  if (!config.smtpHost) {
    throw new EmailProviderInputError("SMTP host is required.", 503);
  }
  if (!config.smtpPort) {
    throw new EmailProviderInputError("SMTP port is required.", 503);
  }
  if (config.smtpPort === 25) {
    throw new EmailProviderInputError(
      "SMTP port 25 is not supported on Cloudflare Workers. Use port 587, 465, or 2525.",
      503,
    );
  }
  if (!config.smtpUsername || !secret) {
    throw new EmailProviderInputError("SMTP username and password are required.", 503);
  }

  const connect = await getSmtpConnect(env);
  const secureTransport =
    config.smtpSecurity === "tls"
      ? "on"
      : config.smtpSecurity === "starttls"
        ? "starttls"
        : "off";
  const socket = connect(
    { hostname: config.smtpHost, port: config.smtpPort },
    { secureTransport, allowHalfOpen: false },
  );
  const session = new SmtpSession(socket);

  try {
    await session.readResponse([220], "SMTP greeting");
    let ehloReply = await session.command(smtpEhloCommand(config, message), [250], "EHLO");

    if (config.smtpSecurity === "starttls") {
      if (!smtpHasCapability(ehloReply, "STARTTLS")) {
        throw new EmailProviderSendError(
          "SMTP server did not advertise STARTTLS.",
          502,
          "STARTTLS_NOT_SUPPORTED",
          { lines: ehloReply.lines },
        );
      }
      await session.command("STARTTLS", [220], "STARTTLS");
      session.upgradeTls(config.smtpHost);
      ehloReply = await session.command(smtpEhloCommand(config, message), [250], "EHLO");
    }

    await authenticateSmtp(session, ehloReply, config.smtpUsername, secret);
    await session.command(`MAIL FROM:<${message.fromAddress}>`, [250], "MAIL FROM");
    await session.command(`RCPT TO:<${message.toAddress}>`, [250, 251], "RCPT TO");
    await session.command("DATA", [354], "DATA");
    const accepted = await session.data(buildSmtpMessage(config, message), [250], "SMTP send");
    await session.command("QUIT", [221], "QUIT").catch(() => undefined);

    return {
      providerMessageId: extractSmtpProviderMessageId(accepted),
      providerStatus: `${accepted.code} ${accepted.message}`.trim(),
      raw: { response: accepted.lines },
    };
  } finally {
    await session.close();
  }
}

async function getSmtpConnect(env: Env): Promise<SmtpConnect> {
  if (env.SMTP_CONNECT) return env.SMTP_CONNECT;
  const sockets = await import("cloudflare:sockets");
  return sockets.connect;
}

async function authenticateSmtp(
  session: SmtpSession,
  ehloReply: SmtpReply,
  username: string,
  password: string,
) {
  const mechanisms = smtpAuthMechanisms(ehloReply);
  if (mechanisms.length === 0 || mechanisms.includes("PLAIN")) {
    await session.command(
      `AUTH PLAIN ${encodeBase64Utf8(`\u0000${username}\u0000${password}`)}`,
      [235],
      "SMTP authentication",
    );
    return;
  }
  if (mechanisms.includes("LOGIN")) {
    await session.command("AUTH LOGIN", [334], "SMTP authentication");
    await session.command(encodeBase64Utf8(username), [334], "SMTP username");
    await session.command(encodeBase64Utf8(password), [235], "SMTP password");
    return;
  }
  throw new EmailProviderSendError(
    "SMTP server did not advertise AUTH PLAIN or LOGIN.",
    502,
    "AUTH_NOT_SUPPORTED",
    { mechanisms },
  );
}

function smtpEhloCommand(config: EmailProviderConfig, message: EmailProviderSendMessage): string {
  return `EHLO ${domainFromEmail(message.fromAddress) || config.smtpHost}`;
}

function smtpHasCapability(reply: SmtpReply, capability: string): boolean {
  const needle = capability.toUpperCase();
  return reply.lines.some((line) => smtpCapabilityText(line).split(/\s+/).includes(needle));
}

function smtpAuthMechanisms(reply: SmtpReply): string[] {
  const mechanisms = new Set<string>();
  for (const line of reply.lines) {
    const text = smtpCapabilityText(line);
    if (!text.toUpperCase().startsWith("AUTH")) continue;
    for (const part of text.split(/\s+/).slice(1)) {
      if (part) mechanisms.add(part.toUpperCase());
    }
  }
  return [...mechanisms];
}

function smtpCapabilityText(line: string): string {
  return line.replace(/^\d{3}[-\s]?/, "").trim().toUpperCase();
}

function buildSmtpMessage(
  config: EmailProviderConfig,
  message: EmailProviderSendMessage,
): string {
  const headers = [
    headerLine("From", formatAddress(message.fromAddress, message.fromName)),
    headerLine("To", message.toAddress),
    headerLine("Subject", encodeMimeHeader(message.subject)),
    headerLine("Date", new Date().toUTCString()),
    headerLine(
      "Message-ID",
      message.messageIdHeader || `<${message.auditId}@${domainFromEmail(message.fromAddress) || config.smtpHost}>`,
    ),
    message.replyToAddress ? headerLine("Reply-To", message.replyToAddress) : null,
    message.inReplyTo ? headerLine("In-Reply-To", message.inReplyTo) : null,
    message.referencesHeader ? headerLine("References", message.referencesHeader) : null,
    headerLine("X-ME3-Audit-ID", message.auditId),
    headerLine("X-ME3-Provider", "smtp"),
    "MIME-Version: 1.0",
  ].filter((header): header is string => Boolean(header));
  const bodyParts = buildSmtpBodyParts(message, `me3-alt-${message.auditId}`);

  if (message.attachments.length > 0) {
    const boundary = `me3-mixed-${message.auditId}`;
    return [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      ...bodyParts.map((part) => [`--${boundary}`, ...part].join("\r\n")),
      ...message.attachments.map((attachment) =>
        [
          `--${boundary}`,
          `Content-Type: ${sanitizeHeaderValue(attachment.mimeType)}; name="${sanitizeHeaderValue(attachment.filename)}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${sanitizeHeaderValue(attachment.filename)}"`,
          "",
          wrapBase64(encodeBase64Bytes(attachment.content)),
        ].join("\r\n"),
      ),
      `--${boundary}--`,
    ].join("\r\n");
  }

  if (!message.htmlBody) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      normalizeSmtpBody(message.textBody),
    ].join("\r\n");
  }

  const boundary = `me3-${message.auditId}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeSmtpBody(message.textBody),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeSmtpBody(message.htmlBody),
    `--${boundary}--`,
  ].join("\r\n");
}

function buildSmtpBodyParts(
  message: EmailProviderSendMessage,
  alternativeBoundary: string,
): string[][] {
  if (!message.htmlBody) {
    return [[
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      normalizeSmtpBody(message.textBody),
    ]];
  }

  return [[
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeSmtpBody(message.textBody),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeSmtpBody(message.htmlBody),
    `--${alternativeBoundary}--`,
  ]];
}

function headerLine(name: string, value: string): string {
  return `${name}: ${sanitizeHeaderValue(value)}`;
}

function encodeMimeHeader(value: string): string {
  const clean = sanitizeHeaderValue(value);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${encodeBase64Utf8(clean)}?=`;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function normalizeSmtpBody(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary);
}

function wrapBase64(value: string): string {
  return value.replace(/.{1,76}/g, "$&\r\n").trim();
}

function dotStuffSmtpData(value: string): string {
  return normalizeSmtpBody(value)
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function extractSmtpProviderMessageId(reply: SmtpReply): string | null {
  const text = reply.lines.join(" ");
  const match = text.match(/(?:queued as|id=)\s*<?([a-z0-9._=-]+)>?/i);
  return match?.[1] || null;
}

function smtpHttpStatus(code: number): number {
  return code >= 400 && code < 500 ? 503 : 502;
}

function serializeProvider(
  adapter: EmailProviderAdapter,
  row: DbEmailProviderSetting | null,
  env: Env,
): EmailProviderSettingsRecord {
  const config = normalizeProviderConfig(row, adapter);
  const configured = adapter.isConfigured(row, config, env);
  const lastStatus = row?.last_status || (configured ? "ready" : "not_configured");
  return {
    id: adapter.id,
    label: adapter.label,
    description: adapter.description,
    recommended: adapter.recommended,
    stable: adapter.stable,
    configured,
    setupRequired: !configured,
    statusLabel: configured
      ? lastStatus === "failed"
        ? "Test failed"
        : "Ready"
      : "Setup required",
    source: adapter.source(row, config, env),
    secretLabel: adapter.secretLabel,
    keyHint: row?.secret_hint || null,
    keyUpdatedAt: row?.secret_updated_at || null,
    lastStatus,
    lastStatusCheckedAt: row?.last_status_checked_at || null,
    lastTestSentAt: row?.last_test_sent_at || null,
    lastTestError: row?.last_test_error || null,
    setupRequirements: adapter.setupRequirements(row, config, env),
    config,
  };
}

function normalizeProviderConfig(
  row: DbEmailProviderSetting | null,
  adapter: EmailProviderAdapter,
): EmailProviderConfig {
  let config = { ...adapter.defaultConfig };
  if (row?.config_json) {
    try {
      const parsed = JSON.parse(row.config_json) as unknown;
      if (isRecord(parsed)) config = normalizeProviderConfigUpdate(config, parsed, adapter.id);
    } catch {
      config = { ...adapter.defaultConfig };
    }
  }
  if (adapter.id === "postmark" && !config.messageStream) config.messageStream = "outbound";
  if (adapter.id === "cloudflare-email") config.messageStream = "";
  if (adapter.id === "mailgun") {
    config.transport = "rest";
    config.accountId = "";
    config.messageStream = "";
    if (!config.mailgunRegion) config.mailgunRegion = "us";
  }
  if (adapter.id === "smtp") {
    config.transport = "smtp";
    config.messageStream = "";
    if (!config.smtpPort) config.smtpPort = 587;
    if (!config.smtpSecurity) config.smtpSecurity = "starttls";
  }
  if (!config.sendingDomain && config.fromAddress) {
    config.sendingDomain = domainFromEmail(config.fromAddress);
  }
  return config;
}

function normalizeProviderConfigUpdate(
  current: EmailProviderConfig,
  input: Record<string, unknown>,
  providerId: EmailProviderId | null,
): EmailProviderConfig {
  const next: EmailProviderConfig = { ...current };
  if (typeof input.transport === "string") {
    if (providerId === "smtp") next.transport = "smtp";
    else next.transport = input.transport === "rest" ? "rest" : "binding";
  }
  if (typeof input.fromAddress === "string") {
    next.fromAddress = input.fromAddress.trim().toLowerCase();
  }
  if (typeof input.fromName === "string") next.fromName = input.fromName.trim().slice(0, 120);
  if (typeof input.replyToAddress === "string") {
    next.replyToAddress = input.replyToAddress.trim().toLowerCase();
  }
  if (typeof input.sendingDomain === "string") {
    next.sendingDomain = normalizeDomain(input.sendingDomain);
  }
  if (typeof input.accountId === "string") next.accountId = input.accountId.trim();
  if (typeof input.messageStream === "string") {
    next.messageStream = input.messageStream.trim().slice(0, 80);
  }
  if (providerId === "mailgun" && typeof input.mailgunRegion === "string") {
    next.mailgunRegion = normalizeMailgunRegion(input.mailgunRegion);
  }
  if (providerId === "smtp") {
    if (typeof input.smtpHost === "string") {
      next.smtpHost = normalizeSmtpHost(input.smtpHost);
    }
    if (typeof input.smtpPort === "string" || typeof input.smtpPort === "number") {
      next.smtpPort = normalizeSmtpPort(input.smtpPort);
    }
    if (typeof input.smtpSecurity === "string") {
      next.smtpSecurity = normalizeSmtpSecurity(input.smtpSecurity);
    }
    if (typeof input.smtpUsername === "string") {
      next.smtpUsername = input.smtpUsername.trim().slice(0, 254);
    }
  }
  if (!next.fromName) next.fromName = "ME3";
  if (providerId === "postmark" && !next.messageStream) next.messageStream = "outbound";
  if (providerId === "cloudflare-email") next.messageStream = "";
  if (providerId === "mailgun") {
    next.transport = "rest";
    next.accountId = "";
    next.messageStream = "";
    if (!next.mailgunRegion) next.mailgunRegion = "us";
  }
  if (providerId === "smtp") {
    next.transport = "smtp";
    next.accountId = "";
    next.messageStream = "";
    if (!next.smtpPort) next.smtpPort = next.smtpSecurity === "tls" ? 465 : 587;
  }
  if (!next.sendingDomain && next.fromAddress) next.sendingDomain = domainFromEmail(next.fromAddress);
  if (next.fromAddress && !isValidEmail(next.fromAddress)) {
    throw new EmailProviderInputError("Enter a valid sender email address");
  }
  if (next.replyToAddress && !isValidEmail(next.replyToAddress)) {
    throw new EmailProviderInputError("Enter a valid reply-to email address");
  }
  if (providerId === "smtp" && next.smtpPort === 25) {
    throw new EmailProviderInputError(
      "SMTP port 25 is not supported on Cloudflare Workers. Use port 587, 465, or 2525.",
    );
  }
  return next;
}

function createDefaultConfig(
  transport: EmailProviderConfig["transport"],
  messageStream: string,
): EmailProviderConfig {
  return {
    transport,
    fromAddress: "",
    fromName: "ME3",
    replyToAddress: "",
    sendingDomain: "",
    accountId: "",
    messageStream,
    smtpHost: "",
    smtpPort: transport === "smtp" ? 587 : 0,
    smtpSecurity: transport === "smtp" ? "starttls" : "none",
    smtpUsername: "",
    mailgunRegion: "us",
  };
}

function normalizeSecretInput(update: EmailProviderUpdate): string | null | undefined {
  const raw = update.apiToken ?? update.serverToken;
  if (raw === null) return null;
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new EmailProviderInputError("Provider token must be a string");
  }
  const secret = raw.trim();
  return secret || undefined;
}

function normalizeEmailProviderId(value: unknown): EmailProviderId | null {
  if (typeof value !== "string") return null;
  return PROVIDER_ALIASES[value.trim().toLowerCase()] || null;
}

function getDefaultEmailProviderId(env: Env): EmailProviderId {
  return (
    normalizeEmailProviderId(env.ME3_EMAIL_DEFAULT_PROVIDER) ||
    (hasManagedEmailGatewayCapability(env)
      ? MANAGED_EMAIL_PROVIDER_ID
      : DEFAULT_EMAIL_PROVIDER_ID)
  );
}

async function getManagedEmailFromAddress(env: Env, ownerId: string): Promise<string> {
  const mailbox = await env.DB.prepare(
    `SELECT alias_local_part
     FROM mailbox_aliases
     WHERE user_id = ? AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1`,
  )
    .bind(ownerId)
    .first<{ alias_local_part: string }>();
  const localPart = mailbox?.alias_local_part?.trim().toLowerCase() || "";
  const address = localPart ? `${localPart}@me3.app` : "";
  if (!isValidEmail(address)) {
    throw new EmailProviderInputError(
      "ME3 managed email address is not provisioned for this mailbox",
      503,
    );
  }
  return address;
}

async function getManagedEmailFromName(env: Env, ownerId: string): Promise<string> {
  const owner = await env.DB.prepare(
    `SELECT name, username
     FROM owner_profile
     WHERE id = ?`,
  )
    .bind(ownerId)
    .first<{ name: string | null; username: string | null }>();
  const profileName = sanitizeHeaderValue(owner?.name || "").trim().slice(0, 120);
  if (profileName && !/^ME3(?: Core)? Owner$/i.test(profileName)) return profileName;
  const username = sanitizeHeaderValue(owner?.username || "").trim().slice(0, 120);
  return username || "ME3";
}

function getProviderAdapter(providerId: EmailProviderId): EmailProviderAdapter {
  const adapter = EMAIL_PROVIDER_ADAPTERS.find((candidate) => candidate.id === providerId);
  if (!adapter) throw new EmailProviderInputError("Unknown email provider");
  return adapter;
}

function getActiveProviderId(
  settings: Map<EmailProviderId, DbEmailProviderSetting>,
): EmailProviderId | null {
  for (const [providerId, row] of settings) {
    if (row.is_active) return providerId;
  }
  return null;
}

function formatAddress(email: string, name: string): string {
  return name ? `${quoteAddressName(name)} <${email}>` : email;
}

function quoteAddressName(name: string): string {
  const clean = sanitizeHeaderValue(name);
  if (/^[a-z0-9 ._-]+$/i.test(clean)) return clean;
  return `"${escapeQuotedHeaderName(clean)}"`;
}

function escapeQuotedHeaderName(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "\\" || character === '"') escaped += "\\";
    escaped += character;
  }
  return escaped;
}

function domainFromEmail(email: string): string {
  const atIndex = email.lastIndexOf("@");
  return atIndex >= 0 ? email.slice(atIndex + 1).toLowerCase() : "";
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
}

function normalizeSmtpHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^smtp:\/\//, "")
    .replace(/^smtps:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

function normalizeSmtpPort(value: string | number): number {
  const port = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EmailProviderInputError("Enter a valid SMTP port");
  }
  return port;
}

function normalizeSmtpSecurity(value: string): SmtpSecurity {
  const normalized = value.trim().toLowerCase();
  if (normalized === "tls" || normalized === "ssl") return "tls";
  if (normalized === "none" || normalized === "off") return "none";
  return "starttls";
}

function normalizeMailgunRegion(value: string): MailgunRegion {
  return value.trim().toLowerCase() === "eu" ? "eu" : "us";
}

function mailgunBaseUrl(config: EmailProviderConfig): string {
  return config.mailgunRegion === "eu"
    ? "https://api.eu.mailgun.net"
    : "https://api.mailgun.net";
}

function normalizeMailgunVariableName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function stringifyMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
}

// The gateway's legacy contract accepts only v4-shaped audit IDs. This is a
// deterministic identifier, not a random credential; authentication is separate.
async function managedEmailOperationAuditId(ownerId: string, purpose: EmailSendPurpose, operationId: string): Promise<string> {
  const hash = await sha256Hex(new TextEncoder().encode(JSON.stringify(["me3-managed-email", ownerId, purpose, operationId])));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function createManagedEmailRequestFingerprint(
  input: EmailProviderSendRequest,
  normalized: {
    fromAddress: string;
    fromName: string;
    replyToAddress: string;
    toAddress: string;
    subject: string;
    attachments: EmailProviderAttachment[];
  },
): Promise<string> {
  const attachments = await Promise.all(
    normalized.attachments.map(async (attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      contentSha256: await sha256Hex(attachment.content),
    })),
  );
  const metadata = Object.fromEntries(
    Object.entries(stringifyMetadata(input.metadata || {})).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        purpose: input.purpose,
        fromAddress: normalized.fromAddress,
        fromName: normalized.fromName,
        replyToAddress: normalized.replyToAddress,
        toAddress: normalized.toAddress,
        subject: normalized.subject,
        textBody: input.textBody,
        htmlBody: input.htmlBody || null,
        attachments,
        messageIdHeader: input.messageIdHeader || null,
        inReplyTo: input.inReplyTo || null,
        referencesHeader: input.referencesHeader || null,
        ownerApproved: Boolean(input.approvedByUserId),
        metadata,
      }),
    ),
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getSecretHint(secret: string): string {
  return `***${secret.slice(-4)}`;
}

async function encryptProviderSecret(secret: string, installKey: string): Promise<string> {
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

async function decryptProviderSecret(encrypted: string, installKey: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = encrypted.split(".");
  if (version !== "v1" || !ivBase64 || !ciphertextBase64) {
    throw new EmailProviderInputError("Stored email provider token is invalid", 500);
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

function encodeBase64Utf8(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
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

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function isCloudflareSuccess(body: unknown): boolean {
  return isRecord(body) && body.success === true;
}

function cloudflareErrorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    if (isRecord(first) && typeof first.message === "string") return first.message;
  }
  return fallback || "Cloudflare Email Service send failed";
}

function cloudflareErrorCode(body: unknown): string | null {
  if (isRecord(body) && Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    if (isRecord(first) && typeof first.code === "number") return String(first.code);
    if (isRecord(first) && typeof first.message === "string") return first.message;
  }
  return null;
}

function isPostmarkSuccess(body: unknown): boolean {
  return isRecord(body) && body.ErrorCode === 0;
}

function isMailgunSuccess(body: unknown): boolean {
  return isRecord(body) && typeof body.id === "string";
}

function mailgunErrorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.message === "string") return body.message;
  return fallback || "Mailgun send failed";
}

function mailgunErrorCode(body: unknown): string | null {
  if (isRecord(body) && typeof body.message === "string") return body.message;
  return null;
}

function postmarkErrorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.Message === "string") return body.Message;
  return fallback || "Postmark send failed";
}

function postmarkErrorCode(body: unknown): string | null {
  if (isRecord(body) && typeof body.ErrorCode === "number") return String(body.ErrorCode);
  return null;
}

function normalizeSendError(error: unknown): {
  message: string;
  status: number;
  code: string | null;
  raw: unknown;
} {
  if (error instanceof EmailProviderSendError) {
    return {
      message: error.message,
      status: error.status,
      code: error.code,
      raw: error.raw,
    };
  }
  if (error instanceof EmailProviderInputError) {
    return { message: error.message, status: error.status, code: null, raw: null };
  }
  return {
    message: error instanceof Error ? error.message : "Email provider send failed",
    status: 500,
    code: null,
    raw: null,
  };
}

function isDefinitiveProviderFailure(error: unknown): boolean {
  return (
    error instanceof EmailProviderInputError ||
    (error instanceof EmailProviderSendError && error.code !== "CONNECTION_CLOSED")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingEmailProviderTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("email_provider_settings") &&
    /no such table|does not exist/i.test(message)
  );
}
