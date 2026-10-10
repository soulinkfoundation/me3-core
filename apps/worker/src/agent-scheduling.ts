import { sameSchedulingRequest, schedulingRequestPrecondition, schedulingRequestValues } from "./scheduling-preconditions";
import type {
  CoreSchedulingOption,
  CoreSchedulingToolServices,
} from "./agent-chat";
import { formatUtcInstantInTimeZone } from "./booking";
import { resolvePrimaryAssistantThread } from "./assistant-primary-thread";
import { addDaysToDateString, resolveTimeZone } from "./calendar";
import {
  approveSchedulingRequest,
  finalizeSchedulingRequest,
  generateSchedulingCandidateSlots,
  getSchedulingRequest,
  listSchedulingTimeTypes,
  normalizeCandidateLimit,
  parseSchedulingDateRange,
  resolveSchedulingPolicy,
  type SchedulingRequestSlot,
  type SchedulingTimeType,
} from "./scheduling";
import type {
  DbAgentChannelConnection,
  DbContact,
  DbSchedulingRequest,
  Env,
} from "./types";
import { ensureSoulinkContactsFresh } from "./routes/channels";
import { authorizePublicProfileSchedulingTarget } from "./network-directory";

const DEFAULT_SOULINK_API_ORIGIN = "https://soulinkfoundation.org";
const AGENT_SCHEDULING_PROTOCOL_VERSION = "2026-08-24";
const NETWORK_SCHEDULING_PROTOCOL_VERSION = "2026-08-25";
const LEGACY_AGENT_SCHEDULING_PROTOCOL_VERSION = "2026-08-19";
const AGENT_SCHEDULING_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_RELAY_CANDIDATES = 180;
const MAX_PRESENTED_OPTIONS = 3;

type AgentSchedulingRole = "requester" | "target";
type AgentSchedulingRelayKind =
  | "schedule.request"
  | "schedule.options"
  | "schedule.selection"
  | "schedule.approval"
  | "schedule.decline";

export type AgentSchedulingRelayMessage = {
  version:
    | typeof AGENT_SCHEDULING_PROTOCOL_VERSION
    | typeof NETWORK_SCHEDULING_PROTOCOL_VERSION
    | typeof LEGACY_AGENT_SCHEDULING_PROTOCOL_VERSION;
  kind: AgentSchedulingRelayKind;
  requestId: string;
  sourceNodeId: string;
  sourceName: string;
  targetNodeId: string;
  durationMinutes: number;
  dateRange: { start: string; end: string };
  reason: string | null;
  candidateSlots: SchedulingRequestSlot[];
  selectedSlot: SchedulingRequestSlot | null;
  meetingUrl: string | null;
  target?: { kind: "public_profile"; id: string };
  request?: {
    kind: "meeting";
    participantMode: "one_to_one";
    paymentMode: "free";
  };
  access?: {
    path: "public_profile";
    profileId: string;
    authorization?: string;
    grantId?: string;
  };
  issuedAt: string;
  expiresAt: string;
};

export type AgentSchedulingNotification = {
  version: 1;
  requestId: string;
  phase: "offer" | "choose" | "waiting" | "confirmed" | "declined";
  peerName: string;
  timezone: string;
  options: CoreSchedulingOption[];
  actions: Array<"offer" | "select" | "decline">;
  expiresAt: string;
};

export type AgentSchedulingOwnerAction = {
  requestId: string;
  action: "offer" | "select" | "decline";
  option?: number;
  selectedOptions?: number[];
  reason?: string;
};

type SchedulingPeerPolicy = {
  protocolVersion: string;
  role: AgentSchedulingRole;
  peerNodeId: string;
  durationMinutes: number;
  expiresAt: string;
  meetingUrl: string | null;
  target?: { kind: "public_profile"; id: string };
  request?: {
    kind: "meeting";
    participantMode: "one_to_one";
    paymentMode: "free";
  };
  access?: {
    path: "public_profile";
    profileId: string;
    grantId: string;
  };
};

type SchedulingRequestWithContact = DbSchedulingRequest & {
  contact_name: string | null;
};

export function createAgentSchedulingToolServices(
  env: Env,
  ownerId: string,
): CoreSchedulingToolServices {
  return {
    availability: async (input) => {
      const range = parseSchedulingDateRange({ start: input.dateFrom, end: input.dateTo });
      if ("error" in range) throw new Error(range.error);
      const types = await listSchedulingTimeTypes(env, ownerId);
      const timeType = types.find((item) => input.timeTypeId
        ? item.id === input.timeTypeId
        : input.durationMinutes
          ? item.durationMinutes === input.durationMinutes
          : true);
      if (!timeType) throw new Error("No matching booking time type is configured.");
      const slots = await generateSchedulingCandidateSlots(env, ownerId, {
        timeType,
        dateRange: range,
        limit: normalizeCandidateLimit(input.limit),
      });
      return { timeTypeName: timeType.title, timezone: timeType.timezone, slots };
    },
    searchContacts: async (input) => {
      await ensureSoulinkContactsFresh(env, ownerId);
      return searchAgentSchedulingContacts(env, ownerId, input);
    },
    request: (input, idempotencyKey) =>
      requestAgentScheduling(env, ownerId, input, idempotencyKey),
    requestNetwork: (input, idempotencyKey) =>
      requestNetworkAgentScheduling(env, ownerId, input, idempotencyKey),
    approve: (input, idempotencyKey) =>
      approveAgentScheduling(env, ownerId, input, idempotencyKey),
    decline: (input, idempotencyKey) =>
      declineAgentScheduling(env, ownerId, input, idempotencyKey),
  };
}

export function resolveAgentSchedulingDefaults(
  input: {
    durationMinutes?: number;
    dateFrom?: string;
    dateTo?: string;
  },
  timezoneInput: string | null | undefined,
  now = new Date(),
) {
  const timezone = resolveTimeZone(timezoneInput);
  const today = localDateForInstant(now, timezone);
  const usedDefaultDuration = input.durationMinutes === undefined;
  const durationMinutes = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 180
  ) {
    throw new Error("Meeting duration must be a whole number from 15 to 180 minutes.");
  }

  const usedDefaultDateRange = !input.dateFrom || !input.dateTo;
  const start = input.dateFrom || today;
  const end = input.dateTo || addDaysToDateString(start, DEFAULT_WINDOW_DAYS - 1);
  const dateRange = parseSchedulingDateRange({ start, end });
  if ("error" in dateRange) throw new Error(dateRange.error);

  return {
    durationMinutes,
    dateRange,
    usedDefaultDuration,
    usedDefaultDateRange,
  };
}

export function intersectAgentSchedulingSlots(
  proposed: readonly SchedulingRequestSlot[],
  available: readonly SchedulingRequestSlot[],
  limit = 5,
): SchedulingRequestSlot[] {
  const availableKeys = new Set(
    available.map((slot) => `${slot.startsAt}\n${slot.endsAt}`),
  );
  return proposed
    .filter((slot) => availableKeys.has(`${slot.startsAt}\n${slot.endsAt}`))
    .slice(0, Math.max(0, limit));
}

export function isAgentSchedulingSlotAuthorized(
  selected: SchedulingRequestSlot,
  authorized: readonly SchedulingRequestSlot[],
) {
  return authorized.some(
    (slot) => slot.startsAt === selected.startsAt && slot.endsAt === selected.endsAt,
  );
}

