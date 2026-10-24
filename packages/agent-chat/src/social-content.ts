import { normalizeTimeZone } from "@me3-core/plugin-calendar";
import {
  createSocialSuggestions,
  createSocialPost,
  listSocialPosts,
  listSocialSuggestions,
  SOCIAL_PUBLISHING_PLUGIN_ID,
  type SocialSuggestion,
  type CreateSocialPostInput,
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

export type AgentSocialSourceType = "journal" | "mission_task";

export type AgentSocialSource = {
  sourceType: AgentSocialSourceType;
  requestedRef: string;
  id: string;
  title: string;
  content: string;
  snapshot: string;
};

export type CreateAgentSocialPostInput = {
  siteId?: string;
  ideaText: string;
  linkedinBody?: string;
  xBody?: string;
  instagramBody?: string;
};

export type CreateAgentSocialSuggestionsInput = {
  siteId?: string;
  quoteText: string;
  quoteSourceExcerpt: string;
  quoteTrimmed?: boolean;
  shortPostText: string;
  shortPostSourceExcerpt: string;
  threadText: string;
  threadSourceExcerpt: string;
  carouselOutlineText: string;
  carouselSourceExcerpt: string;
};

type JournalRow = {
  id: string;
  entry_date: string;
  title: string | null;
  body: string;
  body_format: string;
  updated_at: string;
};

type MissionTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  due_at: string | null;
  project_id: string | null;
  project_name: string | null;
  updated_at: string;
};

