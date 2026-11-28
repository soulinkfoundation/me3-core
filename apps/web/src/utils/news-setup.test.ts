import { describe, expect, it } from "vitest";
import {
  NEWS_PANTRY_LIMIT, newsBaseNames, newsCanAddTyped, newsCookSteps, newsDishEmoji, newsPantryAddTyped, newsPantryShelves, newsPantryToggle, newsPantryYours,
  newsReceiptLines, newsSetupBack, newsSetupOrder, newsSetupOrderWithoutBase, newsTastedTotal, newsTownName, newsTypedTopic, readNewsBase, toggleNewsFeeling,
} from "./news-setup";
import type { NewsBowl, NewsPaper } from "./news";

// Failure modes: a third feeling piling up instead of pushing out the first, a full plate taking a
// thirteenth topic, the cooking screen quoting made-up numbers once the paper's real ones are in,
// and an order an older ME3 refuses because of keys it doesn't know.
const chip = (label: string, on = true) => ({ word: label.toLowerCase(), label, on });
const counts = { pages: 5, stories: 14, videos: 2, minutes: 12, considered: 640 };
const bowl: NewsBowl = { sources: 1240, voices: 3, fromVoices: 2, base: ["hopeful"], bigStories: true, sauce: ["AI"], fromSauce: 4, stories: 14, episodes: 1, videos: 2, feelings: {}, skimmed: { fearOutrage: 20, sponsored: 3, aiFiller: 8, total: 31 } };
const paper = (extra: Partial<Pick<NewsPaper, "bowl">> = {}): Pick<NewsPaper, "counts" | "bowl"> => ({ counts, ...extra });

describe("feelings", () => {
  it("keeps one or two, the first picked leading", () => {
    expect(toggleNewsFeeling([], "hopeful")).toEqual(["hopeful"]);
    expect(toggleNewsFeeling(["hopeful"], "know")).toEqual(["hopeful", "know"]);
    expect(toggleNewsFeeling(["hopeful", "know"], "connected")).toEqual(["know", "connected"]);
    expect(toggleNewsFeeling(["hopeful", "know"], "hopeful")).toEqual(["know"]);
    expect(newsBaseNames(["know", "hopeful"])).toBe("In the know + Hopeful");
  });
  it("reads only feelings it knows from saved settings", () => {
    expect(readNewsBase(["hopeful", "angry", 3, "know", "connected"])).toEqual(["hopeful", "know"]);
    expect(readNewsBase(undefined)).toEqual([]);
  });
});

describe("going back", () => {
  it("steps back one, but not from the intro or once it is cooking", () => {
    expect(newsSetupBack("receipt")).toBe("follow");
    expect(newsSetupBack("profile")).toBe("intro");
    expect(newsSetupBack("intro")).toBeNull();
    expect(newsSetupBack("cooking")).toBeNull();
  });
});

describe("the pantry", () => {
  it("filters shelves by what was typed and drops empty ones", () => {
    const shelves = newsPantryShelves("mine", "  swim ");
    expect(shelves.map(row => row.title)).toEqual(["Wellbeing"]);
    expect(shelves[0].items.map(item => item.label)).toEqual(["Sea swimming"]);
    expect(newsPantryShelves("work", "").length).toBe(9);
  });
  it("shows the owner's own topics that are on no shelf", () => {
    expect(newsPantryYours("mine", [chip("Yoga"), chip("Uilleann pipes", false)]).map(item => item.label)).toEqual(["Uilleann pipes"]);
  });
  it("adds, switches back on, and takes a topic off the menu altogether", () => {
    const item = { word: "yoga", label: "Yoga" };
    expect(newsPantryToggle([], item)).toEqual({ chips: [chip("Yoga")], full: false });
    expect(newsPantryToggle([chip("Yoga", false)], item)).toEqual({ chips: [chip("Yoga")], full: false });
    expect(newsPantryToggle([chip("Yoga"), chip("Art")], item)).toEqual({ chips: [chip("Art")], full: false });
  });
  it("takes no more than a full plate, but still lets one come off", () => {
    const plate = Array.from({ length: NEWS_PANTRY_LIMIT }, (_, index) => chip(`Topic ${index}`));
    expect(newsPantryToggle(plate, { word: "yoga", label: "Yoga" })).toEqual({ chips: plate, full: true });
    expect(newsPantryAddTyped(plate, "Bog snorkelling")).toEqual({ chips: plate, full: true });
    expect(newsPantryToggle(plate, { word: "topic 0", label: "Topic 0" }).chips).toHaveLength(NEWS_PANTRY_LIMIT - 1);
    // Topics switched off don't count towards the plate.
    expect(newsPantryToggle([...plate.slice(1), chip("Off", false)], { word: "yoga", label: "Yoga" }).full).toBe(false);
  });
  it("tidies a typed topic and offers it only when it is new", () => {
    expect(newsTypedTopic("  bog   snorkelling \n")).toBe("bog snorkelling");
    expect(newsTypedTopic("x".repeat(60))).toHaveLength(40);
    expect(newsCanAddTyped("mine", [], "Bog snorkelling")).toBe(true);
    expect(newsCanAddTyped("mine", [chip("Bog snorkelling")], "bog  snorkelling")).toBe(false);
    expect(newsCanAddTyped("mine", [], "yoga")).toBe(false);
    expect(newsCanAddTyped("mine", [], "   ")).toBe(false);
    expect(newsPantryAddTyped([chip("Bog snorkelling", false)], "Bog Snorkelling").chips).toEqual([chip("Bog snorkelling")]);
    expect(newsPantryAddTyped([], "Bog Snorkelling").chips).toEqual([{ word: "bog snorkelling", label: "Bog Snorkelling", on: true }]);
  });
  it("puts something on every plate", () => {
    expect(newsDishEmoji("Sea swimming", "💛")).toBe("🌊");
    expect(newsDishEmoji("Park runs", "💛")).toBe("🏃");
    expect(newsDishEmoji("Zymurgy", "💼")).toBe("💼");
  });
});

