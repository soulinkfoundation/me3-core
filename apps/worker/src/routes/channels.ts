import {
  convertAgentContactToClient,
  deleteAgentContact,
  listAgentContacts,
  upsertAgentContact,
} from "../agent-chat";
import {
  dispatchAgentChannelTurn,
  insertProviderChannelEventOnce,
} from "../agent-channels";
import type { AgentSandboxDispatchResponse } from "../agent-chat";
import type { AppContext, AppHono } from "../http/types";
import {
  getTelegramSettings,
  resolveTelegramBotToken,
  resolveTelegramBotTokenForInstall,
  resolveTelegramWebhookSecret,
  resolveTelegramWebhookSecretForInstall,
  TelegramSettingsInputError,
  updateTelegramSettings,
} from "../telegram-settings";
import {
  getCoreApiOrigin,
  getCoreWebOrigin,
  getOwnerProfile,
  normalizeEmail,
  normalizeShortText,
  originFromUrl,
} from "../sites";
import type { DbAgentChannelConnection, DbAgentChannelEvent, DbContact, Env } from "../types";

const DEFAULT_SOULINK_API_ORIGIN = "https://soulinkfoundation.org";

type ChannelRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

type SoulinkProvisionResponse = {
  ok?: boolean;
  ownerNodeId?: string;
  assistantNodeId?: string;
  streamChannelType?: string;
  streamChannelId?: string;
  soulinkChatUrl?: string;
  error?: string;
};
type SoulinkLinksResponse = {
  ok?: boolean;
  ownerNodeId?: string | null;
  links?: SoulinkLinkRecord[];
  error?: string;
};
type SoulinkLinkRecord = {
  id?: unknown;
  fromNodeId?: unknown;
  toNodeId?: unknown;
  sourceChatId?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  otherNode?: SoulinkLinkNodeRecord | null;
  context?: SoulinkLinkContextRecord | null;
};
type SoulinkLinkNodeRecord = {
  id?: unknown;
  displayName?: unknown;
  handle?: unknown;
  me3Url?: unknown;
  kind?: unknown;
  avatarUrl?: unknown;
  email?: unknown;
  contactEmail?: unknown;
};
type SoulinkLinkContextRecord = {
  sourceChatId?: unknown;
  sourceChatTitle?: unknown;
  sourceChatKind?: unknown;
  streamChannelId?: unknown;
  directMessageUrl?: unknown;
  soulinkChatUrl?: unknown;
  chatUrl?: unknown;
  lastActiveAt?: unknown;
  label?: unknown;
};
type TelegramUser = {
  id?: unknown;
  is_bot?: unknown;
  username?: unknown;
  first_name?: unknown;
  last_name?: unknown;
};
type TelegramChat = {
  id?: unknown;
  type?: unknown;
};
type TelegramMessage = {
  message_id?: unknown;
  text?: unknown;
  chat?: TelegramChat;
  from?: TelegramUser;
  reply_to_message?: { message_id?: unknown };
};
type TelegramWebhookUpdate = {
  update_id?: unknown;
  message?: TelegramMessage;
};