export function parseAgentSchedulingRelayMessage(
  value: unknown,
): AgentSchedulingRelayMessage | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== AGENT_SCHEDULING_PROTOCOL_VERSION &&
    value.version !== NETWORK_SCHEDULING_PROTOCOL_VERSION &&
    value.version !== LEGACY_AGENT_SCHEDULING_PROTOCOL_VERSION
  ) return null;
  if (
    value.kind !== "schedule.request" &&
    value.kind !== "schedule.options" &&
    value.kind !== "schedule.selection" &&
    value.kind !== "schedule.approval" &&
    value.kind !== "schedule.decline"
  ) {
    return null;
  }
  const requestId = shortText(value.requestId, 160);
  const sourceNodeId = shortText(value.sourceNodeId, 200);
  const sourceName = shortText(value.sourceName, 160);
  const targetNodeId = shortText(value.targetNodeId, 200);
  const durationMinutes = numericInteger(value.durationMinutes);
  const dateRange = parseSchedulingDateRange(value.dateRange);
  const candidateSlots = Array.isArray(value.candidateSlots)
    ? value.candidateSlots
      .slice(0, MAX_RELAY_CANDIDATES)
      .map(parseRelaySlot)
      .filter((slot): slot is SchedulingRequestSlot => Boolean(slot))
    : [];
  const selectedSlot = value.selectedSlot === null || value.selectedSlot === undefined
    ? null
    : parseRelaySlot(value.selectedSlot);
  const meetingUrl = parseHttpsUrl(value.meetingUrl);
  const networkProfileId = isRecord(value.target) && value.target.kind === "public_profile"
    ? shortText(value.target.id, 200)
    : "";
  const networkAccess = isRecord(value.access) &&
      value.access.path === "public_profile"
    ? {
        path: "public_profile" as const,
        profileId: shortText(value.access.profileId, 200),
        grantId: shortText(value.access.grantId, 200),
      }
    : null;
  const networkRequest = isRecord(value.request) &&
      value.request.kind === "meeting" &&
      value.request.participantMode === "one_to_one" &&
      value.request.paymentMode === "free"
    ? {
        kind: "meeting" as const,
        participantMode: "one_to_one" as const,
        paymentMode: "free" as const,
      }
    : null;
  const isNetworkRelay = value.version === NETWORK_SCHEDULING_PROTOCOL_VERSION;
  const now = new Date();
  const issuedAt = value.version === LEGACY_AGENT_SCHEDULING_PROTOCOL_VERSION
    ? now.toISOString()
    : parseIsoInstant(value.issuedAt);
  const expiresAt = value.version === LEGACY_AGENT_SCHEDULING_PROTOCOL_VERSION
    ? new Date(now.getTime() + AGENT_SCHEDULING_TTL_MS).toISOString()
    : parseIsoInstant(value.expiresAt);
  if (
    !requestId ||
    !sourceNodeId ||
    !sourceName ||
    !targetNodeId ||
    durationMinutes === null ||
    durationMinutes < 15 ||
    durationMinutes > 180 ||
    "error" in dateRange ||
    !issuedAt ||
    !expiresAt ||
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    (isNetworkRelay && (
      !networkProfileId ||
      !networkAccess?.grantId ||
      networkAccess.profileId !== networkProfileId ||
      !networkRequest ||
      (value.kind === "schedule.options" && candidateSlots.length > MAX_PRESENTED_OPTIONS)
    )) ||
    (value.kind === "schedule.request" && candidateSlots.length === 0) ||
    ((value.kind === "schedule.selection" || value.kind === "schedule.approval") && !selectedSlot)
  ) {
    return null;
  }
  return {
    version: value.version === NETWORK_SCHEDULING_PROTOCOL_VERSION
      ? NETWORK_SCHEDULING_PROTOCOL_VERSION
      : AGENT_SCHEDULING_PROTOCOL_VERSION,
    kind: value.kind,
    requestId,
    sourceNodeId,
    sourceName,
    targetNodeId,
    durationMinutes,
    dateRange,
    reason: shortText(value.reason, 500) || null,
    candidateSlots,
    selectedSlot,
    meetingUrl,
    ...(isNetworkRelay
      ? {
          target: { kind: "public_profile" as const, id: networkProfileId },
          request: networkRequest!,
          access: {
            path: "public_profile" as const,
            profileId: networkAccess!.profileId,
            grantId: networkAccess!.grantId,
          },
        }
      : {}),
    issuedAt,
    expiresAt,
  };
}

export async function getAgentSchedulingConnectionByDispatchToken(
  env: Env,
  token: string,
) {
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
    .bind(token)
    .first<DbAgentChannelConnection>();
}

export async function receiveAgentSchedulingRelay(
  env: Env,
  connection: DbAgentChannelConnection,
  message: AgentSchedulingRelayMessage,
): Promise<{
  status:
    | "options_ready"
    | "no_mutual_availability"
    | "waiting_for_target_review"
    | "waiting_for_owner"
    | "booked"
    | "declined";
  options?: CoreSchedulingOption[];
}> {
  const ownerNodeId = schedulingConnectionOwnerNodeId(connection);
  if (!ownerNodeId || ownerNodeId !== message.targetNodeId) {
    throw new AgentSchedulingError(
      "Scheduling relay target does not match this ME3 installation.",
      403,
    );
  }
  if (message.sourceNodeId === ownerNodeId) {
    throw new AgentSchedulingError("An assistant cannot schedule with itself.", 400);
  }
  if (Date.parse(message.expiresAt) <= Date.now()) {
    throw new AgentSchedulingError("This scheduling request expired.", 410);
  }

  if (message.kind === "schedule.request") {
    return receiveAgentSchedulingRequest(env, connection, message);
  }
  if (message.kind === "schedule.options") {
    return receiveAgentSchedulingOptions(env, connection, message);
  }
  if (message.kind === "schedule.selection") {
    return receiveAgentSchedulingSelection(env, connection, message);
  }
  if (message.kind === "schedule.approval") {
    return receiveAgentSchedulingApproval(env, connection, message);
  }
  return receiveAgentSchedulingDecline(env, connection, message);
}

export class AgentSchedulingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function searchAgentSchedulingContacts(
  env: Env,
  ownerId: string,
  input: { query?: string; limit?: number },
  includeStableIds = false,
) {
  const query = shortText(input.query, 160);
  const limit = clampInteger(input.limit, 1, 10, 5);
  const rows = query
    ? await env.DB.prepare(
      `SELECT id, user_id, name, email, phone, source, source_ref,
              relationship, status, notes, tags, last_interaction_at,
              next_followup_at, outreach_status, social_handles, metadata,
              created_at, updated_at
       FROM contacts
       WHERE user_id = ? AND status = 'active'
         AND (name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE)
       ORDER BY CASE WHEN lower(name) = lower(?) THEN 0 ELSE 1 END,
                updated_at DESC
       LIMIT ?`,
    )
      .bind(ownerId, `%${query}%`, `%${query}%`, query, limit)
      .all<DbContact>()
    : await env.DB.prepare(
      `SELECT id, user_id, name, email, phone, source, source_ref,
              relationship, status, notes, tags, last_interaction_at,
              next_followup_at, outreach_status, social_handles, metadata,
              created_at, updated_at
       FROM contacts
       WHERE user_id = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
      .bind(ownerId, limit)
      .all<DbContact>();
  const contacts = (rows.results || []).map((contact) => ({
    ...(includeStableIds ? { id: contact.id, updatedAt: contact.updated_at, peerNodeId: soulinkPeerNodeId(contact) } : {}),
    name: contact.name,
    relationship: contact.relationship,
    me3AssistantAvailable: Boolean(soulinkPeerNodeId(contact)),
  }));
  return { contacts, total: contacts.length };
}

export async function requestAgentScheduling(
  env: Env,
  ownerId: string,
  input: {
    contact: string;
    contactId?: string;
    expectedContact?: { id: string; name: string; updatedAt?: unknown; peerNodeId?: unknown };
    durationMinutes?: number;
    dateFrom?: string;
    dateTo?: string;
    reason?: string;
  },
  idempotencyKey: string,
) {
  await ensureSoulinkContactsFresh(env, ownerId);
  const contact = input.contactId
    ? await env.DB.prepare("SELECT * FROM contacts WHERE id = ? AND user_id = ? AND status = 'active'").bind(input.contactId, ownerId).first<DbContact>()
    : await resolveAgentSchedulingContact(env, ownerId, input.contact);
  if (!contact) throw new AgentSchedulingError("Scheduling contact not found.", 404);
  if (input.expectedContact && (contact.id !== input.expectedContact.id || contact.name !== input.expectedContact.name || contact.updated_at !== input.expectedContact.updatedAt || soulinkPeerNodeId(contact) !== input.expectedContact.peerNodeId)) {
    throw new AgentSchedulingError("Scheduling contact changed since it was read.", 409);
  }
  const targetNodeId = soulinkPeerNodeId(contact);
  if (!targetNodeId) {
    throw new AgentSchedulingError(
      `${contact.name} does not have a connected ME3 assistant in the synced Soulink contact.`,
      409,
    );
  }
  const owner = await getSchedulingOwner(env, ownerId);
  const defaults = resolveAgentSchedulingDefaults(input, owner.timezone);
  const timeType = await schedulingTimeTypeForDuration(
    env,
    ownerId,
    defaults.durationMinutes,
  );
  const localPolicy = await resolveSchedulingPolicy(env, ownerId, {
    contactId: contact.id,
    timeTypeId: timeType.id,
  });
  if ("error" in localPolicy) {
    throw new AgentSchedulingError(localPolicy.error, localPolicy.status);
  }
  if (!localPolicy.allowed) {
    throw new AgentSchedulingError(localPolicy.reason, 403);
  }
  const proposedSlots = await generateSchedulingCandidateSlots(env, ownerId, {
    timeType,
    dateRange: defaults.dateRange,
    limit: MAX_RELAY_CANDIDATES,
  });
  if (proposedSlots.length === 0) {
    return {
      contactName: contact.name,
      durationMinutes: defaults.durationMinutes,
      dateRange: defaults.dateRange,
      usedDefaultDuration: defaults.usedDefaultDuration,
      usedDefaultDateRange: defaults.usedDefaultDateRange,
      status: "no_owner_availability" as const,
      options: [],
    };
  }

  const connection = await getOwnerSchedulingConnection(env, ownerId);
  if (!connection) {
    throw new AgentSchedulingError("Connect Soulink before asking another ME3 assistant.", 409);
  }
  const sourceNodeId = schedulingConnectionOwnerNodeId(connection);
  if (!sourceNodeId) {
    throw new AgentSchedulingError("The Soulink connection is missing its owner identity.", 409);
  }
  const requestId = idempotencyKey;
  const reason = shortText(input.reason, 500) || null;
  const envelopeTimes = schedulingEnvelopeTimes();
  await upsertPeerSchedulingRequest(env, {
    requestId,
    ownerId,
    contact,
    timeType,
    role: "requester",
    peerNodeId: targetNodeId,
    requesterName: owner.name || "ME3 owner",
    targetName: contact.name,
    reason,
    dateRange: defaults.dateRange,
    candidateSlots: [],
    proposedSlots,
    selectedSlot: null,
    status: "draft",
    expiresAt: envelopeTimes.expiresAt,
    meetingUrl: null,
  });

  const message: AgentSchedulingRelayMessage = {
    version: AGENT_SCHEDULING_PROTOCOL_VERSION,
    kind: "schedule.request",
    requestId,
    sourceNodeId,
    sourceName: owner.name || "ME3 owner",
    targetNodeId,
    durationMinutes: defaults.durationMinutes,
    dateRange: defaults.dateRange,
    reason,
    candidateSlots: proposedSlots,
    selectedSlot: null,
    meetingUrl: null,
    ...envelopeTimes,
  };
  const relayed = await relayAgentSchedulingMessage(env, connection, message);
  const relayStatus = shortText(relayed.status, 80);
  if (relayStatus === "pending_target" || relayStatus === "waiting_for_target_review") {
    return {
      contactName: contact.name,
      durationMinutes: defaults.durationMinutes,
      dateRange: defaults.dateRange,
      usedDefaultDuration: defaults.usedDefaultDuration,
      usedDefaultDateRange: defaults.usedDefaultDateRange,
      status: relayStatus === "pending_target"
        ? "pending_target" as const
        : "waiting_for_target_review" as const,
      options: [],
    };
  }
  const slots = parseRelayOptions(relayed.options);
  await upsertPeerSchedulingRequest(env, {
    requestId,
    ownerId,
    contact,
    timeType,
    role: "requester",
    peerNodeId: targetNodeId,
    requesterName: owner.name || "ME3 owner",
    targetName: contact.name,
    reason,
    dateRange: defaults.dateRange,
    candidateSlots: slots,
    proposedSlots: [],
    selectedSlot: null,
    status: "candidates_shared",
    expiresAt: envelopeTimes.expiresAt,
    meetingUrl: null,
  });
  await recordSchedulingAudit(env, requestId, ownerId, "candidates_shared", "assistant",
    `Received ${slots.length} mutual candidate slots from ${contact.name}'s ME3 assistant`,
    { peerNodeId: targetNodeId, durationMinutes: defaults.durationMinutes });
  if (slots.length > 0) {
    const storedRequest = await getSchedulingRequest(env, ownerId, requestId);
    if (storedRequest) {
      await notifySchedulingOwner(
        env,
        connection,
        `${contact.name} is available at these times. Choose one and I’ll add it to both calendars.`,
        `scheduling:${requestId}:options`,
        schedulingNotification(
          storedRequest,
          requireOpenPeerPolicy(storedRequest),
          owner.timezone,
          contact.name,
          "choose",
          slots,
          ["select", "decline"],
        ),
      );
    }
  }

  return {
    contactName: contact.name,
    durationMinutes: defaults.durationMinutes,
    dateRange: defaults.dateRange,
    usedDefaultDuration: defaults.usedDefaultDuration,
    usedDefaultDateRange: defaults.usedDefaultDateRange,
    status: slots.length > 0
      ? "options_ready" as const
      : "no_mutual_availability" as const,
    options: schedulingOptions(slots, owner.timezone),
  };
}

