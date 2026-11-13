// A fixture of Soup's news contract (thehumansoup-lnf.40.4, draft of 2026-11-13) for the two
// mockup personas: a founder in Dublin and a coach in Galway. Used by the tests, and by local
// development when ME3_SOUP_NEWS_FIXTURE is set, until the real API is live. Stories are the
// sample data from docs/design/mockups/me3-agent/news.html; some have no image on purpose.
import type { NewsStory, NewsToday } from "../soup-client";

const at = (hoursAgo: number) => new Date(Date.UTC(2026, 10, 13, 6, 0) - hoursAgo * 3_600_000).toISOString();
const picture = (seed: string) => ({ url: `https://picsum.photos/seed/me3-news-${seed}/640/360` });
let counter = 0;
function story(headline: string, source: string, extra: Partial<NewsStory> & { summary?: string } = {}): NewsStory {
  counter += 1;
  const slug = headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
  return {
    id: `news:${slug}`, headline, summary: extra.summary || "", url: `https://example.com/news/${slug}`,
    sources: [{ name: source, url: `https://example.com/news/${slug}` }], publishedAt: at(counter % 12), topics: [], medium: "read", ...extra,
  };
}

const FRONT: NewsStory[] = [
  story("Storm Bram brings orange wind warnings to the west coast", "RTÉ", { summary: "Gusts up to 130 km/h from Saturday afternoon. Ferries to the islands are cancelled.", image: picture("storm"), topics: ["weather", "ireland"] }),
  story("Central banks hold rates as inflation settles near 2%", "Reuters", { summary: "The ECB and the Bank of England both left rates unchanged.", topics: ["economy"] }),
  story("Forty Irish firms make the four-day week permanent", "Irish Times", { summary: "A two-year trial ends with most firms keeping the shorter week.", topics: ["work"] }),
  // The same event from a second outlet: until grouping lands the picker must drop it.
  story("Orange wind warning issued as Storm Bram approaches", "Irish Times", { summary: "Met Éireann warns of dangerous coastal conditions.", topics: ["weather", "ireland"] }),
  story("Housing completions rise for a third quarter", "Irish Independent", { summary: "Apartments account for most of the increase.", topics: ["housing"] }),
];

