import type { Env } from "./types";
import {
  MissionControlInputError,
  isRecord,
  normalizeNullableText,
  parseJsonRecord,
} from "./workspace-input";

export function normalizeMainGoal(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 600);
}

export function normalizeMissionGoals(value: unknown, legacyMainGoal: string) {
  const incoming = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const goals = incoming.slice(0, 20).flatMap((item, index) => {
    const input: Record<string, unknown> = isRecord(item)
      ? item
      : { title: item };
    const title = normalizeMainGoal(input.title);
    if (!title) return [];
    const candidateId = normalizeNullableText(input.id) || `goal-${index + 1}`;
    const baseId = candidateId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `goal-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (seen.has(id)) {
      const suffixText = `-${suffix}`;
      id = `${baseId.slice(0, 80 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    seen.add(id);
    return [
      {
        id,
        title,
        status: input.status === "completed" ? ("completed" as const) : ("active" as const),
      },
    ];
  });

  if (!Array.isArray(value) && goals.length === 0 && legacyMainGoal) {
    goals.push({
      id: "legacy-main-goal",
      title: legacyMainGoal,
      status: "active",
    });
  }
  return goals;
}

// Keep the existing storage contract so assistant context and older clients see
// the same goals. Updating goals must not load dashboard cards or rewrite settings.
export async function getGoals(env: Env, userId: string) {
  const row = await env.DB.prepare(
    "SELECT settings_json FROM mission_dashboard_settings WHERE user_id = ?",
  ).bind(userId).first<{ settings_json: string }>();
  const settings = parseJsonRecord(row?.settings_json || null);
  return { goals: normalizeMissionGoals(settings.goals, normalizeMainGoal(settings.mainGoal)) };
}

export async function updateGoals(env: Env, userId: string, input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.goals)) {
    throw new MissionControlInputError("Goals must be a list");
  }
  if (input.goals.length > 20) throw new MissionControlInputError("Keep up to 20 goals");
  const goals = normalizeMissionGoals(input.goals, "");
  await env.DB.prepare(`
    INSERT INTO mission_dashboard_settings (user_id, cards_json, quick_links_json, settings_json)
    VALUES (?, '[]', '[]', json_object('goals', json(?)))
    ON CONFLICT(user_id) DO UPDATE SET
      settings_json = json_set(mission_dashboard_settings.settings_json, '$.goals', json(?)),
      updated_at = datetime('now')
  `).bind(userId, JSON.stringify(goals), JSON.stringify(goals)).run();
  return { goals };
}
