import { getHomeLayout, type HomeLayout } from "./home-layout";
import { readCachedManagedPlan } from "./managed-ai-billing";
import { socialPlanAccess } from "./plan-features";
import { isCorePluginEnabled } from "./plugins";
import { siteFileContentToBytes } from "./sites";
import type { Env } from "./types";

/**
 * Show me around (me3-q6la.5): a short tour that sits over the whole app, the same on web, iOS and Android.
 * Each step points at what to tap and asks the owner to do one small real thing themselves; Core ticks it from what the install now has
 * (a card on Home, a calendar connected, a page visited, a site built), and keeps their place so the tour survives a reload
 * or a move to another app. The website comes last: it needs the owner's input and ends the tour.
 *
 * A free ME3 (ME3_TOUR=free, set by the free runtime) tours what the free plan has instead: Home, the calendar,
 * asking ME3 for a reminder, and their free me3.app page, which comes last the way the website does.
 */
/** One of the app's own places, which each client maps to its own screen: `website` is the website editor, `page` the free me3.app page editor. */
export type TourPlace = "website" | "page";
export type TourTask = { kind: "open"; label: string; to: TourPlace } | { kind: "site_ask"; label: string };
/**
 * What the card points at, in the order the owner reaches them. Each client draws the card beside the last one
 * it can see (Home tab, then + Add to Home once Home is open), with `hint` saying what to tap.
 */
export type TourTargetId = "home_tab" | "chat_tab" | "add_to_home" | "add_inbox" | "connect_calendar" | "chat_composer" | "profile_menu" | "menu_accounts" | "menu_social";
export type TourTarget = { id: TourTargetId; hint: string };
/** The screen a step is about. Next takes the owner there, and the step's `body` explains it once they're on it. */
export type TourScreen = "home" | "accounts" | "social" | "chat";
export type TourStep = {
  id: TourStepId; emoji: string; title: string; body: string;
  screen: TourScreen;
  /** Shown instead of `body` until the owner reaches `screen` by the route the targets point along. */
  intro: string | null;
  targets: TourTarget[];
  /** A button for a step the owner can't do by tapping around (the website, which needs their input). */
  task: TourTask | null;
  /** The owner has done the step. */
  done: boolean;
  /** The owner may move on without doing it (connecting a calendar): the apps offer Not now. */
  optional?: boolean;
};
export type TourStepId = "home" | "calendar" | "email" | "accounts" | "social" | "website" | "ask" | "page";
export type TourStatus = "new" | "active" | "finished" | "skipped";
export type TourProgress = { status: TourStatus; stepId: TourStepId | null };
export type ChatTour = { steps: TourStep[]; progress: TourProgress };

export type TourContext = {
  /** The free plan tours Home, the calendar, a reminder and the free page; paid plans tour email, Accounts, Social and the website. */
  plan: "paid" | "free";
  siteBuilt: boolean;
  /** A calendar is connected (an active subscribed or imported calendar). */
  calendarConnected: boolean;
  /** The owner has a task or reminder: the free tour's Ask me step. */
  hasTaskOrReminder: boolean;
  layout: HomeLayout | null;
  /** Steps whose plugin is on; a step for a plugin that's off is left out. Social also needs Business or a trial. */
  accounts: boolean;
  social: boolean;
  /** Places the owner has opened during the tour. */
  seen: string[];
  progress: TourProgress;
};

const STEP_IDS: TourStepId[] = ["home", "calendar", "email", "accounts", "social", "website", "ask", "page"];
const SEEN_PLACES: TourStepId[] = ["accounts", "social"];

/** Mirrors Home's own rule (homeSummary.visibleHomeCards) for the one card the tour asks about. */
function inboxOnHome(layout: HomeLayout | null) {
  return Boolean(layout && !layout.hidden.includes("inbox") && (layout.pinned.includes("inbox") || layout.earned.includes("inbox")));
}

