import { describe, expect, it } from "vitest";
import { exclusionSentence } from "./campaigns";

describe("exclusionSentence", () => {
  it("says who is left out in one sentence, biggest reason first", () => {
    expect(exclusionSentence({ bounced: 2, unsubscribed: 6, pending_permission: 1, duplicate: 0 })).toBe(
      "9 left out: 6 unsubscribed, 2 bounced and 1 hasn't confirmed.",
    );
  });

  it("is empty when nobody is left out", () => {
    expect(exclusionSentence({ bounced: 0 })).toBe("");
    expect(exclusionSentence(undefined)).toBe("");
  });
});