export function registerChannelRoutes(app: AppHono, deps: ChannelRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.get("/api/telegram/status", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    return c.json(await buildTelegramStatusPayload(c.env, ownerId, c.req.url));
  });

  app.put("/api/telegram/settings", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    try {
      await updateTelegramSettings(
        c.env,
        ownerId,
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        ok: true,
        ...(await buildTelegramStatusPayload(c.env, ownerId, c.req.url)),
      });
    } catch (error) {
      if (error instanceof TelegramSettingsInputError) {
        return c.json({ ok: false, error: error.message }, error.status as any);
      }
      throw error;
    }
  });

  app.post("/api/telegram/webhook/sync", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const settings = await getTelegramSettings(c.env, ownerId);
    const botToken = await resolveTelegramBotToken(c.env, ownerId);
    const webhookSecret = await resolveTelegramWebhookSecret(c.env, ownerId);
    const webhookUrl = `${getCoreApiOrigin(c.env, c.req.url)}/api/telegram/webhook`;

    if (!settings.botUsername) {
      return c.json({ ok: false, error: "Telegram bot username is not configured" }, 503);
    }
    if (!botToken) {
      return c.json({ ok: false, error: "Telegram bot token is not configured" }, 503);
    }
    if (!webhookSecret) {
      return c.json({ ok: false, error: "Telegram webhook secret is not configured" }, 503);
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;

    if (!response.ok || payload?.ok !== true) {
      return c.json(
        {
          ok: false,
          error:
            payload?.description || `Telegram setWebhook failed (${response.status})`,
        },
        502,
      );
    }

    return c.json({
      ok: true,
      ...(await buildTelegramStatusPayload(c.env, ownerId, c.req.url)),
    });
  });

  app.post("/api/telegram/setup", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const settings = await getTelegramSettings(c.env, ownerId);
    if (!settings.botUsername) {
      return c.json({ error: "Telegram bot username is not configured" }, 503);
    }
    if (!settings.botTokenConfigured) {
      return c.json({ error: "Telegram bot token is not configured" }, 503);
    }
    if (!settings.webhookSecretConfigured) {
      return c.json({ error: "Telegram webhook secret is not configured" }, 503);
    }

    const connection = await upsertPendingTelegramConnection(c.env, ownerId);
    return c.json({
      ok: true,
      ...(await buildTelegramStatusPayload(c.env, ownerId, c.req.url, connection)),
    });
  });

  app.post("/api/telegram/disconnect", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const existing = await getTelegramConnection(c.env, ownerId);
    if (!existing) {
      return c.json({ ok: true, disconnected: false });
    }

    await c.env.DB.prepare(
      `UPDATE agent_channel_connections
       SET status = 'disconnected',
           telegram_user_id = NULL,
           telegram_chat_id = NULL,
           telegram_username = NULL,
           telegram_first_name = NULL,
           telegram_last_name = NULL,
           disconnected_at = datetime('now'),
           updated_at = datetime('now')
       WHERE user_id = ? AND channel = 'telegram'`,
    )
      .bind(ownerId)
      .run();

    const connection = await getTelegramConnection(c.env, ownerId);
    return c.json({
      ok: true,
      disconnected: true,
      ...(await buildTelegramStatusPayload(c.env, ownerId, c.req.url, connection)),
    });
  });

  app.post("/api/telegram/webhook", async (c) => {
    const configuredSecret = await resolveTelegramWebhookSecretForInstall(c.env);
    if (!configuredSecret) {
      return c.json({ ok: false, error: "Telegram webhook secret is not configured" }, 503);
    }

    const receivedSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
    if (receivedSecret !== configuredSecret) {
      return c.json({ ok: false, error: "Invalid Telegram webhook secret" }, 401);
    }

    const update = await c.req.json<TelegramWebhookUpdate>().catch(() => null);
    if (!update || typeof update !== "object") {
      return c.json({ ok: false, error: "Invalid Telegram update" }, 400);
    }

    const result = await handleTelegramWebhookUpdate(c.env, update);
    return c.json(result, (result.ok ? 200 : result.status) as any);
  });

  app.get("/api/soulink/status", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    return c.json(await buildSoulinkStatusPayload(c.env, ownerId, c.req.url));
  });

  app.post("/api/soulink/setup", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const config = getSoulinkConnectorConfig(c.env);
    if (!config.configured) {
      return c.json(
        {
          ok: false,
          error: "Soulink connector is not configured for this Core install",
          ...(await buildSoulinkStatusPayload(c.env, ownerId, c.req.url)),
        },
        503,
      );
    }

    const owner = await getOwnerProfile(c.env, ownerId);
    if (!owner) return c.json({ ok: false, error: "Account not found" }, 404);

    const dispatchToken = crypto.randomUUID();
    const callbackUrl = `${getCoreApiOrigin(c.env, c.req.url)}/api/agent/channels/soulink/dispatch`;
    const response = await fetch(`${config.apiOrigin}/api/me3/assistant-channel/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        issuer: getCoreApiOrigin(c.env, c.req.url),
        subject: owner.id,
        owner: {
          displayName: owner.name || owner.username || "ME3 Owner",
          handle: owner.username || "owner",
          me3Url: await getOwnerMe3Url(c.env, ownerId, c.req.url),
          avatarUrl: owner.avatar_url || null,
        },
        assistant: {
          displayName: "ME3 Assistant",
          avatarUrl: null,
        },
        runtime: {
          kind: "standalone-me3-core",
          callbackUrl,
          dispatchToken,
        },
      }),
    });

    const payload = (await response.json().catch(() => null)) as SoulinkProvisionResponse | null;
    if (!response.ok || payload?.ok !== true || !payload.streamChannelId) {
      return c.json(
        {
          ok: false,
          error: payload?.error || `Soulink provisioning failed (${response.status})`,
          ...(await buildSoulinkStatusPayload(c.env, ownerId, c.req.url)),
        },
        502,
      );
    }

    const connection = await upsertActiveSoulinkConnection(c.env, ownerId, {
      ownerNodeId: payload.ownerNodeId || null,
      assistantNodeId: payload.assistantNodeId || null,
      streamChannelType: payload.streamChannelType || "messaging",
      streamChannelId: payload.streamChannelId,
      soulinkChatUrl: payload.soulinkChatUrl || null,
      runtimeCallbackUrl: callbackUrl,
      dispatchToken,
    });

    await insertProviderChannelEventOnce(c.env, {
      channel: "soulink",
      connectionId: connection.id,
      direction: "system",
      eventType: "link",
      status: "linked",
      providerEventId: `setup:${payload.streamChannelId}`,
      providerMessageId: null,
      replyToMessageId: null,
      textBody: "Soulink assistant chat connected.",
      rawJson: payload,
      errorMessage: null,
    });

    const contactSync = await syncSoulinkContacts(c.env, ownerId);

    return c.json({
      ok: true,
      contactSync: contactSync.ok
        ? { synced: contactSync.synced, created: contactSync.created, updated: contactSync.updated }
        : { error: contactSync.error },
      ...(await buildSoulinkStatusPayload(c.env, ownerId, c.req.url, connection)),
    });
  });

  app.post("/api/soulink/disconnect", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const existing = await getSoulinkConnection(c.env, ownerId);
    if (!existing) {
      return c.json({ ok: true, disconnected: false, ...(await buildSoulinkStatusPayload(c.env, ownerId, c.req.url)) });
    }

    await c.env.DB.prepare(
      `UPDATE agent_channel_connections
       SET status = 'disconnected',
           disconnected_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND channel = 'soulink'`,
    )
      .bind(ownerId)
      .run();

    const connection = await getSoulinkConnection(c.env, ownerId);
    return c.json({
      ok: true,
      disconnected: true,
      ...(await buildSoulinkStatusPayload(c.env, ownerId, c.req.url, connection)),
    });
  });

  app.post("/api/soulink/contacts/sync", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await syncSoulinkContacts(c.env, ownerId);
    if (!result.ok) {
      return c.json(result, result.status as any);
    }
    return c.json(result);
  });

  app.get("/api/me3/links", async (c) => {
    const result = await listSoulinkLinksForConnectedCore(
      c.env,
      c.req.header("authorization"),
      c.req.query("ownerNodeId"),
    );
    if (!result.ok) return c.json({ ok: false, error: result.error }, result.status as any);
    return c.json(result);
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function getSoulinkConnectorConfig(env: Env) {
  const apiOrigin =
    originFromUrl(env.SOULINK_API_ORIGIN) || DEFAULT_SOULINK_API_ORIGIN;
  return {
    apiOrigin,
    configured: Boolean(apiOrigin),
  };
}

function verifySoulinkDispatchAuth(
  connection: DbAgentChannelConnection,
  authorization: string | undefined,
) {
  const dispatchToken = connection.setup_token;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token || !constantTimeEqual(token, dispatchToken)) {
    return { ok: false, status: 401, error: "Invalid Soulink dispatch token" };
  }
  return { ok: true as const };
}

function serializeSoulinkConnection(row: DbAgentChannelConnection | null) {
  if (!row) return null;
  const metadata = parseJsonRecord(row.provider_metadata_json);
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    ownerNodeId:
      typeof metadata.ownerNodeId === "string" ? metadata.ownerNodeId : row.provider_user_id,
    assistantNodeId:
      typeof metadata.assistantNodeId === "string" ? metadata.assistantNodeId : null,
    streamChannelType: row.provider_connection_id || "messaging",
    streamChannelId: row.provider_thread_id,
    soulinkChatUrl:
      typeof metadata.soulinkChatUrl === "string" ? metadata.soulinkChatUrl : null,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function buildSoulinkStatusPayload(
  env: Env,
  ownerId: string,
  requestUrl: string,
  currentConnection?: DbAgentChannelConnection | null,
) {
  const config = getSoulinkConnectorConfig(env);
  const connection =
    currentConnection === undefined
      ? await getSoulinkConnection(env, ownerId)
      : currentConnection;
  const events = connection
    ? await env.DB.prepare(
        `SELECT id, connection_id, channel, direction, event_type, status,
                provider_event_id, provider_message_id,
                telegram_message_id, reply_to_message_id, telegram_user_id,
                telegram_chat_id, telegram_username, text_body, raw_json,
                error_message, created_at, updated_at
         FROM agent_channel_events
         WHERE connection_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
      )
        .bind(connection.id)
        .all<DbAgentChannelEvent>()
    : { results: [] };

  return {
    available: true,
    configured: config.configured,
    apiOrigin: config.apiOrigin,
    runtimeCallbackUrl: `${getCoreApiOrigin(env, requestUrl)}/api/agent/channels/soulink/dispatch`,
    connection: serializeSoulinkConnection(connection),
    recentEvents: (events.results || []).map(serializeProviderChannelEvent),
  };
}

