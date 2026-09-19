import { workersAiGatewayRunOptions, type AgentChatAiRoute } from "./model-runtime";

export const JEV_ROUTER_MODEL = "typesafe/jev";
export const JEV_ROUTER_THRESHOLD = 0.65;

export type JevRouterMode = "off" | "shadow" | "active";
export type JevToolFamily =
  | "bookings" | "calendar" | "journal" | "mailbox" | "mission" | "people"
  | "reminders" | "scheduling" | "sites" | "social" | "web";

export type JevRouterDecision = {
  selectedFamilies: JevToolFamily[];
  probabilities: Record<JevToolFamily | "conversation", number>;
  model: string;
  durationMs: number;
};

const CRITERIA: Record<JevToolFamily | "conversation", string> = {
  bookings: "Read existing bookings, appointments, or client sessions.",
  calendar: "Read or create calendar events and agenda items.",
  journal: "Read the owner's private journal entries.",
  mailbox: "Search or read email, or create an email draft.",
  mission: "Read, create, update, prioritize, complete, or archive Mission Control tasks.",
  people: "Discover people, providers, collaborators, products, or services in the public network.",
  reminders: "Read, create, update, or cancel reminders.",
  scheduling: "Arrange, approve, decline, or inspect availability for a meeting with another person.",
  sites: "Read, create, or edit the owner's website, landing pages, or blog content.",
  social: "Read source material or create, plan, review, or publish social content.",
  web: "Research current public information or open a public web page.",
  conversation: "Answer, explain, plan, write, or converse without operating a specific ME3 feature.",
};

const FAMILY_KEYS = Object.keys(CRITERIA).filter((key) => key !== "conversation") as JevToolFamily[];

export function resolveJevRouterMode(value: string | undefined, deploymentMode?: string): JevRouterMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "shadow" || normalized === "active") return normalized;
  return deploymentMode?.trim().toLowerCase() === "managed" ? "active" : "off";
}

export async function runJevToolRouter(input: {
  route: AgentChatAiRoute;
  message: string;
  recentMessages?: readonly string[];
}): Promise<JevRouterDecision | null> {
  if (!input.route.ai || !["shadow", "active"].includes(input.route.jevRouterMode || "") || !input.message.trim()) return null;
  const questions = Object.fromEntries(Object.entries(CRITERIA).map(([key, meaning]) => [key, {
    type: "noul",
    instructions: `Does the user's latest request require this capability: ${meaning}`,
    criteria: { true: meaning, false: "This capability is not required by the latest request." },
  }]));
  const startedAt = performance.now();
  try {
    const options = workersAiGatewayRunOptions({
      ...input.route,
      aiGatewayMetadata: { ...input.route.aiGatewayMetadata, me3_intent: "jev_tool_router" },
    });
    const raw = await input.route.ai.run(JEV_ROUTER_MODEL, {
      state: {
        latest_request: input.message,
        recent_messages: (input.recentMessages || []).slice(-3),
      },
      questions,
    }, options);
    const root = asRecord(raw);
    const payload = asRecord(root?.result) || root;
    const answers = asRecord(payload?.answers);
    if (!answers) return null;
    const probabilities = {} as Record<JevToolFamily | "conversation", number>;
    for (const key of [...FAMILY_KEYS, "conversation"] as const) {
      const answer = asRecord(answers[key]);
      probabilities[key] = probability(answer?.noul);
    }
    return {
      probabilities,
      selectedFamilies: FAMILY_KEYS.filter((key) => probabilities[key] >= JEV_ROUTER_THRESHOLD),
      model: typeof payload?.model === "string" ? payload.model : JEV_ROUTER_MODEL,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    };
  } catch {
    return null;
  }
}

function probability(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
