import { describe, expect, it } from "vitest";
import { generateSiteHtml, headlineTrade, publicTrade } from "./index";

describe("public trade", () => {
  it("uses the owner's own words, as one short plain line", () => {
    expect(publicTrade({ trade: "Hairdresser" })).toBe("Hairdresser");
    expect(publicTrade({ trade: "  Yoga   teacher\n& doula " })).toBe("Yoga teacher & doula");
    expect(publicTrade({ trade: "<b>Hair</b>dresser" })).toBe("Hairdresser");
    expect(publicTrade({ trade: "x".repeat(90) })).toHaveLength(60);
    expect(publicTrade({ trade: "A very long trade that runs on past the sixty character limit set" })).toBe("A very long trade that runs on past the sixty character");
  });

  it("falls back to the headline a starter site saved as the bio's bold first line", () => {
    expect(publicTrade({ bio: "**Hairdresser in Galway**\n\nColour, cuts and blow-dries." })).toBe("Hairdresser in Galway");
    expect(publicTrade({ bio: "**Career coach helping people who feel stuck**\n\nHello." })).toBe("Career coach");
    expect(publicTrade({ bio: "<p><strong>Career coach · Leeds</strong></p><p>Hello.</p>" })).toBe("Career coach");
    expect(publicTrade({ trade: "Coach", bio: "**Hairdresser**\n\nHello." })).toBe("Coach");
  });

  it("says nothing when the owner hasn't said what they do", () => {
    expect(publicTrade({})).toBeUndefined();
    expect(publicTrade({ trade: "  ", bio: "Colour, cuts and **blow-dries** in a calm studio." })).toBeUndefined();
    expect(publicTrade({ trade: "<>" })).toBeUndefined();
  });

  it("cuts a headline to its first clause of at most five words", () => {
    expect(headlineTrade("Career coach helping people who feel stuck")).toBe("Career coach");
    expect(headlineTrade("Yoga teacher, doula and writer")).toBe("Yoga teacher");
    expect(headlineTrade("One two three four five six seven")).toBe("One two three four five");
    expect(headlineTrade("")).toBe("");
  });
});

describe("trade in structured data", () => {
  const graph = async (profile: object) => {
    const html = (await generateSiteHtml(profile as never, [], undefined, { baseUrl: "https://a.example" }))["index.html"];
    return JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1])["@graph"] as Array<Record<string, any>>;
  };

  it("gives a person their trade as a job title", async () => {
    const [, person] = await graph({ name: "Alex", trade: "Career coach" });
    expect(person).toMatchObject({ "@type": "Person", jobTitle: "Career coach" });
  });

  it("gives a business its trade as keywords", async () => {
    const [, business] = await graph({
      name: "Niamh Byrne Hair", bio: "**Hairdresser in Galway**\n\nColour and cuts.", location: "Galway",
      intents: { book: { enabled: true, offers: [{ id: "cut", title: "Cut", duration: 30 }], availability: { windows: { monday: ["09:00-17:00"] } } } },
    });
    expect(business).toMatchObject({ "@type": "ProfessionalService", keywords: "Hairdresser in Galway" });
    expect(business.jobTitle).toBeUndefined();
  });
});
