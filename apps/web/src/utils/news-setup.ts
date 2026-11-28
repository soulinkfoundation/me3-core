import type { NewsFeelingId, NewsPaper, NewsSettings, NewsTopicChip } from "./news";
import type { NewsFollowPick } from "./news-follow";

// The News setup sheet on the web (me3-6ptk.13), ported from the iOS sheet: the feelings, the pantry
// of topics, the order ME3 places and what the cooking screen says. Pure pieces live here so they
// can be tested; the views are NewsSetupSheet.vue and NewsPantry.vue.

export type NewsSetupStep = "intro" | "profile" | "base" | "sauce" | "follow" | "receipt" | "cooking";
export const NEWS_SETUP_STEPS: NewsSetupStep[] = ["intro", "profile", "base", "sauce", "follow", "receipt", "cooking"];
export const NEWS_SETUP_TITLES: Record<NewsSetupStep, string> = {
  intro: "",
  profile: "First, let ME3 get to know you",
  base: "How would you like to feel?",
  sauce: "Add your sauce",
  follow: "Who do you follow?",
  receipt: "Your order is ready",
  cooking: "ME3 is cooking",
};
/** The step before this one, or null where there is no going back (the intro, and once it cooks). */
export function newsSetupBack(step: NewsSetupStep): NewsSetupStep | null {
  const index = NEWS_SETUP_STEPS.indexOf(step);
  return step === "cooking" || index <= 0 ? null : NEWS_SETUP_STEPS[index - 1];
}

/** What `news/settings?profile=1` adds for the setup sheet. */
export type NewsSetupProfile = { work: string | null; mission: string | null; goals: string[] };
export type NewsSetupSettings = NewsSettings & { base?: NewsFeelingId[]; bigStories?: boolean; profile?: NewsSetupProfile };

/** How the owner would like to feel after reading. The first one picked leads the paper. */
export type NewsFeeling = { id: NewsFeelingId; emoji: string; name: string; line: string };
export const NEWS_FEELINGS: NewsFeeling[] = [
  { id: "hopeful", emoji: "🌱", name: "Hopeful", line: "Progress, solutions and good people" },
  { id: "motivated", emoji: "⚡", name: "Motivated", line: "Ideas for your work and your goals" },
  { id: "know", emoji: "📡", name: "In the know", line: "The big stories, told straight" },
  { id: "connected", emoji: "🤝", name: "Connected", line: "Your town, your people, what’s on" },
];
const FEELING_IDS = new Set<string>(NEWS_FEELINGS.map(feeling => feeling.id));
export function readNewsBase(value: unknown): NewsFeelingId[] {
  return Array.isArray(value) ? value.filter((id): id is NewsFeelingId => typeof id === "string" && FEELING_IDS.has(id)).slice(0, 2) : [];
}
/** One or two feelings: tapping a picked one drops it, a third pushes out the first. */
export function toggleNewsFeeling(base: NewsFeelingId[], id: NewsFeelingId): NewsFeelingId[] {
  if (base.includes(id)) return base.filter(entry => entry !== id);
  const next = [...base, id];
  return next.length > 2 ? next.slice(1) : next;
}
export function newsBaseNames(base: NewsFeelingId[]): string {
  return base.map(id => NEWS_FEELINGS.find(feeling => feeling.id === id)?.name ?? "").filter(Boolean).join(" + ");
}

// The pantry: topics to pick from instead of typing them one by one. Kept in the app for now; a list
// served by The Human Soup comes later (thehumansoup-lnf.40.21). Shelves follow Soulink's eight
// categories, Spirituality last of them; what fits none sits on the last shelf.
export type NewsPantryLane = "work" | "mine";
export type NewsPantryItem = { emoji: string; label: string; word: string };
export type NewsPantryShelf = { title: string; items: NewsPantryItem[] };
const shelf = (title: string, pairs: Array<[string, string]>): NewsPantryShelf => ({ title, items: pairs.map(([emoji, label]) => ({ emoji, label, word: label.toLowerCase() })) });

