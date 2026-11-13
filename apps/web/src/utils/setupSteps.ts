import type { UiIconName } from "./icons";

// Home's Get set up chips, in the iOS/Android order (me3-56rr.6, me3-56rr.10). Each ticks only from a real action.
// The tour leads when a walkthrough video is configured (utils/tourVideo.ts).
export type SetupStepId = "tour" | "site" | "email" | "mission" | "soulink";
export type SetupStep = { id: SetupStepId; label: string; icon: UiIconName; done: boolean };

export function setupSteps(done: Record<SetupStepId, boolean>, options: { tourMinutes?: number } = {}): SetupStep[] {
  const steps: SetupStep[] = [
    { id: "site", label: "Website", icon: "Globe", done: done.site },
    { id: "email", label: "Email ME3", icon: "Mail", done: done.email },
    { id: "mission", label: "Mission", icon: "Sparkles", done: done.mission },
    { id: "soulink", label: "Soulink", icon: "UsersRound", done: done.soulink },
  ];
  if (!options.tourMinutes) return steps;
  return [{ id: "tour", label: `Watch the ${options.tourMinutes}-min tour`, icon: "Play", done: done.tour }, ...steps];
}
