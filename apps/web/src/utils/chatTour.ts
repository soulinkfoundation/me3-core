// Show me around (me3-q6la.5): Core writes the steps and keeps the owner's place (GET /api/assistant/tour),
// so every app tours the same things and a tour started on one picks up on another.
export type TourPlace = "website";
export type TourTask = { kind: "open"; label: string; to: TourPlace } | { kind: "site_ask"; label: string };
/** What the card points at, in the order the owner reaches them; elements carry `data-tour-target="<id>"`. */
export type TourTarget = { id: string; hint: string };
export type TourStep = { id: string; emoji: string; title: string; body: string; targets: TourTarget[]; task: TourTask | null; copy: { label: string; value: string } | null; done: boolean };
export type TourStatus = "new" | "active" | "finished" | "skipped";
export type ChatTour = { steps: TourStep[]; progress: { status: TourStatus; stepId: string | null } };

type GetJson = <T>(path: string) => Promise<T>;

/** A step without a title or body is left out; a tour with no steps is null, so the app falls back to asking ME3. */
export function readChatTour(tour: Partial<ChatTour> | null | undefined): ChatTour | null {
  const steps = (Array.isArray(tour?.steps) ? tour.steps : [])
    .filter(step => step?.title && step.body)
    .map(step => ({ ...step, targets: Array.isArray(step.targets) ? step.targets.filter(target => target?.id) : [], task: step.task ?? null, copy: step.copy ?? null, done: step.done === true }));
  if (!steps.length) return null;
  const status = tour?.progress?.status ?? "new";
  return { steps, progress: { status, stepId: tour?.progress?.stepId ?? null } };
}

export async function loadChatTour(get: GetJson): Promise<ChatTour | null> {
  return readChatTour(await get<Partial<ChatTour>>("/assistant/tour"));
}

/** Where to pick up: the saved step while the tour is active, else the start. */
export function tourStartIndex(tour: ChatTour): number {
  if (tour.progress.status !== "active") return 0;
  return Math.max(0, tour.steps.findIndex(step => step.id === tour.progress.stepId));
}

/** The tour step a page belongs to, so opening it ticks that step. */
export function tourPlaceForPath(path: string): "accounts" | "social" | null {
  if (path === "/accounts" || path.startsWith("/accounts/")) return "accounts";
  if (path === "/social" || path.startsWith("/social/")) return "social";
  return null;
}

/** Off Home (Accounts, Social) the profile picture isn't there, so the card points at Back first. */
export const BACK_HOME: TourTarget = { id: "back_home", hint: "Tap back to get to Home." };

/** The furthest target the owner can see now: Home tab, then Add to Home once Home is open. */
export function currentTourTarget(targets: TourTarget[], visible: (id: string) => boolean): TourTarget | null {
  for (let index = targets.length - 1; index >= 0; index--) if (visible(targets[index].id)) return targets[index];
  return targets.length && visible(BACK_HOME.id) ? BACK_HOME : null;
}

type Box = { top: number; left: number; right: number; bottom: number };
/** `arrow` is how far along the card's edge the pointer sits (x for above/below, y for left). */
export type TourPlacement = { top: number; left: number; side: "below" | "above" | "left"; arrow: number };

/**
 * Where the card goes so its arrow points at `target` without covering it. `around` is something open the card
 * must not cover either (the profile menu the target sits in). Null when there's no room: the card docks instead.
 */
export function placeTourCard(target: Box, card: { width: number; height: number }, view: { width: number; height: number }, around?: Box): TourPlacement | null {
  const gap = 14; const margin = 12;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const centreX = (target.left + target.right) / 2; const centreY = (target.top + target.bottom) / 2;
  const avoid = around ?? target;
  const horizontal = (top: number, side: "below" | "above") => {
    const left = clamp(centreX - card.width / 2, margin, view.width - card.width - margin);
    return { top, left, side, arrow: clamp(centreX - left, 20, card.width - 20) };
  };
  if (around && around.left - card.width - gap >= margin) {
    const top = clamp(centreY - 32, margin, view.height - card.height - margin);
    return { top, left: around.left - card.width - gap, side: "left", arrow: clamp(centreY - top, 20, card.height - 20) };
  }
  if (avoid.bottom + gap + card.height <= view.height - margin) return horizontal(avoid.bottom + gap, "below");
  if (!around && avoid.top - gap - card.height >= margin) return horizontal(avoid.top - gap - card.height, "above");
  return null;
}
