import { ownedMissionStatement } from "@me3-core/plugin-mission-control";
import { getMailboxBrief } from "./mailbox-brief";
import { getOwnerProfile, siteFileContentToBytes } from "./sites";
import type { Env } from "./types";

/**
 * The starters under Chat's empty state, for web, iOS and Android alike (me3-q6la.1).
 * Clients draw what this returns, so a starter changes here without a client release.
 * A starter either sends `prompt` as the owner's message or, with `action`, opens a card in the app.
 */
/** "tour" opens Show me around; a client that predates it sends the prompt instead. */
export type ChatStarterAction = "site_ask" | "tour";
export type ChatStarter = { id: string; emoji: string; label: string; prompt: string; action?: ChatStarterAction };
export type ChatStarters = {
  /** A new owner: no site bio yet and nothing said in Chat. Clients show `greeting` above the starters. */
  firstRun: boolean;
  greeting: { title: string; body: string } | null;
  starters: ChatStarter[];
};

export type ChatStarterContext = {
  /** The owner's local hour, 0-23. */
  hour: number;
  firstName: string | null;
  siteMissing: boolean;
  hasSpoken: boolean;
  missionMissing: boolean;
  /** The next timed event starting within the hour. */
  nextEvent: { title: string; time: string } | null;
  /** The top email that needs the owner. */
  reply: { name: string; subject: string } | null;
};

export const MAX_CHAT_STARTERS = 4;
export const BUILD_SITE_PROMPT = "Build my website.";
export const HELP_PROMPT =
  "What can you help me with? Tell me in plain words what you can do with the tools I have connected, in a few short groups, and suggest one thing to try from each.";
export const TOUR_PROMPT =
  "Show me around ME3. Take me through the main things one at a time, keep each step short, and tell me where to find each one in the app.";
export const MISSION_DRAFT_PROMPT =
  "Help me draft my mission. Ask me one short question at a time: who I want to help, the change I want for them, how I help, and why it matters to me. Then suggest a first draft I can save. It doesn't need to be perfect.";

const site: ChatStarter = { id: "site", emoji: "🌐", label: "Make my website", prompt: BUILD_SITE_PROMPT, action: "site_ask" };
const help: ChatStarter = { id: "help", emoji: "💡", label: "What can you help with?", prompt: HELP_PROMPT };
const tour: ChatStarter = { id: "tour", emoji: "🧭", label: "Show me around", prompt: TOUR_PROMPT, action: "tour" };

function clip(text: string, max = 28): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function chatStarters(context: ChatStarterContext): ChatStarters {
  if (context.siteMissing && !context.hasSpoken) {
    return {
      firstRun: true,
      greeting: {
        title: context.firstName ? `Hi ${context.firstName}, I'm ME3` : "Hi, I'm ME3",
        body: "Your assistant, website and inbox in one place. Where shall we start?",
      },
      starters: [site, help, tour],
    };
  }
  const starters: ChatStarter[] = [];
  if (context.nextEvent) {
    const title = context.nextEvent.title || "your next event";
    starters.push({ id: "prep", emoji: "📅", label: `Prep for ${clip(title)}`, prompt: `Help me prep for ${title} at ${context.nextEvent.time}.` });
  }
  if (context.reply) {
    const name = context.reply.name;
    const about = context.reply.subject ? ` about "${context.reply.subject}"` : "";
    starters.push({ id: "reply", emoji: "✉️", label: `Reply to ${clip(name, 20)}`, prompt: `Help me reply to ${name}'s email${about}. Draft it and ask me before sending.` });
  }
  if (context.siteMissing) starters.push({ ...site, label: "Build my site" });
  if (context.missionMissing) starters.push({ id: "mission", emoji: "✨", label: "Draft my mission", prompt: MISSION_DRAFT_PROMPT });
  // No generic time-of-day starters (Plan my day, Wrap up today): only ones backed by the owner's own data.
  starters.push(help);
  return { firstRun: false, greeting: null, starters: starters.slice(0, MAX_CHAT_STARTERS) };
}

/** The owner's local hour and a clock time in their zone; an unknown zone falls back to UTC. */
export function localClock(now: Date, timeZone: string | null | undefined) {
  let zone = "UTC";
  if (timeZone) {
    try { new Intl.DateTimeFormat("en-GB", { timeZone }); zone = timeZone; } catch { /* keep UTC */ }
  }
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now));
  const time = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date);
  return { hour: Number.isFinite(hour) ? hour % 24 : now.getUTCHours(), time };
}

const PREP_WINDOW_MS = 60 * 60 * 1000;

