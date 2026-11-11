import { describe, expect, it, vi } from "vitest";
import { ShortenInputError, shortenSocialText } from "./social-shorten";
import type { Env } from "./types";

describe("Shorten for X", () => {
  it("returns text that already fits without asking the model", async () => {
    const write = vi.fn();
    await expect(shortenSocialText({} as Env, "owner", { text: "Short enough." }, write)).resolves.toBe("Short enough.");
    expect(write).not.toHaveBeenCalled();
  });

  it("asks again when the first draft is still too long", async () => {
    const write = vi.fn()
      .mockResolvedValueOnce("x".repeat(300))
      .mockResolvedValueOnce('"We launched ME3 today. Try it free."');
    await expect(shortenSocialText({} as Env, "owner", { text: "y".repeat(400), limit: 280 }, write)).resolves.toBe("We launched ME3 today. Try it free.");
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![0].at(-1).content).toContain("That is 300 characters.");
  });

  it("refuses empty text and odd limits", async () => {
    await expect(shortenSocialText({} as Env, "owner", { text: " " }, vi.fn())).rejects.toBeInstanceOf(ShortenInputError);
    await expect(shortenSocialText({} as Env, "owner", { text: "a".repeat(300), limit: 10 }, vi.fn())).rejects.toBeInstanceOf(ShortenInputError);
  });
});
