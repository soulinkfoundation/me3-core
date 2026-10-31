import type { UiIconName } from "./icons";

// Home's Get set up chips, in the iOS/Android order (me3-56rr.6, me3-56rr.10). Each ticks only from a real action.
export type SetupStepId = "site" | "email" | "mission" | "soulink";
export type SetupStep = { id: SetupStepId; label: string; icon: UiIconName; done: boolean };

export function setupSteps(done: Record<SetupStepId, boolean>): SetupStep[] {
  return [
    { id: "site", label: "Website", icon: "Globe", done: done.site },
    { id: "email", label: "Email ME3", icon: "Mail", done: done.email },
    { id: "mission", label: "Mission", icon: "Sparkles", done: done.mission },
    { id: "soulink", label: "Soulink", icon: "UsersRound", done: done.soulink },
  ];
}
