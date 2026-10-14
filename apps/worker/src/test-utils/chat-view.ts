// Test doubles written against chat-completions requests read OpenAI
// Responses requests (used for GPT-5+) through this chat-shaped view.
type Item = Record<string, unknown>;
export type ChatViewMessage = { role: string; content: string; tool_call_id?: string; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };
export type ChatView = { messages: ChatViewMessage[]; tools: Array<{ type: "function"; function: { name: string; description?: string; parameters?: unknown } }> } & Item;

export function chatView(input: unknown): ChatView {
  const request = (input ?? {}) as Item;
  if (!Array.isArray(request.input)) return request as ChatView;
  const messages: ChatViewMessage[] = [];
  if (typeof request.instructions === "string" && request.instructions) messages.push({ role: "system", content: request.instructions });
  for (const raw of request.input as Item[]) {
    if (raw.type === "function_call_output") { messages.push({ role: "tool", tool_call_id: String(raw.call_id), content: String(raw.output) }); continue; }
    if (raw.type === "function_call") {
      const call = { id: String(raw.call_id), type: "function" as const, function: { name: String(raw.name), arguments: String(raw.arguments) } };
      const last = messages.at(-1);
      if (last?.role === "assistant") (last.tool_calls ??= []).push(call); else messages.push({ role: "assistant", content: "", tool_calls: [call] });
      continue;
    }
    const content = Array.isArray(raw.content) ? (raw.content as Item[]).filter(part => typeof part.text === "string").map(part => part.text as string).join("") : String(raw.content ?? "");
    messages.push({ role: String(raw.role), content });
  }
  const tools = Array.isArray(request.tools) ? (request.tools as Item[]).map(tool => ({ type: "function" as const, function: { name: String(tool.name), description: tool.description as string | undefined, parameters: tool.parameters } })) : [];
  return { ...request, messages, tools };
}
