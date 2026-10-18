export type PluginStatus =
  | "available"
  | "installed"
  | "setup_required"
  | "disabled"
  | "coming_soon";

export type PluginSetupRequirement = {
  id: string;
  label: string;
  kind: "package" | "secret" | "binding" | "migration" | "queue" | "cron";
  required: boolean;
  configured: boolean;
  note?: string;
};

export type PluginRecord = {
  id: string;
  name: string;
  version: string;
  description: string;
  trustTier: "first_party" | "third_party";
  distribution: "workspace_package" | "npm_package" | "remote_bundle";
  implementationStatus: "catalog_only" | "bundled";
  showInPluginList?: boolean;
  releaseStage: "available" | "coming_soon";
  activationAllowed: boolean;
  status: PluginStatus;
  statusLabel: string;
  installed: boolean;
  enabled: boolean;
  capabilityIds: string[];
  permissions: { id: string; label: string }[];
  routes: { id: string; path: string; methods: string[]; auth: string }[];
  uiSlots: { id: string; slot: string; label: string }[];
  agentTools: {
    id: string;
    label: string;
    sideEffect: string;
    approvalMode: string;
  }[];
  secrets: { name: string; label: string; required: boolean }[];
  migrations: { id: string; path: string; destructive: false }[];
  queuesAndCrons: {
    id: string;
    kind: "queue" | "cron";
    binding?: string;
    schedule?: string;
  }[];
  setupRequirements: PluginSetupRequirement[];
  notes: string[];
};

export type PluginsResponse = {
  catalogVersion: string;
  plugins: PluginRecord[];
};

const pluginDisplayOrder = [
  "me3.agent-chat",
  "me3.mission-control",
  "me3.calendar",
  "me3.journal",
  "me3.accounts",
  "me3.landing-pages",
  "me3.email-campaigns",
  "me3.social-publishing",
];

const fixedCorePluginIds = new Set<string>([
  "me3.agent-chat",
  "me3.mission-control",
  "me3.calendar",
  "me3.journal",
]);

const pluginDisplayRank = new Map(
  pluginDisplayOrder.map((pluginId, index) => [pluginId, index]),
);

const pluginNavEmojis: Record<string, string> = {
  "me3.mission-control": "🚀",
  "me3.journal": "✍️",
  "me3.calendar": "🗓️",
  "me3.agent-chat": "🤖",
  "me3.social-publishing": "📣",
  "me3.accounts": "💰",
  "me3.landing-pages": "🌐",
  "me3.email-campaigns": "✉️",
};

export function pluginInfoText(plugin: PluginRecord) {
  if (plugin.id === "me3.social-publishing") {
    return "Adds social account connection and approval-first publishing.";
  }
  if (plugin.id === "me3.email-campaigns") {
    return "Schedule and manage email campaigns (this is a paid feature)";
  }
  return plugin.description;
}

export function isPluginComingSoon(plugin: PluginRecord) {
  return (
    plugin.status === "coming_soon" ||
    plugin.releaseStage === "coming_soon" ||
    plugin.activationAllowed === false
  );
}

export function isPluginHiddenFromList(plugin: PluginRecord) {
  return plugin.showInPluginList === false;
}

export function isFixedCorePlugin(plugin: PluginRecord) {
  return fixedCorePluginIds.has(plugin.id);
}

export function canActivatePlugin(plugin: PluginRecord) {
  return (
    !isPluginComingSoon(plugin) &&
    (plugin.status === "available" || plugin.status === "disabled")
  );
}

export function isPluginEnabled(plugin: PluginRecord) {
  return plugin.enabled || (!canActivatePlugin(plugin) && !isPluginComingSoon(plugin));
}

export function pluginNavEmojiById(pluginId: string) {
  return pluginNavEmojis[pluginId] || "🧩";
}

export function pluginNavEmoji(plugin: PluginRecord) {
  return pluginNavEmojiById(plugin.id);
}

export function sortPluginsForDisplay(plugins: readonly PluginRecord[]) {
  return [...plugins].sort((a, b) => {
    const aRank = pluginDisplayRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = pluginDisplayRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank || a.name.localeCompare(b.name);
  });
}
