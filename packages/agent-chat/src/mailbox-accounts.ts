import { type CoreAgentChatEnv, normalizeNullableText } from "./domain-store";
import { type AgentMailboxOverview, type AgentMailboxUpdateInput, type AgentMailbox, type AgentMailboxSource, CORE_MAILBOX_DAILY_INBOUND_LIMIT, CORE_MAILBOX_DAILY_OUTBOUND_LIMIT, type DbMailboxAliasRow, type AgentMailboxMessage, type DbMailboxMessageRow } from "./mailbox-types";
import { getAgentMailboxRow, isValidEmail, normalizeEmailText, agentMailboxMessageSelectSql } from "./mailbox-store";
import { normalizeMe3DeploymentMode } from "./contracts";
import { serializeAgentMailbox, serializeAgentMailboxMessage } from "./mailbox-format";

export async function getAgentMailboxOverview(
  env: Pick<CoreAgentChatEnv, "DB" | "ME3_DEPLOYMENT_MODE">,
  userId: string,
  ownerHint?: { username?: string | null; email?: string | null },
  options: {
    includeRecentActivity?: boolean;
    configuredIdentity?: { id: string; address: string } | null;
  } = {},
): Promise<AgentMailboxOverview> {
  const mailbox = await getAgentMailboxRow(env, userId);
  const cloudflareManaged = normalizeMe3DeploymentMode(env.ME3_DEPLOYMENT_MODE) === "managed";
  const managedAddress =
    mailbox && cloudflareManaged
      ? getAgentMailboxManagedAddress(mailbox.alias_local_part)
      : null;
  const configuredIdentity = normalizeAgentMailboxConfiguredIdentity(
    options.configuredIdentity,
  );
  const suggestedAliasLocalPart =
    mailbox?.alias_local_part ||
    suggestAgentMailboxAlias(ownerHint?.username || ownerHint?.email || "owner");

  return {
    tier: "core",
    available: true,
    approvalRequired: true,
    cloudflareManaged,
    suggestedAliasLocalPart,
    mailbox: mailbox ? serializeAgentMailbox(mailbox, managedAddress) : null,
    sources:
      mailbox && managedAddress
        ? [serializeAgentMailboxManagedSource(mailbox, managedAddress)]
        : mailbox && configuredIdentity
          ? [serializeAgentMailboxConfiguredSource(configuredIdentity)]
          : [],
    recentActivity:
      mailbox && options.includeRecentActivity !== false
        ? await getAgentMailboxActivity(env, mailbox.id, 25, 0)
        : [],
  };
}