const MEDIA_FOUNDER: NewsStory[] = [
  story("Working backwards: write the press release before you build", "AWS Events", { medium: "watch", durationSeconds: 1022, embedUrl: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ", image: picture("working-backwards"), topics: ["running a small business"] }),
  story("How solo founders price a done-for-you tier", "Indie Hackers podcast", { medium: "listen", durationSeconds: 720, topics: ["running a small business"] }),
];
const MEDIA_COACH: NewsStory[] = [
  story("The one coaching question that changes everything", "TEDx Talks", { medium: "watch", durationSeconds: 860, embedUrl: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ", image: picture("coaching-question"), topics: ["coaching"] }),
  story("Running a full practice in 25 hours a week", "Coaching for Leaders", { medium: "listen", durationSeconds: 720, topics: ["coaching"] }),
];

export const NEWS_FIXTURE_FOUNDER: NewsToday = {
  contractVersion: "2026-11-13.draft",
  frontPage: FRONT,
  byTopic: [
    { topic: "ai agents", stories: [story("EU agrees first rules for AI agents that spend money for people", "Financial Times", { summary: "Agents need a named human, a spending limit and a receipt trail by 2028.", image: picture("eu-agents"), topics: ["ai agents", "online payments"] })] },
    { topic: "online payments", stories: [story("Stripe opens Link agent wallets to UK and EU accounts", "Stripe blog", { summary: "Agent wallets were US-only until now.", topics: ["online payments"] })] },
    { topic: "cloudflare", stories: [story("Cloudflare halves Workers AI prices from December", "Cloudflare blog", { summary: "The cut applies to all hosted models.", topics: ["cloudflare"] })] },
    { topic: "running a small business", stories: [story("Sole traders get a simpler quarterly return from January", "RTÉ Business", { summary: "Revenue says the new form takes ten minutes.", topics: ["running a small business"] })] },
    { topic: "surfing", stories: [story("Big swell forecast for Mullaghmore on Sunday", "Surfer Today", { summary: "A long-period swell arrives behind the storm.", image: picture("swell"), topics: ["surfing"] })] },
    { topic: "poetry", stories: [story("Mary Oliver on paying attention as devotion", "The Marginalian", { summary: "A reading of her late essays.", image: picture("poetry"), topics: ["poetry"] })] },
  ],
  local: [story("Luas Green line closed this weekend for works", "Irish Times", { summary: "Replacement buses run between Charlemont and Sandyford.", topics: ["dublin"] })],
  media: MEDIA_FOUNDER,
  meta: { considered: 214, grouped: false },
};

export const NEWS_FIXTURE_COACH: NewsToday = {
  contractVersion: "2026-11-13.draft",
  frontPage: FRONT,
  byTopic: [
    { topic: "coaching", stories: [story("ICF asks coaches to get consent before using AI note-takers", "Coaching World", { summary: "New ethics guidance applies from January to all credentialed coaches.", image: picture("icf"), topics: ["coaching"] })] },
    { topic: "instagram marketing", stories: [story("Instagram cuts reach for posts with links in bio", "Social Media Today", { summary: "Stories and DMs are not affected.", topics: ["instagram marketing"] })] },
    { topic: "running a small business", stories: [story("VAT threshold for sole traders rises from January", "RTÉ Business", { summary: "The services threshold moves up for the second year running.", topics: ["running a small business"] })] },
    { topic: "wellbeing", stories: [story("Workplace wellbeing budgets shift from apps to people", "The Guardian", { summary: "Employers report better results from coaching than from subscriptions.", topics: ["wellbeing"] })] },
    { topic: "yoga", stories: [story("Why slow yoga is filling studios again", "The Guardian", { summary: "Teachers say students want less heat and more time.", image: picture("yoga"), topics: ["yoga"] })] },
    { topic: "gardening", stories: [story("What to plant in November: garlic, broad beans, tulips", "RTÉ Lifestyle", { summary: "The soil is still warm enough for all three.", image: picture("garden"), topics: ["gardening"] })] },
  ],
  local: [story("Galway Christmas market opens next Friday in Eyre Square", "Galway Advertiser", { summary: "Open daily until 22 December, late on Fridays.", topics: ["galway"] })],
  media: MEDIA_COACH,
  meta: { considered: 187, grouped: false },
};

/** The wholesome "one good thing" for the Near you page, which comes from Soup's search rather than the news API. */
export function newsFixtureGood(request: { city?: string | null }): NewsStory {
  return /galway/i.test(request.city || "")
    ? story("A Connemara village knitted 1,000 hats for newborns", "The Human Soup")
    : story("A Dublin café has paid for strangers’ coffee for a year, one note at a time", "The Human Soup");
}

/** The fixture for a request, chosen the way the personas differ: the coach lives in Galway. */
export function newsFixtureFor(request: { city?: string | null; topics?: string[] }): NewsToday {
  const coach = /galway/i.test(request.city || "") || (request.topics || []).some(topic => /coach/i.test(topic));
  return structuredClone(coach ? NEWS_FIXTURE_COACH : NEWS_FIXTURE_FOUNDER);
}

/**
 * The picks and notes the mockup shows, for local development without a model: the fixture then
 * lays out all six pages with ME3's notes and actions in place.
 */
export function newsFixturePicks(news: NewsToday, request: { city?: string | null }) {
  const coach = /galway/i.test(request.city || "");
  const work = news.byTopic.slice(0, 3).map(entry => entry.stories[0]).filter(Boolean);
  const notes = coach
    ? [{ note: "You use AI notes with clients. Your intake form needs one line.", action: { label: "Draft the consent line", prompt: "Draft a consent line about AI note-taking for my intake form" } }, { note: "Most of your bookings come from Instagram. Your booking link still works in Stories." }, { note: "You were close to the old limit this year." }]
    : [{ note: "Touches ME3 payments. You keep receipts already; limits are the gap.", action: { label: "Add a task", prompt: "Add a task: spending limits for agent payments" } }, { note: "This was the blocker on your payments task.", action: { label: "Reopen the task", prompt: "Reopen my Stripe Link wallets task" } }, { note: "Cheaper Haiku fallback for ME3." }];
  const video = news.media.find(story => story.medium === "watch");
  return {
    lead: { id: news.frontPage[0].id, note: coach ? "Your Saturday walk-and-talk session is outdoors. Want me to message the group?" : "You’re in Galway on Sunday. I’ll check the train times." },
    work: work.map((story, index) => ({ id: story.id, ...notes[index] })),
    ...(video ? { video: { id: video.id, note: coach ? "Good for your Thursday group session." : "You’re writing the $49 Business page this week. Try it on that." } } : {}),
  };
}
