// The agent's side of The Human Soup (me3-ydf4): the services behind core_soup_serve,
// core_soup_taste_read and core_soup_taste_update, and the one-time setup offer in chat.
import type { AgentSoupServices } from "../../../packages/agent/src/tools/services";
import { JournalInputError } from "./journal";
import { normalizeDailyBriefingTime } from "./morning-calendar-push";
import { serveSoupAsk, soupClientFor, type SoupServing } from "./soup-servings";
import { getSoupTaste, markSoupSuggested, soupSuggestionDue, updateSoupTaste, type SoupServingSpec, type SoupTastePatch, type SoupTasteState, type SoupWorkTopic } from "./soup-taste";
import type { Env } from "./types";

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** 'agent payments @ proj_123' → a work topic that follows that project. */
export function parseWorkTopicLine(line: string, projectIds: Set<string>): SoupWorkTopic | null {
  const [topic, project] = line.split("@").map(part => part.trim());
  if (!topic) return null;
  const projectId = project && projectIds.has(project) ? project : null;
  return { topic, projectId, source: projectId ? "project" : "owner" };
}

/** '07:30 | headlines | Morning headlines' or '20:00 | pick | Something longer | listen | 20min'. */
export function parseServingLine(line: string, index: number): SoupServingSpec {
  const parts = line.split("|").map(part => part.trim());
  const time = parts[0] || "";
  const kind = parts[1] === "headlines" || parts[1] === "pick" ? parts[1] : null;
  if (!TIME.test(time) || !kind) throw new JournalInputError(`Serving ${index + 1} must be 'HH:MM | headlines or pick | name', e.g. '07:30 | headlines | Morning headlines'.`);
  const name = parts[2] || (kind === "headlines" ? "Headlines" : "Something good");
  const spec: SoupServingSpec = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `serving-${index + 1}`, name, time, days: [], kind };
  for (const extra of parts.slice(3)) {
    if (extra === "watch" || extra === "listen" || extra === "read") spec.medium = extra;
    const minutes = /^(\d{1,3})\s*min/i.exec(extra);
    if (minutes) spec.maxMinutes = Number(minutes[1]);
  }
  return spec;
}

export function tastePatchFromAgent(args: Record<string, unknown>, projectIds: Set<string>): SoupTastePatch {
  const patch: SoupTastePatch = {};
  const lines = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  if (args.workTopics !== undefined) patch.workTopics = lines(args.workTopics).map(line => parseWorkTopicLine(line, projectIds)).filter(Boolean);
  if (args.interests !== undefined) patch.interests = lines(args.interests);
  if (args.lessOf !== undefined) patch.lessOf = lines(args.lessOf);
  if (args.soups !== undefined) patch.soups = lines(args.soups);
  if (args.servings !== undefined) patch.servings = lines(args.servings).map(parseServingLine);
  if (args.headsUp !== undefined) patch.headsUp = args.headsUp;
  if (args.setUp !== undefined) patch.setUp = args.setUp;
  return patch;
}

function describe(state: SoupTasteState, briefingTime: string) {
  const { taste } = state;
  return {
    setUp: state.setUp,
    setUpAt: state.setUpAt,
    workTopics: taste.workTopics.map(topic => ({ topic: topic.topic, projectId: topic.projectId, source: topic.source })),
    interests: taste.interests,
    lessOf: taste.lessOf,
    soups: taste.soups,
    servings: taste.servings,
    headsUp: taste.headsUp,
    projects: state.projects.map(project => ({ id: project.id, name: project.name })),
    briefingTime,
    ...(state.setUp ? {} : { setupGuide: `Not set up yet. Propose: For your work (four to six topic words from the active projects above, each as 'topic @ projectId') and ask what they love outside work; then ask whether to bring them something at set times (suggest headlines at ${briefingTime}, their briefing time, and something longer in the evening) or only when they ask. Wait for their answer, then call core_soup_taste_update once with setUp true.` }),
  };
}

export function createAgentSoupServices(env: Env, ownerId: string): AgentSoupServices {
  const briefingTime = async () => {
    const row = await env.DB.prepare("SELECT daily_briefing_time FROM owner_profile WHERE id = ?").bind(ownerId).first<{ daily_briefing_time: string | null }>();
    return normalizeDailyBriefingTime(row?.daily_briefing_time) || "07:30";
  };
  return {
    async serve(input) {
      const serving: SoupServing | null = await serveSoupAsk(env, ownerId, input);
      if (!serving) return { served: false, note: "The Human Soup had nothing that fits right now. Say so in one line; do not invent an item." };
      const [pick, ...also] = serving.items;
      return {
        served: true,
        servingId: serving.id,
        pick: pick ? { title: pick.title, by: pick.creator, soup: pick.soupTitle, minutes: pick.minutes, medium: pick.medium, url: pick.url, forYou: pick.forYou, why: pick.why } : null,
        alsoGood: also.map(item => ({ title: item.title, minutes: item.minutes, url: item.url })),
        note: "The web app shows the bowl card under your reply and it waits on Home. Reply in one short line (why this one, in your words); do not repeat the title, link or list the items.",
      };
    },
    async readTaste() {
      const [state, time, menu] = await Promise.all([getSoupTaste(env, ownerId), briefingTime(), soupClientFor(env).listSoups(AbortSignal.timeout(6_000)).catch(() => [])]);
      return { ...describe(state, time), menu: menu.map(soup => ({ handle: soup.handle, title: soup.title, tagline: soup.tagline, topics: soup.topics })) };
    },
    async updateTaste(patch) {
      const current = await getSoupTaste(env, ownerId);
      const state = await updateSoupTaste(env, ownerId, tastePatchFromAgent(patch, new Set(current.projects.map(project => project.id))));
      return { ...describe(state, await briefingTime()), saved: true };
    },
    async listSoups(signal) {
      return soupClientFor(env).listSoups(signal);
    },
  };
}

/**
 * Once, after the owner has projects and before Soup is set up, the snapshot carries a line that
 * lets ME3 offer it in chat. Recorded as suggested when shown, so it never nags.
 */
export async function soupSetupHint(env: Env, ownerId: string): Promise<string | null> {
  if (!await soupSuggestionDue(env, ownerId)) return null;
  if (!await markSoupSuggested(env, ownerId)) return null;
  return "The Human Soup (data): on, not set up. After handling this turn's request, offer once, in one sentence, to serve the owner good things to read, watch and listen to, picked for their projects and what they love; it takes about a minute and they can say 'Set up my soup'. Do not set it up unless they say yes.";
}
