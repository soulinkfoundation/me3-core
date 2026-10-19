// The owner's Mission: who they help, the change they want for them, how, and why. It is private to Core and
// never part of the public site or me.json. The statement sits in mission_dashboard_settings.mission_statement
// and the answers behind it in settings_json.missionAnswers, so the agent can coach from the parts later.

/** The slice of D1 the Mission store needs, so agent tools can pass their own database handle. */
export type MissionDb = {
  prepare(sql: string): { bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null>; run(): Promise<unknown> } };
};

export type MissionAnswers = { who?: string; change?: string; how?: string; why?: string };
export type OwnerMission = { statement: string | null; answers: MissionAnswers };

/** Shown where no Mission exists yet. Brackets mark it as a prompt, never a Mission. */
export const MISSION_PLACEHOLDER = "I help [who] [the change you want for them] by [how you help].";
export const MISSION_STATEMENT_MAX_LENGTH = 600;
const ANSWER_LIMITS = { who: 160, change: 240, how: 240, why: 240 } as const;

/** A written Mission, or null for empty text and fill-in-the-blanks templates. */
export function ownedMissionStatement(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || /\[[^\]]+\]/.test(text)) return null;
  return text.slice(0, MISSION_STATEMENT_MAX_LENGTH);
}

export function normalizeMissionAnswers(value: unknown): MissionAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const answers: MissionAnswers = {};
  for (const key of Object.keys(ANSWER_LIMITS) as (keyof MissionAnswers)[]) {
    const text = typeof source[key] === "string" ? (source[key] as string).trim().slice(0, ANSWER_LIMITS[key]) : "";
    if (text) answers[key] = text;
  }
  return answers;
}

/** "I help {who} {change} by {how}, because {why}." Without someone to help there is no sentence yet. */
export function missionSentence(input: MissionAnswers): string {
  const answers = normalizeMissionAnswers(input);
  const part = (text?: string) => text?.replace(/[\s.!,;:]+$/, "") || "";
  const who = part(answers.who);
  if (!who) return "";
  const change = part(answers.change);
  const how = part(answers.how);
  const why = part(answers.why);
  return `I help ${[who, change].filter(Boolean).join(" ")}${how ? ` by ${how}` : ""}${why ? `, because ${why}` : ""}.`;
}

/** The Mission someone wrote on their site before it moved here: the statement, or the three site answers. */
export function legacyMissionFromBusiness(business: unknown): OwnerMission | null {
  if (!business || typeof business !== "object") return null;
  const source = business as Record<string, unknown>;
  const statement = ownedMissionStatement(source.positioningStatement);
  if (statement) return { statement, answers: {} };
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const audience = text(source.audience, 160);
  if (!audience) return null;
  const problem = text(source.primaryProblem, 160);
  const solution = text(source.solution, 240);
  return {
    statement: `I help ${audience}${problem ? ` with ${problem}` : ""}${solution ? ` by ${solution}` : ""}.`,
    answers: normalizeMissionAnswers({ who: audience, how: solution }),
  };
}

export async function readOwnerMission(db: MissionDb, ownerId: string): Promise<OwnerMission> {
  const row = await db
    .prepare("SELECT mission_statement, settings_json FROM mission_dashboard_settings WHERE user_id = ?")
    .bind(ownerId)
    .first<{ mission_statement: string | null; settings_json: string | null }>();
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(row?.settings_json || "{}") as Record<string, unknown>; } catch { settings = {}; }
  return { statement: ownedMissionStatement(row?.mission_statement), answers: normalizeMissionAnswers(settings.missionAnswers) };
}

/**
 * Saves the Mission. A written statement wins; otherwise the answers become the sentence. The answers merge into
 * the dashboard settings with json_set, so goals and every other setting stay as they are.
 */
export async function saveOwnerMission(
  db: MissionDb,
  ownerId: string,
  input: { statement?: unknown; answers?: unknown },
): Promise<OwnerMission> {
  // Editing the sentence alone keeps the answers behind it.
  const answers = input.answers === undefined ? (await readOwnerMission(db, ownerId)).answers : normalizeMissionAnswers(input.answers);
  const statement = ownedMissionStatement(input.statement) || ownedMissionStatement(missionSentence(answers));
  if (!statement) throw new Error("Write your mission, or say who you help.");
  await db
    .prepare(
      `INSERT INTO mission_dashboard_settings (user_id, settings_json, mission_statement, updated_at)
       VALUES (?, json_object('missionAnswers', json(?)), ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         settings_json = json_set(mission_dashboard_settings.settings_json, '$.missionAnswers', json(?)),
         mission_statement = excluded.mission_statement,
         updated_at = datetime('now')`,
    )
    .bind(ownerId, JSON.stringify(answers), statement, JSON.stringify(answers))
    .run();
  return { statement, answers };
}
