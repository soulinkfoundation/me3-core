import {
  createSocialPost,
  listSocialPosts,
  SOCIAL_PUBLISHING_PLUGIN_ID,
  type SocialPostDetail,
  type SocialPostEnv,
} from "@me3-core/plugin-social-publishing";
import { SOCIAL_TEXT_LIMITS, assertOwnerWords, fitOwnerText, socialNudgeDue } from "./social-voice";

type AgentSocialStatement = {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

export type AgentSocialDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): AgentSocialStatement;
  };
  batch?: unknown;
};

export type AgentSocialPlatform = "x" | "linkedin" | "instagram" | "facebook";

export type CreateAgentSocialPostFromTextInput = {
  text: string;
  platforms: AgentSocialPlatform[];
  title?: string;
};

/**
 * Saves a draft from words the owner wrote in Chat. Each platform gets the same words, trimmed to fit its limit;
 * nothing is scheduled or posted.
 */
export async function createAgentSocialPostFromOwnerText(
  db: AgentSocialDb,
  userId: string,
  ownerText: string,
  input: CreateAgentSocialPostFromTextInput,
): Promise<SocialPostDetail> {
  if (typeof db.batch !== "function") {
    throw new Error("Social draft storage is not configured for this runtime.");
  }
  const text = requiredText(input.text, "The owner's text is required.");
  assertOwnerWords(text, ownerText, "This draft");
  const platforms = [...new Set(input.platforms)].filter((platform) => platform in SOCIAL_TEXT_LIMITS);
  if (!platforms.length) throw new Error("Choose at least one of X, LinkedIn, Instagram or Facebook.");
  const title = optionalText(input.title);
  if (title) assertOwnerWords(title, ownerText, "The title");
  const firstLine = text.split(/\n/, 1)[0]!.trim();
  const siteId = await primaryProfileSiteId(db, userId);
  return createSocialPost(
    { DB: db as unknown as SocialPostEnv["DB"] },
    userId,
    {
      siteId,
      sourceTitle: title || (firstLine.length > 70 ? `${firstLine.slice(0, 67).trimEnd()}…` : firstLine),
      sourceType: "pasted",
      sourceSnapshot: text,
      sourceText: text,
      ideaText: text,
      createdBy: "agent",
      versions: platforms.map((platform) => ({ platform, bodyText: fitOwnerText(text, SOCIAL_TEXT_LIMITS[platform]!) })),
    },
  );
}

type NudgeState = { socialNudgesOff?: boolean; socialLastNudgeAt?: string | null };

async function readNudgeState(db: AgentSocialDb): Promise<NudgeState> {
  const row = await db.prepare("SELECT setup_state_json FROM plugin_installations WHERE plugin_id = ?")
    .bind(SOCIAL_PUBLISHING_PLUGIN_ID)
    .first<{ setup_state_json: string | null }>();
  try {
    return JSON.parse(row?.setup_state_json || "{}") as NudgeState;
  } catch {
    return {};
  }
}

async function writeNudgeState(db: AgentSocialDb, patch: NudgeState): Promise<void> {
  const next = { ...(await readNudgeState(db)), ...patch };
  await db.prepare("UPDATE plugin_installations SET setup_state_json = ?, updated_at = datetime('now') WHERE plugin_id = ?")
    .bind(JSON.stringify(next), SOCIAL_PUBLISHING_PLUGIN_ID)
    .run();
}

export async function setAgentSocialNudges(db: AgentSocialDb, on: boolean): Promise<{ nudges: "on" | "off" }> {
  await writeNudgeState(db, { socialNudgesOff: !on });
  return { nudges: on ? "on" : "off" };
}

/**
 * What the agent needs to help with social: counts per tab, what's coming up, saved ideas, posts worth reposting
 * and whether a nudge is due. With `recordNudge`, a due nudge is recorded so it fires at most once a week.
 */
export async function readAgentSocialQueue(
  db: AgentSocialDb,
  userId: string,
  options: { recordNudge?: boolean; now?: Date } = {},
) {
  const env = { DB: db as unknown as SocialPostEnv["DB"] };
  const now = options.now || new Date();
  const [posts, state] = await Promise.all([
    listSocialPosts(env, userId, null),
    readNudgeState(db),
  ]);
  const weekAhead = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const summaries = posts.map((detail) => {
    const versions = detail.versions.filter((version) => version.platform !== "tiktok");
    const scheduled = versions.filter((version) => version.publicationStatus === "scheduled" && version.scheduledFor);
    const published = versions.filter((version) => version.publicationStatus === "published" && version.publishedAt);
    return {
      postId: detail.post.id,
      title: detail.post.sourceTitle,
      platforms: versions.map((version) => version.platform),
      nextScheduledAt: scheduled.map((version) => version.scheduledFor!).sort()[0] || null,
      lastPostedAt: published.map((version) => version.publishedAt!).sort().pop() || null,
      failed: versions.some((version) => version.publicationStatus === "failed"),
      draft: !scheduled.length && !published.length,
    };
  });
  const scheduledNext7Days = summaries.filter((post) => {
    const at = post.nextScheduledAt ? Date.parse(post.nextScheduledAt) : NaN;
    return Number.isFinite(at) && at >= now.getTime() && at <= weekAhead;
  }).length;
  const nudge = socialNudgeDue({
    scheduledNext7Days,
    lastNudgeAt: state.socialLastNudgeAt || null,
    nudgesOff: state.socialNudgesOff === true,
    now,
  });
  if (nudge.due && options.recordNudge) await writeNudgeState(db, { socialLastNudgeAt: now.toISOString() });
  return {
    counts: {
      drafts: summaries.filter((post) => post.draft).length,
      scheduled: summaries.filter((post) => post.nextScheduledAt).length,
      posted: summaries.filter((post) => post.lastPostedAt).length,
    },
    scheduledNext7Days,
    upcoming: summaries.filter((post) => post.nextScheduledAt).sort((a, b) => a.nextScheduledAt!.localeCompare(b.nextScheduledAt!)).slice(0, 5),
    needsAttention: summaries.filter((post) => post.failed).slice(0, 5),
    // Reposts only come from Posted, and only once a post is a month old.
    repostSuggestions: summaries
      .filter((post) => post.lastPostedAt && Date.parse(post.lastPostedAt) < monthAgo && !post.nextScheduledAt)
      .sort((a, b) => b.lastPostedAt!.localeCompare(a.lastPostedAt!))
      .slice(0, 3),
    nudge: { ...nudge, nudgesOff: state.socialNudgesOff === true },
  };
}

async function primaryProfileSiteId(db: AgentSocialDb, userId: string): Promise<string> {
  const site = await db.prepare(
    `SELECT id FROM sites
     WHERE user_id = ? AND site_role = 'profile'
     ORDER BY created_at ASC
     LIMIT 1`,
  )
    .bind(userId)
    .first<{ id: string }>();
  if (!site) throw new Error("Create a ME3 profile site before saving social drafts.");
  return site.id;
}

function requiredText(value: unknown, message: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(message);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