export async function syncSoulinkContacts(env: Env, ownerId: string) {
  const config = getSoulinkConnectorConfig(env);
  if (!config.configured) {
    return { ok: false, status: 503, error: "Soulink connector is not configured" };
  }

  const connection = await getSoulinkConnection(env, ownerId);
  if (!connection || connection.status !== "active") {
    return { ok: false, status: 409, error: "Connect Soulink before syncing contacts" };
  }

  await updateSoulinkContactSyncMetadata(env, connection, {
    soulinkContactsLastAttemptedAt: new Date().toISOString(),
    soulinkContactsLastError: null,
  });

  const linksResult = await fetchSoulinkLinks(config.apiOrigin, connection).catch((error) => ({
    ok: false as const,
    status: 502,
    error: error instanceof Error ? error.message : "Soulink contacts could not be reached",
  }));
  if (!linksResult.ok) {
    await updateSoulinkContactSyncMetadata(env, connection, {
      soulinkContactsLastError: linksResult.error,
    });
    return {
      ok: false,
      status: linksResult.status,
      error: linksResult.error,
    };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const link of linksResult.links) {
    const input = await soulinkLinkToContactInput(
      link,
      config.apiOrigin,
    );
    if (!input) {
      skipped += 1;
      continue;
    }

    const result = await upsertAgentContact(env, ownerId, input);
    if ("error" in result) {
      skipped += 1;
      continue;
    }
    if (result.created) created += 1;
    else updated += 1;
  }

  const contacts = await listAgentContacts(env, ownerId);
  await updateSoulinkContactSyncMetadata(env, connection, {
    soulinkContactsLastSyncedAt: new Date().toISOString(),
    soulinkContactsLastError: null,
  });
  return {
    ok: true,
    synced: created + updated,
    created,
    updated,
    skipped,
    contacts: contacts.contacts,
    summary: contacts.summary,
  };
}

export async function ensureSoulinkContactsFresh(
  env: Env,
  ownerId: string,
  staleAfterMs = 24 * 60 * 60 * 1000,
) {
  const connection = await getSoulinkConnection(env, ownerId);
  if (!connection || connection.status !== "active") return null;
  const metadata = parseJsonRecord(connection.provider_metadata_json);
  const lastSyncedAt = Date.parse(stringValue(metadata.soulinkContactsLastSyncedAt) || "");
  if (Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < staleAfterMs) {
    return { ok: true as const, fresh: true as const };
  }
  return syncSoulinkContacts(env, ownerId);
}

export async function syncDueSoulinkContacts(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_user_id, provider_thread_id,
            provider_username, provider_metadata_json,
            telegram_user_id, telegram_chat_id, telegram_username,
            telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at,
            updated_at
     FROM agent_channel_connections
     WHERE channel = 'soulink' AND status = 'active'`,
  ).all<DbAgentChannelConnection>();
  const results = await Promise.all((rows.results || []).map((connection) =>
    ensureSoulinkContactsFresh(env, connection.user_id).catch(() => null)
  ));
  return {
    scanned: rows.results?.length || 0,
    synced: results.filter((result) => result && "synced" in result).length,
  };
}

async function updateSoulinkContactSyncMetadata(
  env: Env,
  connection: DbAgentChannelConnection,
  patch: Record<string, unknown>,
) {
  const current = await getSoulinkConnection(env, connection.user_id);
  const metadata = parseJsonRecord(current?.provider_metadata_json || connection.provider_metadata_json);
  await env.DB.prepare(
    `UPDATE agent_channel_connections
     SET provider_metadata_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(JSON.stringify({ ...metadata, ...patch }), connection.id)
    .run();
}

