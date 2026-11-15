import { describe, expect, it } from "vitest";
import { createTextReveal, revealStep } from "./textReveal";

describe("revealStep", () => {
  it("drains a larger backlog faster", () => {
    const small = revealStep("a".repeat(40), 16);
    const large = revealStep("a".repeat(400), 16);
    expect(large).toBeGreaterThan(small);
  });

  it("finishes the word it lands in", () => {
    expect(revealStep("Hello there friend", 16)).toBe("Hello ".length);
  });

  it("returns the whole backlog when it is short", () => {
    expect(revealStep("Hi", 16)).toBe(2);
    expect(revealStep("", 16)).toBe(0);
  });
});

describe("createTextReveal", () => {
  it("writes everything on flush and nothing after reset", () => {
    let text = "";
    const reveal = createTextReveal((chunk) => { text += chunk; });
    reveal.push("Hello ");
    reveal.push("world");
    reveal.flush();
    expect(text).toBe("Hello world");
    reveal.push("lost");
    reveal.reset();
    reveal.flush();
    expect(text).toBe("Hello world");
  });

  it("writes straight through when immediate", () => {
    let text = "";
    const reveal = createTextReveal((chunk) => { text += chunk; }, { immediate: true });
    reveal.push("now");
    expect(text).toBe("now");
  });
});
