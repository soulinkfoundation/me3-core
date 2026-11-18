// Chat's empty-state starters come from Core (GET /api/assistant/starters, me3-q6la.1), so web, iOS and
// Android show the same ones. `tour=app` says this app draws Show me around, so a brand-new owner gets only that. A starter sends its prompt; action "site_ask" opens the Build your website card and "tour" opens Show me around.
export type ChatStarter = { id: string; emoji: string; label: string; prompt: string; action?: "site_ask" | "tour" };
export type ChatStarters = { firstRun: boolean; greeting: { title: string; body: string } | null; starters: ChatStarter[] };

export const EMPTY_CHAT_STARTERS: ChatStarters = { firstRun: false, greeting: null, starters: [] };

export const CONFIGURE_PROMPT =
  "Help me configure my ME3 installation. First check what is already set up across my public site/profile, email mailbox, Soulink, assistant/AI, plugins, and updates. Then suggest the missing or most useful next step. If I'm not sure, walk me through the basics.";

/** A self-hosted install without a model can't answer the others, so Configure leads. */
export const CONFIGURE_STARTER: ChatStarter = { id: "configure", emoji: "⚙️", label: "Configure", prompt: CONFIGURE_PROMPT };

type GetJson = <T>(path: string) => Promise<T>;

export async function loadChatStarters(get: GetJson, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): Promise<ChatStarters> {
  const result = await get<Partial<ChatStarters>>(`/assistant/starters?${new URLSearchParams({ tz: timeZone || "UTC", tour: "app" })}`);
  return {
    firstRun: result.firstRun === true,
    greeting: result.greeting?.title ? result.greeting : null,
    starters: Array.isArray(result.starters) ? result.starters.filter(starter => starter?.label && starter.prompt) : [],
  };
}

export function withConfigure(starters: ChatStarter[], needsConfigure: boolean, max = 4): ChatStarter[] {
  return needsConfigure ? [CONFIGURE_STARTER, ...starters.filter(starter => starter.id !== CONFIGURE_STARTER.id)].slice(0, max) : starters;
}
