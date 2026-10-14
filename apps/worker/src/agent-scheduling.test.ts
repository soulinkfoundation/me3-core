import { describe, expect, it } from "vitest";
import {
  intersectAgentSchedulingSlots,
  isAgentSchedulingSlotAuthorized,
  parseAgentSchedulingRelayMessage,
  resolveAgentSchedulingDefaults,
} from "./agent-scheduling";
import type { SchedulingRequestSlot } from "./scheduling";

describe("ME3 agent scheduling", () => {
  it("defaults an underspecified booking request to 30 minutes and seven local days", () => {
    expect(
      resolveAgentSchedulingDefaults(
        {},
        "Europe/Dublin",
        new Date("2026-08-19T12:00:00.000Z"),
      ),
    ).toEqual({
      durationMinutes: 30,
      dateRange: { start: "2026-08-19", end: "2026-08-25" },
      usedDefaultDuration: true,
      usedDefaultDateRange: true,
    });
  });

  it("keeps an explicit duration and completes a partial date window", () => {
    expect(
      resolveAgentSchedulingDefaults(
        { durationMinutes: 45, dateFrom: "2026-09-01" },
        "Europe/Dublin",
        new Date("2026-08-19T12:00:00.000Z"),
      ),
    ).toEqual({
      durationMinutes: 45,
      dateRange: { start: "2026-09-01", end: "2026-09-07" },
      usedDefaultDuration: false,
      usedDefaultDateRange: true,
    });
  });

  it("shares only exact mutual availability", () => {
    const first = slot("2026-08-20T09:00:00.000Z", "2026-08-20T09:30:00.000Z");
    const second = slot("2026-08-20T10:00:00.000Z", "2026-08-20T10:30:00.000Z");
    expect(intersectAgentSchedulingSlots([first, second], [second])).toEqual([second]);
  });

  it("books only an exact slot from the recipient-authorized set", () => {
    const authorized = slot("2026-08-20T09:00:00.000Z", "2026-08-20T09:30:00.000Z");
    const changed = slot("2026-08-20T09:15:00.000Z", "2026-08-20T09:45:00.000Z");
    expect(isAgentSchedulingSlotAuthorized(authorized, [authorized])).toBe(true);
    expect(isAgentSchedulingSlotAuthorized(changed, [authorized])).toBe(false);
  });

  it("rejects scheduling envelopes without a verified shape", () => {
    expect(parseAgentSchedulingRelayMessage({
      version: "2026-08-19",
      kind: "schedule.request",
      requestId: "request-1",
      sourceNodeId: "source",
      sourceName: "Source",
      targetNodeId: "target",
      durationMinutes: 30,
      dateRange: { start: "2026-08-20", end: "2026-08-26" },
      reason: null,
      candidateSlots: [],
      selectedSlot: null,
    })).toBeNull();
  });

  it("requires bounded timestamps on the current scheduling envelope", () => {
    const candidate = slot("2026-08-25T09:00:00.000Z", "2026-08-25T09:30:00.000Z");
    const envelope = {
      version: "2026-08-24",
      kind: "schedule.request",
      requestId: "request-2",
      sourceNodeId: "source",
      sourceName: "Source",
      targetNodeId: "target",
      durationMinutes: 30,
      dateRange: { start: "2026-08-25", end: "2026-08-31" },
      reason: null,
      candidateSlots: [candidate],
      selectedSlot: null,
    };

    expect(parseAgentSchedulingRelayMessage(envelope)).toBeNull();
    expect(parseAgentSchedulingRelayMessage({
      ...envelope,
      issuedAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-26T12:00:00.000Z",
    })).toMatchObject({
      version: "2026-08-24",
      kind: "schedule.request",
      requestId: "request-2",
      issuedAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-26T12:00:00.000Z",
    });
  });

  it("accepts a current decline envelope without exposing candidate slots", () => {
    expect(parseAgentSchedulingRelayMessage({
      version: "2026-08-24",
      kind: "schedule.decline",
      requestId: "request-3",
      sourceNodeId: "source",
      sourceName: "Source",
      targetNodeId: "target",
      durationMinutes: 30,
      dateRange: { start: "2026-08-25", end: "2026-08-31" },
      reason: "Not this week",
      candidateSlots: [],
      selectedSlot: null,
      meetingUrl: "https://soulinkfoundation.org/calls/@source",
      issuedAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-26T12:00:00.000Z",
    })).toMatchObject({
      kind: "schedule.decline",
      candidateSlots: [],
      selectedSlot: null,
      meetingUrl: "https://soulinkfoundation.org/calls/@source",
    });
  });

  it("accepts only a grant-backed free one-to-one network relay", () => {
    const candidate = slot("2026-08-25T09:00:00.000Z", "2026-08-25T09:30:00.000Z");
    const envelope = {
      version: "2026-08-25",
      kind: "schedule.request",
      requestId: "network-request",
      sourceNodeId: "source",
      sourceName: "Source",
      targetNodeId: "target",
      durationMinutes: 30,
      dateRange: { start: "2026-08-25", end: "2026-08-31" },
      reason: null,
      candidateSlots: [candidate],
      selectedSlot: null,
      meetingUrl: "https://soulinkfoundation.org/calls/@source",
      target: { kind: "public_profile", id: "profile-target" },
      request: { kind: "meeting", participantMode: "one_to_one", paymentMode: "free" },
      access: {
        path: "public_profile",
        profileId: "profile-target",
        grantId: "network-grant",
      },
      issuedAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-26T12:00:00.000Z",
    };

    expect(parseAgentSchedulingRelayMessage(envelope)).toMatchObject({
      version: "2026-08-25",
      target: { kind: "public_profile", id: "profile-target" },
      access: { profileId: "profile-target", grantId: "network-grant" },
    });
    expect(parseAgentSchedulingRelayMessage({
      ...envelope,
      access: { ...envelope.access, profileId: "another-profile" },
    })).toBeNull();
  });

});

function slot(startsAt: string, endsAt: string): SchedulingRequestSlot {
  return {
    startsAt,
    endsAt,
    timezone: "Europe/Dublin",
    localDate: startsAt.slice(0, 10),
    localStartTime: startsAt.slice(11, 16),
    localEndDate: endsAt.slice(0, 10),
    localEndTime: endsAt.slice(11, 16),
  };
}