export function chatTour(context: TourContext): ChatTour {
  const free = context.plan === "free";
  const steps: TourStep[] = [
    {
      id: "home", emoji: "🏠", title: "Home",
      // The first thing to do is open Home: the apps show it done once the owner is on it. A new Home already has
      // cards, so adding one can't be the tick; the next step (email, or the calendar) asks for something real.
      body: "This is Home: your day at a glance, plus cards for the things you use most. Add more any time with Add to Home.",
      screen: "home", intro: "Home shows your day: what's on, plus cards for the things you use most. Tap Home to take a look.",
      targets: [{ id: "home_tab", hint: "Tap Home at the top." }],
      task: null,
      done: true,
    },
    {
      // Every plan: the Today card's Connect your calendar opens the connect dialog, and connecting moves the owner on.
      id: "calendar", emoji: "📅", title: "Your calendar",
      body: "Connect your calendar so Today shows what's on, and I can plan around it.",
      screen: "home", intro: null,
      targets: [{ id: "home_tab", hint: "Go to Home." }, { id: "connect_calendar", hint: "Tap Connect your calendar." }],
      task: null,
      done: context.calendarConnected,
      optional: true,
    },
  ];
  if (free) {
    steps.push({
      id: "ask", emoji: "💬", title: "Ask me",
      // Asking for a reminder is the quickest way to see ME3 do something: the step ticks once a task or reminder exists.
      body: "I keep your tasks and reminders. Try asking: \"Remind me to call Mum on Friday at 5.\"",
      screen: "chat", intro: "I keep your tasks and reminders for you. Tap Chat to try it.",
      targets: [{ id: "chat_tab", hint: "Tap Chat at the top." }, { id: "chat_composer", hint: "Type what you'd like reminding about." }],
      task: null,
      done: context.hasTaskOrReminder,
    }, {
      id: "page", emoji: "🔗", title: "Your page",
      // Last, like the website: it needs the owner's input and ends the tour. Next opens Home behind the editor.
      body: "Claim your me3.app address: your name, photo and links in one place. Find it any time under your profile picture.",
      screen: "home", intro: null,
      targets: [],
      task: { kind: "open", label: "Claim my page", to: "page" },
      done: false,
    });
    const stepId = steps.some(step => step.id === context.progress.stepId) ? context.progress.stepId : null;
    return { steps, progress: { status: context.progress.status, stepId } };
  }
  const inboxDone = inboxOnHome(context.layout);
  steps.push(
    {
      id: "email", emoji: "✉️", title: "ME3's own email",
      // The Inbox card shows and copies the address; the targets lead to it.
      body: "Like any good assistant, I have my own email. Tap Add to Home and pick Inbox to see it, then forward me invoices and I'll log them in Accounts.",
      screen: "home", intro: null,
      targets: [{ id: "home_tab", hint: "Go to Home." }, { id: "add_to_home", hint: "Tap Add to Home." }, { id: "add_inbox", hint: "Pick Inbox." }],
      task: null,
      done: inboxDone,
    },
  );
  if (context.accounts) steps.push({
    id: "accounts", emoji: "📒", title: "Accounts",
    body: "Track your income and expenses here. Sales and bookings from your site show up on their own, so do invoices sent to my email.",
    // Next opens Accounts straight away, like Social and the website.
    screen: "accounts", intro: null,
    targets: [],
    task: null,
    done: context.seen.includes("accounts"),
  });
  if (context.social) steps.push({
    id: "social", emoji: "📣", title: "Socials made simple",
    body: "Connect your social accounts and post everywhere. Repost and schedule in a couple of taps.",
    screen: "social", intro: null,
    targets: [],
    task: null,
    done: context.seen.includes("social"),
  });
  steps.push({
    id: "website", emoji: "🌐", title: "Your website",
    body: context.siteBuilt
      ? "Your website is ready. Change anything in the website editor, or ask me to. Find it any time under your profile picture."
      : "Tell me about your work and I'll make a first draft. You review it in the website editor before it goes live. Find it any time under your profile picture.",
    // Next takes the owner to Chat, where ME3 drafts it.
    screen: "chat", intro: null,
    targets: [],
    task: context.siteBuilt ? { kind: "open", label: "Open", to: "website" } : { kind: "site_ask", label: "Make my website" },
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

async function calendarConnected(env: Env, ownerId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 AS found FROM calendar_sources WHERE user_id = ? AND status = 'active' LIMIT 1").bind(ownerId).first());
}

async function hasTaskOrReminder(env: Env, ownerId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare(
    "SELECT 1 AS found FROM user_reminders WHERE user_id = ? UNION ALL SELECT 1 FROM mission_tasks WHERE user_id = ? LIMIT 1",
  ).bind(ownerId, ownerId).first());
}

async function progressRow(env: Env, ownerId: string) {
  return env.DB.prepare("SELECT status, step_id, seen_json FROM chat_tour_progress WHERE user_id = ?")
    .bind(ownerId).first<{ status: string; step_id: string | null; seen_json: string }>();
}

/** Social is a Business feature: the tour shows it on Business (or self-hosted) and during a trial, when it's switched on. */
async function socialInTour(env: Env): Promise<boolean> {
  if (!(await isCorePluginEnabled(env, "me3.social-publishing"))) return false;
  if ((await socialPlanAccess(env)) === "included") return true;
  return (await readCachedManagedPlan(env).catch(() => null))?.source === "trial";
}

/** Each part is read on its own: one that fails falls back to its plainer step. */
export async function loadChatTour(env: Env, ownerId: string): Promise<ChatTour> {
  const plan = env.ME3_TOUR?.trim().toLowerCase() === "free" ? "free" : "paid";
  const paid = plan === "paid";
  const [siteBuilt, layout, accounts, social, calendar, taskOrReminder, row] = await Promise.all([
    paid ? profileSiteBuilt(env, ownerId).catch(() => true) : false,
    getHomeLayout(env, ownerId).then(result => result.layout).catch(() => null),
    paid ? isCorePluginEnabled(env, "me3.accounts").catch(() => false) : false,
    paid ? socialInTour(env).catch(() => false) : false,
    calendarConnected(env, ownerId).catch(() => false),
    paid ? false : hasTaskOrReminder(env, ownerId).catch(() => false),
    progressRow(env, ownerId).catch(() => null),
  ]);
  const { progress, seen } = readProgress(row);
  return chatTour({ plan, siteBuilt, calendarConnected: calendar, hasTaskOrReminder: taskOrReminder, layout, accounts, social, seen, progress });
}

export class TourInputError extends Error {}

/** Saves where the owner is: `status` and `stepId` as given, and `seen` added to the places they've opened. */
export async function saveChatTourProgress(env: Env, ownerId: string, input: unknown): Promise<ChatTour> {
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
  return loadChatTour(env, ownerId);
}
