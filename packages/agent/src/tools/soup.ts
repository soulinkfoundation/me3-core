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
        workTopics: list("For your work lane: each entry a topic word, optionally followed by ' @ ' and the projectId it follows, e.g. 'agent payments @ proj_123'. Replaces the lane."),
        interests: list("Just for you lane: interests the owner stated, e.g. poetry, surfing. Replaces the lane."),
        lessOf: list("Topics the owner wants less of. Replaces the list."),
        soups: list("Collection handles to follow, from the menu in core_news_settings_read. Replaces the list."),
        servings: list("The owner's servings, one per entry as 'HH:MM | kind | name', kind headlines or pick, e.g. '07:30 | headlines | Morning headlines'. Add ' | listen' or ' | 20min' for a pick's medium or length. An empty list means only when they ask. Replaces the list."),
        headsUp: { type: "boolean", description: "Rare alerts when news touches a live project. Off unless the owner asks." },
        setUp: { type: "boolean", description: "true once the owner has confirmed the proposal; the News card joins Home." },
      }),
    }),
  ];
}