async function listSoulinkLinksForConnectedCore(
  env: Env,
  authorization: string | undefined,
  requestedOwnerNodeId: string | undefined,
): Promise<
  | { ok: true; ownerNodeId: string | null; links: ReturnType<typeof serializeSoulinkContactLink>[] }
  | { ok: false; status: 401 | 403; error: string }
> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token) return { ok: false, status: 401, error: "Missing Soulink dispatch token" };

  const connection = await getActiveSoulinkConnectionByDispatchToken(env, token);
  if (!connection || !constantTimeEqual(connection.setup_token, token)) {
    return { ok: false, status: 401, error: "Invalid Soulink dispatch token" };
  }

  const metadata = parseJsonRecord(connection.provider_metadata_json);
  const ownerNodeId =
    stringValue(metadata.ownerNodeId) ||
    stringValue(connection.provider_user_id);
  const normalizedRequestedOwnerNodeId = normalizeShortText(requestedOwnerNodeId, 160);
  if (
    normalizedRequestedOwnerNodeId &&
    ownerNodeId &&
    normalizedRequestedOwnerNodeId !== ownerNodeId
  ) {
    return { ok: false, status: 403, error: "Dispatch token is not valid for that owner node" };
  }

  const contacts = await env.DB.prepare(
    `SELECT id, user_id, name, email, phone, source, source_ref,
            relationship, status, notes, tags, last_interaction_at,
            next_followup_at, outreach_status, social_handles, metadata,
            created_at, updated_at
     FROM contacts
     WHERE user_id = ? AND status = 'active'`,
  )
    .bind(connection.user_id)
    .all<DbContact>();

  return {
    ok: true,
    ownerNodeId,
    links: (contacts.results || [])
      .map((contact) => serializeSoulinkContactLink(contact, ownerNodeId))
      .filter((link): link is ReturnType<typeof serializeSoulinkContactLink> => Boolean(link)),
  };
}

function serializeSoulinkContactLink(contact: DbContact, ownerNodeId: string | null) {
  const metadata = parseJsonRecord(contact.metadata);
  const socialHandles = parseJsonRecord(contact.social_handles);
  const linkId = stringValue(metadata.soulinkLinkId) || (
    contact.source === "soulink" && contact.source_ref ? contact.source_ref : null
  );
  const otherNodeId = stringValue(metadata.soulinkNodeId) || (
    contact.source === "soulink" && contact.source_ref ? contact.source_ref : null
  );
  const me3Url = stringValue(metadata.me3Url) || stringValue(socialHandles.me3);
  const handle = stringValue(socialHandles.soulink) || stringValue(metadata.soulinkHandle);
  const sourceChatId = stringValue(metadata.soulinkSourceChatId);
  const streamChannelId = stringValue(metadata.soulinkStreamChannelId) || sourceChatId;
  const soulinkChatUrl = stringValue(metadata.soulinkChatUrl);

  if (!linkId && !otherNodeId && !soulinkChatUrl && contact.source !== "soulink") return null;

  return {
    id: linkId || `contact:${contact.id}`,
    fromNodeId: ownerNodeId,
    toNodeId: otherNodeId,
    sourceChatId,
    status: stringValue(metadata.soulinkStatus) || "active",
    createdAt: contact.created_at,
    updatedAt:
      stringValue(metadata.soulinkLastActiveAt) ||
      stringValue(contact.last_interaction_at) ||
      contact.updated_at,
    otherNode: {
      id: otherNodeId,
      displayName: contact.name,
      handle,
      me3Url,
      kind: "person",
      avatarUrl: stringValue(metadata.avatarUrl),
      email: contact.email,
      contactEmail: contact.email,
    },
    context: {
      sourceChatId,
      sourceChatTitle: stringValue(metadata.soulinkSourceChatTitle),
      sourceChatKind: stringValue(metadata.soulinkSourceChatKind),
      streamChannelId,
      soulinkChatUrl,
      chatUrl: soulinkChatUrl,
      lastActiveAt:
        stringValue(metadata.soulinkLastActiveAt) ||
        stringValue(contact.last_interaction_at),
      label:
        stringValue(metadata.soulinkContextLabel) ||
        stringValue(metadata.soulinkSourceChatTitle),
    },
  };
}

async function fetchSoulinkLinks(
  apiOrigin: string,
  connection: DbAgentChannelConnection,
): Promise<
  | { ok: true; links: SoulinkLinkRecord[] }
  | { ok: false; status: number; error: string }
> {
  const metadata = parseJsonRecord(connection.provider_metadata_json);
  const ownerNodeId =
    typeof metadata.ownerNodeId === "string"
      ? metadata.ownerNodeId
      : connection.provider_user_id;
  const url = new URL("/api/me3/links", apiOrigin);
  if (ownerNodeId) url.searchParams.set("ownerNodeId", ownerNodeId);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${connection.setup_token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as SoulinkLinksResponse | null;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: 409,
        error: "Connect Soulink before syncing contacts",
      };
    }

    return {
      ok: false,
      status: response.status === 404 ? 501 : 502,
      error:
        payload?.error ||
        "Soulink Links sync is not available from this Soulink connector yet",
    };
  }

  return {
    ok: true,
    links: Array.isArray(payload?.links) ? payload.links : [],
  };
}

