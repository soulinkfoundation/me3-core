import type { AgentSchedulingServices, SchedulingContact, SchedulingRequest } from "../../../packages/agent/src/tools/services";
import { createAgentSchedulingToolServices, performAgentSchedulingOwnerAction, requestAgentScheduling, requestNetworkAgentScheduling, searchAgentSchedulingContacts } from "./agent-scheduling";
import { getSchedulingRequest } from "./scheduling";
import { schedulingRequestValues } from "./scheduling-preconditions";
import type { DbAgentChannelConnection, DbSchedulingRequest, Env } from "./types";

async function revision(request: DbSchedulingRequest) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(schedulingRequestValues(request))));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}
async function summary(request: DbSchedulingRequest): Promise<SchedulingRequest> {
  const policy = JSON.parse(request.policy_json || "{}") as { role?: string };
  const slots = JSON.parse(request.candidate_slots_json || "[]") as Array<{ startsAt: string; endsAt: string }>;
  return { id: request.id, contactId: request.contact_id || undefined, contactName: (policy.role === "requester" ? request.target_name : request.requester_name) || undefined,
    status: request.status, role: policy.role, reason: request.reason, dateRange: { start: request.date_range_start, end: request.date_range_end },
    options: slots.slice(0, 3).map((slot, index) => ({ option: index + 1, startsAt: slot.startsAt, endsAt: slot.endsAt })), revision: await revision(request) };
}

export function createStableAgentSchedulingServices(env: Env, ownerId: string): AgentSchedulingServices {
  async function read(requestId: string) { const request = await getSchedulingRequest(env, ownerId, requestId); return request ? summary(request) : null; }
  async function reviewed(requestId: string, expected: SchedulingRequest) {
    if (expected.id !== requestId) throw new Error("Approved scheduling request ID does not match.");
    const request = await getSchedulingRequest(env, ownerId, requestId);
    if (!request) throw new Error("Scheduling request not found.");
    if (await revision(request) !== expected.revision) throw new Error("Scheduling request changed since it was reviewed.");
    return request;
  }
  async function connection() {
    const value = await env.DB.prepare("SELECT * FROM agent_channel_connections WHERE user_id = ? AND channel = 'soulink' AND status = 'active'").bind(ownerId).first<DbAgentChannelConnection>();
    if (!value) throw new Error("Soulink is no longer connected."); return value;
  }
  return {
    availability: createAgentSchedulingToolServices(env, ownerId).availability,
    searchContacts: async input => {
      const found = await searchAgentSchedulingContacts(env, ownerId, input, true);
      return { ...found, contacts: found.contacts as SchedulingContact[] };
    },
    getRequest: read,
    request: async (input, key) => {
      if (!input.expectedContact || input.expectedContact.id !== input.contactId) throw new Error("A reviewed stable contact is required.");
      const result = await requestAgentScheduling(env, ownerId, { ...input, contact: input.expectedContact.name }, key);
      return await read(key) || { id: key, contactId: input.contactId, ...result };
    },
    requestNetwork: async (input, key) => {
      const result = await requestNetworkAgentScheduling(env, ownerId, input, key);
      return await read(key) || { id: key, ...result };
    },
    approve: async (input, _key) => {
      if (input.confirmed !== true) throw new Error("Scheduling approval requires a durable owner decision.");
      const expected = await reviewed(input.requestId, input.expected);
      const policy = JSON.parse(expected.policy_json || "{}") as { role?: string };
      await performAgentSchedulingOwnerAction(env, await connection(), { requestId: input.requestId, action: policy.role === "requester" ? "select" : "offer", option: input.option,
        selectedOptions: policy.role === "target" && input.option !== undefined ? [input.option] : undefined }, expected);
      return (await read(input.requestId))!;
    },
    decline: async (input, _key) => {
      const expected = await reviewed(input.requestId, input.expected);
      await performAgentSchedulingOwnerAction(env, await connection(), { requestId: input.requestId, action: "decline", reason: input.reason }, expected);
      return (await read(input.requestId))!;
    },
  };
}
