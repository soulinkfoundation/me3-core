import { describe, expect, it, vi } from "vitest";
import { AltTextInputError, ALT_TEXT_VISION_MODEL, cleanAltText, draftSocialAltText } from "./social-alt-text";
import type { Env } from "./types";

const image = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("Social alt text drafts", () => {
  it("asks the vision model with the image and the post as context", async () => {
    const run = vi.fn(async () => ({ response: '"Image of a green launch banner that reads ME3 is live."' }));
    const text = await draftSocialAltText({} as Env, "owner", { image, context: "We launched!" }, run);

    expect(text).toBe("A green launch banner that reads ME3 is live.");
    expect(run).toHaveBeenCalledWith(ALT_TEXT_VISION_MODEL, expect.objectContaining({
      messages: [
        expect.objectContaining({ role: "system" }),
        { role: "user", content: [{ type: "text", text: "Post text (context only): We launched!" }, { type: "image_url", image_url: { url: image } }] },
      ],
    }));
  });

  it("refuses anything that isn't a small image data URL", async () => {
    const run = vi.fn();
    await expect(draftSocialAltText({} as Env, "owner", { image: "https://example.com/a.png" }, run)).rejects.toBeInstanceOf(AltTextInputError);
    await expect(draftSocialAltText({} as Env, "owner", { image: `data:image/png;base64,${"A".repeat(1_600_000)}` }, run)).rejects.toMatchObject({ status: 413 });
    expect(run).not.toHaveBeenCalled();
  });

  it("cleans model replies into plain alt text", () => {
    expect(cleanAltText("Alt text: photo of  a dog\non a beach")).toBe("A dog on a beach");
    expect(cleanAltText("x".repeat(1_200))).toHaveLength(1_000);
  });
});