export const NEWS_PANTRY: Record<NewsPantryLane, NewsPantryShelf[]> = {
  work: [
    shelf("Wellbeing", [["🗣️", "Coaching"], ["🫶", "Therapy"], ["🧘", "Yoga teaching"], ["🌬️", "Breathwork"], ["🩺", "Healthcare"], ["💉", "Nursing"], ["💪", "Personal training"]]),
    shelf("Learning", [["🍎", "Teaching"], ["🔬", "Research"], ["🧑‍🏫", "Mentoring"], ["🎓", "Online courses"]]),
    shelf("Creativity", [["🎨", "Design"], ["✍️", "Writing"], ["📷", "Photography"], ["🎬", "Filmmaking"], ["🎻", "Music industry"], ["📐", "Architecture"]]),
    shelf("Relationships", [["🤲", "Community building"], ["🪑", "Facilitation"], ["👪", "Family support"], ["🕊️", "Mediation"]]),
    shelf("Regeneration", [["🌱", "Sustainability"], ["🚜", "Farming"], ["🌿", "Permaculture"], ["☀️", "Clean energy"], ["🔨", "Trades and building"]]),
    shelf("Innovation", [["🤖", "AI"], ["💻", "Software"], ["🚀", "Startups"], ["📱", "Apps"], ["🧩", "Product design"], ["🔐", "Cybersecurity"]]),
    shelf("Business", [["🏪", "Small business"], ["💚", "Conscious enterprise"], ["📣", "Marketing"], ["📲", "Social media"], ["🤝", "Sales"], ["🧭", "Leadership"], ["💶", "Money and tax"], ["🐝", "Co-ops"], ["🏠", "Remote work"]]),
    shelf("Spirituality", [["🪷", "Meditation teaching"], ["🏕️", "Retreats"], ["🕯️", "Ceremony"], ["✨", "Energy work"]]),
    shelf("And the rest", [["🏛️", "Policy"], ["⚖️", "Law"], ["📰", "Journalism"], ["🎗️", "Charities"], ["🍳", "Hospitality"], ["🛍️", "Retail"]]),
  ],
  mine: [
    shelf("Wellbeing", [["🧘", "Yoga"], ["🏃", "Running"], ["🌊", "Sea swimming"], ["🏄", "Surfing"], ["🥾", "Hiking"], ["🚴", "Cycling"], ["🩺", "Health"], ["😴", "Sleep"]]),
    shelf("Learning", [["🤔", "Philosophy"], ["🧠", "Psychology"], ["🔬", "Science"], ["🏰", "History"], ["📚", "Books"], ["🗣️", "Languages"]]),
    shelf("Creativity", [["🖼️", "Art"], ["🎵", "Music"], ["🎬", "Film"], ["🎭", "Theatre"], ["📷", "Photography"], ["😂", "Comedy"], ["🎮", "Games"]]),
    shelf("Relationships", [["👶", "Parenting"], ["👪", "Family"], ["🫂", "Friendship"], ["💞", "Love and dating"], ["🏘️", "Community"]]),
    shelf("Regeneration", [["🌲", "Nature"], ["🌿", "Gardening"], ["🌍", "Climate"], ["🐦", "Birdwatching"], ["🥕", "Growing food"], ["⛺", "Camping"]]),
    shelf("Innovation", [["🤖", "AI"], ["🔭", "Space"], ["🔮", "The future"], ["⚡", "Energy"]]),
    shelf("Business", [["📈", "Economics"], ["💶", "Personal finance"], ["🚀", "Startups"], ["💚", "Ethical business"]]),
    shelf("Spirituality", [["🪷", "Meditation"], ["🌌", "Consciousness"], ["🌬️", "Breathwork"], ["🙏", "Mindfulness"], ["🕯️", "Contemplation"]]),
    shelf("And the rest", [["⚽", "Football"], ["🏉", "Rugby"], ["🏑", "GAA"], ["🎾", "Tennis"], ["🏛️", "Politics"], ["🍲", "Food and cooking"], ["✈️", "Travel"], ["🐶", "Pets"], ["🏡", "Homes and interiors"], ["🌞", "Good news"]]),
  ],
};
/** ME3 cooks with up to 12 topics a course. */
export const NEWS_PANTRY_LIMIT = 12;

const ROUGH_EMOJI: Array<[string, string]> = [
  ["design", "🎨"], ["research", "🔍"], ["climate", "🌍"], ["energy", "⚡"], ["ai", "🤖"], ["tech", "💻"], ["startup", "🚀"], ["business", "📈"],
  ["money", "💶"], ["market", "📣"], ["coach", "🧭"], ["health", "🩺"], ["therapy", "🫶"], ["teach", "🍎"], ["garden", "🌿"], ["swim", "🌊"],
  ["surf", "🏄"], ["run", "🏃"], ["marathon", "🏃"], ["yoga", "🧘"], ["music", "🎻"], ["irish", "☘️"], ["politic", "🏛️"], ["football", "⚽"],
  ["rugby", "🏉"], ["hurling", "🏑"], ["food", "🍲"], ["cook", "🍳"], ["book", "📚"], ["film", "🎬"], ["travel", "✈️"], ["sleep", "😴"],
  ["parent", "👶"], ["bee", "🐝"], ["bird", "🐦"], ["nature", "🌲"], ["hik", "🥾"], ["science", "🔬"], ["history", "🏰"], ["art", "🖼️"],
];
/** An emoji for a topic, so each dish has something on its plate: the pantry's own, else a rough match. */
export function newsDishEmoji(label: string, fallback: string): string {
  const word = label.toLowerCase();
  for (const lane of ["work", "mine"] as const) for (const row of NEWS_PANTRY[lane]) { const item = row.items.find(entry => entry.word === word); if (item) return item.emoji; }
  return ROUGH_EMOJI.find(([part]) => word.includes(part))?.[1] ?? fallback;
}

