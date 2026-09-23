import type { CoreBookingOffer } from "./booking";
import type { Env } from "./types";

export type BookingMeeting = {
  provider: "soulink" | "external" | null;
  guestUrl: string | null;
  hostUrl: string | null;
  guestTokenHash: string | null;
};
export class BookingMeetingError extends Error {}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashGuestToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return base64url(digest);
}

export function validExternalMeetingUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function resolveBookingMeeting(
  env: Env,
  ownerId: string,
  offer: Pick<CoreBookingOffer, "meetingProvider" | "meetingUrl">,
  bookingId: string,
  siteId?: string,
  offerId?: string,
): Promise<BookingMeeting> {
  if (offer.meetingProvider === "external") {
    const privateSetting = siteId && offerId
      ? await env.DB.prepare("SELECT meeting_url FROM site_booking_meetings WHERE site_id = ? AND offer_id = ?")
          .bind(siteId, offerId).first<{ meeting_url: string }>()
      : null;
    const url = validExternalMeetingUrl(privateSetting?.meeting_url || offer.meetingUrl);
    if (!url) throw new BookingMeetingError("This offer needs a valid HTTPS meeting link.");
    return { provider: "external", guestUrl: url, hostUrl: url, guestTokenHash: null };
  }
  if (offer.meetingProvider !== "soulink") {
    return { provider: null, guestUrl: null, hostUrl: null, guestTokenHash: null };
  }

  const connection = await env.DB.prepare(
    `SELECT provider_metadata_json, provider_user_id FROM agent_channel_connections
     WHERE user_id = ? AND channel = 'soulink' AND status = 'active' AND setup_token IS NOT NULL`,
  ).bind(ownerId).first<{ provider_metadata_json: string | null; provider_user_id: string | null }>();
  let ownerNodeId: string | null = null;
  try {
    const metadata = JSON.parse(connection?.provider_metadata_json || "null") as { ownerNodeId?: unknown } | null;
    if (typeof metadata?.ownerNodeId === "string" && metadata.ownerNodeId) ownerNodeId = metadata.ownerNodeId;
  } catch { /* Invalid connector metadata cannot authorize a call. */ }
  if (!ownerNodeId && connection?.provider_user_id) ownerNodeId = connection.provider_user_id;
  if (!ownerNodeId) throw new BookingMeetingError("Connect this ME3 installation to Soulink before accepting this booking.");

  const token = base64url(new TextEncoder().encode(JSON.stringify({
    ownerNodeId,
    bookingId,
    secret: crypto.randomUUID(),
  })));
  const origin = (env.SOULINK_API_ORIGIN || "https://soulinkfoundation.org").replace(/\/+$/, "");
  const roomHash = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerNodeId)))).slice(0, 20);
  return {
    provider: "soulink",
    guestUrl: `${origin}/booking-calls/${token}`,
    hostUrl: `${origin}/calls/personal_${roomHash}`,
    guestTokenHash: await hashGuestToken(token),
  };
}
