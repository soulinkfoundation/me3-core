import { getAgentMailboxOverview } from "@me3-core/plugin-agent-chat";
import { getConfiguredEmailIdentity } from "./email-providers";
import { isManagedEmailDeployment } from "./managed-email";
import { getNewsSettings } from "./news-settings";
import { getOwnerProfile, getPublishedSiteBaseUrl, siteFileContentToBytes } from "./sites";
import type { DbSite, Env } from "./types";

/**
 * Show me around (me3-q6la.5): a short tour drawn as step cards in Chat, the same on web, iOS and Android.
 * Core writes each step from what this install has (the site's address, ME3's email, the morning paper),
 * so every step points at something real and its Try it does something real.
 */
export type TourTry =
  | { kind: "prompt"; label: string; prompt: string }
  | { kind: "site_ask"; label: string }
  | { kind: "copy"; label: string; value: string }
  /** `to` is one of the app's own places, which each client maps to its own screen. */
  | { kind: "open"; label: string; to: TourPlace };
export type TourPlace = "home" | "website" | "news" | "email_settings";
export type TourStep = { id: string; emoji: string; title: string; body: string; where: string; tryIt: TourTry | null };
export type ChatTour = { steps: TourStep[]; done: { title: string; body: string } };

export type TourContext = {
  site: { url: string; built: boolean } | null;
  emailAddress: string | null;
  news: { setUp: boolean; time: string } | null;
};

export function chatTour(context: TourContext): ChatTour {
  const steps: TourStep[] = [];
  const site = context.site;
  steps.push(site?.built
    ? { id: "website", emoji: "🌐", title: "Your website", body: `Your site is live at ${site.url}. Change anything in the website editor, or ask me to.`, where: "Website", tryIt: { kind: "open", label: "Open the editor", to: "website" } }
    : { id: "website", emoji: "🌐", title: "Your website", body: `You have a page${site ? ` at ${site.url}` : ""}. Tell me about your work and I'll draft the rest. You review it in the website editor before it goes live.`, where: "Website", tryIt: { kind: "site_ask", label: "Make my website" } });
  steps.push(context.emailAddress
    ? { id: "email", emoji: "✉️", title: "ME3's own email", body: `${context.emailAddress} is my own address. Forward me invoices and anything I should know or handle. I never read your inbox.`, where: "Home → Inbox", tryIt: { kind: "copy", label: "Copy my address", value: context.emailAddress } }
    : { id: "email", emoji: "✉️", title: "ME3's own email", body: "I can have my own email address. Forward me invoices and anything I should know or handle. I never read your inbox.", where: "Settings → Email", tryIt: { kind: "open", label: "Set up my email", to: "email_settings" } });
  if (context.news) {
    steps.push(context.news.setUp
      ? { id: "news", emoji: "📰", title: "Your morning paper", body: `Each morning at ${context.news.time} I put together a short paper on what you care about, from sources you can trust.`, where: "Home", tryIt: { kind: "open", label: "Read today's paper", to: "news" } }
      : { id: "news", emoji: "📰", title: "Your morning paper", body: "I can put together a short paper each morning on what you care about, from sources you can trust.", where: "Home", tryIt: { kind: "prompt", label: "Set up my paper", prompt: "Set up my morning paper." } });
  }
  steps.push({ id: "home", emoji: "🏠", title: "Home", body: "Home shows your day: what's on, what needs you and your tasks. Come back to Chat whenever you want me to do something.", where: "Home", tryIt: { kind: "open", label: "Go to Home", to: "home" } });
  return { steps, done: { title: "That's the tour", body: "Ask me anything, or pick something below to start." } };
}

async function profileSite(env: Env, ownerId: string): Promise<{ url: string; built: boolean } | null> {
  const site = await env.DB.prepare(
    `SELECT * FROM sites WHERE user_id = ? AND COALESCE(site_role, COALESCE(site_type, 'profile')) = 'profile' ORDER BY created_at ASC LIMIT 1`,
  ).bind(ownerId).first<DbSite>();
  if (!site) return null;
  const file = await env.DB.prepare(`SELECT content FROM site_files WHERE site_id = ? AND path = 'src/me.json'`)
    .bind(site.id).first<{ content: Parameters<typeof siteFileContentToBytes>[0] | string }>();
  let built = false;
  if (file?.content) {
    try {
      const text = typeof file.content === "string" ? file.content : new TextDecoder().decode(siteFileContentToBytes(file.content));
      const bio = (JSON.parse(text) as { bio?: unknown }).bio;
      built = typeof bio === "string" && bio.trim().length > 0;
    } catch { built = true; } // Unreadable counts as built: never offer to redo an owner's site.
  }
  const url = (await getPublishedSiteBaseUrl(env, site)).replace(/^https?:\/\//, "").replace(/\/$/, "");
  return { url, built };
}

/** ME3's own address, read the way GET /api/mailbox does. */
async function agentEmailAddress(env: Env, ownerId: string): Promise<string | null> {
  const owner = await getOwnerProfile(env, ownerId);
  const configuredIdentity = isManagedEmailDeployment(env) ? null : await getConfiguredEmailIdentity(env, ownerId).catch(() => null);
  const overview = await getAgentMailboxOverview(env, ownerId, owner || undefined, { includeRecentActivity: false, configuredIdentity });
  return overview.mailbox?.aliasAddress || overview.sources.find(source => source.inboundEnabled)?.address || null;
}

/** Each part is read on its own: one that fails falls back to its plainer step. */
export async function loadChatTour(env: Env, ownerId: string, options: { emailAddress?: () => Promise<string | null> } = {}): Promise<ChatTour> {
  const [site, emailAddress, news] = await Promise.all([
    profileSite(env, ownerId).catch(() => null),
    (options.emailAddress ?? (() => agentEmailAddress(env, ownerId)))().catch(() => null),
    getNewsSettings(env, ownerId).then(settings => ({ setUp: settings.setUp, time: settings.time })).catch(() => null),
  ]);
  return chatTour({ site, emailAddress, news });
}