export async function requestNetworkAgentScheduling(
  env: Env,
  ownerId: string,
  input: {
    target: { kind: "public_profile"; profileId: string };
    request: {
      kind: "meeting";
      participantMode: "one_to_one";
      paymentMode: "free";
    };
    durationMinutes?: number;
    dateFrom?: string;
    dateTo?: string;
    reason?: string;
  },
  idempotencyKey: string,
) {
  const profileId = shortText(input.target.profileId, 200);
  if (
    input.target.kind !== "public_profile" ||
    !profileId ||
    input.request.kind !== "meeting" ||
    input.request.participantMode !== "one_to_one" ||
    input.request.paymentMode !== "free"
  ) {
    throw new AgentSchedulingError(
      "Network scheduling requires one exact free one-to-one public profile target.",
      400,
    );
  }
  const owner = await getSchedulingOwner(env, ownerId);
  const defaults = resolveAgentSchedulingDefaults(input, owner.timezone);
  const timeType = await schedulingTimeTypeForDuration(
    env,
    ownerId,
    defaults.durationMinutes,
  );
  const proposedSlots = await generateSchedulingCandidateSlots(env, ownerId, {
    timeType,
    dateRange: defaults.dateRange,
    limit: MAX_RELAY_CANDIDATES,
  });
  if (proposedSlots.length === 0) {
    return {
      contactName: "the selected public Soulink profile",
      durationMinutes: defaults.durationMinutes,
      dateRange: defaults.dateRange,
      usedDefaultDuration: defaults.usedDefaultDuration,
      usedDefaultDateRange: defaults.usedDefaultDateRange,
      status: "no_owner_availability" as const,
      options: [],
    };
  }

  const connection = await getOwnerSchedulingConnection(env, ownerId);
  if (!connection) {
    throw new AgentSchedulingError("Connect Soulink before requesting a network meeting.", 409);
  }
  const sourceNodeId = schedulingConnectionOwnerNodeId(connection);
  if (!sourceNodeId) {
    throw new AgentSchedulingError("The Soulink connection is missing its owner identity.", 409);
  }
  const authorized = await authorizePublicProfileSchedulingTarget(
    env,
    profileId,
    idempotencyKey,
  );
  const reason = shortText(input.reason, 500) || null;
  const envelopeTimes = schedulingEnvelopeTimes(authorized.expiresAt);
  const relayed = await relayAgentSchedulingMessage(env, connection, {
    version: NETWORK_SCHEDULING_PROTOCOL_VERSION,
    kind: "schedule.request",
    requestId: idempotencyKey,
    sourceNodeId,
    sourceName: owner.name || "ME3 owner",
    targetNodeId: profileId,
    durationMinutes: defaults.durationMinutes,
    dateRange: defaults.dateRange,
    reason,
    candidateSlots: proposedSlots,
    selectedSlot: null,
    meetingUrl: null,
    target: { kind: "public_profile", id: profileId },
    request: input.request,
    access: {
      path: "public_profile",
      profileId,
      authorization: authorized.authorization,
    },
    ...envelopeTimes,
  });
  const peerNodeId = shortText(relayed.peerNodeId, 200);
  const relayAccess = parseNetworkSchedulingRelayAccess(relayed.relayAccess);
  if (
    !peerNodeId ||
    !relayAccess ||
    relayAccess.profileId !== profileId
  ) {
    throw new AgentSchedulingError(
      "Soulink returned an invalid network scheduling grant.",
      502,
    );
  }
  const relayStatus = shortText(relayed.status, 80);
  if (relayStatus !== "pending_target" && relayStatus !== "waiting_for_target_review") {
    throw new AgentSchedulingError(
      "The public profile did not enter recipient review as required.",
      409,
    );
  }
  await upsertPeerSchedulingRequest(env, {
    requestId: idempotencyKey,
    ownerId,
    contact: null,
    timeType,
    role: "requester",
    peerNodeId,
    requesterName: owner.name || "ME3 owner",
    targetName: authorized.name,
    reason,
    dateRange: defaults.dateRange,
    candidateSlots: [],
    proposedSlots,
    selectedSlot: null,
    status: "draft",
    expiresAt: earlierIsoInstant(envelopeTimes.expiresAt, authorized.expiresAt),
    meetingUrl: null,
    network: {
      target: { kind: "public_profile", id: profileId },
      request: input.request,
      access: relayAccess,
    },
  });
  return {
    contactName: authorized.name,
    durationMinutes: defaults.durationMinutes,
    dateRange: defaults.dateRange,
    usedDefaultDuration: defaults.usedDefaultDuration,
    usedDefaultDateRange: defaults.usedDefaultDateRange,
    status: relayStatus === "pending_target"
      ? "pending_target" as const
      : "waiting_for_target_review" as const,
    options: [],
  };
}

