import { domainTool, ok, objectSchema, optionalNumber, optionalString, services } from "./common";
import type { AgentToolContext } from "../types";

// News (me3-6ptk), built on the Soup client from me3-ydf4: owners see "News", the code and
// tables keep their soup_* names. The worker's services own every request to The Human Soup and
// only ever pass topic words and filters along; the owner's name, projects and ME3's notes stay
// in the install. Setup is a conversation guided by the capability summaries.
const strings = (value: unknown, max = 12): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim()).slice(0, max) : [];

function soup(context: AgentToolContext) {
  const service = services(context).soup;
  if (!service) throw new Error("News is unavailable.");
  return service;
}

const list = (description: string) => ({ type: "array", items: { type: "string" }, description });

export function soupTools() {
  return [
    domainTool("core.news.serve", async (args, context) => {
      const topics = strings(args.topics, 6);
      if (!topics.length) throw new Error("topics are required: two to six plain topic words.");
      const medium = args.medium === "watch" || args.medium === "listen" || args.medium === "read" ? args.medium : undefined;
      const maxMinutes = optionalNumber(args.maxMinutes);
      context.signal.throwIfAborted();
      return ok(await soup(context).serve({
        topics, ...(medium ? { medium } : {}), ...(maxMinutes && maxMinutes > 0 ? { maxMinutes: Math.round(maxMinutes) } : {}),
        ...(strings(args.soups, 6).length ? { soups: strings(args.soups, 6) } : {}),
        ...(optionalString(args.title) ? { title: optionalString(args.title) } : {}),
        ...(optionalString(args.occasion) ? { occasion: optionalString(args.occasion) } : {}),
      }, context.signal));
    }),
    domainTool("core.news.settings.read", async (_args, context) => ok(await soup(context).readTaste()), { parameters: objectSchema({}) }),
    domainTool("core.news.settings.update", async (args, context) => {
      context.signal.throwIfAborted();
      return ok(await soup(context).updateTaste(args));
    }, {
      parameters: objectSchema({
        workTopics: list("For your work: the topics switched on, each a plain topic as the owner would write it (AI agents, Coaching), optionally followed by ' @ ' and the projectId it follows. Replaces the selected work topics."),
        moreWorkTopics: list("More work topics to show as suggestions, switched off."),
        interests: list("Just for you: the topics switched on, e.g. Surfing, Poetry. Hobbies and interests only. Replaces the selected ones."),
        moreInterests: list("More personal topics to show as suggestions, switched off."),
        lessOf: list("Topics the owner wants less of. Replaces the list."),
        city: { type: "string", description: "The town or city the owner lives in, for local news and weather, e.g. Galway. A place name only." },
        time: { type: "string", description: "When the paper should be ready, local HH:MM on a quarter hour, e.g. 06:45. Weekends are an hour later." },
        notify: { type: "boolean", description: "Whether to send one notification when the paper is ready." },
        askTime: { type: "boolean", description: "During setup, true once the owner has confirmed the topics: the app shows time choices under your reply." },
        setUp: { type: "boolean", description: "true once the owner has confirmed topics and given a time: News is switched on, today's paper is built and the News card joins Home." },
      }),
    }),
    domainTool("core.news.paper", async (args, context) => {
      context.signal.throwIfAborted();
      return ok(await soup(context).paper({ fresh: args.fresh === true }, context.signal));
    }, { parameters: objectSchema({ fresh: { type: "boolean", description: "true only when the owner asks for a new paper rather than today's." } }) }),
  ];
}