async function soulinkLinkToContactInput(
  link: SoulinkLinkRecord,
  soulinkOrigin: string,
) {
  const node = link.otherNode && typeof link.otherNode === "object" ? link.otherNode : null;
  const linkId = stringValue(link.id);
  const nodeId = stringValue(node?.id);
  const sourceRef = nodeId || linkId;
  if (!sourceRef) return null;

  const me3Url = stringValue(node?.me3Url);
  const meProfile = await resolveLinkedMeProfile(me3Url);
  const name =
    stringValue(node?.displayName) ||
    stringValue(meProfile?.name) ||
    stringValue(node?.handle) ||
    "Soulink contact";
  const email =
    normalizeEmail(node?.email) ||
    normalizeEmail(node?.contactEmail) ||
    normalizeEmail(meProfile?.email) ||
    null;
  const avatarUrl =
    stringValue(node?.avatarUrl) ||
    stringValue(meProfile?.avatarUrl) ||
    null;
  const context = link.context && typeof link.context === "object" ? link.context : null;
  const soulinkChatUrl = buildSoulinkContactChatUrl(soulinkOrigin, link, context);
  const lastActiveAt =
    stringValue(context?.lastActiveAt) ||
    stringValue(link.updatedAt) ||
    stringValue(link.createdAt);
  const socialHandles: Record<string, string> = {};
  const handle = stringValue(node?.handle);
  if (handle) socialHandles.soulink = handle;
  if (me3Url) socialHandles.me3 = me3Url;

  return {
    name,
    email,
    source: "soulink" as const,
    sourceRef,
    relationship: "contact" as const,
    status: "active" as const,
    lastInteractionAt: lastActiveAt,
    socialHandles,
    metadata: {
      avatarUrl,
      me3Url,
      soulinkLinkId: linkId,
      soulinkNodeId: nodeId,
      soulinkChatUrl,
      soulinkOrigin,
      soulinkSourceChatId:
        stringValue(context?.sourceChatId) || stringValue(link.sourceChatId),
      soulinkStreamChannelId: stringValue(context?.streamChannelId),
      soulinkContextLabel: stringValue(context?.label),
      soulinkSourceChatTitle: stringValue(context?.sourceChatTitle),
      soulinkSourceChatKind: stringValue(context?.sourceChatKind),
      soulinkStatus: stringValue(link.status),
      soulinkLastActiveAt: lastActiveAt,
      resolvedFromMeJsonAt: meProfile?.resolvedAt || null,
      coreResolvedAt: new Date().toISOString(),
    },
  };
}

async function resolveLinkedMeProfile(me3Url: string | null): Promise<{
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  resolvedAt: string;
} | null> {
  const candidates = candidateMeJsonUrls(me3Url);
  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      headers: { Accept: "application/json" },
    }).catch(() => null);
    if (!response?.ok) continue;
    const data = (await response.json().catch(() => null)) as unknown;
    if (!isPlainObject(data)) continue;
    const links = isPlainObject(data.links) ? data.links : {};
    return {
      name: stringValue(data.name),
      email: normalizeEmail(links.email),
      avatarUrl: resolveProfileAssetUrl(candidate, stringValue(data.avatar)),
      resolvedAt: new Date().toISOString(),
    };
  }
  return null;
}

function candidateMeJsonUrls(me3Url: string | null): string[] {
  if (!me3Url) return [];
  try {
    const base = new URL(me3Url);
    if (!/^https?:$/.test(base.protocol)) return [];
    if (base.pathname.endsWith(".json")) return [base.toString()];
    const root = new URL(base.toString());
    root.pathname = root.pathname.replace(/\/+$/, "");
    root.search = "";
    root.hash = "";
    return [
      new URL(`${root.pathname}/me.json`.replace(/\/+/g, "/"), root.origin).toString(),
      new URL("/.well-known/me.json", root.origin).toString(),
    ];
  } catch {
    return [];
  }
}

function resolveProfileAssetUrl(profileUrl: string, assetUrl: string | null): string | null {
  if (!assetUrl) return null;
  try {
    return new URL(assetUrl, profileUrl).toString();
  } catch {
    return assetUrl;
  }
}