async function approveAgentScheduling(
  env: Env,
  ownerId: string,
  input: { contact?: string; option?: number; confirmed: boolean },
  _idempotencyKey: string,
) {
  if (!input.confirmed) {
    throw new AgentSchedulingError("The owner must explicitly approve the scheduling action.", 400);
  }
  const request = await findOpenPeerSchedulingRequest(env, ownerId, input.contact);
  const connection = await getOwnerSchedulingConnection(env, ownerId);
  if (!connection) throw new AgentSchedulingError("Soulink is no longer connected.", 409);
  const policy = requireOpenPeerPolicy(request);
  const result = await performSchedulingOwnerAction(env, connection, request, {
    requestId: request.id,
    action: policy.role === "requester" ? "select" : "offer",
    option: input.option,
  });
  if (result.status === "declined") {
    throw new AgentSchedulingError("This scheduling request was declined.", 409);
  }
  return result;
}

async function declineAgentScheduling(
  env: Env,
  ownerId: string,
  input: { contact?: string; reason?: string },
  _idempotencyKey: string,
) {
  const request = await findOpenPeerSchedulingRequest(env, ownerId, input.contact);
  const connection = await getOwnerSchedulingConnection(env, ownerId);
  if (!connection) throw new AgentSchedulingError("Soulink is no longer connected.", 409);
  const result = await performSchedulingOwnerAction(env, connection, request, {
    requestId: request.id,
    action: "decline",
    reason: input.reason,
  });
  if (result.status !== "declined") {
    throw new AgentSchedulingError("The scheduling request could not be declined.", 409);
  }
  return result;
}

export async function performAgentSchedulingOwnerAction(
  env: Env,
  connection: DbAgentChannelConnection,
  input: AgentSchedulingOwnerAction,
  expected?: DbSchedulingRequest,
) {
  const request = await getSchedulingRequest(env, connection.user_id, input.requestId);
  if (!request) throw new AgentSchedulingError("Agent scheduling request was not found.", 404);
  if (expected && !sameSchedulingRequest(request, expected)) throw new AgentSchedulingError("Scheduling request changed since it was read.", 409);
  return performSchedulingOwnerAction(env, connection, request, input, expected);
}

async function performSchedulingOwnerAction(
  env: Env,
  connection: DbAgentChannelConnection,
  request: DbSchedulingRequest & { contact_name?: string | null },
  input: AgentSchedulingOwnerAction,
  expected?: DbSchedulingRequest,
) {
  const ownerId = connection.user_id;
  const policy = requireOpenPeerPolicy(request);
  if (Date.parse(policy.expiresAt) <= Date.now()) {
    await cancelPeerSchedulingRequest(env, ownerId, request.id, "expired");
    throw new AgentSchedulingError("This scheduling request expired.", 410);
  }
  const owner = await getSchedulingOwner(env, ownerId);
  const peerName = request.contact_name || request.requester_name || request.target_name || "your contact";
  const envelope = {
    ...schedulingRelayContract(policy),
    requestId: request.id,
    sourceNodeId: schedulingConnectionOwnerNodeId(connection) || "",
    sourceName: owner.name || "ME3 owner",
    targetNodeId: policy.peerNodeId,
    durationMinutes: policy.durationMinutes,
    dateRange: { start: request.date_range_start, end: request.date_range_end },
    meetingUrl: policy.meetingUrl,
    ...schedulingEnvelopeTimes(policy.expiresAt),
  };

  if (input.action === "decline") {
    if (expected) {
      const changed = await env.DB.prepare(`UPDATE scheduling_requests SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? ${schedulingRequestPrecondition}`).bind(request.id, ownerId, ...schedulingRequestValues(expected)).run();
      if (changed.meta.changes !== 1) throw new AgentSchedulingError("Scheduling request changed before declining it.", 409);
      await recordSchedulingAudit(env, request.id, ownerId, "finalization_blocked", "assistant", "Agent scheduling request was declined after owner approval", { reason: input.reason || null });
    }
    const reason = shortText(input.reason, 500) || null;
    await relayAgentSchedulingMessage(env, connection, {
      ...envelope,
      kind: "schedule.decline",
      reason,
      candidateSlots: [],
      selectedSlot: null,
    });
    await cancelPeerSchedulingRequest(env, ownerId, request.id, "declined");
    await notifySchedulingOwner(
      env,
      connection,
      `I declined the scheduling request with ${peerName}. Nothing was added to either calendar.`,
      `scheduling:${request.id}:declined-local`,
      schedulingNotification(request, policy, owner.timezone, peerName, "declined", [], []),
    );
    return { contactName: peerName, status: "declined" as const };
  }

  if (input.action === "offer") {
    if (policy.role !== "target" || request.status !== "review_required") {
      throw new AgentSchedulingError("These scheduling options have already been handled.", 409);
    }
    const candidates = parseStoredSlots(request.candidate_slots_json);
    const indexes = normalizeSelectedOptionIndexes(input.selectedOptions, candidates.length);
    const offered = input.selectedOptions
      ? indexes.map((index) => candidates[index - 1])
      : candidates;
    if (offered.length === 0) {
      throw new AgentSchedulingError("Choose at least one suitable time to offer.", 400);
    }
    if (expected) {
      const changed = await env.DB.prepare(`UPDATE scheduling_requests SET status = 'candidates_shared', candidate_slots_json = ?, stream_payload_json = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? ${schedulingRequestPrecondition}`).bind(JSON.stringify(offered), request.id, ownerId, ...schedulingRequestValues(expected)).run();
      if (changed.meta.changes !== 1) throw new AgentSchedulingError("Scheduling request changed before offering its times.", 409);
    }
    await relayAgentSchedulingMessage(env, connection, {
      ...envelope,
      kind: "schedule.options",
      reason: request.reason,
      candidateSlots: offered,
      selectedSlot: null,
    });
    await env.DB.prepare(
      `UPDATE scheduling_requests
       SET status = 'candidates_shared', candidate_slots_json = ?,
           stream_payload_json = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND status = 'review_required'`,
    )
      .bind(JSON.stringify(offered), request.id, ownerId)
      .run();
    await recordSchedulingAudit(
      env,
      request.id,
      ownerId,
      "candidates_shared",
      "target",
      `Authorized ${offered.length} exact candidate slots for the requester to choose`,
      { peerNodeId: policy.peerNodeId, slots: offered },
    );
    await notifySchedulingOwner(
      env,
      connection,
      `I sent ${peerName} ${offered.length === 1 ? "that time" : "those times"}. I’ll add their choice to your calendar automatically.`,
      `scheduling:${request.id}:offered`,
      schedulingNotification(request, policy, owner.timezone, peerName, "waiting", offered, []),
    );
    return { contactName: peerName, status: "availability_shared" as const, selectedOption: null };
  }

  if (policy.role !== "requester" || request.status !== "candidates_shared") {
    throw new AgentSchedulingError("This scheduling request is not ready for a time selection.", 409);
  }
  const candidates = parseStoredSlots(request.candidate_slots_json);
  const option = input.option ?? (candidates.length === 1 ? 1 : null);
  if (!option || option < 1 || option > candidates.length) {
    throw new AgentSchedulingError("Choose one of the offered scheduling options.", 400);
  }
  const selectedSlot = candidates[option - 1];
  const approved = await approveSchedulingRequest(env, ownerId, request.id, {
    participantRole: "requester",
    startsAt: selectedSlot.startsAt,
    endsAt: selectedSlot.endsAt,
  }, expected);
  if ("error" in approved) throw new AgentSchedulingError(approved.error, approved.status);
  const relayed = await relayAgentSchedulingMessage(env, connection, {
    ...envelope,
    kind: "schedule.selection",
    reason: request.reason,
    candidateSlots: [],
    selectedSlot,
  });
  if (relayed.status !== "booked") {
    await notifySchedulingOwner(
      env,
      connection,
      `I sent ${peerName} your choice. I’ll confirm it here as soon as the durable relay completes.`,
      `scheduling:${request.id}:selection-pending`,
      schedulingNotification(request, policy, owner.timezone, peerName, "waiting", [selectedSlot], []),
    );
  }
  return {
    contactName: peerName,
    status: relayed.status === "booked" ? "booked" as const : "waiting_for_other_owner" as const,
    selectedOption: schedulingOptions([selectedSlot], owner.timezone)[0],
  };
}

