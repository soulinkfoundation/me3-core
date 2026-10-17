/**
 * Computer job limits. Defaults were approved with the design (2026-10-11).
 * The installation sets a ceiling (managed plans pass it in; self-hosted installs
 * use the defaults), and the owner can only lower each value beneath it.
 */
export type ComputerLimits = {
  maxRunningJobs: number;
  maxBrowsingMinutesPerJob: number;
  maxStepsPerJob: number;
  dailyBrowserMinutes: number;
  maxTakeoverMinutes: number;
};
export const DEFAULT_COMPUTER_LIMITS: Readonly<ComputerLimits> = Object.freeze({
  maxRunningJobs: 1,
  maxBrowsingMinutesPerJob: 20,
  maxStepsPerJob: 60,
  dailyBrowserMinutes: 60,
  maxTakeoverMinutes: 30,
});
export const COMPUTER_LIMIT_KEYS = Object.keys(DEFAULT_COMPUTER_LIMITS) as Array<keyof ComputerLimits>;
// Hard platform bounds no ceiling can exceed: Browser Run handoffs last at most 30 minutes.
const PLATFORM_MAXIMUM: ComputerLimits = { maxRunningJobs: 5, maxBrowsingMinutesPerJob: 120, maxStepsPerJob: 300, dailyBrowserMinutes: 600, maxTakeoverMinutes: 30 };

export class ComputerLimitError extends Error {}

/** Parses an installation ceiling (JSON object of limit overrides); invalid input falls back to the defaults. */
export function parseComputerCeiling(raw: string | undefined | null): ComputerLimits {
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  const ceiling = { ...DEFAULT_COMPUTER_LIMITS };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const key of COMPUTER_LIMIT_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Number.isInteger(value) && (value as number) >= 1) ceiling[key] = Math.min(value as number, PLATFORM_MAXIMUM[key]);
    }
  }
  return ceiling;
}

/** Effective limits: each owner value applies only when it is at or below the ceiling. */
export function resolveComputerLimits(owner: Partial<ComputerLimits> | null | undefined, ceiling: ComputerLimits): ComputerLimits {
  const limits = { ...ceiling };
  for (const key of COMPUTER_LIMIT_KEYS) {
    const value = owner?.[key];
    if (Number.isInteger(value) && (value as number) >= 1) limits[key] = Math.min(value as number, ceiling[key]);
  }
  return limits;
}

/** Validates an owner settings change. Values above the ceiling are refused rather than silently clamped. */
export function parseOwnerComputerLimits(input: unknown, ceiling: ComputerLimits): Partial<ComputerLimits> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ComputerLimitError("Limits must be an object.");
  const result: Partial<ComputerLimits> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!COMPUTER_LIMIT_KEYS.includes(key as keyof ComputerLimits)) throw new ComputerLimitError(`Unknown limit ${key}.`);
    const limit = key as keyof ComputerLimits;
    if (value === null) continue;
    if (!Number.isInteger(value) || (value as number) < 1) throw new ComputerLimitError(`${limit} must be a whole number of at least 1.`);
    if ((value as number) > ceiling[limit]) throw new ComputerLimitError(`${limit} can be at most ${ceiling[limit]} on this installation.`);
    result[limit] = value as number;
  }
  return result;
}
