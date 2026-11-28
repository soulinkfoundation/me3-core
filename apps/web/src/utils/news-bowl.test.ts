import { describe, expect, it } from "vitest";
import { newsBowlLines, newsFeelingTag, type NewsBowl } from "./news";

const bowl: NewsBowl = {
  sources: 212, voices: 3, fromVoices: 2, base: ["hopeful", "know"], bigStories: true, sauce: ["Coaching", "Yoga"], fromSauce: 4,
  stories: 14, episodes: 2, videos: 1, feelings: { know: 3, hopeful: 6 }, skimmed: { fearOutrage: 38, sponsored: 2, aiFiller: 4, total: 44 },
};

describe("today's bowl", () => {
  it("lists the serving, the feelings in their usual order, the sauce and what was skimmed off", () => {
    expect(newsBowlLines(bowl, 9)).toEqual([
      { label: "14 stories · 2 episodes · 1 video", value: "about 9 min", strong: true },
      { label: "🌱 Hopeful", value: "6" },
      { label: "📡 In the know", value: "3" },
      { label: "🧂 Your sauce", value: "4" },
      { label: "👋 From people you follow", value: "2" },
      { label: "Skimmed off: fear and outrage", value: "38", quiet: true },
      { label: "Skimmed off: AI filler and ads", value: "6", quiet: true },
    ]);
  });
  it("leaves out what Soup didn't report", () => {
    const lines = newsBowlLines({ ...bowl, skimmed: null, fromVoices: 0, episodes: 0, videos: 0, stories: 1 }, 1);
    expect(lines[0].label).toBe("1 story");
    expect(lines.some(line => line.label.startsWith("Skimmed"))).toBe(false);
    expect(lines.some(line => line.label.includes("follow"))).toBe(false);
  });
  it("tags a story with its feeling", () => {
    expect(newsFeelingTag({ feeling: "connected" })).toBe("🤝 Connected");
    expect(newsFeelingTag({})).toBe("");
  });
});
