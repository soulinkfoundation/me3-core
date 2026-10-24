import {
  SocialPostInputError,
  createSocialPost,
  getSocialPost,
  type SocialPostDetail,
  type SocialPostEnv,
  type SocialPostSourceType,
} from "./content-packages";
import type { SocialPlatform } from "./index";

export const SOCIAL_SUGGESTION_KINDS = [
  "quote",
  "short_post",
  "thread",
  "carousel_outline",
] as const;

export type SocialSuggestionKind = (typeof SOCIAL_SUGGESTION_KINDS)[number];
export type SocialSuggestionStatus = "suggested" | "choosing" | "chosen" | "discarded";

export type SocialSuggestion = {
  id: string;
  siteId: string;
  sourceType: SocialPostSourceType;
  sourceRef: string;
  sourceTitle: string;
  sourceSnapshot: string;
  sourceText: string;
  kind: SocialSuggestionKind;
  bodyText: string;
  sourceExcerpt: string;
  quoteTrimmed: boolean;
  status: SocialSuggestionStatus;
  selectedPostId: string | null;
  choosingPlatforms: SocialPlatform[] | null;
  choosingAt: string | null;
  createdBy: "user" | "agent";
  createdAt: string;
  updatedAt: string;
};

export type CreateSocialSuggestionsInput = {
  siteId: string;
  sourceType: SocialPostSourceType;
  sourceRef?: string | null;
  sourceTitle: string;
  sourceSnapshot: string;
  sourceText: string;
  createdBy?: "user" | "agent";
  suggestions: Array<{
    kind: SocialSuggestionKind;
    bodyText: string;
    sourceExcerpt: string;
    quoteTrimmed?: boolean;
  }>;
};

export type UpdateSocialSuggestionInput = {
  expectedUpdatedAt: string;
  bodyText?: string;
  sourceExcerpt?: string;
  quoteTrimmed?: boolean;
};

export type ChooseSocialSuggestionInput = {
  platforms: SocialPlatform[];
  expectedUpdatedAt: string;
};

export type DiscardSocialSuggestionInput = {
  expectedUpdatedAt: string;
};

type SuggestionRow = {
  id: string;
  site_id: string;
  source_type: SocialPostSourceType;
  source_ref: string;
  source_title: string;
  source_snapshot: string;
  source_text: string;
  suggestion_kind: SocialSuggestionKind;
  body_text: string;
  source_excerpt: string;
  quote_trimmed: number;
  status: SocialSuggestionStatus;
  selected_post_id: string | null;
  choose_token: string | null;
  choosing_at: string | null;
  choose_platforms_json: string | null;
  created_by: "user" | "agent";
  created_at: string;
  updated_at: string;
};

const SUPPORTED_PLATFORMS = new Set<SocialPlatform>([
  "x",
  "linkedin",
  "instagram",
  "instagram_business",
  "facebook",
  "youtube",
  "tiktok",
]);

const STALE_CHOOSE_CLAIM_MS = 5 * 60_000;

export class SocialSuggestionInputError extends SocialPostInputError {}

