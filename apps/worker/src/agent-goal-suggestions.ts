import type { AgentModel, AgentTool } from "../../../packages/agent/src/types";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { createAgentModels } from "./agent-runtime";
import { getGoals } from "./goals";
import { getOwnerProfile } from "./sites";
import type { Env } from "./types";

// Starter goals after the first Wheel of Life: a fast model writes three from the owner's
// wheel, profile, location and me.json. The app keeps its own list for when this fails.
export const GOAL_SUGGESTION_LIMIT = 3;
const TITLE_MAX = 60;
const HELP_MAX = 110;
const AREA_IDS = ["health", "spirituality", "work", "finances", "home", "joy"] as const;

export type GoalSuggestion = { areaId: string; title: string; help: string };

const goalTool: AgentTool = {
  name: "core_goal_suggestions",
  description: "Return three starter goals for the owner.",
  parameters: {
    type: "object",
    properties: {
      goals: {
        type: "array",
        maxItems: GOAL_SUGGESTION_LIMIT,
        items: {
          type: "object",
          properties: {
            areaId: { type: "string", enum: [...AREA_IDS] },
            title: { type: "string", description: `The goal in the owner's voice, at most ${TITLE_MAX} characters.` },
            help: { type: "string", description: `One sentence on how ME3 helps, at most ${HELP_MAX} characters.` },
          },
          required: ["areaId", "title", "help"],
          additionalProperties: false,
        },
      },
    },
    required: ["goals"],
    additionalProperties: false,
  },
  effect: "read",
  approval: "none",
  async execute() { throw Error("Goal suggestions never execute."); },
};

const SYSTEM_PROMPT = [
  "You suggest starter goals for the owner of a personal assistant called ME3, right after they scored their Wheel of Life (0 to 10 per area).",
  "Return exactly three goals. Favour the lowest-scoring areas, never two for the same area, and never one the owner already has.",
  "Make each goal specific to this owner: use their work, bio, location, offerings and mission from the snapshot, so it could not be given to anyone else. Keep it small enough to start this week.",
  "Write the title in the owner's voice as a short action, e.g. \"Walk by the river three lunchtimes a week\". No emoji, no trailing full stop.",
  "The help line says what ME3 can do for it, starting \"ME3 can\". ME3 can set reminders, add tasks and projects with dates, put events on a connected calendar, write in the journal, draft emails, and track Three good things. It cannot send email campaigns, post to social media or buy things.",
  "Never invent facts about the owner that are not in the snapshot.",
  "Call core_goal_suggestions exactly once with no prose.",
].join(" ");

export async function writeGoalSuggestions(
  model: AgentModel,
  input: { ownerSnapshot: string; wheel: Array<{ areaId: string; score: number }>; existingGoals: string[] },
  signal: AbortSignal,
): Promise<GoalSuggestion[]> {
  const response = await model.step({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({
        wheel: input.wheel,
        existingGoals: input.existingGoals.slice(0, 20),
        ownerSnapshot: input.ownerSnapshot.slice(0, 6_000),
      }) },
    ],
    tools: [goalTool],
    toolChoice: goalTool.name,
    signal,
    onDelta: async () => {},
  });
  const call = response.toolCalls.find(item => item.name === goalTool.name);
  return readGoalSuggestions(call?.arguments.goals, input.existingGoals);
}

export function readGoalSuggestions(value: unknown, existingGoals: string[] = []): GoalSuggestion[] {
  if (!Array.isArray(value)) return [];
  const taken = new Set(existingGoals.map(key));
  const areas = new Set<string>();
  const goals: GoalSuggestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { areaId, title, help } = item as Record<string, unknown>;
    if (typeof areaId !== "string" || !(AREA_IDS as readonly string[]).includes(areaId) || areas.has(areaId)) continue;
    const cleanTitle = clean(title).replace(/\.$/, "");
    const cleanHelp = clean(help);
    if (!cleanTitle || cleanTitle.length > TITLE_MAX || !cleanHelp || cleanHelp.length > HELP_MAX || taken.has(key(cleanTitle))) continue;
    areas.add(areaId);
    taken.add(key(cleanTitle));
    goals.push({ areaId, title: cleanTitle, help: cleanHelp });
    if (goals.length === GOAL_SUGGESTION_LIMIT) break;
  }
  return goals;
}

/** Writes the owner's starter goals with the fast model, billed like any agent call. */
export async function suggestStarterGoals(env: Env, ownerId: string, wheelInput: unknown): Promise<GoalSuggestion[]> {
  const owner = await getOwnerProfile(env, ownerId);
  if (!owner) return [];
  const wheel = readWheel(wheelInput);
  const [snapshot, goals] = await Promise.all([
    loadOwnerSnapshotContext({
      db: env.DB, ownerId, meJsonUrl: null,
      owner: { id: owner.id, name: owner.name, username: owner.username, timezone: owner.timezone || "UTC", assistantName: owner.assistant_name || "ME3" },
    }),
    getGoals(env, ownerId),
  ]);
  const requestId = `goal-suggestions:${crypto.randomUUID()}`;
  const models = await createAgentModels(env, { userId: ownerId, threadId: "", turnId: requestId, requestId });
  const fastName = env.ME3_AGENT_FAST_MODEL?.trim() || "anthropic/claude-haiku-5.5";
  const modelId = (id: string) => id.replace(/^@cf\//, "");
  const model = models.managed && !models.managed.models.some(item => modelId(item.id) === modelId(fastName))
    ? models.model
    : models.modelFor(fastName, { purpose: "goal_suggestions" });
  return writeGoalSuggestions(model, {
    ownerSnapshot: snapshot.prompt,
    wheel,
    existingGoals: (goals.goals || []).map((goal: { title: string }) => goal.title),
  }, AbortSignal.timeout(15_000));
}

function readWheel(value: unknown): Array<{ areaId: string; score: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const { areaId, score } = (item || {}) as Record<string, unknown>;
    return typeof areaId === "string" && (AREA_IDS as readonly string[]).includes(areaId) && typeof score === "number" && Number.isFinite(score)
      ? [{ areaId, score: Math.max(0, Math.min(10, Math.round(score))) }]
      : [];
  });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function key(title: string) {
  return title.trim().toLowerCase();
}