describe("the order", () => {
  const input = { work: [chip("AI"), chip("Design", false)], mine: [chip("Yoga")], base: ["hopeful" as const], time: "07:00", notify: true, follows: [{ id: "a", name: "A", medium: "listen" as const, feed: "https://a.example/feed", image: null }] };
  it("sends topics as labels, with the base, the voices and setUp", () => {
    expect(newsSetupOrder(input)).toEqual({ work: [{ label: "AI", on: true }, { label: "Design", on: false }], mine: [{ label: "Yoga", on: true }], base: ["hopeful"], time: "07:00", notify: true, follows: input.follows, setUp: true });
  });
  it("leaves out what an older ME3 refuses", () => {
    expect(Object.keys(newsSetupOrderWithoutBase(newsSetupOrder(input))).sort()).toEqual(["mine", "notify", "setUp", "time", "work"]);
  });
  it("names the town by its place, else the start of its label", () => {
    expect(newsTownName({ locality: "Galway", label: "Galway, County Galway, Ireland" })).toBe("Galway");
    expect(newsTownName({ label: "Ennistymon, County Clare, Ireland" })).toBe("Ennistymon");
  });
});

describe("the receipt", () => {
  it("lists the base, each dish, up to four voices and the promises", () => {
    const follows = ["A", "B", "C", "D", "E", "F"].map(name => ({ name }));
    const lines = newsReceiptLines({ base: ["hopeful", "know"], dishes: ["AI", "Yoga"], follows, city: "Galway", time: "07:30" }).filter(line => !line.rule);
    expect(lines.map(line => `${line.key}|${line.value}`)).toEqual([
      "🍲 BASE|Hopeful + In the know", "🥫 SAUCE|×2", "AI|1", "Yoga|1", "👂 VOICES|×6", "A|1", "B|1", "C|1", "D|1", "and 2 more|",
      "📍 LOCAL|Galway", "🚨 BIG NEWS|when it happens", "😡 RAGE BAIT|0", "🤖 AI FILLER|0", "☕ SERVED|07:30 daily",
    ]);
  });
  it("leaves voices off when none are followed", () => {
    const lines = newsReceiptLines({ base: ["hopeful"], dishes: ["AI"], follows: [], city: null, time: "07:00" });
    expect(lines.some(line => line.key.includes("VOICES"))).toBe(false);
    expect(lines.find(line => line.key === "📍 LOCAL")?.value).toBe("—");
  });
});

describe("the cooking steps", () => {
  const order = { base: ["hopeful" as const, "know" as const], dishes: ["AI", "Yoga", "Climate", "Books", "Film"], city: "Galway" };
  it("says what each step does until the paper is in", () => {
    const steps = newsCookSteps({ paper: null, ...order });
    expect(steps.map(step => step.title)).toEqual(["Running your order to The Human Soup", "Gathering today’s stories", "Building the base", "Stirring in your sauce", "Skimming off fear and outrage", "Serving your paper"]);
    expect(steps[1].detail).toBe("Trusted outlets first, specialists for your topics");
    expect(steps[2].detail).toBe("Hopeful + In the know");
    expect(steps[3].detail).toBe("AI, Yoga, Climate and 2 more");
    expect(steps[5].detail).toBe("Laying out the pages");
  });
  it("uses the bowl's real numbers once the paper is cooked", () => {
    const steps = newsCookSteps({ paper: paper({ bowl }), ...order });
    expect(steps[1]).toEqual({ title: `Gathering from ${(1240).toLocaleString()} sources`, detail: "Starting with the 3 voices you follow" });
    expect(steps[4]).toEqual({ title: "Skimming off 31 stories", detail: "Made to scare or enrage, or filler and ads" });
    expect(steps[5]).toEqual({ title: "Serving 14 stories and 1 episode", detail: "On 5 pages, plus Galway weather" });
  });
  it("falls back to the counts for a paper without a bowl, or a bowl with nothing to report", () => {
    const old = newsCookSteps({ paper: paper(), ...order, city: null });
    expect(old[1]).toEqual({ title: "Gathering today’s stories", detail: "640 stories tasted" });
    expect(old[5]).toEqual({ title: "Serving 16 stories", detail: "On 5 pages, plus local weather" });
    const quiet = newsCookSteps({ paper: paper({ bowl: { ...bowl, sources: 1, voices: 0, episodes: 0, stories: 1, skimmed: null } }), ...order });
    expect(quiet[1]).toEqual({ title: "Gathering from 1 source", detail: "640 stories tasted" });
    expect(quiet[4].title).toBe("Skimming off fear and outrage");
    expect(quiet[5].title).toBe("Serving 1 story");
  });
  it("ends the counter on what was really tasted", () => {
    expect(newsTastedTotal({ counts }, 1500)).toBe(640);
    expect(newsTastedTotal({ counts: { ...counts, considered: undefined as unknown as number } }, 100)).toBe(280);
  });
});
