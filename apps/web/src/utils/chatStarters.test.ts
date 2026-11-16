import { describe, expect, it } from "vitest";
import { CONFIGURE_STARTER, loadChatStarters, withConfigure } from "./chatStarters";

// Failure modes: the owner's zone isn't sent, so evening starters show in the morning; a malformed
// starter from an older or broken Core draws an empty badge; Configure pushes past the cap.
describe("chat starters", () => {
  it("asks Core with the owner's zone and drops starters it can't draw", async () => {
    const paths: string[] = [];
    const result = await loadChatStarters(async <T>(path: string) => {
      paths.push(path);
      return { firstRun: true, greeting: { title: "Hi", body: "Start" }, starters: [{ id: "a", emoji: "🌐", label: "Make my website", prompt: "Build my website.", action: "site_ask" }, { id: "b", emoji: "", label: "", prompt: "" }] } as T;
    }, "Europe/London");
    expect(paths).toEqual(["/assistant/starters?tz=Europe%2FLondon"]);
    expect(result.starters.map(starter => starter.id)).toEqual(["a"]);
    expect(result.firstRun).toBe(true);
  });

  it("puts Configure first without going past four", () => {
    const starters = ["a", "b", "c", "d"].map(id => ({ id, emoji: "", label: id, prompt: id }));
    expect(withConfigure(starters, true).map(starter => starter.id)).toEqual([CONFIGURE_STARTER.id, "a", "b", "c"]);
    expect(withConfigure(starters, false)).toBe(starters);
  });
});