async function receiveAgentSchedulingRequest(
  env: Env,
  connection: DbAgentChannelConnection,
  message: AgentSchedulingRelayMessage,
) {
  const existing = await getSchedulingRequest(env, connection.user_id, message.requestId);
  if (existing) {
    if (existing.status === "cancelled") return { status: "declined" as const };
    if (existing.status === "finalized") return { status: "booked" as const };
    if (existing.status === "review_required") {
      return { status: "waiting_for_target_review" as const };
    }
    const slots = parseStoredSlots(existing.candidate_slots_json);
    return {
      status: slots.length > 0
        ? "options_ready" as const
        : "no_mutual_availability" as const,
      options: schedulingRelayOptions(
        slots,
        (await getSchedulingOwner(env, connection.user_id)).timezone,
      ),
    };
  }
  const networkRequest = message.version === NETWORK_SCHEDULING_PROTOCOL_VERSION;
  const contact = networkRequest
    ? null
    : await resolveAgentSchedulingContactByNode(
      env,
      connection.user_id,
      message.sourceNodeId,
    );
  if (!networkRequest && !contact) {
    throw new AgentSchedulingError(
      "The requesting ME3 owner is not an active synced Soulink contact.",
      403,
    );
  }
  const owner = await getSchedulingOwner(env, connection.user_id);
  const timeType = await schedulingTimeTypeForDuration(
    env,
    connection.user_id,
    message.durationMinutes,
  );
  const policy = networkRequest
    ? null
    : await resolveSchedulingPolicy(env, connection.user_id, {
      contactId: contact!.id,
      timeTypeId: timeType.id,
    });
  if (policy && "error" in policy) {
    throw new AgentSchedulingError(policy.error, policy.status);
  }
  if (policy && !policy.allowed) {
    throw new AgentSchedulingError(policy.reason, 403);
  }
  const available = await generateSchedulingCandidateSlots(env, connection.user_id, {
    timeType,
    dateRange: message.dateRange,
    limit: MAX_RELAY_CANDIDATES,
  });
  const mutual = intersectAgentSchedulingSlots(
    message.candidateSlots,
    available,
    MAX_PRESENTED_OPTIONS,
  );
  if (networkRequest || !policy || policy.ownerReviewRequired || !policy.candidateSharingAllowed) {
    await upsertPeerSchedulingRequest(env, {
      requestId: message.requestId,
      ownerId: connection.user_id,
      contact,
      timeType,
      role: "target",
      peerNodeId: message.sourceNodeId,
      requesterName: message.sourceName,
      targetName: owner.name || "ME3 owner",
      reason: message.reason,
      dateRange: message.dateRange,
      candidateSlots: mutual,
      proposedSlots: [],
      selectedSlot: null,
      status: "review_required",
      expiresAt: message.expiresAt,
      meetingUrl: message.meetingUrl,
      network: networkRequest
        ? requireNetworkSchedulingContract(message)
        : undefined,
    });
    const options = schedulingOptions(mutual, owner.timezone);
    const storedRequest = await getSchedulingRequest(
      env,
      connection.user_id,
      message.requestId,
    );
    if (!storedRequest) throw new AgentSchedulingError("Scheduling request was not stored.", 500);
    await notifySchedulingOwner(
      env,
      connection,
      options.length > 0
        ? `${message.sourceName} wants to book ${message.durationMinutes} minutes with you. These times work for both calendars. Offer any suitable options, or decline.`
        : `${message.sourceName} wants to book ${message.durationMinutes} minutes with you, but I couldn’t find a mutual free time in the requested window.`,
      `scheduling:${message.requestId}:review`,
      schedulingNotification(
        storedRequest,
        {
          protocolVersion: AGENT_SCHEDULING_PROTOCOL_VERSION,
          role: "target",
          peerNodeId: message.sourceNodeId,
          durationMinutes: message.durationMinutes,
          expiresAt: message.expiresAt,
          meetingUrl: message.meetingUrl,
          ...(networkRequest
            ? requireNetworkSchedulingContract(message)
            : {}),
        },
        owner.timezone,
        message.sourceName,
        "offer",
        mutual,
        options.length > 0 ? ["offer", "decline"] : ["decline"],
      ),
    );
    return { status: "waiting_for_target_review" as const };
  }
  await upsertPeerSchedulingRequest(env, {
    requestId: message.requestId,
    ownerId: connection.user_id,
    contact,
    timeType,
    role: "target",
    peerNodeId: message.sourceNodeId,
    requesterName: message.sourceName,
    targetName: owner.name || "ME3 owner",
    reason: message.reason,
    dateRange: message.dateRange,
    candidateSlots: mutual,
    proposedSlots: [],
    selectedSlot: null,
    status: "candidates_shared",
    expiresAt: message.expiresAt,
    meetingUrl: message.meetingUrl,
    network: undefined,
  });
  await recordSchedulingAudit(env, message.requestId, connection.user_id, "candidates_shared", "assistant",
    `Returned ${mutual.length} mutual candidate slots to ${message.sourceName}'s ME3 assistant`,
    { peerNodeId: message.sourceNodeId, durationMinutes: message.durationMinutes });
  return {
    status: mutual.length > 0
      ? "options_ready" as const
      : "no_mutual_availability" as const,
    options: schedulingRelayOptions(mutual, owner.timezone),
  };
}

async function receiveAgentSchedulingOptions(
  env: Env,
  connection: DbAgentChannelConnection,
  message: AgentSchedulingRelayMessage,
) {
  const request = await requirePeerSchedulingRequest(
    env,
    connection.user_id,
    message.requestId,
    "requester",
    message.sourceNodeId,
  );
  await updatePeerSchedulingMeetingUrl(env, connection.user_id, request, message.meetingUrl);
  await env.DB.prepare(
    `UPDATE scheduling_requests
     SET status = 'candidates_shared', candidate_slots_json = ?,
         stream_payload_json = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND status NOT IN ('finalized', 'cancelled')`,
  )
    .bind(JSON.stringify(message.candidateSlots), request.id, connection.user_id)
    .run();
  await recordSchedulingAudit(
    env,
    request.id,
    connection.user_id,
    "candidates_shared",
    "assistant",
    `Received ${message.candidateSlots.length} mutual candidate slots from ${message.sourceName}'s ME3 assistant`,
    { peerNodeId: message.sourceNodeId, durationMinutes: message.durationMinutes },
  );
  const owner = await getSchedulingOwner(env, connection.user_id);
  const options = schedulingOptions(message.candidateSlots, owner.timezone);
  await notifySchedulingOwner(
    env,
    connection,
    options.length > 0
      ? `${message.sourceName} is available at these times. Choose one and I’ll add it to both calendars.`
      : `${message.sourceName} couldn’t offer a mutual free time in the requested window.`,
    `scheduling:${message.requestId}:options`,
    schedulingNotification(
      request,
      { ...requireOpenPeerPolicy(request), meetingUrl: message.meetingUrl || requireOpenPeerPolicy(request).meetingUrl },
      owner.timezone,
      message.sourceName,
      "choose",
      message.candidateSlots,
      options.length > 0 ? ["select", "decline"] : ["decline"],
    ),
  );
  return {
    status: options.length > 0
      ? "options_ready" as const
      : "no_mutual_availability" as const,
    options,
  };
}

async function receiveAgentSchedulingDecline(
  env: Env,
  connection: DbAgentChannelConnection,
  message: AgentSchedulingRelayMessage,
) {
  const request = await getSchedulingRequest(env, connection.user_id, message.requestId);
  const policy = request ? peerPolicy(request.policy_json) : null;
  if (!request || !policy || policy.peerNodeId !== message.sourceNodeId) {
    throw new AgentSchedulingError("Agent scheduling request was not found.", 404);
  }
  if (request.status !== "cancelled") {
    await cancelPeerSchedulingRequest(env, connection.user_id, request.id, "peer_declined");
  }
  await notifySchedulingOwner(
    env,
    connection,
    `${message.sourceName} declined the scheduling request${message.reason ? `: ${message.reason}.` : "."} Nothing was added to either calendar.`,
    `scheduling:${message.requestId}:declined`,
    schedulingNotification(
      request,
      policy,
      (await getSchedulingOwner(env, connection.user_id)).timezone,
      message.sourceName,
      "declined",
      [],
      [],
    ),
  );
  return { status: "declined" as const };
}

