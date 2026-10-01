import type { Me3AgentCapabilitySchema } from "@me3/knowledge";
import {
  CORE_CHAT_CAPABILITIES,
  type CoreChatCapabilityContract,
  type CoreChatCapabilityId,
} from "./capabilities";

export type CoreChatToolDefinition = {
  name: string;
  capabilityId: CoreChatCapabilityId;
  pluginId: string | null;
  description: string;
  parameters: Me3AgentCapabilitySchema;
  handlerRoute: string;
  requiredSetupChecks: readonly string[];
  sideEffect: CoreChatCapabilityContract["sideEffect"];
  approvalMode: CoreChatCapabilityContract["approvalMode"];
  auditEventKind: string;
};

export type CoreChatToolDefinitionIssue = {
  toolName: string;
  field: keyof CoreChatToolDefinition;
  message: string;
};

export const CORE_CHAT_TOOLS: readonly CoreChatToolDefinition[] = CORE_CHAT_CAPABILITIES
  .filter((capability) => capability.handler.route !== "model")
  .map((capability) => ({
    name: coreChatToolName(capability.id),
    capabilityId: capability.id,
    pluginId: capability.pluginId,
    description: capability.summary,
    parameters: capability.inputSchema,
    handlerRoute: capability.handler.route,
    requiredSetupChecks: capability.requiresSetup,
    sideEffect: capability.sideEffect,
    approvalMode: capability.approvalMode,
    auditEventKind: capability.auditEventKind,
  }));

const CORE_CHAT_TOOL_BY_NAME = new Map(
  CORE_CHAT_TOOLS.map((tool) => [tool.name, tool] as const),
);

export function coreChatToolName(capabilityId: string): string {
  return capabilityId.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

export function getCoreChatToolByName(name: string): CoreChatToolDefinition | null {
  return CORE_CHAT_TOOL_BY_NAME.get(name) || null;
}

export function validateCoreChatToolDefinitions(
  tools: readonly CoreChatToolDefinition[] = CORE_CHAT_TOOLS,
): CoreChatToolDefinitionIssue[] {
  const issues: CoreChatToolDefinitionIssue[] = [];
  const names = new Set<string>();

  for (const tool of tools) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) {
      issues.push({
        toolName: tool.name,
        field: "name",
        message: "Tool names must be 1-64 provider-safe characters.",
      });
    }
    if (names.has(tool.name)) {
      issues.push({
        toolName: tool.name,
        field: "name",
        message: "Tool names must be unique.",
      });
    }
    names.add(tool.name);

    if (!tool.description.trim()) {
      issues.push({
        toolName: tool.name,
        field: "description",
        message: "Tool descriptions are required.",
      });
    }
    if (tool.parameters.additionalProperties !== false) {
      issues.push({
        toolName: tool.name,
        field: "parameters",
        message: "Tool schemas must reject undeclared properties.",
      });
    }
  }

  return issues;
}