export async function createSocialSuggestions(
  env: SocialPostEnv,
  ownerId: string,
  input: CreateSocialSuggestionsInput,
): Promise<SocialSuggestion[]> {
  const siteId = requiredText(input.siteId, "siteId is required");
  const site = await env.DB.prepare("SELECT id FROM sites WHERE id = ? AND user_id = ?")
    .bind(siteId, ownerId)
    .first<{ id: string }>();
  if (!site) throw new SocialSuggestionInputError("Site not found", 404);

  if (!isSourceType(input.sourceType)) {
    throw new SocialSuggestionInputError("Unsupported Suggestion Source");
  }
  const sourceTitle = requiredText(input.sourceTitle, "Source title is required");
  const sourceSnapshot = requiredText(
    input.sourceSnapshot,
    "A human-authored Source snapshot is required",
  );
  const sourceText = requiredText(
    input.sourceText,
    "Visible human-authored Source text is required",
  );
  if (input.sourceType === "pasted" && sourceSnapshot !== sourceText) {
    throw new SocialSuggestionInputError(
      "Pasted Source text must be preserved as the exact Source snapshot",
    );
  }
  if (!Array.isArray(input.suggestions) || input.suggestions.length < 2) {
    throw new SocialSuggestionInputError("At least two grounded Suggestions are required");
  }
  if (input.suggestions.length > 12) {
    throw new SocialSuggestionInputError("No more than 12 Suggestions can be saved at once");
  }

  const sourceGroupId = crypto.randomUUID();
  const sourceRef = optionalText(input.sourceRef) ||
    (input.sourceType === "pasted" ? `pasted:social-source-${sourceGroupId}` : null);
  if (!sourceRef) {
    throw new SocialSuggestionInputError(
      `${input.sourceType} Sources require a stable reference`,
    );
  }

  const now = new Date().toISOString();
  const ids: string[] = [];
  const statements = input.suggestions.map((candidate) => {
    const suggestion = validatedSuggestion(candidate, sourceText);
    const id = `social-suggestion-${crypto.randomUUID()}`;
    ids.push(id);
    return env.DB.prepare(
      `INSERT INTO social_suggestions (
         id, site_id, source_type, source_ref, source_title, source_snapshot,
         source_text, suggestion_kind, body_text, source_excerpt, quote_trimmed,
         status, selected_post_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', NULL, ?, ?, ?)`,
    ).bind(
      id,
      siteId,
      input.sourceType,
      sourceRef,
      sourceTitle,
      sourceSnapshot,
      sourceText,
      suggestion.kind,
      suggestion.bodyText,
      suggestion.sourceExcerpt,
      suggestion.quoteTrimmed ? 1 : 0,
      input.createdBy === "user" ? "user" : "agent",
      now,
      now,
    );
  });

  await env.DB.batch(statements);
  const created = await listSuggestionRowsByIds(env, ownerId, ids);
  if (created.length !== ids.length) {
    throw new SocialSuggestionInputError("Could not save grounded Suggestions");
  }
  return created;
}

export async function listSocialSuggestions(
  env: SocialPostEnv,
  ownerId: string,
  siteIdInput?: string | null,
  statusInput: SocialSuggestionStatus | "all" = "suggested",
): Promise<SocialSuggestion[]> {
  const siteId = optionalText(siteIdInput);
  if (!isSuggestionStatus(statusInput) && statusInput !== "all") {
    throw new SocialSuggestionInputError("Unsupported Suggestion status");
  }
  const result = await env.DB.prepare(
    `${suggestionSelectSql()}
     WHERE s.user_id = ?
       AND (? IS NULL OR suggestion.site_id = ?)
       AND (
         ? = 'all'
         OR (? = 'suggested' AND suggestion.status IN ('suggested', 'choosing'))
         OR suggestion.status = ?
       )
     ORDER BY suggestion.updated_at DESC, suggestion.created_at ASC`,
  )
    .bind(ownerId, siteId, siteId, statusInput, statusInput, statusInput)
    .all<SuggestionRow>();
  return (result.results || []).map(serializeSuggestion);
}

