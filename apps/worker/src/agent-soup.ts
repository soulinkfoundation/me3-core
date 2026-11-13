// The agent's side of News (me3-6ptk, on the Soup code from me3-ydf4): the services behind
// core_news_settings_read, core_news_settings_update, core_news_paper and core_news_serve, and the
// one-time setup offer in chat.
import type { AgentSoupServices } from "../../../packages/agent/src/tools/services";
import { buildNewsNow, type NewsPaper } from "./news-paper";
import { describeNewsSettings, updateNewsSettings, type NewsSettings } from "./news-settings";
import { serveSoupAsk, type SoupServing } from "./soup-servings";
import { getSoupTaste, markSoupSuggested, soupSuggestionDue, type SoupTasteState, type SoupWorkTopic } from "./soup-taste";
import type { Env } from "./types";

/** 'agent payments @ proj_123' (or '@ ME3 payments', the project's name) → a work topic that follows that project. */
export function parseWorkTopicLine(line: string, projects: Set<string> | Map<string, string>): SoupWorkTopic | null {
  const [topic, project] = line.split("@").map(part => part.trim());
  if (!topic) return null;
  const byId = projects instanceof Map ? projects : new Map([...projects].map(id => [id, id]));
  const wanted = (project || "").replace(/\s+project$/i, "").trim().toLowerCase();
  const projectId = wanted ? [...byId].find(([id, name]) => id.toLowerCase() === wanted || name.toLowerCase() === wanted)?.[0] ?? null : null;
  return { topic, projectId, source: projectId ? "project" : "owner" };
}

/**
 * The agent speaks in plain lines: selected topics, and the suggestions it wants shown but left
 * off. A lane that is not mentioned stays as it is; a lane given without its suggestions keeps the
 * suggestions already there.
 */
export function newsPatchFromAgent(args: Record<string, unknown>, current: NewsSettings, projects: Map<string, string>): Record<string, unknown> {
  const lines = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const patch: Record<string, unknown> = {};
  if (args.workTopics !== undefined || args.moreWorkTopics !== undefined) {
    const on = args.workTopics !== undefined
      ? lines(args.workTopics).map(line => parseWorkTopicLine(line, projects)).filter((topic): topic is SoupWorkTopic => !!topic).map(topic => ({ label: topic.topic, on: true, projectId: topic.projectId }))
      : current.work.filter(chip => chip.on).map(chip => ({ label: chip.label, on: true }));
    const off = args.moreWorkTopics !== undefined ? lines(args.moreWorkTopics).map(label => ({ label, on: false })) : current.work.filter(chip => !chip.on).map(chip => ({ label: chip.label, on: false }));
    patch.work = [...on, ...off];
  }
  if (args.interests !== undefined || args.moreInterests !== undefined) {
    const on = args.interests !== undefined ? lines(args.interests).map(label => ({ label, on: true })) : current.mine.filter(chip => chip.on).map(chip => ({ label: chip.label, on: true }));
    const off = args.moreInterests !== undefined ? lines(args.moreInterests).map(label => ({ label, on: false })) : current.mine.filter(chip => !chip.on).map(chip => ({ label: chip.label, on: false }));
    patch.mine = [...on, ...off];
  }
  if (args.lessOf !== undefined) patch.lessOf = lines(args.lessOf);
  for (const key of ["city", "time", "notify", "setUp"] as const) if (args[key] !== undefined) patch[key] = args[key];
  return patch;
}

function describe(state: SoupTasteState) {
  const settings = describeNewsSettings(state);
  return {
    ...settings,
    projects: state.projects.map(project => ({ id: project.id, name: project.name })),
    ...(settings.setUp ? {} : { setupGuide: "Not set up yet. Setup is one short chat. 1) From the snapshot, call core_news_settings_update with workTopics (four plain topics for the owner's kind of work, each optionally '@ projectId'), interests (two or three things they love outside work, switched on), moreInterests (two or three more suggestions left off) and city. The app then shows the topics as chips the owner can tap; say in one sentence what you based them on and ask them to tap the ones they want or add their own. 2) When they say it looks good, call core_news_settings_update with askTime true and ask what time it should be ready; the app shows time choices. 3) When they give a time, call core_news_settings_update with time and setUp true; today's paper is built and the app shows a Read it now button. Reply that it is ready and when tomorrow's will be. Call it their news, never soup." }),
  };
}

