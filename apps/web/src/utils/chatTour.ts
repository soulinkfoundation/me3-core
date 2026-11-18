// Show me around (me3-q6la.5): Core writes the steps and keeps the owner's place (GET /api/assistant/tour),
// so every app tours the same things and a tour started on one picks up on another.
export type TourPlace = "home_add" | "accounts" | "social" | "website";
export type TourTask = { kind: "open"; label: string; to: TourPlace } | { kind: "site_ask"; label: string };
export type TourStep = { id: string; emoji: string; title: string; body: string; task: TourTask | null; copy: { label: string; value: string } | null; done: boolean };
export type TourStatus = "new" | "active" | "finished" | "skipped";
export type ChatTour = { steps: TourStep[]; progress: { status: TourStatus; stepId: string | null } };

type GetJson = <T>(path: string) => Promise<T>;

/** A step without a title or body is left out; a tour with no steps is null, so the app falls back to asking ME3. */
export function readChatTour(tour: Partial<ChatTour> | null | undefined): ChatTour | null {
  const steps = (Array.isArray(tour?.steps) ? tour.steps : [])
    .filter(step => step?.title && step.body)
    .map(step => ({ ...step, task: step.task ?? null, copy: step.copy ?? null, done: step.done === true }));
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