function buildSoulinkContactChatUrl(
  soulinkOrigin: string,
  link: SoulinkLinkRecord,
  context: SoulinkLinkContextRecord | null,
): string | null {
  const directMessageUrl = stringValue(context?.directMessageUrl);
  if (directMessageUrl) return directMessageUrl;
  const nodeId = stringValue(link.otherNode?.id);
  if (nodeId) {
    return `${soulinkOrigin}/?node=${encodeURIComponent(nodeId)}`;
  }
  const explicitUrl = stringValue(context?.soulinkChatUrl) || stringValue(context?.chatUrl);
  if (explicitUrl) return explicitUrl;
  const streamChannelId = stringValue(context?.streamChannelId);
  if (streamChannelId) {
    return `${soulinkOrigin}/?chat=${encodeURIComponent(
      streamChannelId.includes(":") ? streamChannelId : `messaging:${streamChannelId}`,
    )}`;
  }
  const sourceChatId = stringValue(context?.sourceChatId) || stringValue(link.sourceChatId);
  return sourceChatId ? `${soulinkOrigin}/?chat=${encodeURIComponent(sourceChatId)}` : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function serializeProviderChannelEvent(row: DbAgentChannelEvent) {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    eventType: row.event_type,
    status: row.status,
    providerEventId: row.provider_event_id,
    providerMessageId: row.provider_message_id,
    replyToMessageId: row.reply_to_message_id,
    textBody: row.text_body,
    rawJson: parseJsonRecord(row.raw_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSoulinkConnection(env: Env, ownerId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_user_id, provider_thread_id,
            provider_username, provider_metadata_json,
            telegram_user_id, telegram_chat_id, telegram_username,
            telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at,
            updated_at
     FROM agent_channel_connections
     WHERE user_id = ? AND channel = 'soulink'`,
  )
    .bind(ownerId)
    .first<DbAgentChannelConnection>();
}

async function getActiveSoulinkConnectionForThread(env: Env, streamChannelId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_user_id, provider_thread_id,
            provider_username, provider_metadata_json,
            telegram_user_id, telegram_chat_id, telegram_username,
            telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at,
            updated_at
     FROM agent_channel_connections
     WHERE provider_thread_id = ? AND channel = 'soulink' AND status = 'active'`,
  )
    .bind(streamChannelId)
    .first<DbAgentChannelConnection>();
}

async function getActiveSoulinkConnectionByDispatchToken(env: Env, setupToken: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_user_id, provider_thread_id,
            provider_username, provider_metadata_json,
            telegram_user_id, telegram_chat_id, telegram_username,
            telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at,
            updated_at
     FROM agent_channel_connections
     WHERE setup_token = ? AND channel = 'soulink' AND status = 'active'`,
  )
    .bind(setupToken)
    .first<DbAgentChannelConnection>();
}

async function upsertActiveSoulinkConnection(
  env: Env,
  ownerId: string,
  input: {
    ownerNodeId: string | null;
    assistantNodeId: string | null;
    streamChannelType: string;
    streamChannelId: string;
    soulinkChatUrl: string | null;
    runtimeCallbackUrl: string;
    dispatchToken: string;
  },
) {
  const existing = await getSoulinkConnection(env, ownerId);
  const connectionId = existing?.id || crypto.randomUUID();
  const setupToken = input.dispatchToken;
  const metadata = JSON.stringify({
    ownerNodeId: input.ownerNodeId,
    assistantNodeId: input.assistantNodeId,
    soulinkChatUrl: input.soulinkChatUrl,
    runtimeCallbackUrl: input.runtimeCallbackUrl,
  });

  await env.DB.prepare(
    `INSERT INTO agent_channel_connections
       (id, user_id, channel, status, setup_token,
        provider_connection_id, provider_user_id, provider_thread_id,
        provider_username, provider_metadata_json,
        connected_at, disconnected_at, last_inbound_at, last_outbound_at)
     VALUES (?, ?, 'soulink', 'active', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, NULL, NULL)
     ON CONFLICT(user_id, channel) DO UPDATE SET
       status = 'active',
       setup_token = excluded.setup_token,
       provider_connection_id = excluded.provider_connection_id,
       provider_user_id = excluded.provider_user_id,
       provider_thread_id = excluded.provider_thread_id,
       provider_username = excluded.provider_username,
       provider_metadata_json = excluded.provider_metadata_json,
       connected_at = COALESCE(agent_channel_connections.connected_at, CURRENT_TIMESTAMP),
       disconnected_at = NULL,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      connectionId,
      ownerId,
      setupToken,
      input.streamChannelType,
      input.ownerNodeId,
      input.streamChannelId,
      input.assistantNodeId,
      metadata,
    )
    .run();

  const row = await getSoulinkConnection(env, ownerId);
  if (!row) throw new Error("Failed to create Soulink connection");
  return row;
}

async function getOwnerMe3Url(env: Env, ownerId: string, requestUrl: string): Promise<string | null> {
  const site = await env.DB.prepare(
    `SELECT username, custom_domain
     FROM sites
     WHERE user_id = ? AND site_role = 'profile'
     ORDER BY published_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(ownerId)
    .first<{ username: string; custom_domain: string | null }>();
  if (site?.custom_domain) return `https://${site.custom_domain}`;
  if (site?.username) return `${getCoreWebOrigin(env, requestUrl)}/${site.username}`;
  return getCoreWebOrigin(env, requestUrl);
}

function serializeTelegramConnection(row: DbAgentChannelConnection, botUsername: string | null) {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    botUsername,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    telegramFirstName: row.telegram_first_name,
    telegramLastName: row.telegram_last_name,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeTelegramEvent(row: DbAgentChannelEvent) {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    eventType: row.event_type,
    status: row.status,
    telegramMessageId: row.telegram_message_id,
    replyToMessageId: row.reply_to_message_id,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    textBody: row.text_body,
    rawJson: parseJsonRecord(row.raw_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function buildTelegramStatusPayload(
  env: Env,
  ownerId: string,
  requestUrl: string,
  currentConnection?: DbAgentChannelConnection | null,
) {
  const settings = await getTelegramSettings(env, ownerId);
  const botUsername = settings.botUsername;
  const connection =
    currentConnection === undefined
      ? await getTelegramConnection(env, ownerId)
      : currentConnection;
  const events = connection
    ? await env.DB.prepare(
        `SELECT id, connection_id, channel, direction, event_type, status,
                telegram_message_id, reply_to_message_id, telegram_user_id,
                telegram_chat_id, telegram_username, text_body, raw_json,
                error_message, created_at, updated_at
         FROM agent_channel_events
         WHERE connection_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
      )
        .bind(connection.id)
        .all<DbAgentChannelEvent>()
    : { results: [] };

  return {
    available: true,
    configured: Boolean(
      botUsername &&
        settings.botTokenConfigured &&
        settings.webhookSecretConfigured,
    ),
    encryptionConfigured: settings.encryptionConfigured,
    botUsername,
    botUsernameSource: settings.botUsernameSource,
    tokenConfigured: settings.botTokenConfigured,
    botTokenSource: settings.botTokenSource,
    botTokenHint: settings.botTokenHint,
    botTokenUpdatedAt: settings.botTokenUpdatedAt,
    webhookSecretConfigured: settings.webhookSecretConfigured,
    webhookSecretSource: settings.webhookSecretSource,
    webhookSecretHint: settings.webhookSecretHint,
    webhookSecretUpdatedAt: settings.webhookSecretUpdatedAt,
    webhookUrl: `${getCoreApiOrigin(env, requestUrl)}/api/telegram/webhook`,
    startUrl:
      connection?.status === "pending" && botUsername
        ? `https://t.me/${botUsername.replace(/^@/, "")}?start=${encodeURIComponent(connection.setup_token)}`
        : null,
    connection: connection ? serializeTelegramConnection(connection, botUsername) : null,
    recentEvents: (events.results || []).map(serializeTelegramEvent),
  };
}

function clampNumber(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function getTelegramConnection(env: Env, ownerId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token, telegram_user_id, telegram_chat_id,
            telegram_username, telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at, updated_at
     FROM agent_channel_connections
     WHERE user_id = ? AND channel = 'telegram'`,
  )
    .bind(ownerId)
    .first<DbAgentChannelConnection>();
}

async function upsertPendingTelegramConnection(env: Env, ownerId: string) {
  const existing = await getTelegramConnection(env, ownerId);
  const connectionId = existing?.id || crypto.randomUUID();
  const setupToken = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO agent_channel_connections
     (id, user_id, channel, status, setup_token, telegram_user_id,
      telegram_chat_id, telegram_username, telegram_first_name,
      telegram_last_name, connected_at, disconnected_at, last_inbound_at,
      last_outbound_at)
     VALUES (?, ?, 'telegram', 'pending', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
     ON CONFLICT(user_id, channel) DO UPDATE SET
       status = 'pending',
       setup_token = excluded.setup_token,
       telegram_user_id = NULL,
       telegram_chat_id = NULL,
       telegram_username = NULL,
       telegram_first_name = NULL,
       telegram_last_name = NULL,
       connected_at = NULL,
       disconnected_at = NULL,
       last_inbound_at = NULL,
       last_outbound_at = NULL,
       updated_at = datetime('now')`,
  )
    .bind(connectionId, ownerId, setupToken)
    .run();

  const row = await getTelegramConnection(env, ownerId);
  if (!row) throw new Error("Failed to create Telegram connection");
  return row;
}

async function handleTelegramWebhookUpdate(
  env: Env,
  update: TelegramWebhookUpdate,
): Promise<{ ok: boolean; status: number; action: string; error?: string }> {
  const message = update.message;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const chatId = telegramIdToString(message?.chat?.id);
  const telegramUserId = telegramIdToString(message?.from?.id);

  if (!message || !chatId || !telegramUserId || !text) {
    return { ok: true, status: 200, action: "skipped" };
  }

  const startToken = parseTelegramStartToken(text);
  if (startToken) {
    const linked = await activateTelegramConnectionFromStartToken(env, update, startToken);
    const botToken = linked
      ? await resolveTelegramBotToken(env, linked.user_id)
      : await resolveTelegramBotTokenForInstall(env);
    if (!botToken) {
      return {
        ok: false,
        status: 503,
        action: "missing_bot_token",
        error: "Telegram bot token is not configured",
      };
    }
    const replyText = linked
      ? "Telegram is connected to your ME3 agent. Send a message here whenever you want to talk to it."
      : "I couldn't link this chat. Open Account -> Telegram in ME3 and generate a fresh setup link.";
    await sendTelegramMessage(botToken, chatId, replyText, message.message_id);
    return { ok: true, status: 200, action: linked ? "linked" : "link_failed" };
  }

  const connection = await getActiveTelegramConnectionForChat(env, chatId);
  const botToken = connection
    ? await resolveTelegramBotToken(env, connection.user_id)
    : await resolveTelegramBotTokenForInstall(env);
  if (!botToken) {
    return {
      ok: false,
      status: 503,
      action: "missing_bot_token",
      error: "Telegram bot token is not configured",
    };
  }
  if (!connection) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "Open Account -> Telegram in ME3 and use the setup link before chatting with this bot.",
      message.message_id,
    );
    return { ok: true, status: 200, action: "unlinked_chat" };
  }

  const turnId = crypto.randomUUID();
  const sourceEventId = await insertTelegramChannelEvent(env, {
    connectionId: connection.id,
    direction: "inbound",
    eventType: "message",
    status: "received",
    message,
    textBody: text,
    rawJson: update,
    errorMessage: null,
  });

  await env.DB.prepare(
    `UPDATE agent_channel_connections
     SET last_inbound_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(connection.id)
    .run();

  const response = await dispatchTelegramAgentTurn(env, {
    userId: connection.user_id,
    connectionId: connection.id,
    sourceEventId,
    turnId,
    messageText: text,
    replyToMessageId: message.message_id,
  });

  if (!response.ok) {
    const fallback = response.error || "ME3 agent runtime is not available right now.";
    await sendTelegramMessage(botToken, chatId, fallback, message.message_id);
    await insertTelegramChannelEvent(env, {
      connectionId: connection.id,
      direction: "outbound",
      eventType: "error",
      status: "failed",
      message,
      textBody: fallback,
      rawJson: response,
      errorMessage: response.error || "Agent dispatch failed",
    });
    return { ok: true, status: 200, action: "agent_failed" };
  }

  if (response.replyText) {
    await sendTelegramMessage(botToken, chatId, response.replyText, message.message_id, {
      formatMarkdown: true,
    });
    await insertTelegramChannelEvent(env, {
      connectionId: connection.id,
      direction: "outbound",
      eventType: "send",
      status: "sent",
      message,
      textBody: response.replyText,
      rawJson: response,
      errorMessage: null,
    });
    await env.DB.prepare(
      `UPDATE agent_channel_connections
       SET last_outbound_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(connection.id)
      .run();
  }

  return { ok: true, status: 200, action: "agent_reply" };
}

async function dispatchTelegramAgentTurn(
  env: Env,
  input: {
    userId: string;
    connectionId: string;
    sourceEventId: string;
    turnId: string;
    messageText: string;
    replyToMessageId: unknown;
  },
): Promise<AgentSandboxDispatchResponse> {
  return dispatchAgentChannelTurn(env, input);
}

async function activateTelegramConnectionFromStartToken(
  env: Env,
  update: TelegramWebhookUpdate,
  setupToken: string,
) {
  const message = update.message;
  const connection = await getTelegramConnectionBySetupToken(env, setupToken);
  if (!connection || connection.status !== "pending") return null;

  await env.DB.prepare(
    `UPDATE agent_channel_connections
     SET status = 'active',
         telegram_user_id = ?,
         telegram_chat_id = ?,
         telegram_username = ?,
         telegram_first_name = ?,
         telegram_last_name = ?,
         connected_at = CURRENT_TIMESTAMP,
         disconnected_at = NULL,
         last_inbound_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND channel = 'telegram'`,
  )
    .bind(
      telegramIdToString(message?.from?.id),
      telegramIdToString(message?.chat?.id),
      stringOrNull(message?.from?.username),
      stringOrNull(message?.from?.first_name),
      stringOrNull(message?.from?.last_name),
      connection.id,
    )
    .run();

  await insertTelegramChannelEvent(env, {
    connectionId: connection.id,
    direction: "inbound",
    eventType: "start",
    status: "linked",
    message,
    textBody: typeof message?.text === "string" ? message.text : null,
    rawJson: update,
    errorMessage: null,
  });

  return connection;
}

async function getTelegramConnectionBySetupToken(env: Env, setupToken: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token, telegram_user_id, telegram_chat_id,
            telegram_username, telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at, updated_at
     FROM agent_channel_connections
     WHERE setup_token = ? AND channel = 'telegram'`,
  )
    .bind(setupToken)
    .first<DbAgentChannelConnection>();
}

async function getActiveTelegramConnectionForChat(env: Env, chatId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token, telegram_user_id, telegram_chat_id,
            telegram_username, telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at, updated_at
     FROM agent_channel_connections
     WHERE telegram_chat_id = ? AND channel = 'telegram' AND status = 'active'`,
  )
    .bind(chatId)
    .first<DbAgentChannelConnection>();
}

async function insertTelegramChannelEvent(
  env: Env,
  input: {
    connectionId: string;
    direction: "inbound" | "outbound" | "system";
    eventType: "start" | "message" | "link" | "send" | "error";
    status: "received" | "pending" | "sent" | "failed" | "linked" | "skipped";
    message: TelegramMessage | undefined;
    textBody: string | null;
    rawJson: unknown;
    errorMessage: string | null;
  },
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_channel_events
       (id, connection_id, channel, direction, event_type, status,
        telegram_message_id, reply_to_message_id, telegram_user_id,
        telegram_chat_id, telegram_username, text_body, raw_json,
        error_message, created_at, updated_at)
     VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      id,
      input.connectionId,
      input.direction,
      input.eventType,
      input.status,
      telegramIdToString(input.message?.message_id),
      telegramIdToString(input.message?.reply_to_message?.message_id),
      telegramIdToString(input.message?.from?.id),
      telegramIdToString(input.message?.chat?.id),
      stringOrNull(input.message?.from?.username),
      input.textBody,
      JSON.stringify(input.rawJson),
      input.errorMessage,
    )
    .run();
  return id;
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyToMessageId?: unknown,
  options: { formatMarkdown?: boolean } = {},
) {
  const truncatedText = truncateTelegramMessage(text);
  const formatted = options.formatMarkdown
    ? formatTelegramMarkdownAsHtml(truncatedText)
    : { text: truncatedText, parseMode: null };
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: formatted.text,
  };
  if (formatted.parseMode) body.parse_mode = formatted.parseMode;
  if (typeof replyToMessageId === "string" || typeof replyToMessageId === "number") {
    body.reply_to_message_id = replyToMessageId;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let response = await postTelegramMessage(url, body);
  if (!response.ok && formatted.parseMode && response.status === 400) {
    body.text = truncatedText;
    delete body.parse_mode;
    response = await postTelegramMessage(url, body);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { description?: string }
      | null;
    throw new Error(payload?.description || `Telegram sendMessage failed (${response.status})`);
  }
}

function postTelegramMessage(url: string, body: Record<string, unknown>) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function parseTelegramStartToken(text: string) {
  const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/);
  return match?.[1]?.trim() || null;
}

