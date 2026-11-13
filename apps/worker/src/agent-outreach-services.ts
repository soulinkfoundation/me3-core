import { listOutreachProspects, saveOutreachProspects } from "@me3-core/plugin-agent-chat";
import type { AgentOutreachServices } from "../../../packages/agent/src/tools/services";
import type { Env } from "./types";

/** Outreach for the assistant: prospects in People. Sending stays with mailbox draft approval. */
export function createAgentOutreachServices(env: Env, ownerId: string): AgentOutreachServices {
  return {
    list: (input) => listOutreachProspects(env, ownerId, input),
    save: (prospects) => saveOutreachProspects(env, ownerId, prospects),
  };
}
