import {
  laterInteractionTimestamp,
  listAgentContacts,
  upsertAgentContact,
} from "@me3-core/plugin-agent-chat";
import {
  insertProviderChannelEventOnce,
} from "../agent-channels";
import type { AppContext, AppHono } from "../http/types";
import {
  getCoreApiOrigin,
  getCoreWebOrigin,
  getOwnerProfile,
  normalizeEmail,
  normalizeShortText,
  originFromUrl,
} from "../sites";
import type { DbAgentChannelConnection, DbAgentChannelEvent, DbContact, Env } from "../types";
import { hashGuestToken } from "../booking-meetings";
import { getOrCreateInstallSessionSecret } from "../install-secrets";
import { resolvePrimaryAssistantThread } from "../assistant-primary-thread";

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
  lastMessageAt?: unknown;
  lastCallAt?: unknown;
  label?: unknown;
};
export function registerChannelRoutes(app: AppHono, deps: ChannelRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.get("/api/soulink/status", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    return c.json(await buildSoulinkStatusPayload(c.env, ownerId, c.req.url));
  });

  app.post("/api/soulink/provision/verify", async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.proof !== "string" || typeof body.issuer !== "string" ||
        typeof body.subject !== "string" || typeof body.callbackUrl !== "string" ||
        typeof body.dispatchToken !== "string") return c.json({ authorized: false }, 400);
    const authorized = body.issuer === getCoreApiOrigin(c.env, c.req.url) &&
      await verifySoulinkProvisionProof(c.env, body as SoulinkProvisionProofInput & { proof: string });
    return c.json({ authorized });
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
    const issuer = getCoreApiOrigin(c.env, c.req.url);
    const callbackUrl = `${issuer}/api/agent/channels/soulink/dispatch`;
    const proof = await createSoulinkProvisionProof(c.env, { issuer, subject: owner.id, callbackUrl, dispatchToken });
    const response = await fetch(`${config.apiOrigin}/api/me3/assistant-channel/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        issuer,
        subject: owner.id,
        proof,
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
    await resolvePrimaryAssistantThread(c.env, ownerId);

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

  // People "Invite a friend": the owner's Soulink personal invite link.
  app.get("/api/soulink/invite-link", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await getSoulinkPersonalInviteLink(c.env, ownerId);
    if (!result.ok) return c.json(result, result.status as any);
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

  app.get("/api/soulink/bookings/upcoming", async (c) => {
    const connection = await authorizedSoulinkBookingConnection(c.env, c.req.header("authorization"));
    if (!connection) return c.json({ error: "Unauthorized" }, 401);
    const { results } = await c.env.DB.prepare(
      `SELECT b.id, b.meeting_title, b.guest_name, b.starts_at, b.ends_at
       FROM bookings b JOIN sites s ON s.id = b.site_id
       WHERE s.user_id = ? AND b.status = 'confirmed' AND b.meeting_provider = 'soulink'
         AND COALESCE(b.payment_status, '') <> 'pending'
         AND b.ends_at > datetime('now') AND b.starts_at < datetime('now', '+90 days')
       ORDER BY b.starts_at LIMIT 50`,
    ).bind(connection.user_id).all<{ id: string; meeting_title: string | null; guest_name: string; starts_at: string; ends_at: string }>();
    return c.json({ bookings: results.map((row) => ({
      id: row.id, title: row.meeting_title || "Booking", guestName: row.guest_name,
      startsAt: row.starts_at, endsAt: row.ends_at,
    })) });
  });

  app.post("/api/soulink/bookings/:id/guest", async (c) => {
    const connection = await authorizedSoulinkBookingConnection(c.env, c.req.header("authorization"));
    if (!connection) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json<{ token?: unknown }>().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token || token.length > 2048) return c.json({ error: "Invalid invitation" }, 400);
    const booking = await c.env.DB.prepare(
      `SELECT b.id, b.guest_name, b.starts_at, b.ends_at, b.status, b.meeting_provider,
              b.meeting_guest_token_hash, b.meeting_title, s.username
       FROM bookings b JOIN sites s ON s.id = b.site_id
       WHERE b.id = ? AND s.user_id = ?`,
    ).bind(c.req.param("id"), connection.user_id).first<{
      id: string; guest_name: string; starts_at: string; ends_at: string;
      status: string; meeting_provider: string | null; meeting_guest_token_hash: string | null;
      meeting_title: string | null; username: string;
    }>();
    if (!booking || booking.status !== "confirmed" || booking.meeting_provider !== "soulink" ||
        !booking.meeting_guest_token_hash ||
        !constantTimeEqual(booking.meeting_guest_token_hash, await hashGuestToken(token))) {
      return c.json({ error: "This booking link is no longer valid" }, 403);
    }
    const now = Date.now();
    const opensAt = Date.parse(booking.starts_at) - 15 * 60_000;
    // The window follows the booking's current time, so a moved booking's existing link opens at its new time.
    if (now < opensAt) {
      return c.json({ error: "This call opens 15 minutes before it starts", code: "booking_not_open",
        startsAt: booking.starts_at, opensAt: new Date(opensAt).toISOString() }, 403);
    }
    if (now > Date.parse(booking.ends_at) + 30 * 60_000) {
      return c.json({ error: "This booking call has ended", code: "booking_ended", startsAt: booking.starts_at }, 403);
    }
    return c.json({ booking: {
      id: booking.id, title: booking.meeting_title || "Booking", guestName: booking.guest_name,
      hostName: booking.username, startsAt: booking.starts_at, endsAt: booking.ends_at,
    } });
  });
}

type SoulinkProvisionProofInput = { issuer: string; subject: string; callbackUrl: string; dispatchToken: string };

export async function createSoulinkProvisionProof(env: Env, input: SoulinkProvisionProofInput): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const signature = await soulinkProvisionSignature(env, input, expiresAt);
  return `${expiresAt}.${signature}`;
}

export async function verifySoulinkProvisionProof(env: Env, input: SoulinkProvisionProofInput & { proof: string }): Promise<boolean> {
  const [expiry, signature, extra] = input.proof.split(".");
  const expiresAt = Number(expiry);
  if (extra !== undefined || !/^\d{10}$/.test(expiry || "") || !/^[a-f0-9]{64}$/.test(signature || "") ||
      expiresAt < Math.floor(Date.now() / 1000) || expiresAt > Math.floor(Date.now() / 1000) + 300) return false;
  return constantTimeEqual(signature, await soulinkProvisionSignature(env, input, expiresAt));
}

async function soulinkProvisionSignature(env: Env, input: SoulinkProvisionProofInput, expiresAt: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await getOrCreateInstallSessionSecret(env)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = JSON.stringify(["soulink-provision-v1", input.issuer, input.subject, input.callbackUrl, input.dispatchToken, expiresAt]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function authorizedSoulinkBookingConnection(env: Env, authorization: string | undefined) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token) return null;
  const connection = await getActiveSoulinkConnectionByDispatchToken(env, token);
  return connection && constantTimeEqual(connection.setup_token, token) ? connection : null;
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

// Soulink issues one personal invite per person; when a friend joins with it
// they are Linked and show up in People with the Soulink badge.
export async function getSoulinkPersonalInviteLink(env: Env, ownerId: string) {
  const config = getSoulinkConnectorConfig(env);
  const connection = await getSoulinkConnection(env, ownerId);
  if (!config.configured || !connection || connection.status !== "active") {
    return { ok: false as const, status: 409, error: "Connect Soulink to invite friends" };
  }

  const metadata = parseJsonRecord(connection.provider_metadata_json);
  const ownerNodeId = stringValue(metadata.ownerNodeId) || stringValue(connection.provider_user_id);
  const url = new URL("/api/me3/personal-invite", config.apiOrigin);
  if (ownerNodeId) url.searchParams.set("ownerNodeId", ownerNodeId);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${connection.setup_token}` },
  }).catch(() => null);
  const payload = (await response?.json().catch(() => null)) as { url?: unknown } | null;
  const inviteUrl = stringValue(payload?.url);
  if (response?.ok && inviteUrl && /^https:\/\//.test(inviteUrl)) {
    return { ok: true as const, url: inviteUrl };
  }
  if (response && [401, 403].includes(response.status)) {
    return { ok: false as const, status: 409, error: "Connect Soulink to invite friends" };
  }
  if (response?.status === 404) {
    return { ok: false as const, status: 501, error: "This Soulink connector can't share invite links yet" };
  }
  return { ok: false as const, status: 502, error: "Soulink couldn't create an invite link" };
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
  // Message and call times are metadata only; Soulink never sends content here.
  const lastActiveAt =
    laterInteractionTimestamp(
      stringValue(context?.lastActiveAt),
      stringValue(context?.lastMessageAt),
      stringValue(context?.lastCallAt),
    ) ||
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
