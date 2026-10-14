import type { AgentToolContext } from "./types";

export async function requireEnabledPlugin(context: Pick<AgentToolContext, "db" | "enabledPluginIds">, pluginId?: string | null): Promise<void> {
  if (!pluginId) return;
  if (!context.enabledPluginIds.has(pluginId)) throw new Error(`Plugin ${pluginId} must be installed and enabled.`);
  const installation = await context.db.prepare(
    "SELECT enabled, status FROM plugin_installations WHERE plugin_id = ? LIMIT 1",
  ).bind(pluginId).first<{ enabled: number; status: string }>();
  // No override preserves the caller's default-enabled catalog eligibility.
  if (installation && (installation.enabled !== 1 || installation.status !== "installed")) {
    throw new Error(`Plugin ${pluginId} is disabled or unavailable.`);
  }
}
