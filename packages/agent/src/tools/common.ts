import { CORE_CHAT_CAPABILITIES } from "../../../agent-chat/src/capabilities";
import type { AgentTool, AgentToolContext, AgentToolResult, JsonSchema } from "../types";
import type { AgentDomainServices } from "./services";

export function domainTool(id: string, execute: AgentTool["execute"], overrides: Partial<Omit<AgentTool, "name" | "execute">> = {}): AgentTool {
  const capability = CORE_CHAT_CAPABILITIES.find(capability => capability.id === id);
  if (!capability) throw new Error(`Unknown capability ${id}`);
  const effect = capability.sideEffect.startsWith("read_") ? "read" : capability.sideEffect.startsWith("external_") && capability.sideEffect !== "external_draft" ? "external" : "write";
  const tool: AgentTool = {
    name: id.replace(/\./g, "_"), description: capability.summary, parameters: capability.inputSchema as JsonSchema,
    effect, approval: effect === "external" || capability.approvalMode === "approval_required" ? "required" : "none", pluginId: capability.pluginId,
    ...overrides,
    async execute(args, context) {
      try {
        if (tool.pluginId && !context.enabledPluginIds.has(tool.pluginId)) throw new Error(`Plugin ${tool.pluginId} must be installed and enabled.`);
        const properties = tool.parameters.properties as Record<string, unknown>;
        for (const key of Object.keys(args)) if (!(key in properties)) throw new Error(`Undeclared argument ${key}.`);
        if (context.signal.aborted) throw new Error("Turn cancelled.");
        return await execute(args, context);
      } catch (error) {
        return { status: "error", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  return tool;
}
export const ok = (data: unknown): AgentToolResult => ({ status: "ok", data });
export function services(context: AgentToolContext): AgentDomainServices { return (context.services || {}) as AgentDomainServices; }
export function requiredString(value: unknown, label: string) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value.trim(); }
export function optionalString(value: unknown) { return typeof value === "string" ? value : undefined; }
export function optionalNumber(value: unknown) { return typeof value === "number" ? value : undefined; }
export const objectSchema = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
export const idProperty = (label: string) => ({ type: "string", minLength: 1, description: `Stable ${label} ID copied exactly from a prior read. Never infer an ID from a title.` });
export function resultOrThrow<T extends object>(value: T): Exclude<T, { error: string }> { if ("error" in value) throw new Error(String(value.error)); return value as Exclude<T, { error: string }>; }