export async function updateSocialSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  suggestionIdInput: string,
  input: UpdateSocialSuggestionInput,
): Promise<SocialSuggestion | null> {
  const suggestionId = requiredText(suggestionIdInput, "Suggestion id is required");
  const existing = await getSocialSuggestionRow(env, ownerId, suggestionId);
  if (!existing) return null;
  const expectedUpdatedAt = expectedSuggestionUpdatedAt(input.expectedUpdatedAt);
  requireEditableSuggestion(serializeSuggestion(existing));
  if (existing.updated_at !== expectedUpdatedAt) {
    throw staleSuggestionError();
  }
  if (
    input.bodyText === undefined &&
    input.sourceExcerpt === undefined &&
    input.quoteTrimmed === undefined
  ) {
    throw new SocialSuggestionInputError("Choose at least one Suggestion field to edit");
  }
  const candidate = validatedSuggestion(
    {
      kind: existing.suggestion_kind,
      bodyText: input.bodyText ?? existing.body_text,
      sourceExcerpt: input.sourceExcerpt ?? existing.source_excerpt,
      quoteTrimmed: input.quoteTrimmed ?? existing.quote_trimmed === 1,
    },
    existing.source_text,
  );
  const now = nextSuggestionUpdatedAt(expectedUpdatedAt);
  const updated = await env.DB.prepare(
    `UPDATE social_suggestions
     SET body_text = ?, source_excerpt = ?, quote_trimmed = ?, updated_at = ?
     WHERE id = ? AND status = 'suggested' AND updated_at = ?
       AND body_text = ? AND source_excerpt = ? AND quote_trimmed = ?
       AND EXISTS (
         SELECT 1 FROM sites
         WHERE sites.id = social_suggestions.site_id AND sites.user_id = ?
       )
     RETURNING id`,
  )
    .bind(
      candidate.bodyText,
      candidate.sourceExcerpt,
      candidate.quoteTrimmed ? 1 : 0,
      now,
      suggestionId,
      expectedUpdatedAt,
      existing.body_text,
      existing.source_excerpt,
      existing.quote_trimmed,
      ownerId,
    )
    .first<{ id: string }>();
  if (!updated) {
    if (!(await getSocialSuggestionRow(env, ownerId, suggestionId))) return null;
    throw staleSuggestionError();
  }
  return getSocialSuggestion(env, ownerId, suggestionId);
}

export async function discardSocialSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  suggestionIdInput: string,
  input: DiscardSocialSuggestionInput,
): Promise<SocialSuggestion | null> {
  const suggestionId = requiredText(suggestionIdInput, "Suggestion id is required");
  const existing = await getSocialSuggestionRow(env, ownerId, suggestionId);
  if (!existing) return null;
  const expectedUpdatedAt = expectedSuggestionUpdatedAt(input.expectedUpdatedAt);
  requireEditableSuggestion(serializeSuggestion(existing));
  if (existing.updated_at !== expectedUpdatedAt) {
    throw staleSuggestionError();
  }
  const discarded = await env.DB.prepare(
    `UPDATE social_suggestions
     SET status = 'discarded', updated_at = ?
     WHERE id = ? AND status = 'suggested' AND updated_at = ?
       AND body_text = ? AND source_excerpt = ? AND quote_trimmed = ?
       AND EXISTS (
         SELECT 1 FROM sites
         WHERE sites.id = social_suggestions.site_id AND sites.user_id = ?
       )
     RETURNING id`,
  )
    .bind(
      nextSuggestionUpdatedAt(expectedUpdatedAt),
      suggestionId,
      expectedUpdatedAt,
      existing.body_text,
      existing.source_excerpt,
      existing.quote_trimmed,
      ownerId,
    )
    .first<{ id: string }>();
  if (!discarded) {
    if (!(await getSocialSuggestionRow(env, ownerId, suggestionId))) return null;
    throw staleSuggestionError();
  }
  return getSocialSuggestion(env, ownerId, suggestionId);
}

