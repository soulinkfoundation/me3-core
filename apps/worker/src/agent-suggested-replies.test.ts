import { describe, expect, it } from "vitest";
import type { AgentModel } from "../../../packages/agent/src/types";
import { readSuggestedReplies, suggestAgentReplies } from "./agent-suggested-replies";

function fakeModel(replies: unknown, name = "core_suggested_replies"): AgentModel {
  return { id: "fake", async step() { return { text: "", toolCalls: [{ id: "1", name, arguments: { replies } }] }; } };
}

describe("suggested replies", () => {
  it("returns the model's short follow-ups", async () => {
    const replies = await suggestAgentReplies(fakeModel(["Yes, move it", "Ask Aoife first"]), { ownerMessage: "Any clashes?", replyText: "Your 4pm clashes. Move it?" }, new AbortController().signal);
    expect(replies).toEqual(["Yes, move it", "Ask Aoife first"]);
  });

  it("ignores other tools and malformed output", async () => {
    const signal = new AbortController().signal;
    expect(await suggestAgentReplies(fakeModel(["Yes"], "other_tool"), { ownerMessage: "", replyText: "Done." }, signal)).toEqual([]);
    expect(await suggestAgentReplies(fakeModel("Yes"), { ownerMessage: "", replyText: "Done." }, signal)).toEqual([]);
  });

  it("trims, drops long or duplicate entries and keeps at most three", () => {
    expect(readSuggestedReplies(["  Yes,   move it ", "yes, move it", "x".repeat(41), 4, "", "Leave it", "Draft it", "Fourth"]))
      .toEqual(["Yes, move it", "Leave it", "Draft it"]);
  });
});