/** The shelves to show: all of them, or only the items matching what was typed. */
export function newsPantryShelves(lane: NewsPantryLane, search: string): NewsPantryShelf[] {
  const text = search.trim().toLowerCase();
  if (!text) return NEWS_PANTRY[lane];
  return NEWS_PANTRY[lane].flatMap(row => { const items = row.items.filter(item => item.word.includes(text)); return items.length ? [{ title: row.title, items }] : []; });
}
/** What's on the menu but not in the pantry, so it still shows there to switch off. */
export function newsPantryYours(lane: NewsPantryLane, chips: NewsTopicChip[]): NewsPantryItem[] {
  const pantry = new Set(NEWS_PANTRY[lane].flatMap(row => row.items.map(item => item.word)));
  return chips.filter(chip => !pantry.has(chip.word)).map(chip => ({ emoji: newsDishEmoji(chip.label, lane === "work" ? "💼" : "💛"), label: chip.label, word: chip.word }));
}
/** A typed topic, tidied: single spaces, 40 characters at most. */
export function newsTypedTopic(search: string): string {
  return search.split(/\s+/).filter(Boolean).join(" ").slice(0, 40);
}
/** Whether "Add “…”" is offered: something typed that is neither on the menu nor on a shelf shown. */
export function newsCanAddTyped(lane: NewsPantryLane, chips: NewsTopicChip[], search: string): boolean {
  const word = newsTypedTopic(search).toLowerCase();
  if (!word) return false;
  return !chips.some(chip => chip.word === word) && !newsPantryShelves(lane, search).some(row => row.items.some(item => item.word === word));
}
const picked = (chips: NewsTopicChip[]) => chips.filter(chip => chip.on).length;
export type NewsPantryChange = { chips: NewsTopicChip[]; full: boolean };
/** Taking a topic off in the pantry takes it off the menu altogether; a full plate takes no more. */
export function newsPantryToggle(chips: NewsTopicChip[], item: Pick<NewsPantryItem, "word" | "label">): NewsPantryChange {
  const existing = chips.find(chip => chip.word === item.word);
  if (existing?.on) return { chips: chips.filter(chip => chip.word !== item.word), full: false };
  if (picked(chips) >= NEWS_PANTRY_LIMIT) return { chips, full: true };
  if (existing) return { chips: chips.map(chip => chip.word === item.word ? { ...chip, on: true } : chip), full: false };
  return { chips: [...chips, { word: item.word, label: item.label, on: true }], full: false };
}
export function newsPantryAddTyped(chips: NewsTopicChip[], search: string): NewsPantryChange {
  const label = newsTypedTopic(search);
  if (!label) return { chips, full: false };
  if (picked(chips) >= NEWS_PANTRY_LIMIT) return { chips, full: true };
  const word = label.toLowerCase();
  if (chips.some(chip => chip.word === word)) return { chips: chips.map(chip => chip.word === word ? { ...chip, on: true } : chip), full: false };
  return { chips: [...chips, { word, label, on: true }], full: false };
}

/** The town as the paper names it: the place's own name, else the first part of its label. */
export function newsTownName(result: { locality?: string; label: string }): string {
  return (result.locality || result.label.split(",")[0] || result.label).trim();
}

export type NewsSetupOrder = {
  work: Array<{ label: string; on: boolean }>; mine: Array<{ label: string; on: boolean }>;
  base: NewsFeelingId[]; time: string; notify: boolean; follows: NewsFollowPick[]; setUp: true;
};
/** The order as `PATCH news/settings` takes it. */
export function newsSetupOrder(input: { work: NewsTopicChip[]; mine: NewsTopicChip[]; base: NewsFeelingId[]; time: string; notify: boolean; follows: NewsFollowPick[] }): NewsSetupOrder {
  const lane = (chips: NewsTopicChip[]) => chips.map(chip => ({ label: chip.label, on: chip.on }));
  return { work: lane(input.work), mine: lane(input.mine), base: input.base, time: input.time, notify: input.notify, follows: input.follows, setUp: true };
}
/** For a ME3 from before feelings and follows, which refuses keys it doesn't know. */
export function newsSetupOrderWithoutBase(order: NewsSetupOrder) {
  return { work: order.work, mine: order.mine, time: order.time, notify: order.notify, setUp: true as const };
}

