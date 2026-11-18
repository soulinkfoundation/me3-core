import { getAgentMailboxOverview } from "@me3-core/plugin-agent-chat";
import { getConfiguredEmailIdentity } from "./email-providers";
import { getHomeLayout, type HomeLayout } from "./home-layout";
import { isManagedEmailDeployment } from "./managed-email";
import { isCorePluginEnabled } from "./plugins";
import { getOwnerProfile, siteFileContentToBytes } from "./sites";
import type { Env } from "./types";

/**
 * Show me around (me3-q6la.5): a short tour that sits over the whole app, the same on web, iOS and Android.
 * Each step points at what to tap and asks the owner to do one small real thing themselves; Core ticks it from what the install now has
 * (a card on Home, a page visited, a site built), and keeps their place so the tour survives a reload
 * or a move to another app. The website comes last: it needs the owner's input and ends the tour.
 */
/** One of the app's own places, which each client maps to its own screen: `website` is the website editor. */
export type TourPlace = "website";
export type TourTask = { kind: "open"; label: string; to: TourPlace } | { kind: "site_ask"; label: string };
/**
 * What the card points at, in the order the owner reaches them. Each client draws the card beside the last one
 * it can see (Home tab, then + Add to Home once Home is open), with `hint` saying what to tap.
 */
export type TourTargetId = "home_tab" | "chat_tab" | "add_to_home" | "add_inbox" | "profile_menu" | "menu_accounts" | "menu_social";
export type TourTarget = { id: TourTargetId; hint: string };
export type TourStep = {
  id: TourStepId; emoji: string; title: string; body: string;
  targets: TourTarget[];
  /** A button for a step the owner can't do by tapping around (the website, which needs their input). */
  task: TourTask | null;
  /** ME3's address, for the email step, so the owner can copy it. */
  copy: { label: string; value: string } | null;
  /** The owner has done the step. */
  done: boolean;
};
export type TourStepId = "home" | "email" | "accounts" | "social" | "website";
export type TourStatus = "new" | "active" | "finished" | "skipped";
export type TourProgress = { status: TourStatus; stepId: TourStepId | null };
export type ChatTour = { steps: TourStep[]; progress: TourProgress };

export type TourContext = {
  siteBuilt: boolean;
  emailAddress: string | null;
  layout: HomeLayout | null;
  /** Steps whose plugin is on; a step for a plugin that's off is left out. */
  accounts: boolean;
  social: boolean;
  /** Places the owner has opened during the tour. */
  seen: string[];
  progress: TourProgress;
};

const STEP_IDS: TourStepId[] = ["home", "email", "accounts", "social", "website"];
const SEEN_PLACES: TourStepId[] = ["accounts", "social"];

/** Mirrors Home's own rule (homeSummary.visibleHomeCards) for the one card the tour asks about. */
function inboxOnHome(layout: HomeLayout | null) {
  return Boolean(layout && !layout.hidden.includes("inbox") && (layout.pinned.includes("inbox") || layout.earned.includes("inbox")));
}

export function chatTour(context: TourContext): ChatTour {
  const steps: TourStep[] = [
    {
      id: "home", emoji: "🏠", title: "Home",
      body: "Home shows your day: what's on, plus your own cards for quick access to what matters to you.",
      targets: [{ id: "home_tab", hint: "Tap Home at the top." }, { id: "add_to_home", hint: "Now tap Add to Home and pick any card." }],
      task: null, copy: null,
      done: Boolean(context.layout?.pinned.length),
    },
    {
      id: "email", emoji: "✉️", title: "ME3's own email",
      body: "Like any good assistant, I have my own email. Forward me invoices and I'll log them in your Accounts. Add my email card to Home for quick access.",
      targets: [{ id: "home_tab", hint: "Go to Home." }, { id: "add_to_home", hint: "Tap Add to Home." }, { id: "add_inbox", hint: "Pick Inbox." }],
      task: null,
      copy: context.emailAddress ? { label: "Copy my address", value: context.emailAddress } : null,
      done: inboxOnHome(context.layout),
    },
  ];
  if (context.accounts) steps.push({
    id: "accounts", emoji: "📒", title: "Accounts",
    body: "Track your income and expenses in one place. Purchases and bookings from your site show up on their own, and so do invoices sent to my email.",
    targets: [{ id: "profile_menu", hint: "Tap your profile picture. Everything in ME3 is in this menu." }, { id: "menu_accounts", hint: "Now tap Accounts." }],
    task: null, copy: null,
    done: context.seen.includes("accounts"),
  });
  if (context.social) steps.push({
    id: "social", emoji: "📣", title: "Socials made simple",
    body: "Connect your accounts and post everywhere from one place. Repost and schedule in a couple of taps.",
    targets: [{ id: "profile_menu", hint: "Tap your profile picture again." }, { id: "menu_social", hint: "Tap Social." }],
    task: null, copy: null,
    done: context.seen.includes("social"),
  });
  steps.push({
    id: "website", emoji: "🌐", title: "Your website",
    body: context.siteBuilt
      ? "Your website is ready. Change anything in the website editor, or ask me to. Find it any time under your profile picture."
      : "Tell me about your work and I'll make a first draft. You review it in the website editor before it goes live. Find it any time under your profile picture.",
    // Back to Chat, where ME3 drafts it; no need for the menu again.
    targets: [{ id: "chat_tab", hint: "Tap Chat at the top." }],
    task: context.siteBuilt ? { kind: "open", label: "Open the editor", to: "website" } : { kind: "site_ask", label: "Make my website" },
    copy: null,
    done: context.siteBuilt,
  });
  const stepId = steps.some(step => step.id === context.progress.stepId) ? context.progress.stepId : null;
  return { steps, progress: { status: context.progress.status, stepId } };
}

