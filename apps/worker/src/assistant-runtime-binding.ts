import type { Env } from "./types";

export function assistantRuntimeNamespace(env:Env):DurableObjectNamespace|undefined {
  return env.ME3_ASSISTANT_RUNTIME==="agent"?env.ME3_AGENT:env.ME3_ASSISTANT_RUNTIME==="sdk"?env.ME3_SDK_USER_AGENT:env.ME3_USER_AGENT;
}
