import type { Env } from "./types";

/**
 * An installation normally offers every tool its services support. A runtime that hosts a restricted
 * plan sets ME3_AGENT_TOOL_ALLOWLIST to the tool-name prefixes that plan includes; anything else is
 * hidden from the model and cannot be executed.
 */
export function toolAllowedByEnv(env: Pick<Env, "ME3_AGENT_TOOL_ALLOWLIST">, name: string): boolean {
  const prefixes = env.ME3_AGENT_TOOL_ALLOWLIST?.split(",").map((prefix) => prefix.trim()).filter(Boolean);
  if (!prefixes?.length) return true;
  return prefixes.some((prefix) => name.startsWith(prefix));
}