export async function readAgentSocialSource(
  db: AgentSocialDb,
  userId: string,
  sourceType: AgentSocialSourceType,
  sourceRefInput: string,
  ownerTimezone: string | null | undefined,
): Promise<AgentSocialSource> {
  const requestedRef = requiredText(sourceRefInput, "Social source ID is required.");

  if (sourceType === "journal") {
    const resolvedRef = requestedRef.toLowerCase() === "today"
      ? localDate(new Date(), ownerTimezone)
      : requestedRef;
    const lookupByDate = /^\d{4}-\d{2}-\d{2}$/.test(resolvedRef);
    const row = await db.prepare(
      `SELECT id, entry_date, title, body, body_format, updated_at
       FROM journal_entries
       WHERE user_id = ? AND ${lookupByDate ? "entry_date" : "id"} = ?
         AND archived_at IS NULL
       LIMIT 1`,
    )
      .bind(userId, resolvedRef)
      .first<JournalRow>();
    if (!row) {
      throw new Error(
        lookupByDate
          ? `No Journal entry was found for ${resolvedRef}.`
          : "Journal entry not found. Use its stable entry ID, date, or today.",
      );
    }
    const title = row.title?.trim() || `Journal entry for ${row.entry_date}`;
    return {
      sourceType,
      requestedRef,
      id: row.id,
      title,
      content: row.body,
      snapshot: JSON.stringify({
        id: row.id,
        entryDate: row.entry_date,
        title,
        body: row.body,
        bodyFormat: row.body_format,
        updatedAt: row.updated_at,
      }),
    };
  }

  const row = await db.prepare(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_at,
            t.project_id, p.name AS project_name, t.updated_at
     FROM mission_tasks t
     LEFT JOIN mission_projects p ON p.id = t.project_id AND p.user_id = t.user_id
     WHERE t.user_id = ? AND t.id = ? AND t.archived_at IS NULL
     LIMIT 1`,
  )
    .bind(userId, requestedRef)
    .first<MissionTaskRow>();
  if (!row) {
    throw new Error("Task not found. List tasks and use a valid stable task ID.");
  }
  const content = [
    row.title,
    row.description?.trim(),
    row.project_name ? `Project: ${row.project_name}` : null,
    `Status: ${row.status}`,
    row.due_at ? `Due: ${row.due_at}` : null,
  ].filter(Boolean).join("\n");
  return {
    sourceType,
    requestedRef,
    id: row.id,
    title: row.title,
    content,
    snapshot: JSON.stringify({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueAt: row.due_at,
      projectId: row.project_id,
      projectName: row.project_name,
      updatedAt: row.updated_at,
    }),
  };
}

export async function createAgentSocialPost(
  db: AgentSocialDb,
  userId: string,
  source: AgentSocialSource,
  input: CreateAgentSocialPostInput,
): Promise<SocialPostDetail> {
  if (typeof db.batch !== "function") {
    throw new Error("Social draft storage is not configured for this runtime.");
  }
  const siteId = optionalText(input.siteId) || await primaryProfileSiteId(db, userId);
  const versions: CreateSocialPostInput["versions"] = [];
  const linkedinBody = optionalText(input.linkedinBody);
  const xBody = optionalText(input.xBody);
  const instagramBody = optionalText(input.instagramBody);
  if (linkedinBody) versions.push({ platform: "linkedin", bodyText: linkedinBody });
  if (xBody) versions.push({ platform: "x", bodyText: xBody });
  if (instagramBody) versions.push({ platform: "instagram", bodyText: instagramBody });
  if (versions.length === 0) {
    throw new Error("At least one LinkedIn, X, or Instagram draft body is required.");
  }
  // Drafts keep the owner's wording: every word must come from the source they wrote.
  for (const version of versions) assertOwnerWords(version.bodyText, source.content, `The ${version.platform} draft`);

  return createSocialPost(
    { DB: db as unknown as SocialPostEnv["DB"] },
    userId,
    {
      siteId,
      sourceTitle: source.title,
      sourceType: source.sourceType,
      sourceRef: `${source.sourceType}:${source.id}`,
      sourceSnapshot: source.snapshot,
      sourceText: source.content,
      ideaText: requiredText(input.ideaText, "Social draft ideaText is required."),
      createdBy: "agent",
      versions,
    },
  );
}

export async function createAgentSocialSuggestions(
  db: AgentSocialDb,
  userId: string,
  source: AgentSocialSource,
  input: CreateAgentSocialSuggestionsInput,
): Promise<SocialSuggestion[]> {
  if (typeof db.batch !== "function") {
    throw new Error("Social Suggestion storage is not configured for this runtime.");
  }
  const siteId = optionalText(input.siteId) || await primaryProfileSiteId(db, userId);
  return createSocialSuggestions(
    { DB: db as unknown as SocialPostEnv["DB"] },
    userId,
    {
      siteId,
      sourceType: source.sourceType,
      sourceRef: `${source.sourceType}:${source.id}`,
      sourceTitle: source.title,
      sourceSnapshot: source.snapshot,
      sourceText: source.content,
      createdBy: "agent",
      suggestions: [
        {
          kind: "quote",
          bodyText: requiredText(input.quoteText, "Quote Suggestion text is required."),
          sourceExcerpt: requiredText(
            input.quoteSourceExcerpt,
            "Quote Suggestion Source text is required.",
          ),
          quoteTrimmed: input.quoteTrimmed === true,
        },
        {
          kind: "short_post",
          bodyText: requiredText(
            input.shortPostText,
            "Short Post Suggestion text is required.",
          ),
          sourceExcerpt: requiredText(
            input.shortPostSourceExcerpt,
            "Short Post Suggestion Source text is required.",
          ),
        },
        {
          kind: "thread",
          bodyText: requiredText(input.threadText, "Thread Suggestion text is required."),
          sourceExcerpt: requiredText(
            input.threadSourceExcerpt,
            "Thread Suggestion Source text is required.",
          ),
        },
        {
          kind: "carousel_outline",
          bodyText: requiredText(
            input.carouselOutlineText,
            "Carousel outline Suggestion text is required.",
          ),
          sourceExcerpt: requiredText(
            input.carouselSourceExcerpt,
            "Carousel outline Suggestion Source text is required.",
          ),
        },
      ],
    },
  );
}

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
  const [posts, ideas, state] = await Promise.all([
    listSocialPosts(env, userId, null),
    listSocialSuggestions(env, userId, null, "suggested"),
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
      ideas: ideas.length,
      drafts: summaries.filter((post) => post.draft).length,
      scheduled: summaries.filter((post) => post.nextScheduledAt).length,
      posted: summaries.filter((post) => post.lastPostedAt).length,
    },
    scheduledNext7Days,
    upcoming: summaries.filter((post) => post.nextScheduledAt).sort((a, b) => a.nextScheduledAt!.localeCompare(b.nextScheduledAt!)).slice(0, 5),
    needsAttention: summaries.filter((post) => post.failed).slice(0, 5),
    ideas: ideas.slice(0, 5).map((idea) => ({ ideaId: idea.id, title: idea.sourceTitle, text: idea.bodyText })),
    // Reposts only come from Posted, and only once a post is a month old.
    repostSuggestions: summaries
      .filter((post) => post.lastPostedAt && Date.parse(post.lastPostedAt) < monthAgo && !post.nextScheduledAt)
      .sort((a, b) => b.lastPostedAt!.localeCompare(a.lastPostedAt!))
      .slice(0, 3),
    nudge: { ...nudge, nudgesOff: state.socialNudgesOff === true },
  };
}

export function agentSocialSourceKey(
  sourceType: AgentSocialSourceType,
  sourceRef: string,
): string {
  return `${sourceType}:${sourceRef.trim().toLowerCase()}`;
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

function localDate(now: Date, timezoneInput: string | null | undefined): string {
  const timezone = normalizeTimeZone(timezoneInput) || "UTC";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function requiredText(value: unknown, message: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(message);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