export async function chooseSocialSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  suggestionIdInput: string,
  input: ChooseSocialSuggestionInput,
): Promise<{ suggestion: SocialSuggestion; post: SocialPostDetail } | null> {
  const suggestionId = requiredText(suggestionIdInput, "Suggestion id is required");
  const existing = await getSocialSuggestionRow(env, ownerId, suggestionId);
  if (!existing) return null;
  if (existing.status === "chosen") {
    return chosenSuggestionResult(env, ownerId, existing);
  }
  const expectedUpdatedAt = expectedSuggestionUpdatedAt(input.expectedUpdatedAt);
  if (existing.status === "choosing") {
    return resumeChoosingSuggestion(env, ownerId, existing, expectedUpdatedAt);
  }
  requireEditableSuggestion(serializeSuggestion(existing));
  if (existing.updated_at !== expectedUpdatedAt) {
    throw staleSuggestionError();
  }
  const deterministicPost = await getSocialPost(
    env,
    ownerId,
    suggestionPostId(existing.id),
  );
  const platforms = deterministicPost
    ? validatePlatforms(deterministicPost.versions.map(({ platform }) => platform))
    : validatePlatforms(input.platforms);
  if (deterministicPost) {
    assertPostMatchesSuggestion(deterministicPost, existing, platforms);
  }

  const token = `social-suggestion-choose-${crypto.randomUUID()}`;
  const choosingAt = new Date().toISOString();
  const updatedAt = nextSuggestionUpdatedAt(existing.updated_at);
  const platformsJson = JSON.stringify(platforms);
  const claimed = await env.DB.prepare(
    `UPDATE social_suggestions
     SET status = 'choosing', choose_token = ?, choosing_at = ?,
         choose_platforms_json = ?, updated_at = ?
     WHERE id = ? AND status = 'suggested' AND updated_at = ?
       AND body_text = ? AND source_excerpt = ? AND quote_trimmed = ?
       AND EXISTS (
         SELECT 1 FROM sites
         WHERE sites.id = social_suggestions.site_id AND sites.user_id = ?
       )
     RETURNING id`,
  )
    .bind(
      token,
      choosingAt,
      platformsJson,
      updatedAt,
      suggestionId,
      expectedUpdatedAt,
      existing.body_text,
      existing.source_excerpt,
      existing.quote_trimmed,
      ownerId,
    )
    .first<{ id: string }>();

  if (!claimed) {
    const latest = await getSocialSuggestionRow(env, ownerId, suggestionId);
    if (!latest) return null;
    if (latest.status === "chosen") return chosenSuggestionResult(env, ownerId, latest);
    if (latest.status === "choosing") {
      return resumeChoosingSuggestion(env, ownerId, latest, expectedUpdatedAt);
    }
    throw staleSuggestionError();
  }

  const claim = await getSocialSuggestionRow(env, ownerId, suggestionId);
  if (!claim || claim.status !== "choosing" || claim.choose_token !== token) {
    throw new SocialSuggestionInputError(
      "This Suggestion changed while it was being saved. Refresh and try again.",
      409,
    );
  }
  return completeChoosingSuggestion(
    env,
    ownerId,
    claim,
    existing.updated_at,
  );
}

async function resumeChoosingSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  claim: SuggestionRow,
  expectedUpdatedAt: string,
): Promise<{ suggestion: SocialSuggestion; post: SocialPostDetail }> {
  const platforms = requirePersistedChoosePlatforms(claim);
  const postId = suggestionPostId(claim.id);
  const existingPost = await getSocialPost(env, ownerId, postId);
  if (existingPost) {
    assertPostMatchesSuggestion(existingPost, claim, platforms);
    return finalizeChoosingSuggestion(env, ownerId, claim, existingPost);
  }

  if (!isStaleChooseClaim(claim.choosing_at)) {
    throw new SocialSuggestionInputError(
      "This Suggestion is already being saved as a Post. Try again in a moment.",
      409,
    );
  }
  if (claim.updated_at !== expectedUpdatedAt) {
    throw staleSuggestionError();
  }

  const token = `social-suggestion-choose-${crypto.randomUUID()}`;
  const choosingAt = new Date().toISOString();
  const updatedAt = nextSuggestionUpdatedAt(claim.updated_at);
  const takenOver = await env.DB.prepare(
    `UPDATE social_suggestions
     SET choose_token = ?, choosing_at = ?, updated_at = ?
     WHERE id = ? AND status = 'choosing' AND choose_token = ?
       AND choosing_at = ? AND choose_platforms_json = ? AND updated_at = ?
       AND body_text = ? AND source_excerpt = ? AND quote_trimmed = ?
       AND EXISTS (
         SELECT 1 FROM sites
         WHERE sites.id = social_suggestions.site_id AND sites.user_id = ?
       )
     RETURNING id`,
  )
    .bind(
      token,
      choosingAt,
      updatedAt,
      claim.id,
      claim.choose_token,
      claim.choosing_at,
      claim.choose_platforms_json,
      claim.updated_at,
      claim.body_text,
      claim.source_excerpt,
      claim.quote_trimmed,
      ownerId,
    )
    .first<{ id: string }>();

  if (!takenOver) {
    const latest = await getSocialSuggestionRow(env, ownerId, claim.id);
    if (!latest) {
      throw new SocialSuggestionInputError("Suggestion not found", 404);
    }
    if (latest.status === "chosen") return chosenSuggestionResult(env, ownerId, latest);
    const recoveredPost = await getSocialPost(env, ownerId, postId);
    if (latest.status === "choosing" && recoveredPost) {
      assertPostMatchesSuggestion(
        recoveredPost,
        latest,
        requirePersistedChoosePlatforms(latest),
      );
      return finalizeChoosingSuggestion(env, ownerId, latest, recoveredPost);
    }
    throw new SocialSuggestionInputError(
      "This Suggestion changed while its Post was being recovered. Refresh and try again.",
      409,
    );
  }

  const takeover = await getSocialSuggestionRow(env, ownerId, claim.id);
  if (!takeover || takeover.status !== "choosing" || takeover.choose_token !== token) {
    throw new SocialSuggestionInputError(
      "This Suggestion changed while its Post was being recovered. Refresh and try again.",
      409,
    );
  }
  return completeChoosingSuggestion(env, ownerId, takeover, claim.updated_at);
}

