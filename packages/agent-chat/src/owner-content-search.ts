export type AgentOwnerContentSourceType = "journal" | "note" | "mission_task";

export type AgentOwnerContentSearchInput = {
  query: string;
  sourceType?: AgentOwnerContentSourceType | "all";
  projectId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type AgentOwnerContentSearchResult = {
  sourceType: AgentOwnerContentSourceType;
  sourceId: string;
  title: string;
  snippet: string | null;
  projectId: string | null;
  projectName: string | null;
  status: string | null;
  sourceDate: string | null;
  updatedAt: string;
  match: "exact_title" | "full_text" | "fuzzy_title";
};

export type AgentOwnerContentSearchResponse = {
  results: AgentOwnerContentSearchResult[];
  ambiguous: boolean;
};

type OwnerContentSearchDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

type OwnerContentSearchRow = {
  source_type: AgentOwnerContentSourceType;
  source_id: string;
  title: string;
  snippet?: string | null;
  project_id: string | null;
  project_name: string | null;
  status: string | null;
  source_date: string | null;
  updated_at: string;
};

type RankedTitle = {
  row: OwnerContentSearchRow;
  score: number;
};

const SEARCH_STATUSES = new Set([
  "backlog",
  "in_progress",
  "review",
  "done",
  "cancelled",
]);
const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "about",
  "entry",
  "find",
  "for",
  "from",
  "in",
  "journal",
  "me",
  "my",
  "note",
  "of",
  "on",
  "or",
  "task",
  "the",
  "to",
  "with",
]);
const FUZZY_MATCH_THRESHOLD = 0.5;
const STRONG_FUZZY_MATCH_THRESHOLD = 0.72;

export async function searchAgentOwnerContent(
  db: OwnerContentSearchDb,
  userId: string,
  input: AgentOwnerContentSearchInput,
): Promise<AgentOwnerContentSearchResponse> {
  const query = requiredText(input.query, "Owner content search query is required.");
  const sourceType = input.sourceType || "all";
  if (sourceType !== "all" && sourceType !== "journal" && sourceType !== "note" && sourceType !== "mission_task") {
    throw new Error(`Invalid owner content source type "${sourceType}".`);
  }
  if (input.status && !SEARCH_STATUSES.has(input.status)) {
    throw new Error(`Invalid Mission task status "${input.status}".`);
  }
  if (sourceType === "journal" && (input.projectId || input.status)) {
    throw new Error("Project and status filters apply only to tasks and notes.");
  }
  if (sourceType === "note" && input.status) {
    throw new Error("The status filter applies only to tasks.");
  }
  assertIsoDate(input.dateFrom, "dateFrom");
  assertIsoDate(input.dateTo, "dateTo");
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
    throw new Error("Owner content search dateFrom must not be after dateTo.");
  }
  const limit = normalizedLimit(input.limit);
  const scope = searchScope(userId, input);
  const ftsQuery = toFtsQuery(query);
  const ftsLimit = Math.max(limit * 4, 20);

  const [fullTextRows, titleRows] = await Promise.all([
    db.prepare(
      `SELECT source_type, source_id, title,
              snippet(owner_content_search, 4, '', '', ' … ', 24) AS snippet,
              project_id, project_name, status, source_date, updated_at
       FROM owner_content_search
       WHERE owner_content_search MATCH ? AND ${scope.where}
       ORDER BY bm25(owner_content_search, 0, 0, 0, 8, 1, 0, 3, 0, 0, 0),
                updated_at DESC, source_id ASC
       LIMIT ?`,
    )
      .bind(ftsQuery, ...scope.values, ftsLimit)
      .all<OwnerContentSearchRow>(),
    db.prepare(
      `SELECT source_type, source_id, title, NULL AS snippet,
              project_id, project_name, status, source_date, updated_at
       FROM owner_content_search
       WHERE ${scope.where}
       ORDER BY updated_at DESC, source_id ASC`,
    )
      .bind(...scope.values)
      .all<OwnerContentSearchRow>(),
  ]);

  const normalizedQuery = normalizeSearchText(query);
  const rankedTitles = (titleRows.results || [])
    .map((row) => ({ row, score: titleSimilarity(normalizedQuery, row.title) }))
    .filter(({ score }) => score >= FUZZY_MATCH_THRESHOLD)
    .sort(compareRankedTitles);
  const exactTitles = rankedTitles.filter(({ score }) => score === 1);
  const fuzzyTitles = rankedTitles.filter(({ score }) => score < 1);
  const strongFuzzyTitles = fuzzyTitles.filter(
    ({ score }) => score >= STRONG_FUZZY_MATCH_THRESHOLD,
  );
  const remainingFuzzyTitles = fuzzyTitles.filter(
    ({ score }) => score < STRONG_FUZZY_MATCH_THRESHOLD,
  );

  const results: AgentOwnerContentSearchResult[] = [];
  const seen = new Set<string>();
  const addTitleResults = (
    candidates: RankedTitle[],
    match: AgentOwnerContentSearchResult["match"],
  ) => {
    for (const { row } of candidates) addResult(results, seen, row, match);
  };
  addTitleResults(exactTitles, "exact_title");
  addTitleResults(strongFuzzyTitles, "fuzzy_title");
  for (const row of fullTextRows.results || []) {
    addResult(results, seen, row, "full_text");
  }
  addTitleResults(remainingFuzzyTitles, "fuzzy_title");

  const topTitleMatches = rankedTitles.slice(0, 2);
  const titleMatchesLead = topTitleMatches.length === 2 &&
    resultKey(results[0]) === rowKey(topTitleMatches[0]!.row) &&
    resultKey(results[1]) === rowKey(topTitleMatches[1]!.row);
  const ambiguous = titleMatchesLead && (
    topTitleMatches[0]!.score === topTitleMatches[1]!.score ||
    topTitleMatches[0]!.score - topTitleMatches[1]!.score <= 0.05
  );
  return { results: results.slice(0, limit), ambiguous };
}

