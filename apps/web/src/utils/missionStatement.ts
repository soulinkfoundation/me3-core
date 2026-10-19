import { api } from "../api";

// The dashboard API falls back to a fill-in-the-blanks template
// ("I help [who] …") when the owner has not written a mission.
// Treat that template as no mission so pages prompt for one instead of showing it.
export function ownMissionStatement(statement: string | null | undefined): string {
  const text = statement?.trim() || "";
  return /\[[^\]]+\]/.test(text) ? "" : text;
}

export type MissionAnswers = { who?: string; change?: string; how?: string; why?: string };
export type OwnerMission = { statement: string | null; answers: MissionAnswers };

// Matches ME3's own sentence (packages/mission-control), so the preview reads exactly as it will be saved.
export function missionSentence(answers: MissionAnswers): string {
  const part = (text?: string) => text?.trim().replace(/[\s.!,;:]+$/, "") || "";
  const who = part(answers.who);
  if (!who) return "";
  const change = part(answers.change);
  const how = part(answers.how);
  const why = part(answers.why);
  return `I help ${[who, change].filter(Boolean).join(" ")}${how ? ` by ${how}` : ""}${why ? `, because ${why}` : ""}.`;
}

// One prompt for every "help me draft my mission" entry point, so ME3 coaches the same way from chat and Mission.
export const MISSION_DRAFT_PROMPT =
  "Help me draft my mission. Ask me one short question at a time: who I want to help, the change I want for them, how I help, and why it matters to me. Then suggest a first draft I can save. It doesn't need to be perfect.";

// The Mission is private to ME3: it saves to Mission, never to the public site or me.json.
export async function saveMission(input: { statement?: string; answers?: MissionAnswers }): Promise<OwnerMission> {
  return (await api.put<{ mission: OwnerMission }>("/mission-control/mission", input)).mission;
}