async function completeChoosingSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  claim: SuggestionRow,
  rollbackUpdatedAt: string,
): Promise<{ suggestion: SocialSuggestion; post: SocialPostDetail }> {
  const platforms = requirePersistedChoosePlatforms(claim);
  const postId = suggestionPostId(claim.id);
  let detail = await getSocialPost(env, ownerId, postId);
  if (!detail) {
    try {
      detail = await createSocialPost(env, ownerId, {
        siteId: claim.site_id,
        sourceTitle: claim.source_title,
        sourceType: claim.source_type,
        sourceRef: claim.source_ref,
        sourceSnapshot: claim.source_snapshot,
        sourceText: claim.source_text,
        ideaText: summarizeSuggestion(claim.body_text),
        createdBy: "user",
        versions: platforms.map((platform) => ({
          platform,
          format: claim.suggestion_kind === "carousel_outline" ? "carousel" : "post",
          bodyText: claim.body_text,
        })),
      }, { postId });
    } catch (error) {
      detail = await getSocialPost(env, ownerId, postId);
      if (!detail) {
        await rollbackChoosingSuggestion(env, ownerId, claim, rollbackUpdatedAt);
        throw error;
      }
    }
  }

  assertPostMatchesSuggestion(detail, claim, platforms);
  return finalizeChoosingSuggestion(env, ownerId, claim, detail);
}

async function finalizeChoosingSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  initialClaim: SuggestionRow,
  detail: SocialPostDetail,
): Promise<{ suggestion: SocialSuggestion; post: SocialPostDetail }> {
  let claim = initialClaim;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const finalized = await env.DB.prepare(
      `UPDATE social_suggestions
       SET status = 'chosen', selected_post_id = ?, choose_token = NULL,
           choosing_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'choosing' AND choose_token = ?
         AND choosing_at = ? AND choose_platforms_json = ? AND updated_at = ?
         AND body_text = ? AND source_excerpt = ? AND quote_trimmed = ?
         AND EXISTS (
           SELECT 1 FROM sites
           WHERE sites.id = social_suggestions.site_id AND sites.user_id = ?
         )
       RETURNING id`,
    )
      .bind(
        detail.post.id,
        nextSuggestionUpdatedAt(claim.updated_at),
        claim.id,
        claim.choose_token,
        claim.choosing_at,
        claim.choose_platforms_json,
        claim.updated_at,
        claim.body_text,
        claim.source_excerpt,
        claim.quote_trimmed,
        ownerId,
      )
      .first<{ id: string }>();

    const latest = await getSocialSuggestionRow(env, ownerId, claim.id);
    if (!latest) {
      throw new SocialSuggestionInputError("Suggestion not found", 404);
    }
    if (latest.status === "chosen" && latest.selected_post_id === detail.post.id) {
      return { suggestion: serializeSuggestion(latest), post: detail };
    }
    if (finalized) {
      throw new SocialSuggestionInputError("Could not record the chosen Suggestion");
    }
    if (latest.status === "choosing" && attempt === 0) {
      assertPostMatchesSuggestion(
        detail,
        latest,
        requirePersistedChoosePlatforms(latest),
      );
      claim = latest;
      continue;
    }
    throw new SocialSuggestionInputError(
      "This Suggestion changed while its Post was being finalized. Refresh and try again.",
      409,
    );
  }
  throw new SocialSuggestionInputError("Could not record the chosen Suggestion");
}

