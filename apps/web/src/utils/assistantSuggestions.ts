import type { UiIconName } from "./icons";
import { MISSION_DRAFT_PROMPT } from "./missionStatement";

// The agent chat's suggestion chips. The iOS and Android apps follow the same rules and prompt text
// (bead me3-uvq3): keep the three in step.
export type AssistantSuggestion = { label: string; icon: UiIconName; prompt: string };
export type UpcomingEvent = { title: string; startsAt: Date };
export type AssistantSuggestionContext = {
  now: Date;
  upcomingEvent?: UpcomingEvent | null;
  /** Only true once the Mission has loaded and is empty. */
  missionMissing?: boolean;
  /** Self-hosted install without a configured model. */
  needsConfigure?: boolean;
};

const MAX_SUGGESTIONS = 4;
const PREP_WINDOW_MS = 60 * 60 * 1000;

export const CONFIGURE_PROMPT =
  "Help me configure my ME3 installation. First check what is already set up across my public site/profile, email mailbox, Soulink, assistant/AI, plugins, and updates. Then suggest the missing or most useful next step. If I'm not sure, walk me through the basics.";

function timeOfDaySuggestion(hour: number): AssistantSuggestion {
  if (hour >= 5 && hour < 11) {
    return { label: "Plan my day", icon: "ListTodo", prompt: "Plan my day: what's on, what's due, and what should I focus on first?" };
  }
  if (hour >= 11 && hour < 17) {
    return { label: "What's next?", icon: "ListTodo", prompt: "What should I focus on next?" };
  }
  if (hour >= 17 && hour < 21) {
    return { label: "Wrap up today", icon: "ListTodo", prompt: "Wrap up my day: what got done, what's still open, and what moves to tomorrow?" };
  }
  return { label: "Plan tomorrow", icon: "CalendarDays", prompt: "What's coming up tomorrow, and what should I get ready tonight?" };
}

export function assistantSuggestions({ now, upcomingEvent, missionMissing, needsConfigure }: AssistantSuggestionContext): AssistantSuggestion[] {
  const suggestions: AssistantSuggestion[] = [];
  if (needsConfigure) suggestions.push({ label: "Configure", icon: "Settings", prompt: CONFIGURE_PROMPT });
  if (upcomingEvent) {
    const until = upcomingEvent.startsAt.getTime() - now.getTime();
    if (until > 0 && until <= PREP_WINDOW_MS) {
      const time = upcomingEvent.startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      suggestions.push({ label: `Prep for ${upcomingEvent.title}`, icon: "CalendarDays", prompt: `Help me prep for ${upcomingEvent.title} at ${time}.` });
    }
  }
  if (missionMissing) suggestions.push({ label: "Draft my mission", icon: "Sparkles", prompt: MISSION_DRAFT_PROMPT });
  const timeOfDay = timeOfDaySuggestion(now.getHours());
  suggestions.push(timeOfDay);
  if (timeOfDay.label !== "Plan tomorrow") {
    suggestions.push({ label: "What's on tomorrow?", icon: "CalendarDays", prompt: "What's on my calendar tomorrow?" });
  }
  suggestions.push({ label: "Help me reply to an email", icon: "Mail", prompt: "Help me choose an email to reply to and draft a response. Ask me before sending." });
  return suggestions.slice(0, MAX_SUGGESTIONS);
}
