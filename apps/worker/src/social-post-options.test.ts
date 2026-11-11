import { describe, expect, it } from "vitest";
import { normalizePostOptions, renderPostText, xPostTexts } from "@me3-core/plugin-social-publishing";

describe("Social post options", () => {
  it("swaps each mapped mention for this platform's handle, as whole words only", () => {
    const options = normalizePostOptions({ mentions: { "@ME3": "@me3_app", "@Kieran": "@kieranbutler", "bad": "@x" } });
    expect(options.mentions).toEqual({ "@ME3": "@me3_app", "@Kieran": "@kieranbutler" });
    expect(renderPostText("Built by @Kieran at @ME3. Not @ME3x or email@ME3.", options))
      .toBe("Built by @kieranbutler at @me3_app. Not @ME3x or email@ME3.");
  });

  it("adds this platform's hashtags once, at the end", () => {
    const options = normalizePostOptions({ hashtags: "  #AI   #buildinpublic " });
    expect(renderPostText("We launched.", options)).toBe("We launched.\n\n#AI #buildinpublic");
    expect(renderPostText("We launched.\n\n#AI #buildinpublic", options)).toBe("We launched.\n\n#AI #buildinpublic");
  });

  it("puts the hashtags on the last post of a thread", () => {
    expect(xPostTexts("One.\n---\nTwo.", normalizePostOptions({ thread: true, hashtags: "#ME3" }, "x"))).toEqual(["One.", "Two.\n\n#ME3"]);
    expect(normalizePostOptions({ thread: true }, "linkedin")).toEqual({});
  });
});