export async function upsertAgentMailbox(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
  input: AgentMailboxUpdateInput,
  ownerHint?: { email?: string | null },
): Promise<{ mailbox: AgentMailbox | null; sources: AgentMailboxSource[] } | { error: string; status: number }> {
  const existing = await getAgentMailboxRow(env, userId);
  const aliasLocalPart = normalizeAgentMailboxAlias(
    typeof input.aliasLocalPart === "string" ? input.aliasLocalPart : "",
  );
  const forwardingEnabled = input.forwardingEnabled === true;
  const forwardingEmail =
    typeof input.forwardingEmail === "string" ? input.forwardingEmail.trim() : "";

  if (!aliasLocalPart || !MAILBOX_ALIAS_REGEX.test(aliasLocalPart)) {
    return {
      error:
        "Mailbox alias must start and end with a letter or number and may contain dots, underscores, or hyphens.",
      status: 400,
    };
  }

  if (forwardingEnabled && !isValidEmail(forwardingEmail)) {
    return { error: "Enter a valid forwarding email address.", status: 400 };
  }

  const savedForwardingEmail =
    forwardingEnabled ? forwardingEmail : existing?.forwarding_email || ownerHint?.email || "";
  const forwardingStatus =
    forwardingEnabled && savedForwardingEmail !== existing?.forwarding_email
      ? "pending"
      : existing?.forwarding_status || "pending";
  const forwardingMode = forwardingEnabled ? "forward" : "me3_only";
  const now = new Date().toISOString();

  try {
    if (existing) {
      await env.DB.prepare(
        `UPDATE mailbox_aliases
         SET alias_local_part = ?,
             forwarding_email = ?,
             forwarding_status = ?,
             forwarding_enabled = ?,
             forwarding_mode = ?,
             updated_at = ?
         WHERE user_id = ?`,
      )
        .bind(
          aliasLocalPart,
          savedForwardingEmail,
          forwardingStatus,
          forwardingEnabled ? 1 : 0,
          forwardingMode,
          now,
          userId,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO mailbox_aliases (
           id, user_id, alias_local_part, forwarding_email, forwarding_status,
           forwarding_enabled, forwarding_mode, status, approval_policy,
           daily_inbound_limit, daily_outbound_limit, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_setup', 'all', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          userId,
          aliasLocalPart,
          savedForwardingEmail,
          forwardingStatus,
          forwardingEnabled ? 1 : 0,
          forwardingMode,
          CORE_MAILBOX_DAILY_INBOUND_LIMIT,
          CORE_MAILBOX_DAILY_OUTBOUND_LIMIT,
          now,
          now,
        )
        .run();
    }
  } catch {
    return { error: "Mailbox alias is already in use.", status: 409 };
  }

  const mailbox = await getAgentMailboxRow(env, userId);
  return {
    mailbox: mailbox ? serializeAgentMailbox(mailbox) : null,
    sources: [],
  };
}

export async function activateAgentMailbox(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
): Promise<{ mailbox: AgentMailbox | null } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE mailbox_aliases
     SET status = 'active',
         activated_at = COALESCE(activated_at, ?),
         updated_at = ?
     WHERE user_id = ?`,
  )
    .bind(now, now, userId)
    .run();

  const updated = await getAgentMailboxRow(env, userId);
  return { mailbox: updated ? serializeAgentMailbox(updated) : null };
}

export async function pauseAgentMailbox(
  env: Pick<CoreAgentChatEnv, "DB">,
  userId: string,
): Promise<{ mailbox: AgentMailbox | null } | { error: string; status: number }> {
  const mailbox = await getAgentMailboxRow(env, userId);
  if (!mailbox) return { error: "Mailbox not found", status: 404 };

  await env.DB.prepare(
    `UPDATE mailbox_aliases
     SET status = 'paused',
         updated_at = ?
     WHERE user_id = ?`,
  )
    .bind(new Date().toISOString(), userId)
    .run();

  const updated = await getAgentMailboxRow(env, userId);
  return { mailbox: updated ? serializeAgentMailbox(updated) : null };
}

export function suggestAgentMailboxAlias(value: string): string {
  const atIndex = value.indexOf("@");
  const base = normalizeAgentMailboxAlias(
    atIndex === -1 ? value : value.slice(0, atIndex),
  );
  return base || "owner";
}

export function normalizeAgentMailboxAlias(value: string): string {
  let normalized = "";
  for (const character of value.trim().toLowerCase()) {
    if (isAgentMailboxAliasCharacter(character)) normalized += character;
  }
  let start = 0;
  let end = normalized.length;
  while (start < end && !isAgentMailboxAliasAlphaNumeric(normalized[start])) {
    start += 1;
  }
  while (end > start && !isAgentMailboxAliasAlphaNumeric(normalized[end - 1])) {
    end -= 1;
  }
  return normalized.slice(start, end);
}

export function isAgentMailboxAliasCharacter(value: string): boolean {
  return isAgentMailboxAliasAlphaNumeric(value) || value === "." || value === "_" || value === "-";
}

export function isAgentMailboxAliasAlphaNumeric(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

export function getAgentMailboxManagedAddress(localPart: string): string {
  return `${localPart}@me3.app`;
}

export function serializeAgentMailboxManagedSource(
  row: DbMailboxAliasRow,
  address: string,
): AgentMailboxSource {
  return {
    id: row.id,
    type: "me3_alias",
    address,
    status: row.status === "active" ? "active" : row.status === "paused" ? "paused" : "pending",
    inboundEnabled: row.status === "active",
    outboundEnabled: true,
  };
}

export function serializeAgentMailboxConfiguredSource(
  identity: { id: string; address: string },
): AgentMailboxSource {
  return {
    id: identity.id,
    type: "custom_domain",
    address: identity.address,
    status: "active",
    inboundEnabled: false,
    outboundEnabled: true,
  };
}

export function normalizeAgentMailboxConfiguredIdentity(
  identity: { id: string; address: string } | null | undefined,
): { id: string; address: string } | null {
  const id = normalizeNullableText(identity?.id);
  const address = normalizeEmailText(identity?.address);
  if (!id || !address || !isValidEmail(address) || address.endsWith("@me3.local")) {
    return null;
  }
  return { id, address };
}

export async function getAgentMailboxActivity(
  env: Pick<CoreAgentChatEnv, "DB">,
  mailboxId: string,
  limit: number,
  offset: number,
): Promise<AgentMailboxMessage[]> {
  const rows = await env.DB.prepare(
    `${agentMailboxMessageSelectSql()}
     WHERE mailbox_id = ?
     ORDER BY COALESCE(sent_at, received_at, approved_at, created_at) DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(mailboxId, limit, offset)
    .all<DbMailboxMessageRow>();

  return (rows.results || []).map(serializeAgentMailboxMessage);
}

export const MAILBOX_ALIAS_REGEX = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
