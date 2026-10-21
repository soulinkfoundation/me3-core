import type { AgentModel, AgentTool } from "../../../packages/agent/src/types";

// One-tap follow-ups shown under a finished agent reply. A small fast-model call
// writes them after the turn; failures simply mean no suggestions.
export const SUGGESTED_REPLY_LIMIT = 3;
const SUGGESTED_REPLY_MAX_LENGTH = 40;

const suggestionTool: AgentTool = {
  name: "core_suggested_replies",
  description: "Return up to three short replies the owner is likely to send next.",
  parameters: {
    type: "object",
    properties: { replies: { type: "array", items: { type: "string" }, maxItems: SUGGESTED_REPLY_LIMIT } },
    required: ["replies"],
    additionalProperties: false,
  },
  effect: "read",
  approval: "none",
  async execute() { throw Error("Suggested replies never execute."); },
};

const SYSTEM_PROMPT = [
  "You suggest quick replies for the owner of a personal assistant.",
  "Given the owner's last message and the assistant's reply, return up to three replies the owner would most plausibly tap next.",
  "Write each in the owner's voice, 2 to 5 words, as an answer or instruction to the assistant, for example \"Yes, move it\", \"Draft the email\", \"Make it shorter\".",
  "When the assistant asked a question, cover the likely answers. Only suggest things the assistant can act on, never email campaigns, social posts, custom Home cards or purchases.",
  "Never introduce names, times or facts that are not in the conversation.",
  "If the reply needs no follow-up, return an empty list.",
  "Call core_suggested_replies exactly once with no prose.",
].join(" ");

export async function suggestAgentReplies(
  model: AgentModel,
  input: { ownerMessage: string; replyText: string },
  signal: AbortSignal,
): Promise<string[]> {
  const response = await model.step({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ ownerMessage: input.ownerMessage.slice(0, 2_000), assistantReply: input.replyText.slice(0, 4_000) }) },
    ],
    tools: [suggestionTool],
    signal,
    onDelta: async () => {},
  });
  const call = response.toolCalls.find(item => item.name === suggestionTool.name);
  return readSuggestedReplies(call?.arguments.replies);
}

export function readSuggestedReplies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const replies: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const reply = item.replace(/\s+/g, " ").trim();
    const key = reply.toLowerCase();
    if (!reply || reply.length > SUGGESTED_REPLY_MAX_LENGTH || seen.has(key)) continue;
    seen.add(key);
    replies.push(reply);
    if (replies.length === SUGGESTED_REPLY_LIMIT) break;
  }
  return replies;
}