async function receiveAgentSchedulingSelection(
  env: Env,
  connection: DbAgentChannelConnection,
  message: AgentSchedulingRelayMessage,
) {
  const request = await requirePeerSchedulingRequest(
    env,
    connection.user_id,
    message.requestId,
    "target",
    message.sourceNodeId,
  );
  const selectedSlot = message.selectedSlot!;
  const policy = requireOpenPeerPolicy(request);
  const authorized = isAgentSchedulingSlotAuthorized(
    selectedSlot,
    parseStoredSlots(request.candidate_slots_json),
  );
  if (request.status !== "candidates_shared" || !authorized) {
    throw new AgentSchedulingError("The selected time was not in the recipient’s authorized options.", 409);
  }
  const requesterApproval = await approveSchedulingRequest(env, connection.user_id, request.id, {
    participantRole: "requester",
    startsAt: selectedSlot.startsAt,
    endsAt: selectedSlot.endsAt,
  });
  if ("error" in requesterApproval) {
    throw new AgentSchedulingError(requesterApproval.error, requesterApproval.status);
  }
  const targetApproval = await approveSchedulingRequest(env, connection.user_id, request.id, {
    participantRole: "target",
    startsAt: selectedSlot.startsAt,
    endsAt: selectedSlot.endsAt,
  });
  if ("error" in targetApproval) {
    throw new AgentSchedulingError(targetApproval.error, targetApproval.status);
  }
  const finalized = await finalizeSchedulingRequest(env, connection.user_id, request.id);
  if ("error" in finalized) throw new AgentSchedulingError(finalized.error, finalized.status);
  const owner = await getSchedulingOwner(env, connection.user_id);
  const label = schedulingOptions([selectedSlot], owner.timezone)[0].label;
  await relayAgentSchedulingMessage(env, connection, {
    ...schedulingRelayContract(policy),
    kind: "schedule.approval",
    requestId: request.id,
    sourceNodeId: schedulingConnectionOwnerNodeId(connection) || "",
    sourceName: owner.name || "ME3 owner",
    targetNodeId: policy.peerNodeId,
    durationMinutes: policy.durationMinutes,
    dateRange: { start: request.date_range_start, end: request.date_range_end },
    reason: request.reason,
    candidateSlots: [],
    selectedSlot,
    meetingUrl: policy.meetingUrl,
    ...schedulingEnvelopeTimes(policy.expiresAt),
  });
  await notifySchedulingOwner(
    env,
    connection,
    `${message.sourceName} chose ${label}. It’s confirmed and added to your calendar.`,
    `scheduling:${message.requestId}:booked`,
    schedulingNotification(request, policy, owner.timezone, message.sourceName, "confirmed", [selectedSlot], []),
  );
  return { status: "booked" as const };
}

async function receiveAgentSchedulingApproval(
  env: Env,
  connection: DbAgentChannelConnection,
  message: AgentSchedulingRelayMessage,
) {
  const request = await requirePeerSchedulingRequest(
    env,
    connection.user_id,
    message.requestId,
    "requester",
    message.sourceNodeId,
  );
  const selectedSlot = message.selectedSlot!;
  await updatePeerSchedulingMeetingUrl(env, connection.user_id, request, message.meetingUrl);
  const approved = await approveSchedulingRequest(env, connection.user_id, request.id, {
    participantRole: "target",
    startsAt: selectedSlot.startsAt,
    endsAt: selectedSlot.endsAt,
  });
  if ("error" in approved) throw new AgentSchedulingError(approved.error, approved.status);
  const finalized = await finalizeSchedulingRequest(env, connection.user_id, request.id);
  if ("error" in finalized) {
    throw new AgentSchedulingError(finalized.error, finalized.status);
  }
  const owner = await getSchedulingOwner(env, connection.user_id);
  const label = schedulingOptions([selectedSlot], owner.timezone)[0].label;
  await notifySchedulingOwner(
    env,
    connection,
    `Great, ${label} is confirmed and added to your calendar.`,
    `scheduling:${message.requestId}:booked`,
    schedulingNotification(
      request,
      { ...requireOpenPeerPolicy(request), meetingUrl: message.meetingUrl || requireOpenPeerPolicy(request).meetingUrl },
      owner.timezone,
      message.sourceName,
      "confirmed",
      [selectedSlot],
      [],
    ),
  );
  return { status: "booked" as const };
}

async function resolveAgentSchedulingContact(
  env: Env,
  ownerId: string,
  queryInput: string,
): Promise<DbContact> {
  const query = shortText(queryInput, 160);
  if (!query) throw new AgentSchedulingError("Scheduling contact is required.", 400);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, name, email, phone, source, source_ref,
            relationship, status, notes, tags, last_interaction_at,
            next_followup_at, outreach_status, social_handles, metadata,
            created_at, updated_at
     FROM contacts
     WHERE user_id = ? AND status = 'active'
       AND (name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE)
     ORDER BY CASE WHEN lower(name) = lower(?) THEN 0 ELSE 1 END,
              updated_at DESC
     LIMIT 10`,
  )
    .bind(ownerId, `%${query}%`, `%${query}%`, query)
    .all<DbContact>();
  const contacts = rows.results || [];
  const exact = contacts.filter((contact) => contact.name.toLowerCase() === query.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (contacts.length === 1) return contacts[0];
  if (contacts.length === 0) {
    throw new AgentSchedulingError(`I couldn't find an active contact matching “${query}”.`, 404);
  }
  throw new AgentSchedulingError(
    `More than one contact matches “${query}”. Use their full contact name.`,
    409,
  );
}

