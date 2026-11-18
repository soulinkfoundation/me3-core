// Show me around (me3-q6la.5): Core writes the steps (GET /api/assistant/tour) so every app tours the same things.
export type TourPlace = "home" | "website" | "news" | "email_settings";
export type TourTry =
  | { kind: "prompt"; label: string; prompt: string }
  | { kind: "site_ask"; label: string }
  | { kind: "copy"; label: string; value: string }
  | { kind: "open"; label: string; to: TourPlace };
export type TourStep = { id: string; emoji: string; title: string; body: string; where: string; tryIt: TourTry | null };
export type ChatTour = { steps: TourStep[]; done: { title: string; body: string } };

type GetJson = <T>(path: string) => Promise<T>;

/** A step without a title or body is left out; a tour with no steps is null, so the app falls back to asking ME3. */
export async function loadChatTour(get: GetJson): Promise<ChatTour | null> {
  const tour = await get<Partial<ChatTour>>("/assistant/tour");
  const steps = (Array.isArray(tour.steps) ? tour.steps : []).filter(step => step?.title && step.body);
  if (!steps.length) return null;
  return { steps, done: tour.done?.title ? tour.done : { title: "That's the tour", body: "Ask me anything." } };
}