export type NewsReceiptLine = { key: string; value: string; sub?: boolean; strong?: boolean; rule?: boolean };
/** The receipt, top to bottom. A `rule` line is a dashed divider. */
export function newsReceiptLines(input: { base: NewsFeelingId[]; dishes: string[]; follows: Array<{ name: string }>; city: string | null; time: string }): NewsReceiptLine[] {
  const rule: NewsReceiptLine = { key: "", value: "", rule: true };
  const voices: NewsReceiptLine[] = input.follows.length ? [
    { key: "👂 VOICES", value: `×${input.follows.length}` },
    ...input.follows.slice(0, 4).map(follow => ({ key: follow.name, value: "1", sub: true })),
    ...(input.follows.length > 4 ? [{ key: `and ${input.follows.length - 4} more`, value: "", sub: true }] : []),
    rule,
  ] : [];
  return [
    rule,
    { key: "🍲 BASE", value: newsBaseNames(input.base) },
    rule,
    { key: "🥫 SAUCE", value: `×${input.dishes.length}` },
    ...input.dishes.map(dish => ({ key: dish, value: "1", sub: true })),
    rule,
    ...voices,
    { key: "📍 LOCAL", value: input.city || "—" },
    { key: "🚨 BIG NEWS", value: "when it happens" },
    { key: "😡 RAGE BAIT", value: "0", strong: true },
    { key: "🤖 AI FILLER", value: "0", strong: true },
    rule,
    { key: "☕ SERVED", value: `${input.time} daily`, strong: true },
  ];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export type NewsCookStep = { title: string; detail: string };
/**
 * The six steps the cooking screen ticks through. The real numbers arrive with the paper (its bowl,
 * me3-6ptk.16); until then each step says what it does. A ME3 from before the bowl still sends counts.
 */
export function newsCookSteps(input: { paper: Pick<NewsPaper, "counts" | "bowl"> | null; base: NewsFeelingId[]; dishes: string[]; city: string | null }): NewsCookStep[] {
  const { paper, dishes } = input;
  const bowl = paper?.bowl;
  const considered = paper?.counts.considered;
  const gathering = bowl && bowl.sources > 0 ? `Gathering from ${bowl.sources.toLocaleString()} ${bowl.sources === 1 ? "source" : "sources"}` : "Gathering today’s stories";
  const gathered = bowl && bowl.voices > 0 ? `Starting with the ${plural(bowl.voices, "voice", "voices")} you follow`
    : considered != null ? `${considered} stories tasted` : "Trusted outlets first, specialists for your topics";
  const skimmed = bowl?.skimmed && bowl.skimmed.total > 0
    ? { title: `Skimming off ${plural(bowl.skimmed.total, "story", "stories")}`, detail: "Made to scare or enrage, or filler and ads" }
    : { title: "Skimming off fear and outrage", detail: "Stories made to scare or enrage stay in the pot" };
  const serving = !paper ? "Serving your paper"
    : !bowl ? `Serving ${plural(paper.counts.stories + paper.counts.videos, "story", "stories")}`
    : `Serving ${[plural(bowl.stories, "story", "stories"), bowl.episodes > 0 ? plural(bowl.episodes, "episode", "episodes") : ""].filter(Boolean).join(" and ")}`;
  return [
    { title: "Running your order to The Human Soup", detail: "A kitchen of news, podcasts and writing made by humans" },
    { title: gathering, detail: gathered },
    { title: "Building the base", detail: newsBaseNames(input.base) },
    { title: "Stirring in your sauce", detail: dishes.slice(0, 3).join(", ") + (dishes.length > 3 ? ` and ${dishes.length - 3} more` : "") },
    skimmed,
    { title: serving, detail: paper ? `On ${paper.counts.pages} pages, plus ${input.city || "local"} weather` : "Laying out the pages" },
  ];
}
/** The LED counter's last number: what the kitchen really tasted, else a fair guess from the paper. */
export function newsTastedTotal(paper: Pick<NewsPaper, "counts">, soFar: number): number {
  return paper.counts.considered ?? Math.max(soFar, paper.counts.stories * 20);
}