async function resolveAgentSchedulingContactByNode(
  env: Env,
  ownerId: string,
  nodeId: string,
) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, name, email, phone, source, source_ref,
            relationship, status, notes, tags, last_interaction_at,
            next_followup_at, outreach_status, social_handles, metadata,
            created_at, updated_at
     FROM contacts
     WHERE user_id = ? AND status = 'active' AND source = 'soulink'`,
  )
    .bind(ownerId)
    .all<DbContact>();
  return (rows.results || []).find((contact) => soulinkPeerNodeId(contact) === nodeId) || null;
}

async function schedulingTimeTypeForDuration(
  env: Env,
  ownerId: string,
  durationMinutes: number,
): Promise<SchedulingTimeType> {
  const timeTypes = await listSchedulingTimeTypes(env, ownerId);
  const ownerTypes = timeTypes.filter(
    (timeType) => timeType.source === "owner" && timeType.paymentMode === "free",
  );
  const selected = ownerTypes.find(
    (timeType) => timeType.durationMinutes === durationMinutes,
  ) || ownerTypes[0];
  if (!selected) {
    throw new AgentSchedulingError("Create an active free scheduling time type first.", 409);
  }
  return selected.durationMinutes === durationMinutes
    ? selected
    : { ...selected, durationMinutes };
}

async function upsertPeerSchedulingRequest(
  env: Env,
  input: {
    requestId: string;
    ownerId: string;
    contact: DbContact | null;
    timeType: SchedulingTimeType;
    role: AgentSchedulingRole;
    peerNodeId: string;
    requesterName: string;
    targetName: string;
    reason: string | null;
    dateRange: { start: string; end: string };
    candidateSlots: SchedulingRequestSlot[];
    proposedSlots: SchedulingRequestSlot[];
    selectedSlot: SchedulingRequestSlot | null;
    status: "draft" | "review_required" | "candidates_shared";
    expiresAt: string;
    meetingUrl: string | null;
    network?: {
      target: { kind: "public_profile"; id: string };
      request: {
        kind: "meeting";
        participantMode: "one_to_one";
        paymentMode: "free";
      };
      access: {
        path: "public_profile";
        profileId: string;
        grantId: string;
      };
    };
  },
) {
  const policy: SchedulingPeerPolicy = {
    protocolVersion: input.network
      ? NETWORK_SCHEDULING_PROTOCOL_VERSION
      : AGENT_SCHEDULING_PROTOCOL_VERSION,
    role: input.role,
    peerNodeId: input.peerNodeId,
    durationMinutes: input.timeType.durationMinutes,
    expiresAt: input.expiresAt,
    meetingUrl: input.meetingUrl,
    ...(input.network || {}),
  };
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO scheduling_requests
       (id, user_id, contact_id, time_type_id, status, requester_name, target_name,
        reason, date_range_start, date_range_end, candidate_slots_json,
        selected_slot_json, policy_json, stream_payload_json, checkout_url,
        requester_approved_at, target_approved_at, finalized_calendar_event_id,
        finalized_booking_id, finalized_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL,
             NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      input.requestId,
      input.ownerId,
      input.contact?.id || null,
      input.timeType.id,
      input.status,
      input.requesterName,
      input.targetName,
      input.reason,
      input.dateRange.start,
      input.dateRange.end,
      JSON.stringify(input.candidateSlots),
      input.selectedSlot ? JSON.stringify(input.selectedSlot) : null,
      JSON.stringify(policy),
      input.proposedSlots.length > 0 ? JSON.stringify(input.proposedSlots) : null,
    )
    .run();
  await env.DB.prepare(
    `UPDATE scheduling_requests
     SET contact_id = ?, time_type_id = ?, status = ?, requester_name = ?,
         target_name = ?, reason = ?, date_range_start = ?, date_range_end = ?,
         candidate_slots_json = ?, selected_slot_json = COALESCE(?, selected_slot_json),
         policy_json = ?, stream_payload_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND status NOT IN ('finalized', 'cancelled')`,
  )
    .bind(
      input.contact?.id || null,
      input.timeType.id,
      input.status,
      input.requesterName,
      input.targetName,
      input.reason,
      input.dateRange.start,
      input.dateRange.end,
      JSON.stringify(input.candidateSlots),
      input.selectedSlot ? JSON.stringify(input.selectedSlot) : null,
      JSON.stringify(policy),
      input.proposedSlots.length > 0 ? JSON.stringify(input.proposedSlots) : null,
      input.requestId,
      input.ownerId,
    )
    .run();
  if (inserted.meta.changes) {
    await recordSchedulingAudit(env, input.requestId, input.ownerId, "request_created", "assistant",
      `${input.role === "requester" ? "Created" : "Received"} agent scheduling request`,
      { role: input.role, peerNodeId: input.peerNodeId, expiresAt: input.expiresAt });
  }
}

async function findOpenPeerSchedulingRequest(
  env: Env,
  ownerId: string,
  contactInput?: string,
): Promise<SchedulingRequestWithContact> {
  const rows = await env.DB.prepare(
    `SELECT sr.id, sr.user_id, sr.contact_id, sr.time_type_id, sr.status,
            sr.requester_name, sr.target_name, sr.reason, sr.date_range_start,
            sr.date_range_end, sr.candidate_slots_json, sr.selected_slot_json,
            sr.policy_json, sr.stream_payload_json, sr.checkout_url,
            sr.requester_approved_at, sr.target_approved_at,
            sr.finalized_calendar_event_id, sr.finalized_booking_id,
            sr.finalized_at, sr.created_at, sr.updated_at,
            c.name AS contact_name
     FROM scheduling_requests sr
     LEFT JOIN contacts c ON c.id = sr.contact_id
     WHERE sr.user_id = ? AND sr.status NOT IN ('finalized', 'cancelled', 'not_allowed')
     ORDER BY sr.updated_at DESC
     LIMIT 20`,
  )
    .bind(ownerId)
    .all<SchedulingRequestWithContact>();
  const relayed: SchedulingRequestWithContact[] = [];
  for (const request of rows.results || []) {
    const policy = peerPolicy(request.policy_json);
    if (!policy) continue;
    if (Date.parse(policy.expiresAt) <= Date.now()) {
      await cancelPeerSchedulingRequest(env, ownerId, request.id, "expired");
      continue;
    }
    relayed.push(request);
  }
  const contact = shortText(contactInput, 160).toLowerCase();
  const matches = contact
    ? relayed.filter((request) =>
      [request.contact_name, request.requester_name, request.target_name]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(contact)))
    : relayed;
  if (matches.length === 0) {
    throw new AgentSchedulingError(
      contactInput
        ? `There is no open agent scheduling request with ${contactInput}.`
        : "There is no open agent scheduling request to approve.",
      404,
    );
  }
  if (!contact && matches.length > 1) {
    throw new AgentSchedulingError("Name the contact whose scheduling request you want to approve.", 409);
  }
  return matches[0];
}

async function requirePeerSchedulingRequest(
  env: Env,
  ownerId: string,
  requestId: string,
  role: AgentSchedulingRole,
  peerNodeId: string,
) {
  const request = await getSchedulingRequest(env, ownerId, requestId);
  const policy = request ? peerPolicy(request.policy_json) : null;
  if (!request || !policy || policy.role !== role || policy.peerNodeId !== peerNodeId) {
    throw new AgentSchedulingError("Agent scheduling request was not found.", 404);
  }
  if (request.status === "cancelled") {
    throw new AgentSchedulingError("This scheduling request was declined or cancelled.", 409);
  }
  if (request.status === "finalized") {
    throw new AgentSchedulingError("This scheduling request is already booked.", 409);
  }
  if (Date.parse(policy.expiresAt) <= Date.now()) {
    await cancelPeerSchedulingRequest(env, ownerId, request.id, "expired");
    throw new AgentSchedulingError("This scheduling request expired.", 410);
  }
  return request;
}

async function cancelPeerSchedulingRequest(
  env: Env,
  ownerId: string,
  requestId: string,
  reason: "declined" | "peer_declined" | "expired",
) {
  const updated = await env.DB.prepare(
    `UPDATE scheduling_requests
     SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND status NOT IN ('finalized', 'cancelled')`,
  )
    .bind(requestId, ownerId)
    .run();
  if (updated.meta.changes) {
    await recordSchedulingAudit(
      env,
      requestId,
      ownerId,
      "finalization_blocked",
      "assistant",
      reason === "expired"
        ? "Agent scheduling request expired without calendar changes"
        : "Agent scheduling request was declined without calendar changes",
      { reason },
    );
  }
}

async function relayAgentSchedulingMessage(
  env: Env,
  connection: DbAgentChannelConnection,
  message: AgentSchedulingRelayMessage,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${soulinkApiOrigin(env)}/api/me3/agent-relay`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${connection.setup_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    },
  );
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok !== true) {
    throw new AgentSchedulingError(
      shortText(payload?.error, 500) ||
        (response.status === 404
          ? "That contact does not currently have a connected ME3 assistant."
          : "The other ME3 assistant could not complete the scheduling request."),
      response.status,
    );
  }
  return isRecord(payload.result) ? payload.result : payload;
}

async function notifySchedulingOwner(
  env: Env,
  connection: DbAgentChannelConnection,
  messageText: string,
  messageId: string,
  scheduling?: AgentSchedulingNotification,
) {
  const streamChannelId = connection.provider_thread_id;
  if (!streamChannelId) throw new AgentSchedulingError("Soulink assistant chat is not connected.", 409);
  const { id: threadId } = await resolvePrimaryAssistantThread(env, connection.user_id);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO assistant_messages
       (id, owner_id, role, content, thread_id)
     VALUES (?, ?, 'assistant', ?, ?)`,
  )
    .bind(messageId, connection.user_id, messageText, threadId)
    .run();
  await env.DB.prepare(
    `UPDATE assistant_threads
     SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(threadId, connection.user_id)
    .run();

  const response = await fetch(
    `${soulinkApiOrigin(env)}/api/me3/assistant-channel/notify`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${connection.setup_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        streamChannelType: connection.provider_connection_id || "messaging",
        streamChannelId,
        messageId,
        messageText,
        createdAt: new Date().toISOString(),
        scheduling,
      }),
    },
  );
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok !== true) {
    throw new AgentSchedulingError(
      shortText(payload?.error, 500) || "The scheduling update could not reach the owner's Soulink chat.",
      response.status,
    );
  }
}

async function getOwnerSchedulingConnection(env: Env, ownerId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_user_id, provider_thread_id,
            provider_username, provider_metadata_json,
            telegram_user_id, telegram_chat_id, telegram_username,
            telegram_first_name, telegram_last_name, connected_at,
            disconnected_at, last_inbound_at, last_outbound_at, created_at,
            updated_at
     FROM agent_channel_connections
     WHERE user_id = ? AND channel = 'soulink' AND status = 'active'`,
  )
    .bind(ownerId)
    .first<DbAgentChannelConnection>();
}

async function getSchedulingOwner(env: Env, ownerId: string) {
  const owner = await env.DB.prepare(
    `SELECT id, name, timezone FROM owner_profile WHERE id = ?`,
  )
    .bind(ownerId)
    .first<{ id: string; name: string | null; timezone: string | null }>();
  if (!owner) throw new AgentSchedulingError("ME3 owner profile was not found.", 404);
  return owner;
}

async function recordSchedulingAudit(
  env: Env,
  requestId: string,
  ownerId: string,
  eventType:
    | "request_created"
    | "candidates_shared"
    | "approval_recorded"
    | "finalization_blocked"
    | "finalized",
  actorRole: "assistant" | "requester" | "target",
  summary: string,
  metadata: unknown,
) {
  await env.DB.prepare(
    `INSERT INTO scheduling_request_audit
       (id, request_id, user_id, event_type, actor_role, summary, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      crypto.randomUUID(),
      requestId,
      ownerId,
      eventType,
      actorRole,
      summary,
      JSON.stringify(metadata),
    )
    .run();
}

function schedulingOptions(
  slots: readonly SchedulingRequestSlot[],
  timezoneInput: string | null | undefined,
): CoreSchedulingOption[] {
  const timezone = resolveTimeZone(timezoneInput);
  return slots.slice(0, MAX_PRESENTED_OPTIONS).map((slot, index) => ({
    option: index + 1,
    label: formatSchedulingOption(slot, timezone),
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
  }));
}

function schedulingRelayOptions(
  slots: readonly SchedulingRequestSlot[],
  timezoneInput: string | null | undefined,
) {
  const options = schedulingOptions(slots, timezoneInput);
  return options.map((option, index) => ({
    ...slots[index],
    ...option,
  }));
}

function formatSchedulingOption(slot: SchedulingRequestSlot, timezone: string) {
  const start = new Date(slot.startsAt);
  const end = new Date(slot.endsAt);
  const day = new Intl.DateTimeFormat("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(start);
  const time = new Intl.DateTimeFormat("en-IE", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });
  return `${day}, ${time.format(start)}–${time.format(end)} ${timezone}`;
}

function parseRelayOptions(value: unknown): SchedulingRequestSlot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => isRecord(option) ? parseRelaySlot(option) : null)
    .filter((slot): slot is SchedulingRequestSlot => Boolean(slot));
}

