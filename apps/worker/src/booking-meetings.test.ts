import { describe, expect, it } from "vitest";
import { hashGuestToken, resolveBookingMeeting, validExternalMeetingUrl } from "./booking-meetings";
import type { Env } from "./types";

describe("booking meeting links", () => {
  it("keeps existing no-link offers unchanged and accepts only HTTPS external links", async () => {
    expect(await resolveBookingMeeting({} as Env, "owner", {}, "booking-1"))
      .toEqual({ provider: null, guestUrl: null, hostUrl: null, guestTokenHash: null });
    expect(validExternalMeetingUrl("https://zoom.example/j/123"))
      .toBe("https://zoom.example/j/123");
    expect(validExternalMeetingUrl("http://zoom.example/j/123")).toBeNull();
    expect(validExternalMeetingUrl("https://user:secret@zoom.example/j/123")).toBeNull();
  });

  it("creates a unique booking-scoped guest ticket only for an active owner connection", async () => {
    const env = {
      SOULINK_API_ORIGIN: "https://soulinkfoundation.org",
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({
          provider_metadata_json: JSON.stringify({ ownerNodeId: "node-1" }),
        }) }) }),
      },
    } as unknown as Env;
    const first = await resolveBookingMeeting(env, "owner", { meetingProvider: "soulink" }, "booking-1");
    const second = await resolveBookingMeeting(env, "owner", { meetingProvider: "soulink" }, "booking-2");
    expect(first.hostUrl).toMatch(/^https:\/\/soulinkfoundation\.org\/calls\/personal_[A-Za-z0-9_-]{20}$/);
    expect(first.guestUrl).toMatch(/^https:\/\/soulinkfoundation\.org\/booking-calls\/[A-Za-z0-9_-]+$/);
    expect(first.guestUrl).not.toBe(second.guestUrl);
    const token = first.guestUrl!.split("/").at(-1)!;
    expect(await hashGuestToken(token)).toBe(first.guestTokenHash);
    expect(JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/"))))
      .toMatchObject({ ownerNodeId: "node-1", bookingId: "booking-1" });
  });

  it("refuses a Soulink booking when the connection is unavailable", async () => {
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } } as unknown as Env;
    await expect(resolveBookingMeeting(env, "owner", { meetingProvider: "soulink" }, "booking-1"))
      .rejects.toThrow(/Connect this ME3 installation/);
  });

  it("resolves an external link from private site settings", async () => {
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ meeting_url: "https://zoom.example/j/456" }) }) }) } } as unknown as Env;
    const meeting = await resolveBookingMeeting(env, "owner", { meetingProvider: "external" }, "booking-1", "site-1", "offer-1");
    expect(meeting).toEqual({
      provider: "external", guestUrl: "https://zoom.example/j/456",
      hostUrl: "https://zoom.example/j/456", guestTokenHash: null,
    });
  });
});
