import type { Env } from "./types";

/**
 * Limits a runtime can place on the agent for a restricted plan. Unset, an installation behaves as it
 * always has. The hosted free runtime sets both.
 */

/** A lower cap on model steps per turn (2 to 30), so one message cannot run the model dozens of times. */
export function agentMaxSteps(env: Pick<Env, "ME3_AGENT_MAX_STEPS">): number | undefined {
  const raw = env.ME3_AGENT_MAX_STEPS?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return undefined;
  const steps = Number(raw);
  return steps >= 2 && steps <= 30 ? steps : undefined;
}

/** A short statement of what the owner's plan leaves out, so the agent does not offer work it has no tools for. */
export function agentPlanNote(env: Pick<Env, "ME3_AGENT_PLAN_NOTE">): string | undefined {
  return env.ME3_AGENT_PLAN_NOTE?.trim() || undefined;
}