async function rollbackChoosingSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  claim: SuggestionRow,
  rollbackUpdatedAt: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE social_suggestions
     SET status = 'suggested', choose_token = NULL, choosing_at = NULL,
         choose_platforms_json = NULL, updated_at = ?
     WHERE id = ? AND status = 'choosing' AND choose_token = ?
       AND updated_at = ?
       AND NOT EXISTS (SELECT 1 FROM social_packages WHERE id = ?)
       AND EXISTS (
         SELECT 1 FROM sites
         WHERE sites.id = social_suggestions.site_id AND sites.user_id = ?
       )`,
  )
    .bind(
      rollbackUpdatedAt,
      claim.id,
      claim.choose_token,
      claim.updated_at,
      suggestionPostId(claim.id),
      ownerId,
    )
    .run();
}

async function chosenSuggestionResult(
  env: SocialPostEnv,
  ownerId: string,
  row: SuggestionRow,
): Promise<{ suggestion: SocialSuggestion; post: SocialPostDetail }> {
  if (!row.selected_post_id) {
    throw new SocialSuggestionInputError(
      "This chosen Suggestion is missing its Post. Refresh and try again.",
      409,
    );
  }
  const detail = await getSocialPost(env, ownerId, row.selected_post_id);
  if (!detail) {
    throw new SocialSuggestionInputError(
      "This chosen Suggestion's Post could not be found.",
      409,
    );
  }
  const platforms = persistedChoosePlatforms(row) || detail.versions.map(({ platform }) => platform);
  assertPostMatchesSuggestion(detail, row, platforms);
  return { suggestion: serializeSuggestion(row), post: detail };
}

async function getSocialSuggestion(
  env: SocialPostEnv,
  ownerId: string,
  suggestionId: string,
): Promise<SocialSuggestion | null> {
  const row = await getSocialSuggestionRow(env, ownerId, suggestionId);
  return row ? serializeSuggestion(row) : null;
}

async function getSocialSuggestionRow(
  env: SocialPostEnv,
  ownerId: string,
  suggestionId: string,
): Promise<SuggestionRow | null> {
  const row = await env.DB.prepare(
    `${suggestionSelectSql()}
     WHERE suggestion.id = ? AND s.user_id = ?`,
  )
    .bind(suggestionId, ownerId)
    .first<SuggestionRow>();
  return row || null;
}

async function listSuggestionRowsByIds(
  env: SocialPostEnv,
  ownerId: string,
  ids: string[],
): Promise<SocialSuggestion[]> {
  const created: SocialSuggestion[] = [];
  for (const id of ids) {
    const suggestion = await getSocialSuggestion(env, ownerId, id);
    if (suggestion) created.push(suggestion);
  }
  return created;
}

function suggestionSelectSql(): string {
  return `SELECT suggestion.id, suggestion.site_id, suggestion.source_type,
                 suggestion.source_ref, suggestion.source_title,
                 suggestion.source_snapshot, suggestion.source_text,
                 suggestion.suggestion_kind, suggestion.body_text,
                 suggestion.source_excerpt, suggestion.quote_trimmed,
                 suggestion.status, suggestion.selected_post_id,
                 suggestion.choose_token, suggestion.choosing_at,
                 suggestion.choose_platforms_json,
                 suggestion.created_by, suggestion.created_at, suggestion.updated_at
          FROM social_suggestions suggestion
          JOIN sites s ON s.id = suggestion.site_id`;
}

function validatedSuggestion(
  input: CreateSocialSuggestionsInput["suggestions"][number],
  sourceText: string,
): {
  kind: SocialSuggestionKind;
  bodyText: string;
  sourceExcerpt: string;
  quoteTrimmed: boolean;
} {
  if (!SOCIAL_SUGGESTION_KINDS.includes(input.kind)) {
    throw new SocialSuggestionInputError("Unsupported Suggestion type");
  }
  const bodyText = requiredText(input.bodyText, "Suggestion text is required");
  const sourceExcerpt = requiredText(
    input.sourceExcerpt,
    "Visible Source text is required for every Suggestion",
  );
  if (!normalizeWhitespace(sourceText).includes(normalizeWhitespace(sourceExcerpt))) {
    throw new SocialSuggestionInputError(
      "Suggestion Source text must be copied from the selected Source",
    );
  }
  const quoteTrimmed = Boolean(input.quoteTrimmed);
  if (input.kind !== "quote" && quoteTrimmed) {
    throw new SocialSuggestionInputError("Only Quote Suggestions can disclose trimming");
  }
  if (input.kind === "quote") validateQuote(bodyText, sourceExcerpt, quoteTrimmed);
  return { kind: input.kind, bodyText, sourceExcerpt, quoteTrimmed };
}

function validateQuote(bodyText: string, sourceExcerpt: string, trimmed: boolean): void {
  if (!trimmed && normalizeWhitespace(bodyText) !== normalizeWhitespace(sourceExcerpt)) {
    throw new SocialSuggestionInputError(
      "A Quote Suggestion must remain verbatim or disclose that it was trimmed",
    );
  }
  if (trimmed && !isOrderedWordSelection(bodyText, sourceExcerpt)) {
    throw new SocialSuggestionInputError(
      "A trimmed Quote Suggestion can remove words but cannot add or reorder them",
    );
  }
}

function isOrderedWordSelection(candidate: string, source: string): boolean {
  const candidateWords = words(candidate.replaceAll("…", " ").replaceAll("...", " "));
  const sourceWords = words(source);
  if (candidateWords.length === 0) return false;
  let sourceIndex = 0;
  for (const word of candidateWords) {
    while (sourceIndex < sourceWords.length && sourceWords[sourceIndex] !== word) {
      sourceIndex += 1;
    }
    if (sourceIndex >= sourceWords.length) return false;
    sourceIndex += 1;
  }
  return true;
}

function words(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
}

function validatePlatforms(input: unknown): SocialPlatform[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new SocialSuggestionInputError("Choose at least one platform for this Post");
  }
  const platforms = input.map((value) => {
    if (typeof value !== "string" || !SUPPORTED_PLATFORMS.has(value as SocialPlatform)) {
      throw new SocialSuggestionInputError("Unsupported Post platform");
    }
    return value as SocialPlatform;
  });
  if (new Set(platforms).size !== platforms.length) {
    throw new SocialSuggestionInputError("Choose each Post platform only once");
  }
  return platforms;
}

function requireEditableSuggestion(suggestion: SocialSuggestion): void {
  if (suggestion.status !== "suggested") {
    throw new SocialSuggestionInputError(
      suggestion.status === "choosing"
        ? "This Suggestion is already being saved as a Post"
        : suggestion.status === "chosen"
          ? "This Suggestion has already been saved as a Post"
          : "This Suggestion was discarded",
      suggestion.status === "choosing" ? 409 : 403,
    );
  }
}

function serializeSuggestion(row: SuggestionRow): SocialSuggestion {
  return {
    id: row.id,
    siteId: row.site_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceTitle: row.source_title,
    sourceSnapshot: row.source_snapshot,
    sourceText: row.source_text,
    kind: row.suggestion_kind,
    bodyText: row.body_text,
    sourceExcerpt: row.source_excerpt,
    quoteTrimmed: row.quote_trimmed === 1,
    status: row.status,
    selectedPostId: row.selected_post_id,
    choosingPlatforms: row.status === "choosing" ? persistedChoosePlatforms(row) : null,
    choosingAt: row.status === "choosing" ? row.choosing_at : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isSourceType(value: unknown): value is SocialPostSourceType {
  return value === "journal" || value === "mission_task" || value === "site" ||
    value === "file" || value === "script" || value === "pasted";
}

function isSuggestionStatus(value: unknown): value is SocialSuggestionStatus {
  return value === "suggested" || value === "choosing" || value === "chosen" ||
    value === "discarded";
}

function summarizeSuggestion(value: string): string {
  const firstLine = value.split("\n").map((line) => line.trim()).find(Boolean) || value;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

function suggestionPostId(suggestionId: string): string {
  const suffix = suggestionId.startsWith("social-suggestion-")
    ? suggestionId.slice("social-suggestion-".length)
    : suggestionId;
  return `social-post-${suffix}`;
}

function isPostForSuggestion(
  detail: SocialPostDetail,
  suggestion: Pick<
    SuggestionRow,
    | "site_id"
    | "source_type"
    | "source_ref"
    | "source_snapshot"
    | "source_text"
    | "suggestion_kind"
    | "body_text"
  >,
  platforms: SocialPlatform[],
): boolean {
  const actualPlatforms = detail.versions.map(({ platform }) => platform);
  const expectedFormat = suggestion.suggestion_kind === "carousel_outline" ? "carousel" : "post";
  return detail.post.siteId === suggestion.site_id &&
    detail.post.sourceType === suggestion.source_type &&
    detail.post.sourceRef === suggestion.source_ref &&
    detail.post.sourceSnapshot === suggestion.source_snapshot &&
    detail.post.sourceText === suggestion.source_text &&
    detail.post.ideaText === summarizeSuggestion(suggestion.body_text) &&
    actualPlatforms.length === platforms.length &&
    platforms.every((platform) => actualPlatforms.includes(platform)) &&
    detail.versions.every(
      (version) => version.bodyText === suggestion.body_text && version.format === expectedFormat,
    );
}

function assertPostMatchesSuggestion(
  detail: SocialPostDetail,
  suggestion: SuggestionRow,
  platforms: SocialPlatform[],
): void {
  if (!isPostForSuggestion(detail, suggestion, platforms)) {
    throw new SocialSuggestionInputError(
      "This Suggestion could not be linked to its exact grounded Post",
      409,
    );
  }
}

function persistedChoosePlatforms(row: SuggestionRow): SocialPlatform[] | null {
  if (!row.choose_platforms_json) return null;
  try {
    const value: unknown = JSON.parse(row.choose_platforms_json);
    if (!Array.isArray(value) || value.length === 0) return null;
    const platforms = value.filter(
      (platform): platform is SocialPlatform =>
        typeof platform === "string" && SUPPORTED_PLATFORMS.has(platform as SocialPlatform),
    );
    if (platforms.length !== value.length || new Set(platforms).size !== platforms.length) {
      return null;
    }
    return platforms;
  } catch {
    return null;
  }
}

function requirePersistedChoosePlatforms(row: SuggestionRow): SocialPlatform[] {
  const platforms = persistedChoosePlatforms(row);
  if (!platforms) {
    throw new SocialSuggestionInputError(
      "This Suggestion's saved platform choice could not be recovered.",
      409,
    );
  }
  return platforms;
}

function isStaleChooseClaim(value: string | null): boolean {
  if (!value) return true;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= Date.now() - STALE_CHOOSE_CLAIM_MS;
}

function expectedSuggestionUpdatedAt(value: unknown): string {
  const expectedUpdatedAt = optionalText(value);
  if (!expectedUpdatedAt) {
    throw new SocialSuggestionInputError(
      "Refresh this Suggestion before changing it.",
      409,
    );
  }
  return expectedUpdatedAt;
}

function nextSuggestionUpdatedAt(previous: string): string {
  const previousTimestamp = Date.parse(previous);
  const now = Date.now();
  return new Date(
    Number.isFinite(previousTimestamp) && previousTimestamp >= now
      ? previousTimestamp + 1
      : now,
  ).toISOString();
}

function staleSuggestionError(): SocialSuggestionInputError {
  return new SocialSuggestionInputError(
    "This Suggestion changed after it loaded. Refresh and try again.",
    409,
  );
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function requiredText(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new SocialSuggestionInputError(message);
  return normalized;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}