async function profileBioAndName(env: Env, ownerId: string): Promise<{ bio: string; name: string }> {
  const row = await env.DB.prepare(
    `SELECT sf.content FROM site_files sf JOIN sites s ON s.id = sf.site_id
     WHERE s.user_id = ? AND COALESCE(s.site_role, COALESCE(s.site_type, 'profile')) = 'profile'
       AND sf.path IN ('src/me.json', 'public/me.json', 'me.json')
     ORDER BY CASE sf.path WHEN 'src/me.json' THEN 0 WHEN 'public/me.json' THEN 1 ELSE 2 END
     LIMIT 1`,
  ).bind(ownerId).first<{ content: Parameters<typeof siteFileContentToBytes>[0] }>();
  if (!row) return { bio: "", name: "" };
  // An unreadable me.json throws, and the caller then counts the site as built.
  const profile = JSON.parse(typeof row.content === "string" ? row.content : new TextDecoder().decode(siteFileContentToBytes(row.content))) as { bio?: unknown; name?: unknown };
  return { bio: typeof profile.bio === "string" ? profile.bio.trim() : "", name: typeof profile.name === "string" ? profile.name.trim() : "" };
}

async function nextEventWithinHour(env: Env, ownerId: string, now: Date): Promise<{ title: string; startsAt: string } | null> {
  const start = now.toISOString();
  const end = new Date(now.getTime() + PREP_WINDOW_MS).toISOString();
  const [own, imported] = await Promise.all([
    env.DB.prepare(
      `SELECT title, starts_at FROM user_calendar_events
       WHERE user_id = ? AND recurrence_rule IS NULL AND COALESCE(all_day, 0) = 0
         AND starts_at > ? AND starts_at <= ? ORDER BY starts_at ASC LIMIT 1`,
    ).bind(ownerId, start, end).first<{ title: string; starts_at: string }>(),
    env.DB.prepare(
      `SELECT cse.title, cse.starts_at FROM calendar_source_events cse
       JOIN calendar_sources cs ON cs.id = cse.source_id
       WHERE cs.user_id = ? AND cs.status = 'active' AND COALESCE(cse.all_day, 0) = 0
         AND cse.starts_at > ? AND cse.starts_at <= ? ORDER BY cse.starts_at ASC LIMIT 1`,
    ).bind(ownerId, start, end).first<{ title: string; starts_at: string }>(),
  ]);
  const next = [own, imported].filter((event): event is { title: string; starts_at: string } => Boolean(event))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  return next ? { title: next.title, startsAt: next.starts_at } : null;
}

/** Each source is read on its own: one that fails just leaves its starter out. */
export async function loadChatStarters(env: Env, ownerId: string, options: { now?: Date; timeZone?: string | null } = {}): Promise<ChatStarters> {
  const now = options.now ?? new Date();
  const clock = localClock(now, options.timeZone);
  const [profile, spoken, mission, event, brief, owner] = await Promise.all([
    profileBioAndName(env, ownerId).catch(() => null),
    env.DB.prepare(`SELECT 1 AS spoken FROM assistant_messages WHERE owner_id = ? AND role = 'user' LIMIT 1`)
      .bind(ownerId).first<{ spoken: number }>().catch(() => ({ spoken: 1 })),
    env.DB.prepare(`SELECT mission_statement FROM mission_dashboard_settings WHERE user_id = ?`)
      .bind(ownerId).first<{ mission_statement: string | null }>().catch(() => undefined),
    nextEventWithinHour(env, ownerId, now).catch(() => null),
    getMailboxBrief(env, ownerId, { now }).catch(() => null),
    getOwnerProfile(env, ownerId).catch(() => null),
  ]);
  const top = brief?.needsYou.find((item: { primaryAction: { kind: string } | null }) => ["send_draft", "edit_draft", "draft_reply"].includes(item.primaryAction?.kind ?? "")) ?? brief?.needsYou[0] ?? null;
  return chatStarters({
    hour: clock.hour,
    // The site's name, else the one given at signup.
    firstName: (profile?.name || owner?.name || "").trim().split(/\s+/)[0] || null,
    // A read that failed counts as built, so an owner is never sent back into first run by an error.
    siteMissing: profile ? !profile.bio : false,
    hasSpoken: Boolean(spoken),
    missionMissing: mission === undefined ? false : !ownedMissionStatement(mission?.mission_statement ?? null),
    nextEvent: event ? { title: event.title, time: clock.time(new Date(event.startsAt)) } : null,
    reply: top ? { name: top.sender.name || top.sender.address, subject: top.subject } : null,
  });
}