function readProgress(row: { status: string; step_id: string | null; seen_json: string } | null): { progress: TourProgress; seen: string[] } {
  if (!row) return { progress: { status: "new", stepId: null }, seen: [] };
  const status = (["active", "finished", "skipped"] as const).find(value => value === row.status) ?? "active";
  const stepId = STEP_IDS.find(id => id === row.step_id) ?? null;
  let seen: string[] = [];
  try { const parsed = JSON.parse(row.seen_json); if (Array.isArray(parsed)) seen = parsed.filter((id): id is string => typeof id === "string"); } catch { /* start fresh */ }
  return { progress: { status, stepId }, seen };
}

async function profileSiteBuilt(env: Env, ownerId: string): Promise<boolean> {
  const file = await env.DB.prepare(
    `SELECT sf.content FROM site_files sf JOIN sites s ON s.id = sf.site_id
     WHERE s.user_id = ? AND COALESCE(s.site_role, COALESCE(s.site_type, 'profile')) = 'profile' AND sf.path = 'src/me.json'
     ORDER BY s.created_at ASC LIMIT 1`,
  ).bind(ownerId).first<{ content: Parameters<typeof siteFileContentToBytes>[0] | string }>();
  if (!file?.content) return false;
  try {
    const text = typeof file.content === "string" ? file.content : new TextDecoder().decode(siteFileContentToBytes(file.content));
    const bio = (JSON.parse(text) as { bio?: unknown }).bio;
    return typeof bio === "string" && bio.trim().length > 0;
  } catch { return true; } // Unreadable counts as built: never offer to redo an owner's site.
}

/** ME3's own address, read the way GET /api/mailbox does. */
async function agentEmailAddress(env: Env, ownerId: string): Promise<string | null> {
  const owner = await getOwnerProfile(env, ownerId);
  const configuredIdentity = isManagedEmailDeployment(env) ? null : await getConfiguredEmailIdentity(env, ownerId).catch(() => null);
  const overview = await getAgentMailboxOverview(env, ownerId, owner || undefined, { includeRecentActivity: false, configuredIdentity });
  return overview.mailbox?.aliasAddress || overview.sources.find(source => source.inboundEnabled)?.address || null;
}

async function progressRow(env: Env, ownerId: string) {
  return env.DB.prepare("SELECT status, step_id, seen_json FROM chat_tour_progress WHERE user_id = ?")
    .bind(ownerId).first<{ status: string; step_id: string | null; seen_json: string }>();
}

/** Each part is read on its own: one that fails falls back to its plainer step. */
export async function loadChatTour(env: Env, ownerId: string, options: { emailAddress?: () => Promise<string | null> } = {}): Promise<ChatTour> {
  const [siteBuilt, emailAddress, layout, accounts, social, row] = await Promise.all([
    profileSiteBuilt(env, ownerId).catch(() => true),
    (options.emailAddress ?? (() => agentEmailAddress(env, ownerId)))().catch(() => null),
    getHomeLayout(env, ownerId).then(result => result.layout).catch(() => null),
    isCorePluginEnabled(env, "me3.accounts").catch(() => false),
    isCorePluginEnabled(env, "me3.social-publishing").catch(() => false),
    progressRow(env, ownerId).catch(() => null),
  ]);
  const { progress, seen } = readProgress(row);
  return chatTour({ siteBuilt, emailAddress, layout, accounts, social, seen, progress });
}

export class TourInputError extends Error {}

/** Saves where the owner is: `status` and `stepId` as given, and `seen` added to the places they've opened. */
export async function saveChatTourProgress(env: Env, ownerId: string, input: unknown, options: { emailAddress?: () => Promise<string | null> } = {}): Promise<ChatTour> {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const { progress, seen } = readProgress(await progressRow(env, ownerId));
  const status = body.status === undefined ? (progress.status === "new" ? "active" : progress.status) : body.status;
  if (!["active", "finished", "skipped"].includes(status as string)) throw new TourInputError("status must be active, finished or skipped");
  const stepId = body.stepId === undefined ? progress.stepId : body.stepId;
  if (stepId !== null && !STEP_IDS.includes(stepId as TourStepId)) throw new TourInputError("stepId is not a tour step");
  if (body.seen !== undefined && !SEEN_PLACES.includes(body.seen as TourStepId)) throw new TourInputError("seen is not a tour place");
  const nextSeen = body.seen && !seen.includes(body.seen as string) ? [...seen, body.seen as string] : seen;
  await env.DB.prepare(`INSERT INTO chat_tour_progress(user_id, status, step_id, seen_json, updated_at) VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, step_id = excluded.step_id, seen_json = excluded.seen_json, updated_at = excluded.updated_at`)
    .bind(ownerId, status, stepId, JSON.stringify(nextSeen)).run();
  return loadChatTour(env, ownerId, options);
}
