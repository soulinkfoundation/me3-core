// "Who do you follow?" in News setup (me3-6ptk.10): Soup's curated voices for the owner's topics and
// feelings, with the ones they already follow marked. Only topic words, feelings and a country leave
// the install.
import { describeNewsSettings, projectNameWords } from "./news-settings";
import { soupClientFor } from "./soup-servings";
import { SoupUnavailableError, type SoupFollowSuggestion, type SoupResolvedSource } from "./soup-client";
import { JournalInputError } from "./journal";
import { getSoupTaste } from "./soup-taste";
import type { Env } from "./types";

export type NewsFollowCard = SoupFollowSuggestion & { following: boolean };

export function newsFollowTopics(work: string[], mine: string[], projectNames: Set<string>): string[] {
  return [...new Set([...work, ...mine])].filter(word => !projectNames.has(word)).slice(0, 12);
}

export async function getNewsFollowList(env: Env, userId: string, options: { medium?: string } = {}): Promise<{ suggestions: NewsFollowCard[] }> {
  const state = await getSoupTaste(env, userId);
  const settings = describeNewsSettings(state);
  const topics = newsFollowTopics(settings.work.filter(chip => chip.on).map(chip => chip.word), settings.mine.filter(chip => chip.on).map(chip => chip.word), projectNameWords(state.projects));
  const medium = options.medium === "read" || options.medium === "listen" || options.medium === "watch" ? options.medium : undefined;
  let suggestions: SoupFollowSuggestion[];
  try { suggestions = await soupClientFor(env).follow({ topics, feelings: settings.base, country: settings.country, ...(medium ? { medium } : {}), limit: 30 }); }
  catch (error) {
    if (error instanceof SoupUnavailableError) throw new JournalInputError("The Human Soup's list of voices isn't ready just now.", 502);
    throw error;
  }
  const followed = new Set(settings.follows.map(follow => follow.id));
  // Voices already followed come first, so a returning owner sees their own list.
  const cards = suggestions.map(suggestion => ({ ...suggestion, following: followed.has(suggestion.id) }));
  return { suggestions: [...cards.filter(card => card.following), ...cards.filter(card => !card.following)] };
}

/**
 * Sources the owner names in setup ("The Rest Is History", "@yogawithadriene", a link, or a batch
 * read off a screenshot). Only what they typed goes to Soup; nothing about who they are.
 */
export async function resolveNewsSources(env: Env, input: unknown): Promise<{ results: SoupResolvedSource[] }> {
  const body = (input && typeof input === "object" ? input : {}) as { query?: unknown; queries?: unknown };
  const raw = Array.isArray(body.queries) ? body.queries : body.query !== undefined ? [body.query] : [];
  const queries = [...new Set(raw.filter((q): q is string => typeof q === "string").map(q => q.replace(/\s+/g, " ").trim()).filter(q => q && q.length <= 300))].slice(0, 30);
  if (!queries.length) throw new JournalInputError("Say who to add: a show or channel name, an @handle or a link.");
  if (queries.some(q => /[\w.+-]+@[\w-]+\.[\w.]+/.test(q))) throw new JournalInputError("Send show names, handles or links, not email addresses.");
  try { return { results: await soupClientFor(env).resolveSources(queries, AbortSignal.timeout(25_000)) }; }
  catch (error) {
    if (error instanceof SoupUnavailableError) throw new JournalInputError(error.status === 400 ? error.message : "The Human Soup can't look sources up just now.", 502);
    throw error;
  }
}
