// "Connect YouTube" in News setup (me3-6ptk.11). A one-off import of the channels the owner
// subscribes to, through ME3 Cloud's verified YouTube client: Cloud asks Google only to view the
// account, reads the subscriptions, revokes the token and hands back the channel list once. Core keeps
// nothing: the app shows the list, the owner picks, and only the picked channels are resolved by Soup
// and saved as follows. Self-hosted installs without ME3 Cloud get a plain message instead.
//
// The app holds the state from start and checks it on the way back, so a list only lands in the setup
// sheet that asked for it.
import { JournalInputError } from "./journal";
import { resolveHostedSocialOAuthOrigin } from "./social-publishing";
import { getCoreApiOrigin } from "./sites";
import { APP_SCHEMES, parseStripeReturnApp, stripeAppReturnPage, type StripeReturnApp } from "./stripe-app-return";
import type { Env } from "./types";

export const NEWS_YOUTUBE_CALLBACK_PATH = "/api/news-connect/youtube/callback/:app";
const STATE = /^[A-Za-z0-9_-]{20,80}$/;
const HANDOFF = /^nyh_[A-Za-z0-9_-]{8,100}$/;
const MAX_CHANNELS = 1000;

export type NewsYouTubeChannel = { id: string; title: string; image: string | null };

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** POST /api/news/follow/youtube/start {app}: where to send the owner, and the state to check on return. */
export async function startNewsYouTube(env: Env, requestUrl: string, input: unknown): Promise<{ url: string; state: string }> {
  const app = parseStripeReturnApp((input as { app?: unknown } | null)?.app);
  if (!app) throw new JournalInputError("Connect YouTube works from the ME3 app.");
  const origin = await resolveHostedSocialOAuthOrigin(env);
  if (!origin) throw new JournalInputError("Connect YouTube needs ME3 Cloud. Add a channel by name or link instead.", 409);
  const state = randomState();
  const url = new URL("/api/social/youtube/news/authorize", origin);
  url.searchParams.set("state", state);
  url.searchParams.set("core_callback", `${getCoreApiOrigin(env, requestUrl).replace(/\/$/, "")}/api/news-connect/youtube/callback/${app}`);
  return { url: url.toString(), state };
}

/** The app deep link for Cloud's answer. Only checked tokens or a short error code go through. */
export function newsYouTubeDeepLink(app: StripeReturnApp, query: { state?: string | null; handoff?: string | null; error?: string | null }): string {
  const base = `${APP_SCHEMES[app]}://news`;
  const state = query.state && STATE.test(query.state) ? query.state : "";
  if (state && query.handoff && HANDOFF.test(query.handoff)) {
    return `${base}?youtube_state=${state}&youtube_handoff=${query.handoff}`;
  }
  const error = query.error && /^[a-z0-9_]{1,40}$/.test(query.error) ? query.error : "failed";
  return `${base}?youtube_error=${error}${state ? `&youtube_state=${state}` : ""}`;
}

/** GET /api/news-connect/youtube/callback/:app: public, closes the sign-in sheet and goes back to the app. */
export function newsYouTubeReturnPage(app: unknown, query: { state?: string | null; handoff?: string | null; error?: string | null }): string | null {
  const target = parseStripeReturnApp(app);
  if (!target) return null;
  return stripeAppReturnPage(newsYouTubeDeepLink(target, query), "Taking you back to ME3.");
}

/** POST /api/news/follow/youtube/collect {state, handoff}: the channel list, once, straight from Cloud. */
export async function collectNewsYouTube(env: Env, input: unknown, fetchImpl: typeof fetch = fetch): Promise<{ channels: NewsYouTubeChannel[] }> {
  const body = (input && typeof input === "object" ? input : {}) as { state?: unknown; handoff?: unknown };
  const state = typeof body.state === "string" ? body.state : "";
  const handoff = typeof body.handoff === "string" ? body.handoff : "";
  if (!STATE.test(state) || !HANDOFF.test(handoff)) throw new JournalInputError("That YouTube sign-in didn't come back right. Try again.");
  const origin = await resolveHostedSocialOAuthOrigin(env);
  if (!origin) throw new JournalInputError("Connect YouTube needs ME3 Cloud.", 409);

  let response: Response;
  try {
    response = await fetchImpl(`${origin}/api/social/youtube/news/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, handoff }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new JournalInputError("ME3 Cloud couldn't be reached. Try again in a moment.", 502);
  }
  if (response.status === 404) throw new JournalInputError("That YouTube sign-in has expired. Connect again.", 404);
  if (!response.ok) throw new JournalInputError("ME3 Cloud couldn't read your YouTube subscriptions just now.", 502);
  const data = (await response.json().catch(() => null)) as { channels?: unknown } | null;
  return { channels: readChannels(data?.channels) };
}

export function readChannels(raw: unknown): NewsYouTubeChannel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const channels: NewsYouTubeChannel[] = [];
  for (const entry of raw) {
    const row = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 120) : "";
    if (!/^UC[\w-]{22}$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    const image = typeof row.image === "string" && row.image.startsWith("https://") ? row.image.slice(0, 500) : null;
    channels.push({ id, title, image });
    if (channels.length >= MAX_CHANNELS) break;
  }
  return channels;
}