function telegramIdToString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateTelegramMessage(value: string) {
  return value.length > 4000 ? `${value.slice(0, 3997)}...` : value;
}

function formatTelegramMarkdownAsHtml(markdown: string): {
  text: string;
  parseMode: "HTML";
} {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let codeFence: string[] | null = null;
  let quoteLines: string[] = [];

  function flushQuote() {
    if (!quoteLines.length) return;
    output.push(
      `<blockquote>${quoteLines.map((line) => formatTelegramInlineMarkdown(line)).join("\n")}</blockquote>`,
    );
    quoteLines = [];
  }

  for (const line of lines) {
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      if (codeFence) {
        output.push(`<pre>${escapeTelegramHtml(codeFence.join("\n"))}</pre>`);
        codeFence = null;
      } else {
        flushQuote();
        codeFence = [];
      }
      continue;
    }

    if (codeFence) {
      codeFence.push(line);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      quoteLines.push(quoteMatch[1] || "");
      continue;
    }

    flushQuote();

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      output.push(`<b>${formatTelegramInlineMarkdown(headingMatch[2] || "")}</b>`);
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      output.push(
        `${escapeTelegramHtml(bulletMatch[1] || "")}• ${formatTelegramInlineMarkdown(
          bulletMatch[2] || "",
        )}`,
      );
      continue;
    }

    output.push(formatTelegramInlineMarkdown(line));
  }

  if (codeFence) {
    output.push(`<pre>${escapeTelegramHtml(codeFence.join("\n"))}</pre>`);
  }
  flushQuote();

  return { text: output.join("\n"), parseMode: "HTML" };
}

function formatTelegramInlineMarkdown(value: string): string {
  let output = "";
  let cursor = 0;
  const tokenPattern =
    /(`([^`\n]+)`)|(\*\*([^*\n]+)\*\*)|(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))/g;
  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    output += escapeTelegramHtml(value.slice(cursor, index));
    if (match[2] !== undefined) {
      output += `<code>${escapeTelegramHtml(match[2])}</code>`;
    } else if (match[4] !== undefined) {
      output += `<b>${escapeTelegramHtml(match[4])}</b>`;
    } else if (match[6] !== undefined && match[7] !== undefined) {
      output += `<a href="${escapeTelegramHtmlAttribute(match[7])}">${escapeTelegramHtml(
        match[6],
      )}</a>`;
    }
    cursor = index + match[0].length;
  }
  output += escapeTelegramHtml(value.slice(cursor));
  return output;
}

function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramHtmlAttribute(value: string) {
  return escapeTelegramHtml(value).replace(/"/g, "&quot;");
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}