/** A short digest of the paper for ME3's own use; the app draws the paper itself. */
function digest(paper: NewsPaper) {
  const line = (story: { headline: string; source: string; note?: string } | null | undefined) => story ? `${story.headline} (${story.source})${story.note ? ` — ${story.note}` : ""}` : null;
  return {
    paperId: paper.id,
    counts: paper.counts,
    frontPage: [paper.pages.front.lead, ...paper.pages.front.briefs].map(line),
    yourWork: (paper.pages.work?.stories || []).map(line),
    watchAndListen: [paper.pages.media?.video, paper.pages.media?.listen].map(line).filter(Boolean),
    yourTopics: (paper.pages.topics?.stories || []).map(line),
    nearYou: [paper.pages.near?.local, paper.pages.near?.good].map(line).filter(Boolean),
  };
}

export function createAgentSoupServices(env: Env, ownerId: string): AgentSoupServices {
  const projectsOf = (state: SoupTasteState) => new Map(state.projects.map(project => [project.id, project.name]));
  return {
    async serve(input) {
      const serving: SoupServing | null = await serveSoupAsk(env, ownerId, input);
      if (!serving) return { served: false, note: "Nothing that fits turned up right now. Say so in one line; do not invent an item." };
      const [pick, ...also] = serving.items;
      return {
        served: true,
        servingId: serving.id,
        pick: pick ? { title: pick.title, by: pick.creator, minutes: pick.minutes, medium: pick.medium, url: pick.url, forYou: pick.forYou, why: pick.why } : null,
        alsoGood: also.map(item => ({ title: item.title, minutes: item.minutes, url: item.url })),
        note: "The web app shows the pick as a card under your reply. Reply in one short line (why this one, in your words); do not repeat the title, link or list the items. Never call it soup or a bowl.",
      };
    },
    async readTaste() {
      return describe(await getSoupTaste(env, ownerId));
    },
    async updateTaste(args) {
      const current = await getSoupTaste(env, ownerId);
      const wasSetUp = describeNewsSettings(current).setUp;
      const patch = newsPatchFromAgent(args, describeNewsSettings(current), projectsOf(current));
      const { firstSetUp } = Object.keys(patch).length ? await updateNewsSettings(env, ownerId, patch) : { firstSetUp: false };
      const state = await getSoupTaste(env, ownerId);
      const settings = describe(state);
      if (firstSetUp || (args.setUp === true && !wasSetUp)) {
        // The first paper is built straight away, so setup ends with something to read.
        const paper = await buildNewsNow(env, ownerId).catch(() => null);
        return { ...settings, saved: true, card: "ready", paper: paper ? digest(paper) : null, note: paper ? `Today's paper is ready and the app shows a Read it now button. Say so in one line and that tomorrow's will be ready at ${settings.time}. Do not list the stories.` : `Saved. Today's paper could not be put together just now; say the first one will be ready at ${settings.time} tomorrow.` };
      }
      if (args.askTime === true && !settings.setUp) return { ...settings, saved: true, card: "time", note: "The app shows time choices under your reply. Ask what time it should be ready, in one short line." };
      if (!settings.setUp && (patch.work !== undefined || patch.mine !== undefined)) return { ...settings, saved: true, card: "topics", note: "The app shows these topics as chips under your reply. Say what you based them on in one sentence and ask the owner to tap the ones they want or add their own. Do not list the topics." };
      return { ...settings, saved: true };
    },
    async paper(input) {
      const state = await getSoupTaste(env, ownerId);
      if (!describeNewsSettings(state).setUp) return { ready: false, note: "News is not set up. Offer to set it up; the owner can say 'Set up my news'." };
      const paper = await buildNewsNow(env, ownerId, { fresh: input.fresh === true });
      if (!paper) return { ready: false, note: "Today's news could not be put together just now. Say so in one line." };
      return { ready: true, card: "paper", ...digest(paper), note: "The app shows a Read your news button under your reply. Answer what the owner asked from this digest in a line or two; do not recite the whole paper." };
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
  return "News (data): on, not set up. After handling this turn's request, offer once, in one sentence, to have the owner's news ready every morning, picked for their work and the topics they love; it takes about a minute and they can say 'Set up my news'. Do not set it up unless they say yes.";
}