function searchScope(
  userId: string,
  input: AgentOwnerContentSearchInput,
): { where: string; values: unknown[] } {
  const clauses = ["user_id = ?"];
  const values: unknown[] = [userId];
  if (input.sourceType && input.sourceType !== "all") {
    clauses.push("source_type = ?");
    values.push(input.sourceType);
  }
  if (input.projectId) {
    clauses.push("project_id = ?");
    values.push(input.projectId);
  }
  if (input.status) {
    clauses.push("status = ?");
    values.push(input.status);
  }
  if (input.dateFrom) {
    clauses.push("source_date >= ?");
    values.push(input.dateFrom);
  }
  if (input.dateTo) {
    clauses.push("source_date <= ?");
    values.push(input.dateTo);
  }
  return { where: clauses.join(" AND "), values };
}

function addResult(
  results: AgentOwnerContentSearchResult[],
  seen: Set<string>,
  row: OwnerContentSearchRow,
  match: AgentOwnerContentSearchResult["match"],
): void {
  const key = rowKey(row);
  if (seen.has(key)) return;
  seen.add(key);
  results.push({
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    snippet: boundedSnippet(row.snippet),
    projectId: row.project_id,
    projectName: row.project_name,
    status: row.status,
    sourceDate: row.source_date,
    updatedAt: row.updated_at,
    match,
  });
}

function rowKey(row: OwnerContentSearchRow): string {
  return `${row.source_type}:${row.source_id}`;
}

function resultKey(result: AgentOwnerContentSearchResult | undefined): string | null {
  return result ? `${result.sourceType}:${result.sourceId}` : null;
}

function compareRankedTitles(left: RankedTitle, right: RankedTitle): number {
  return (
    right.score - left.score ||
    right.row.updated_at.localeCompare(left.row.updated_at) ||
    left.row.source_id.localeCompare(right.row.source_id)
  );
}

function titleSimilarity(normalizedQuery: string, title: string): number {
  const normalizedTitle = normalizeSearchText(title);
  if (!normalizedQuery || !normalizedTitle) return 0;
  if (normalizedQuery === normalizedTitle) return 1;
  if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
    const shorter = Math.min(normalizedQuery.length, normalizedTitle.length);
    const longer = Math.max(normalizedQuery.length, normalizedTitle.length);
    return 0.8 + (0.15 * shorter) / longer;
  }
  const trigramScore = diceCoefficient(trigrams(normalizedQuery), trigrams(normalizedTitle));
  const tokenScore = diceCoefficient(
    new Set(normalizedQuery.split(" ")),
    new Set(normalizedTitle.split(" ")),
  );
  return (trigramScore * 0.75) + (tokenScore * 0.25);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function trigrams(value: string): Set<string> {
  const compact = `  ${value}  `;
  const values = new Set<string>();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    values.add(compact.slice(index, index + 3));
  }
  return values;
}

function diceCoefficient(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function toFtsQuery(query: string): string {
  const allTokens = normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) || [];
  const usefulTokens = allTokens.filter(
    (token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token),
  );
  const tokens = [...new Set(usefulTokens.length > 0 ? usefulTokens : allTokens)].slice(0, 12);
  if (tokens.length === 0) throw new Error("Owner content search query needs searchable text.");
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 8;
  const limit = Math.trunc(value);
  if (!Number.isFinite(value) || limit < 1 || limit > 20) {
    throw new Error("Owner content search limit must be between 1 and 20.");
  }
  return limit;
}

function boundedSnippet(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const snippet = value.trim().replace(/\s+/g, " ");
  return snippet.length <= 280 ? snippet : `${snippet.slice(0, 277).trimEnd()}…`;
}

function assertIsoDate(value: string | undefined, field: string): void {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Owner content search ${field} must be YYYY-MM-DD.`);
  }
}

function requiredText(value: unknown, message: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(message);
}
