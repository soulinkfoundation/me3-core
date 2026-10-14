import type { Env } from "./types";

export function assistantRuntimeNamespace(env: Env): DurableObjectNamespace | undefined {
  return env.ME3_AGENT;
}
