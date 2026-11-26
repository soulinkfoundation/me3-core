// Show me around (me3-q6la.5): Core writes the steps and keeps the owner's place (GET /api/assistant/tour),
// so every app tours the same things and a tour started on one picks up on another.
export type TourPlace = "website" | "page";
export type TourTask = { kind: "open"; label: string; to: TourPlace } | { kind: "site_ask"; label: string };
/** What the card points at, in the order the owner reaches them; elements carry `data-tour-target="<id>"`. */
export type TourTarget = { id: string; hint: string };
/** The screen a step is about: Next takes the owner there, and the card explains it once they're on it. */
export type TourScreen = "home" | "accounts" | "social" | "chat";
export type TourStep = { id: string; emoji: string; title: string; body: string; screen: TourScreen | null; intro: string | null; targets: TourTarget[]; task: TourTask | null; done: boolean; optional?: boolean };
export type TourStatus = "new" | "active" | "finished" | "skipped";
export type ChatTour = { steps: TourStep[]; progress: { status: TourStatus; stepId: string | null } };

type GetJson = <T>(path: string) => Promise<T>;

/** A step without a title or body is left out; a tour with no steps is null, so the app falls back to asking ME3. */
export function readChatTour(tour: Partial<ChatTour> | null | undefined): ChatTour | null {
  const steps = (Array.isArray(tour?.steps) ? tour.steps : [])
    .filter(step => step?.title && step.body)
    .map(step => ({ ...step, screen: step.screen ?? null, intro: step.intro ?? null, targets: Array.isArray(step.targets) ? step.targets.filter(target => target?.id) : [], task: step.task ?? null, done: step.done === true, optional: step.optional === true }));
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

/**
 * What the card points at once the step is done: a step whose one target is where the owner had to go (Home's tab)
 * keeps its card beside it, so the first card sits up by the Home tab rather than at the bottom of the screen.
 */
export function tourPointsWhenDone(targets: TourTarget[], visible: TourTarget | null): TourTarget | null {
  return targets.length === 1 && visible?.id === targets[0].id ? targets[0] : null;
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
export type TourPlacement = { top: number; left: number; side: "below" | "above" | "left" | "over"; arrow: number };

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
  // A target in the lower half (Add to Home at the end of Home) gets the card above it, clear of the composer.
  const roomAbove = !around && avoid.top - gap - card.height >= margin;
  if (roomAbove && centreY > view.height / 2) return horizontal(avoid.top - gap - card.height, "above");
  if (avoid.bottom + gap + card.height <= view.height - margin) return horizontal(avoid.bottom + gap, "below");
  if (roomAbove) return horizontal(avoid.top - gap - card.height, "above");
  return null;
}

/** Whether the owner is looking at `screen` now. Home and Chat share /assistant and differ by `view`. */
export function onTourScreen(screen: TourScreen | null, path: string, view: unknown): boolean {
  if (!screen) return true;
  if (screen === "home" || screen === "chat") return path === "/assistant" && (view === screen || (view === undefined && screen === "home"));
  return tourPlaceForPath(path) === screen;
}

export function tourScreenRoute(screen: TourScreen) {
  return screen === "home" || screen === "chat" ? { path: "/assistant", query: { view: screen } } : { path: `/${screen}` };
}

/** The screen the owner is looking at now, or null anywhere else. */
export function currentTourScreen(path: string, view: unknown): TourScreen | null {
  return (["home", "chat", "accounts", "social"] as const).find(screen => onTourScreen(screen, path, view)) ?? null;
}

/**
 * Where Next or Back takes the owner: the step's own screen, so the card always explains what's in front of them
 * (Next from Home's card on Chat opens Home). Leaving Accounts or Social closes them too.
 */
export function tourScreenToOpen(step: TourStep, current: TourScreen | null): TourScreen | null {
  const screen = step.screen;
  return !screen || screen === current ? null : screen;
}

/**
 * Whether the step counts as done here. Landing on Accounts or Social is the step; a step that points the way
 * (Home, then Add to Home) shows Done only on its own screen, so an owner whose Home already has cards still starts
 * by opening Home.
 */
export function tourStepDone(step: TourStep, current: TourScreen | null): boolean {
  if ((step.id === "accounts" || step.id === "social") && step.id === current) return true;
  return step.done && (!step.targets.length || onScreen(step.screen, current));
}

/** The page where the owner does a step (Calendar's connect dialog): the card steps aside there. */
export function tourStepIsHere(step: TourStep, path: string): boolean {
  return step.id === "calendar" && (path === "/calendar" || path.startsWith("/calendar/"));
}

/** Where the tour just sent the owner and when; `arrived` is when that screen came up. */
export type TourTrip = { screen: TourScreen; asked: number; arrived: number | null };
/** The card waits while the screen the tour asked for opens and settles (0.45 s), giving up after 3 s. */
export function tourArrival(trip: TourTrip | null, current: TourScreen | null, now: number): { trip: TourTrip | null; waiting: boolean } {
  if (!trip) return { trip: null, waiting: false };
  if (current === trip.screen) {
    const arrived = trip.arrived ?? now;
    if (now - arrived < 450) return { trip: { ...trip, arrived }, waiting: true };
  } else if (now - trip.asked < 3000) {
    return { trip, waiting: true };
  }
  return { trip: null, waiting: false };
}

/** A dialog over the step's screen (Add to Home) is where the owner is doing the step, so the card steps aside unless it points inside it. */
export function tourCardWaits(step: TourStep, current: TourScreen | null, dialog: { open: boolean; holdsTarget: boolean }): boolean {
  return dialog.open && !dialog.holdsTarget && onScreen(step.screen, current);
}
const onScreen = (screen: TourScreen | null, current: TourScreen | null) => !screen || screen === current;

/** The step last seen settled (on its screen, nothing open) and whether Core counted it done then. */
export type TourTickMemory = { stepId: string; done: boolean };
/**
 * Done what Home asked (Inbox picked, a calendar connected) and back with nothing open: straight on to the next step.
 * `done` is Core's tick, so arriving on a step that was already done doesn't skip it.
 */
export function tourMovesOn(memory: TourTickMemory | null, now: { stepId: string; done: boolean; hasTargets: boolean; settled: boolean }): { memory: TourTickMemory | null; advance: boolean } {
  if (memory?.stepId === now.stepId && !memory.done && now.done && now.hasTargets && now.settled) return { memory: { stepId: now.stepId, done: true }, advance: true };
  if (memory?.stepId !== now.stepId || now.settled) return { memory: { stepId: now.stepId, done: now.done }, advance: false };
  return { memory, advance: false };
}

/** Walking away from the last card's screen, once the owner has been on it, finishes the tour. */
export function tourLeftLast(reached: boolean, now: { isLast: boolean; screen: TourScreen | null; current: TourScreen | null }): { reached: boolean; end: boolean } {
  if (!now.isLast || !now.screen) return { reached: false, end: false };
  if (now.current === now.screen) return { reached: true, end: false };
  return { reached, end: reached };
}

/** With nothing to point at, the card covers `backdrop` (a screen's empty placeholder, which fades out under it), `bottomLimit` clear of the bottom. */
export function coverTourCard(backdrop: Box, card: { width: number; height: number }, view: { width: number; height: number }, bottomLimit: number): TourPlacement {
  const margin = 12;
  const top = Math.max(margin, Math.min((backdrop.top + backdrop.bottom) / 2 - card.height / 2, view.height - bottomLimit - card.height));
  const left = Math.max(margin, Math.min((backdrop.left + backdrop.right) / 2 - card.width / 2, view.width - card.width - margin));
  return { top, left, side: "over", arrow: 0 };
}