function parseStoredSlots(value: string | null): SchedulingRequestSlot[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(parseRelaySlot).filter((slot): slot is SchedulingRequestSlot => Boolean(slot))
      : [];
  } catch {
    return [];
  }
}

function parseStoredSlot(value: string | null) {
  if (!value) return null;
  try {
    return parseRelaySlot(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function requireOpenPeerPolicy(request: DbSchedulingRequest): SchedulingPeerPolicy {
  const policy = peerPolicy(request.policy_json);
  if (!policy) throw new AgentSchedulingError("This scheduling request is not an agent relay.", 409);
  if (request.status === "cancelled") {
    throw new AgentSchedulingError("This scheduling request was declined or cancelled.", 409);
  }
  if (request.status === "finalized") {
    throw new AgentSchedulingError("This scheduling request is already booked.", 409);
  }
  return policy;
}

function normalizeSelectedOptionIndexes(value: number[] | undefined, optionCount: number) {
  if (!value) return [];
  return [...new Set(value)]
    .filter((option) => Number.isInteger(option) && option >= 1 && option <= optionCount)
    .sort((first, second) => first - second);
}

function schedulingNotification(
  request: DbSchedulingRequest,
  policy: SchedulingPeerPolicy,
  timezoneInput: string | null | undefined,
  peerName: string,
  phase: AgentSchedulingNotification["phase"],
  slots: readonly SchedulingRequestSlot[],
  actions: AgentSchedulingNotification["actions"],
): AgentSchedulingNotification {
  return {
    version: 1,
    requestId: request.id,
    phase,
    peerName,
    timezone: resolveTimeZone(timezoneInput),
    options: schedulingOptions(slots, timezoneInput),
    actions,
    expiresAt: policy.expiresAt,
  };
}

async function updatePeerSchedulingMeetingUrl(
  env: Env,
  ownerId: string,
  request: DbSchedulingRequest,
  meetingUrl: string | null,
) {
  if (!meetingUrl) return;
  const policy = peerPolicy(request.policy_json);
  if (!policy || policy.meetingUrl === meetingUrl) return;
  await env.DB.prepare(
    `UPDATE scheduling_requests
     SET policy_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND status NOT IN ('finalized', 'cancelled')`,
  )
    .bind(JSON.stringify({ ...policy, meetingUrl }), request.id, ownerId)
    .run();
}

function parseRelaySlot(value: unknown): SchedulingRequestSlot | null {
  if (!isRecord(value)) return null;
  const startsAt = shortText(value.startsAt, 50);
  const endsAt = shortText(value.endsAt, 50);
  const startsAtMs = Date.parse(startsAt);
  const endsAtMs = Date.parse(endsAt);
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) {
    return null;
  }
  const timezone = resolveTimeZone(shortText(value.timezone, 100));
  const localStart = formatUtcInstantInTimeZone(startsAtMs, timezone);
  const localEnd = formatUtcInstantInTimeZone(endsAtMs, timezone);
  return {
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    timezone,
    localDate: localStart?.localDate || startsAt.slice(0, 10),
    localStartTime: localStart?.localTime || startsAt.slice(11, 16),
    localEndDate: localEnd?.localDate || endsAt.slice(0, 10),
    localEndTime: localEnd?.localTime || endsAt.slice(11, 16),
  };
}

function peerPolicy(value: string | null): SchedulingPeerPolicy | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    const role = parsed.role === "requester" || parsed.role === "target" ? parsed.role : null;
    const peerNodeId = shortText(parsed.peerNodeId, 200);
    const durationMinutes = numericInteger(parsed.durationMinutes);
    const protocolVersion = shortText(parsed.protocolVersion, 40);
    const expiresAt = parseIsoInstant(parsed.expiresAt) ||
      (protocolVersion === LEGACY_AGENT_SCHEDULING_PROTOCOL_VERSION
        ? new Date(0).toISOString()
        : null);
    const meetingUrl = parseHttpsUrl(parsed.meetingUrl);
    const isNetworkPolicy = protocolVersion === NETWORK_SCHEDULING_PROTOCOL_VERSION;
    const targetId = isRecord(parsed.target) && parsed.target.kind === "public_profile"
      ? shortText(parsed.target.id, 200)
      : "";
    const access = parseNetworkSchedulingRelayAccess(parsed.access);
    const request = isRecord(parsed.request) &&
        parsed.request.kind === "meeting" &&
        parsed.request.participantMode === "one_to_one" &&
        parsed.request.paymentMode === "free"
      ? {
          kind: "meeting" as const,
          participantMode: "one_to_one" as const,
          paymentMode: "free" as const,
        }
      : null;
    if (
      (protocolVersion !== AGENT_SCHEDULING_PROTOCOL_VERSION &&
        protocolVersion !== NETWORK_SCHEDULING_PROTOCOL_VERSION &&
        protocolVersion !== LEGACY_AGENT_SCHEDULING_PROTOCOL_VERSION) ||
      !role ||
      !peerNodeId ||
      durationMinutes === null ||
      !expiresAt ||
      (isNetworkPolicy && (
        !targetId ||
        !request ||
        !access ||
        access.profileId !== targetId
      ))
    ) {
      return null;
    }
    return {
      protocolVersion,
      role,
      peerNodeId,
      durationMinutes,
      expiresAt,
      meetingUrl,
      ...(isNetworkPolicy
        ? {
            target: { kind: "public_profile" as const, id: targetId },
            request: request!,
            access: access!,
          }
        : {}),
    };
  } catch {
    return null;
  }
}

function parseNetworkSchedulingRelayAccess(value: unknown) {
  if (!isRecord(value) || value.path !== "public_profile") return null;
  const profileId = shortText(value.profileId, 200);
  const grantId = shortText(value.grantId, 200);
  return profileId && grantId
    ? { path: "public_profile" as const, profileId, grantId }
    : null;
}

function requireNetworkSchedulingContract(message: AgentSchedulingRelayMessage) {
  const access = parseNetworkSchedulingRelayAccess(message.access);
  if (
    message.version !== NETWORK_SCHEDULING_PROTOCOL_VERSION ||
    message.target?.kind !== "public_profile" ||
    !message.target.id ||
    message.request?.kind !== "meeting" ||
    message.request.participantMode !== "one_to_one" ||
    message.request.paymentMode !== "free" ||
    !access ||
    access.profileId !== message.target.id
  ) {
    throw new AgentSchedulingError("Network scheduling relay access is invalid.", 403);
  }
  return {
    target: message.target,
    request: message.request,
    access,
  };
}

function schedulingRelayContract(policy: SchedulingPeerPolicy): {
  version:
    | typeof AGENT_SCHEDULING_PROTOCOL_VERSION
    | typeof NETWORK_SCHEDULING_PROTOCOL_VERSION;
  target?: AgentSchedulingRelayMessage["target"];
  request?: AgentSchedulingRelayMessage["request"];
  access?: AgentSchedulingRelayMessage["access"];
} {
  if (policy.protocolVersion !== NETWORK_SCHEDULING_PROTOCOL_VERSION) {
    return { version: AGENT_SCHEDULING_PROTOCOL_VERSION };
  }
  if (!policy.target || !policy.request || !policy.access) {
    throw new AgentSchedulingError("Network scheduling grant is missing.", 410);
  }
  return {
    version: NETWORK_SCHEDULING_PROTOCOL_VERSION,
    target: policy.target,
    request: policy.request,
    access: policy.access,
  };
}

function earlierIsoInstant(first: string, second: string) {
  return Date.parse(first) <= Date.parse(second) ? first : second;
}

function schedulingEnvelopeTimes(existingExpiresAt?: string) {
  const issuedAt = new Date().toISOString();
  const parsedExpiry = parseIsoInstant(existingExpiresAt);
  return {
    issuedAt,
    expiresAt: parsedExpiry ||
      new Date(Date.parse(issuedAt) + AGENT_SCHEDULING_TTL_MS).toISOString(),
  };
}

function parseIsoInstant(value: unknown) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function soulinkPeerNodeId(contact: DbContact): string | null {
  const metadata = parseJsonRecord(contact.metadata);
  return shortText(metadata.soulinkNodeId, 200) ||
    (contact.source === "soulink" ? shortText(contact.source_ref, 200) : "") ||
    null;
}

function schedulingConnectionOwnerNodeId(connection: DbAgentChannelConnection) {
  const metadata = parseJsonRecord(connection.provider_metadata_json);
  return shortText(metadata.ownerNodeId, 200) || shortText(connection.provider_user_id, 200) || null;
}

function localDateForInstant(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function soulinkApiOrigin(env: Env) {
  try {
    return new URL(env.SOULINK_API_ORIGIN || DEFAULT_SOULINK_API_ORIGIN).origin;
  } catch {
    return DEFAULT_SOULINK_API_ORIGIN;
  }
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value!)));
}

function numericInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function shortText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
