export * from "./agent-context";
export * from "./bundled-agent-skills";

export const ME3_KNOWLEDGE_SCHEMA_VERSION = "2026-05-15.v1";

export type Me3KnowledgeAudience = "agent" | "app" | "docs";
export type Me3KnowledgeSurface = "core" | "hosted" | "shared";
export type Me3CapabilityCategory =
  | "assistant"
  | "identity"
  | "workspace"
  | "calendar"
  | "mailbox"
  | "contacts"
  | "content"
  | "sites"
  | "providers"
  | "safety";

export type Me3CapabilityLifecycle =
  | "available"
  | "partial"
  | "setup_required"
  | "coming_soon";

export type Me3ApprovalMode =
  | "none"
  | "owner_approval"
  | "external_action_approval"
  | "local_access_approval";

export type Me3CapabilitySideEffect =
  | "none"
  | "internal_write"
  | "external_write"
  | "local_read"
  | "local_write"
  | "local_shell";

export type Me3CapabilityRuntimeState =
  | "available"
  | "partial"
  | "setup_required"
  | "disabled"
  | "coming_soon"
  | "not_installed"
  | "unsupported"
  | "unknown";

export type Me3KnowledgeFact = {
  id: string;
  title: string;
  summary: string;
  agentSummary: string;
  audiences: readonly Me3KnowledgeAudience[];
  tags: readonly string[];
};

export type Me3Capability = {
  id: string;
  title: string;
  category: Me3CapabilityCategory;
  summary: string;
  agentSummary: string;
  surfaces: readonly Me3KnowledgeSurface[];
  lifecycle: Me3CapabilityLifecycle;
  pluginId?: string;
  defaultEnabled?: boolean;
  requires?: readonly string[];
  approvalMode: Me3ApprovalMode;
  sideEffect: Me3CapabilitySideEffect;
  dataBoundary: string;
  appRoutes?: readonly string[];
  agentToolIds?: readonly string[];
  boundaries: readonly string[];
  tags: readonly string[];
};

export type Me3KnowledgeRuntimeContext = {
  surface?: Exclude<Me3KnowledgeSurface, "shared">;
  installedPluginIds?: readonly string[];
  enabledPluginIds?: readonly string[];
  setupRequiredPluginIds?: readonly string[];
  disabledPluginIds?: readonly string[];
  configuredFeatureIds?: readonly string[];
  missingFeatureIds?: readonly string[];
  chatRuntime?: "conversation_only" | "tool_enabled";
  includeComingSoon?: boolean;
  maxAgentCapabilities?: number;
};

export type Me3KnowledgePluginTool = {
  id: string;
  label?: string;
  sideEffect?: string;
  approvalMode?: string;
};

export type Me3KnowledgePluginRoute = {
  id: string;
  path: string;
  methods?: readonly string[];
  auth?: string;
};

export type Me3KnowledgePluginSetupRequirement = {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  configured: boolean;
  note?: string;
};

export type Me3KnowledgePluginSource = {
  id: string;
  name: string;
  description: string;
  status?: string;
  enabled?: boolean;
  installed?: boolean;
  capabilityIds?: readonly string[];
  routes?: readonly Me3KnowledgePluginRoute[];
  agentTools?: readonly Me3KnowledgePluginTool[];
  setupRequirements?: readonly Me3KnowledgePluginSetupRequirement[];
};

export type Me3KnowledgePluginDerivedSummary = {
  id: string;
  name: string;
  description: string;
  status: string | null;
  enabled: boolean | null;
  installed: boolean | null;
  capabilityIds: readonly string[];
  routePaths: readonly string[];
  agentToolIds: readonly string[];
  setupRequirements: readonly Me3KnowledgePluginSetupRequirement[];
};

export type Me3KnowledgeValidationIssue = {
  capabilityId: string;
  pluginId?: string;
  field: "pluginId" | "agentToolIds" | "appRoutes";
  message: string;
};

export type Me3ResolvedCapability = Me3Capability & {
  runtimeState: Me3CapabilityRuntimeState;
  runtimeNote: string;
  availableInContext: boolean;
};

export type Me3KnowledgeSnapshot = {
  schemaVersion: string;
  facts: readonly Me3KnowledgeFact[];
  capabilities: readonly Me3ResolvedCapability[];
  plugins?: readonly Me3KnowledgePluginDerivedSummary[];
};

export const ME3_AGENT_CAPABILITY_APPROVAL_MODES = [
  "none",
  "review_required",
  "approval_required",
  "forbidden",
] as const;

export type Me3AgentCapabilityApprovalMode =
  (typeof ME3_AGENT_CAPABILITY_APPROVAL_MODES)[number];

export const ME3_AGENT_CAPABILITY_SIDE_EFFECTS = [
  "none",
  "read_private",
  "read_external",
  "internal_write",
  "write_internal_draft",
  "write_internal_active",
  "memory_write",
  "notify_owner",
  "external_draft",
  "external_write",
  "external_send",
  "public_publish",
  "destructive",
  "money_or_account",
  "local_read",
  "local_write",
  "local_shell",
  "permission_change",
] as const;

export type Me3AgentCapabilitySideEffect =
  (typeof ME3_AGENT_CAPABILITY_SIDE_EFFECTS)[number];

export type Me3AgentCapabilityOwner = "core" | "plugin";

export type Me3AgentCapabilityCategory =
  | "assistant"
  | "mission_control"
  | "email"
  | "calendar"
  | "messaging"
  | "memory"
  | "local"
  | "content"
  | "sites"
  | "web"
  | "accounts"
  | "provider";

export type Me3AgentCapabilitySchemaProperty = {
  type:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | readonly ("string" | "number" | "integer" | "boolean" | "array" | "null")[];
  description: string;
  enum?: readonly (string | number | boolean | null)[];
  format?: string;
  items?: {
    type: "string" | "number" | "integer" | "boolean" | "null";
  };
};

export type Me3AgentCapabilitySchema = {
  type: "object";
  required?: readonly string[];
  properties: Readonly<Record<string, Me3AgentCapabilitySchemaProperty>>;
  additionalProperties: false;
};

export type Me3AgentCapabilityHandler = {
  surface: "chat" | "assistant_job" | "plugin_tool";
  route: string;
};

export type Me3AgentCapabilityExamples = {
  positive: readonly string[];
  negative: readonly string[];
};

export type Me3AgentCapabilityContract = {
  id: string;
  owner: Me3AgentCapabilityOwner;
  pluginId: string | null;
  version: string;
  ownerFacingLabel: string;
  summary: string;
  category: Me3AgentCapabilityCategory;
  handler: Me3AgentCapabilityHandler;
  sideEffect: Me3AgentCapabilitySideEffect;
  approvalMode: Me3AgentCapabilityApprovalMode;
  requiresSetup: readonly string[];
  inputSchema: Me3AgentCapabilitySchema;
  outputSchema: Me3AgentCapabilitySchema;
  auditEventKind: string;
  examples: Me3AgentCapabilityExamples;
};

export type Me3AgentCapabilityContractIssue = {
  capabilityId: string;
  field: keyof Me3AgentCapabilityContract | "examples.positive" | "examples.negative";
  message: string;
};

export const ME3_EMPTY_AGENT_CAPABILITY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies Me3AgentCapabilitySchema;

const ME3_AGENT_CAPABILITY_APPROVAL_MODE_WEIGHT: Record<
  Me3AgentCapabilityApprovalMode,
  number
> = {
  none: 0,
  review_required: 1,
  approval_required: 2,
  forbidden: 3,
};

export function defineMe3AgentCapabilityContract<
  T extends Me3AgentCapabilityContract,
>(capability: T): T {
  return capability;
}

export function isMe3AgentCapabilityApprovalModeAtLeast(
  requested: Me3AgentCapabilityApprovalMode,
  required: Me3AgentCapabilityApprovalMode,
): boolean {
  return (
    ME3_AGENT_CAPABILITY_APPROVAL_MODE_WEIGHT[requested] >=
    ME3_AGENT_CAPABILITY_APPROVAL_MODE_WEIGHT[required]
  );
}

export function validateMe3AgentCapabilityContract(
  capability: Me3AgentCapabilityContract,
): Me3AgentCapabilityContractIssue[] {
  const issues: Me3AgentCapabilityContractIssue[] = [];
  const requiredTextFields = [
    "id",
    "version",
    "ownerFacingLabel",
    "summary",
    "auditEventKind",
  ] as const;

  for (const field of requiredTextFields) {
    if (!capability[field]?.trim()) {
      issues.push({
        capabilityId: capability.id || "(missing)",
        field,
        message: `${field} is required.`,
      });
    }
  }

  if (capability.owner === "plugin" && !capability.pluginId?.trim()) {
    issues.push({
      capabilityId: capability.id || "(missing)",
      field: "pluginId",
      message: "Plugin-owned capabilities must name their plugin.",
    });
  }

  if (!capability.handler.route.trim()) {
    issues.push({
      capabilityId: capability.id || "(missing)",
      field: "handler",
      message: "Capabilities must name a handler route.",
    });
  }

  for (const [field, schema] of [
    ["inputSchema", capability.inputSchema],
    ["outputSchema", capability.outputSchema],
  ] as const) {
    if (schema.additionalProperties !== false) {
      issues.push({
        capabilityId: capability.id || "(missing)",
        field,
        message: `${field} must reject undeclared properties.`,
      });
    }
    for (const required of schema.required ?? []) {
      if (!schema.properties[required]) {
        issues.push({
          capabilityId: capability.id || "(missing)",
          field,
          message: `${field} requires undeclared property ${required}.`,
        });
      }
    }
    for (const [name, property] of Object.entries(schema.properties)) {
      if (!property.description.trim()) {
        issues.push({
          capabilityId: capability.id || "(missing)",
          field,
          message: `${field} property ${name} needs a description.`,
        });
      }
    }
  }

  if (!capability.examples.positive.length) {
    issues.push({
      capabilityId: capability.id || "(missing)",
      field: "examples.positive",
      message: "Capabilities must include at least one positive example.",
    });
  }

  if (!capability.examples.negative.length) {
    issues.push({
      capabilityId: capability.id || "(missing)",
      field: "examples.negative",
      message: "Capabilities must include at least one negative example.",
    });
  }

  return issues;
}

export type Me3LlmsDocumentSource = {
  title: string;
  url: string;
  description: string;
};

export type Me3LlmsTextOptions = {
  repositoryUrl?: string;
  sourceDocuments?: readonly Me3LlmsDocumentSource[];
};

export const ME3_PRODUCT_KNOWLEDGE: readonly Me3KnowledgeFact[] = [
  {
    id: "me3.product.identity",
    title: "What ME3 is",
    summary:
      "ME3 is an assistant, identity layer, public site, and action surface for a person or business.",
    agentSummary:
      "Describe ME3 as a personal/business assistant that understands the owner's public identity, private context, and action surfaces.",
    audiences: ["agent", "app", "docs"],
    tags: ["product", "positioning"],
  },
  {
    id: "me3.boundary.public_private",
    title: "Public and private boundaries",
    summary:
      "Public me.json/profile data is separate from private memory, provider secrets, tasks, approvals, and local context.",
    agentSummary:
      "Keep public profile/me.json facts separate from private memory, secrets, task history, approvals, and local context.",
    audiences: ["agent", "app", "docs"],
    tags: ["privacy", "me-json", "memory"],
  },
  {
    id: "me3.consent.actions",
    title: "Consent before action",
    summary:
      "Sending, publishing, booking, paying, editing local files, and running code require clear owner permission and auditability.",
    agentSummary:
      "Do not imply consequential actions happened unless a tool or route result confirms it; explain approval requirements plainly.",
    audiences: ["agent", "app", "docs"],
    tags: ["safety", "approvals", "audit"],
  },
  {
    id: "me3.portability.core_hosted",
    title: "Core and hosted portability",
    summary:
      "ME3 is owner-controlled and installable. Managed ME3 reuses shared capability contracts while keeping billing and managed operations outside the installable runtime.",
    agentSummary:
      "When comparing Core and hosted ME3, distinguish shared capabilities from hosted-only billing, ops, and managed infrastructure.",
    audiences: ["agent", "app", "docs"],
    tags: ["core", "hosted", "portability"],
  },
];

export const ME3_CAPABILITIES: readonly Me3Capability[] = [
  {
    id: "chat.core_reply",
    title: "Core chat",
    category: "assistant",
    summary:
      "ME3 can answer questions, reason with the owner, and explain the current Core install when an AI route is configured.",
    agentSummary:
      "You can converse, reason, explain ME3, and help the owner plan. Live model quality depends on configured AI providers.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    pluginId: "me3.agent-chat",
    defaultEnabled: true,
    requires: ["ai.chat_provider"],
    approvalMode: "none",
    sideEffect: "none",
    dataBoundary: "Conversation history is owner-scoped inside the install.",
    appRoutes: ["/api/agent/sandbox", "/api/assistant/chat"],
    agentToolIds: ["chat.core_reply"],
    boundaries: [
      "Do not say external work was completed unless a tool or API result confirms it.",
      "If AI setup is missing, explain how to configure a provider instead of pretending a live model is active.",
    ],
    tags: ["chat", "assistant", "ai"],
  },
  {
    id: "identity.public_profile",
    title: "Public identity and me.json",
    category: "identity",
    summary:
      "ME3 can publish the owner's public profile and me.json so other systems know who they are and what public actions are authorized.",
    agentSummary:
      "ME3 owns public profile and me.json output; treat it as public authority-before-action context, not private memory.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    approvalMode: "owner_approval",
    sideEffect: "internal_write",
    dataBoundary: "Public profile data may be published; private memory must not leak into me.json unless explicitly mapped by the owner.",
    appRoutes: ["/.well-known/me.json", "/api/account"],
    boundaries: [
      "Public me.json is not a dump of private context.",
      "Profile edits should be explicit owner changes.",
    ],
    tags: ["identity", "me-json", "profile"],
  },
  {
    id: "sites.public_site",
    title: "Public site",
    category: "sites",
    summary:
      "ME3 can host a simple public site for the owner, including profile, links, booking/contact surfaces, and generated pages.",
    agentSummary:
      "ME3 can help the owner shape their public site, but publishing visible changes should be explicit.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    approvalMode: "owner_approval",
    sideEffect: "internal_write",
    dataBoundary: "Site content is public once published; drafts and setup data remain owner-scoped.",
    appRoutes: ["/api/sites", "/sites/:username"],
    boundaries: [
      "Distinguish drafts from published pages.",
      "Do not publish visible changes without owner intent.",
    ],
    tags: ["sites", "profile", "publishing"],
  },
  {
    id: "workspace.mission_control",
    title: "Tasks and Projects",
    category: "workspace",
    summary:
      "Tasks and Projects gives the owner a private workspace for tasks, projects, approvals, private memory, context sources, and run history.",
    agentSummary:
      "Tasks and Projects is the default private workspace for tasks, approvals, private memory, context sources, plugin activity, and run history.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    pluginId: "me3.mission-control",
    defaultEnabled: true,
    approvalMode: "owner_approval",
    sideEffect: "internal_write",
    dataBoundary: "Task and project data is private, owner-scoped, and plugin-owned.",
    appRoutes: ["/tasks", "/tasks?goals=1"],
    agentToolIds: [
      "mission.task.create",
      "mission.memory.write",
      "mission.approval.request",
    ],
    boundaries: [
      "Private memory writes should be visible and approval-aware.",
      "Public me.json remains Core-owned and separate from private Assistant memory.",
    ],
    tags: ["workspace", "tasks", "memory", "approvals"],
  },
  {
    id: "workspace.local_daemon_bridge",
    title: "Optional local daemon bridge",
    category: "workspace",
    summary:
      "ME3 is designed to pair with an optional local daemon for explicitly approved local files, repos, and shell actions.",
    agentSummary:
      "Local daemon access is optional, path-scoped, owner-paired, and approval-gated. Treat it as unavailable unless setup and tool results confirm it.",
    surfaces: ["core"],
    lifecycle: "partial",
    pluginId: "me3.mission-control",
    defaultEnabled: true,
    requires: ["mission.daemon_pairing"],
    approvalMode: "local_access_approval",
    sideEffect: "local_shell",
    dataBoundary: "Local file and repo access must be explicit, scoped, and audited.",
    appRoutes: ["/api/mission-control/daemon/*"],
    agentToolIds: ["mission.daemon.read", "mission.daemon.write", "mission.daemon.shell"],
    boundaries: [
      "Do not claim local access unless the daemon is paired and the requested path/action is allowed.",
      "Never make local file or shell access implicit.",
    ],
    tags: ["daemon", "local-files", "repos", "approval"],
  },
  {
    id: "calendar.events_reminders",
    title: "Calendar events and reminders",
    category: "calendar",
    summary:
      "ME3 can manage native personal calendar events, reminders, bookings, birthdays, imported calendar sources, recurring event expansion, and a read-only view of Social Publications when that plugin is ready.",
    agentSummary:
      "ME3 has calendar and reminder surfaces. Social Publications can appear as plugin-owned read-only Calendar entries; creating or changing events/reminders remains a separate internal write.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    pluginId: "me3.calendar",
    defaultEnabled: true,
    approvalMode: "owner_approval",
    sideEffect: "internal_write",
    dataBoundary: "Calendar records are private owner workspace data unless explicitly shared through a public surface.",
    appRoutes: ["/calendar", "/api/calendar/feed", "/api/agent/reminders"],
    agentToolIds: ["calendar.event.create", "calendar.reminder.create"],
    boundaries: [
      "Be precise about dates, times, and time zones.",
      "Do not claim a reminder or event was created without an API/tool result.",
      "Calendar projects Social Publications only while Social Publishing is ready and never copies them into personal calendar event records.",
    ],
    tags: ["calendar", "reminders", "bookings", "social-publications"],
  },
  {
    id: "mailbox.drafts_approvals",
    title: "Mailbox drafts and approvals",
    category: "mailbox",
    summary:
      "ME3 can provide a Core mailbox, draft email replies, track mailbox activity, and require approval before sending outbound mail.",
    agentSummary:
      "ME3 can help draft email and manage mailbox state, but outbound sending is approval-first.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    pluginId: "me3.agent-chat",
    defaultEnabled: true,
    approvalMode: "external_action_approval",
    sideEffect: "external_write",
    dataBoundary: "Mailbox messages and provider tokens are private; provider secrets are encrypted and never returned to the browser.",
    appRoutes: ["/email", "/api/mailbox"],
    boundaries: [
      "Drafting is not sending.",
      "Sending email requires owner approval and provider readiness.",
    ],
    tags: ["email", "mailbox", "approvals"],
  },
  {
    id: "contacts.relationships",
    title: "Contacts and relationships",
    category: "contacts",
    summary:
      "ME3 can store contacts, relationship status, outreach status, notes, social handles, follow-up dates, and booking links.",
    agentSummary:
      "ME3 can help maintain owner-scoped contacts and relationship context. Treat updates as private workspace writes.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    pluginId: "me3.agent-chat",
    defaultEnabled: true,
    approvalMode: "owner_approval",
    sideEffect: "internal_write",
    dataBoundary: "Contacts are private owner workspace data unless explicitly published or exported.",
    appRoutes: ["/api/contacts"],
    boundaries: [
      "Do not expose private contact notes in public profile output.",
      "Be careful with outreach status and follow-up claims.",
    ],
    tags: ["contacts", "crm", "outreach"],
  },
  {
    id: "content.social_publishing",
    title: "Social Publishing",
    category: "content",
    summary:
      "ME3 can turn explicit human-authored Sources into grounded Suggestions, reusable social Posts, account-specific Versions, and approval-first Publications when Social Publishing is installed.",
    agentSummary:
      "Create Suggestions only after reading one explicit owner Source, retain visible Source text, and save a Post only when the owner chooses it. LinkedIn Versions can be scheduled and published after exact owner approval; X and Instagram Versions are draft-only for now.",
    surfaces: ["core", "hosted"],
    lifecycle: "setup_required",
    pluginId: "me3.social-publishing",
    requires: ["social.oauth_accounts", "social.publish_queue"],
    approvalMode: "external_action_approval",
    sideEffect: "external_write",
    dataBoundary: "Sources, Suggestions, Posts, Versions, Publications, and delivery history are owner-scoped; a successful Publication sends approved content to its connected social account.",
    appRoutes: [
      "/social",
      "/api/social/suggestions",
      "/api/social/suggestions/:id",
      "/api/social/suggestions/:id/post",
      "/api/social/posts",
      "/api/social/posts/:id",
      "/api/social/versions/:id",
      "/api/social/versions/:id/publications",
      "/api/social/versions/:id/publish",
      "/api/social/publications/:id",
      "/api/social/publications/:id/resolve",
      "/api/social/accounts",
    ],
    agentToolIds: ["social.post.suggest", "social.version.publish"],
    boundaries: [
      "Every saved Suggestion must come from one explicit human-authored Source and show an exact Source excerpt; Quotes remain verbatim unless removal-only trimming is disclosed.",
      "An agent-saved Post requires a stable human-authored Source reference, immutable Source snapshot, and visible Source text; a blank prompt may be discussed but not saved as publishable content.",
      "Approval applies to one exact account Version; editing its copy, media, format, or account removes approval and cancels incompatible future Publications without changing queued or historical snapshots.",
      "Scheduling and reposting create new Publications with independent delivery state, provider results, recovery, and audit history.",
      "Never represent a draft, scheduled Version, queued Publication, or failed Publication as published.",
      "LinkedIn is the only end-to-end schedule and publish platform currently enabled; X, Instagram, and Instagram Business remain draft-only.",
    ],
    tags: ["social", "sources", "suggestions", "posts", "versions", "publications"],
  },
  {
    id: "sites.landing_pages",
    title: "Landing page generation",
    category: "sites",
    summary:
      "ME3 has a first-party landing-page package for draft generation and rendering, but the Core catalog currently marks it as coming soon.",
    agentSummary:
      "Landing pages are a coming-soon package in Core. You can discuss the direction, but do not promise live generation unless the install exposes it.",
    surfaces: ["core", "hosted"],
    lifecycle: "coming_soon",
    pluginId: "me3.landing-pages",
    requires: ["landing_pages.plugin_enabled"],
    approvalMode: "owner_approval",
    sideEffect: "internal_write",
    dataBoundary: "Landing-page drafts are owner-scoped until published.",
    appRoutes: ["/api/agent/landing-pages/generate"],
    agentToolIds: ["landing_pages.generate_draft"],
    boundaries: [
      "Call this coming soon unless runtime/plugin state proves it is enabled.",
      "Generated drafts are not published pages.",
    ],
    tags: ["landing-pages", "sites", "generation"],
  },
  {
    id: "ai.chat_provider",
    title: "AI provider routing",
    category: "providers",
    summary:
      "ME3 can route chat through Workers AI, OpenAI, or Anthropic when the owner configures a provider or binding.",
    agentSummary:
      "Model-backed chat depends on configured provider settings. If missing, tell the owner how to add an AI provider.",
    surfaces: ["core", "hosted"],
    lifecycle: "setup_required",
    requires: ["workers_ai_or_api_key"],
    approvalMode: "none",
    sideEffect: "none",
    dataBoundary: "Provider API keys are private install secrets and should not be exposed.",
    appRoutes: ["/account", "/api/ai-settings"],
    boundaries: [
      "Do not expose provider secrets.",
      "Distinguish configured model routes from fallback shell responses.",
    ],
    tags: ["ai", "providers", "settings"],
  },
  {
    id: "safety.approvals_audit",
    title: "Approvals and audit trail",
    category: "safety",
    summary:
      "ME3 is designed around visible approvals and audit trails for consequential work across plugins and local/hosted surfaces.",
    agentSummary:
      "When a request has side effects, explain the approval path and avoid implying invisible automation.",
    surfaces: ["core", "hosted"],
    lifecycle: "available",
    pluginId: "me3.mission-control",
    defaultEnabled: true,
    approvalMode: "owner_approval",
    sideEffect: "internal_write",
    dataBoundary: "Approvals and audit records are private workspace data.",
    appRoutes: ["/mission-control", "/api/mission-control/approvals"],
    agentToolIds: ["mission.approval.request"],
    boundaries: [
      "Consequential actions should be reviewable.",
      "Approval state should be visible rather than hidden in prompt context.",
    ],
    tags: ["approvals", "audit", "safety"],
  },
];

export function listMe3Capabilities(filters: {
  category?: Me3CapabilityCategory;
  surface?: Exclude<Me3KnowledgeSurface, "shared">;
  includeComingSoon?: boolean;
} = {}): readonly Me3Capability[] {
  return ME3_CAPABILITIES.filter((capability) => {
    if (filters.category && capability.category !== filters.category) return false;
    if (
      filters.surface &&
      !capability.surfaces.includes(filters.surface) &&
      !capability.surfaces.includes("shared")
    ) {
      return false;
    }
    if (!filters.includeComingSoon && capability.lifecycle === "coming_soon") {
      return false;
    }
    return true;
  });
}

export function getMe3KnowledgeSnapshot(
  context: Me3KnowledgeRuntimeContext = {},
  plugins: readonly Me3KnowledgePluginSource[] = [],
): Me3KnowledgeSnapshot {
  return {
    schemaVersion: ME3_KNOWLEDGE_SCHEMA_VERSION,
    facts: ME3_PRODUCT_KNOWLEDGE,
    capabilities: ME3_CAPABILITIES.map((capability) =>
      resolveMe3Capability(capability, context),
    ),
    plugins: plugins.length ? deriveMe3KnowledgeFromPlugins(plugins) : undefined,
  };
}

export function resolveMe3Capability(
  capability: Me3Capability,
  context: Me3KnowledgeRuntimeContext = {},
): Me3ResolvedCapability {
  const runtimeState = resolveRuntimeState(capability, context);
  return {
    ...capability,
    runtimeState,
    runtimeNote: runtimeNoteFor(capability, runtimeState),
    availableInContext:
      runtimeState === "available" || runtimeState === "partial",
  };
}

export function buildMe3CapabilityContext(
  context: Me3KnowledgeRuntimeContext = {},
): string {
  const snapshot = getMe3KnowledgeSnapshot(context);
  const includeComingSoon = context.includeComingSoon === true;
  const maxCapabilities = context.maxAgentCapabilities ?? 8;
  const capabilities = snapshot.capabilities
    .filter((capability) => {
      if (!includeComingSoon && capability.runtimeState === "coming_soon") return false;
      return !["disabled", "not_installed", "unsupported", "unknown"].includes(
        capability.runtimeState,
      );
    })
    .sort(compareAgentPromptCapabilities)
    .slice(0, maxCapabilities);

  const factLines = snapshot.facts
    .filter((fact) => fact.audiences.includes("agent"))
    .map((fact) => `- ${fact.agentSummary}`);

  const capabilityLines = capabilities.map((capability) => {
    const state = runtimeStateLabel(capability.runtimeState);
    return `- ${capability.title} [${state}]: ${capability.agentSummary}`;
  });

  const runtimeLines = [
    context.chatRuntime === "conversation_only"
      ? "- The current chat runtime can explain, reason, and guide. Treat action capabilities as product/app capabilities unless a tool or API result is available in the turn."
      : null,
    "- Distinguish what ME3 can generally do from what this install has configured right now.",
    "- For side effects, describe the approval path and never claim completion without a tool or API result.",
  ].filter((line): line is string => Boolean(line));

  return [
    "ME3 product knowledge:",
    ...factLines,
    "",
    "ME3 capability map:",
    ...capabilityLines,
    "",
    "ME3 runtime guidance:",
    ...runtimeLines,
  ].join("\n");
}

export function buildMe3LlmsText(
  options: Me3LlmsTextOptions = {},
): string {
  const repositoryUrl = options.repositoryUrl || "https://github.com/Soulink-Foundation/me3";
  const snapshot = getMe3KnowledgeSnapshot({
    surface: "core",
    includeComingSoon: true,
    chatRuntime: "conversation_only",
  });

  const productLines = snapshot.facts
    .filter((fact) => fact.audiences.includes("docs"))
    .map((fact) => `- ${fact.title}: ${fact.summary}`);

  const capabilityLines = snapshot.capabilities.map((capability) => {
    const lines = [
      `- ${capability.title} (${capability.id})`,
      `  Category: ${capability.category}`,
      `  Surfaces: ${capability.surfaces.join(", ")}`,
      `  Lifecycle: ${capability.lifecycle}`,
      `  Runtime state in Core: ${capability.runtimeState}`,
      `  Summary: ${capability.summary}`,
      `  Approval mode: ${capability.approvalMode}`,
      `  Side effect: ${capability.sideEffect}`,
      `  Data boundary: ${capability.dataBoundary}`,
    ];

    if (capability.appRoutes?.length) {
      lines.push(`  App/API routes: ${capability.appRoutes.join(", ")}`);
    }
    if (capability.agentToolIds?.length) {
      lines.push(`  Agent tool ids: ${capability.agentToolIds.join(", ")}`);
    }
    if (capability.requires?.length) {
      lines.push(`  Requires: ${capability.requires.join(", ")}`);
    }
    if (capability.boundaries.length) {
      lines.push(`  Boundaries: ${capability.boundaries.join(" ")}`);
    }

    return lines.join("\n");
  });

  const sourceLines = (options.sourceDocuments || []).map(
    (source) => `- [${source.title}](${source.url}): ${source.description}`,
  );

  return [
    "# ME3",
    "",
    "> Installable ME3 personal/business AI assistant scaffold. ME3 is an owner-controlled assistant, identity layer, public site, private workspace, and plugin surface for a person or business.",
    "",
    `Repository: ${repositoryUrl}`,
    `Knowledge schema: ${snapshot.schemaVersion}`,
    "Generated from the typed ME3 knowledge package. This file is public-safe and should not include real secrets, production Cloudflare IDs, hosted subscription billing config, private memory, or customer data.",
    "",
    "## Product Knowledge",
    "",
    ...productLines,
    "",
    "## Core Boundaries",
    "",
    "- Public me.json/profile data is separate from private memory, provider secrets, tasks, approvals, and local context.",
    "- Core owns installable assistant runtime, owner profile, me.json output, setup-required integration states, and optional owner-supplied providers.",
    "- Hosted-only ME3 Cloud routes, production infrastructure, managed provider accounts, and hosted subscription billing stay outside the Core public docs artifact.",
    "- Consequential actions such as sending, publishing, booking, paying, editing local files, or running code require visible owner permission and auditability.",
    "",
    "## Capability Map",
    "",
    ...capabilityLines,
    "",
    "## Source Documents",
    "",
    ...sourceLines,
    "",
  ].join("\n");
}

export function deriveMe3KnowledgeFromPlugins(
  plugins: readonly Me3KnowledgePluginSource[],
): readonly Me3KnowledgePluginDerivedSummary[] {
  return plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    status: typeof plugin.status === "string" ? plugin.status : null,
    enabled: typeof plugin.enabled === "boolean" ? plugin.enabled : null,
    installed: typeof plugin.installed === "boolean" ? plugin.installed : null,
    capabilityIds: [...(plugin.capabilityIds || [])],
    routePaths: [...new Set((plugin.routes || []).map((route) => route.path))],
    agentToolIds: [...new Set((plugin.agentTools || []).map((tool) => tool.id))],
    setupRequirements: plugin.setupRequirements || [],
  }));
}

export function validateMe3KnowledgeAgainstPlugins(
  plugins: readonly Me3KnowledgePluginSource[],
): readonly Me3KnowledgeValidationIssue[] {
  const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const issues: Me3KnowledgeValidationIssue[] = [];

  for (const capability of ME3_CAPABILITIES) {
    if (!capability.pluginId) continue;

    const plugin = pluginById.get(capability.pluginId);
    if (!plugin) {
      issues.push({
        capabilityId: capability.id,
        pluginId: capability.pluginId,
        field: "pluginId",
        message: `Capability references missing plugin ${capability.pluginId}.`,
      });
      continue;
    }

    const pluginToolIds = new Set((plugin.agentTools || []).map((tool) => tool.id));
    for (const toolId of capability.agentToolIds || []) {
      if (!pluginToolIds.has(toolId)) {
        issues.push({
          capabilityId: capability.id,
          pluginId: capability.pluginId,
          field: "agentToolIds",
          message: `Capability references missing agent tool ${toolId}.`,
        });
      }
    }

    // Route facts are derived from plugin manifests for app/API rendering, but
    // several Core routes are still owned outside plugin manifests while the
    // extraction scaffold settles. Validate routes once manifests are complete.
  }

  return issues;
}

function compareAgentPromptCapabilities(
  left: Me3ResolvedCapability,
  right: Me3ResolvedCapability,
): number {
  return (
    runtimeStateRank(left.runtimeState) - runtimeStateRank(right.runtimeState) ||
    categoryRank(left.category) - categoryRank(right.category) ||
    left.title.localeCompare(right.title)
  );
}

function runtimeStateRank(runtimeState: Me3CapabilityRuntimeState): number {
  switch (runtimeState) {
    case "available":
      return 0;
    case "partial":
      return 1;
    case "setup_required":
      return 2;
    case "coming_soon":
      return 3;
    default:
      return 4;
  }
}

function categoryRank(category: Me3CapabilityCategory): number {
  const order: readonly Me3CapabilityCategory[] = [
    "assistant",
    "identity",
    "workspace",
    "calendar",
    "mailbox",
    "contacts",
    "sites",
    "content",
    "providers",
    "safety",
  ];
  const index = order.indexOf(category);
  return index === -1 ? order.length : index;
}

function resolveRuntimeState(
  capability: Me3Capability,
  context: Me3KnowledgeRuntimeContext,
): Me3CapabilityRuntimeState {
  const surface = context.surface || "core";
  if (!capability.surfaces.includes(surface) && !capability.surfaces.includes("shared")) {
    return "unsupported";
  }

  if (capability.lifecycle === "coming_soon") return "coming_soon";

  const configuredFeatureIds = new Set(context.configuredFeatureIds || []);
  const missingFeatureIds = new Set(context.missingFeatureIds || []);
  if (capability.requires?.some((requirement) => missingFeatureIds.has(requirement))) {
    return "setup_required";
  }

  if (
    capability.lifecycle === "setup_required" &&
    capability.requires?.some((requirement) => configuredFeatureIds.has(requirement))
  ) {
    return "available";
  }

  if (capability.pluginId) {
    const disabledPluginIds = new Set(context.disabledPluginIds || []);
    const setupRequiredPluginIds = new Set(context.setupRequiredPluginIds || []);
    const enabledPluginIds = new Set(context.enabledPluginIds || []);
    const installedPluginIds = new Set(context.installedPluginIds || []);

    if (disabledPluginIds.has(capability.pluginId)) return "disabled";
    if (setupRequiredPluginIds.has(capability.pluginId)) return "setup_required";
    if (enabledPluginIds.has(capability.pluginId)) {
      return capability.lifecycle === "partial" ? "partial" : "available";
    }
    if (
      context.installedPluginIds &&
      !installedPluginIds.has(capability.pluginId) &&
      capability.defaultEnabled !== true
    ) {
      return capability.lifecycle === "setup_required" ? "setup_required" : "not_installed";
    }
  }

  if (capability.lifecycle === "partial") return "partial";
  if (capability.lifecycle === "setup_required") return "setup_required";
  return "available";
}

function runtimeNoteFor(
  capability: Me3Capability,
  runtimeState: Me3CapabilityRuntimeState,
): string {
  switch (runtimeState) {
    case "available":
      return "Available in the current context.";
    case "partial":
      return "Partially available; verify setup and tool access before promising action.";
    case "setup_required":
      return "Requires setup, configuration, or plugin enablement before full use.";
    case "disabled":
      return "Disabled in the current install.";
    case "coming_soon":
      return "Planned or cataloged, but not generally available in Core yet.";
    case "not_installed":
      return "Not installed in the current context.";
    case "unsupported":
      return `Not supported on the selected surface for ${capability.title}.`;
    default:
      return "Runtime state is unknown.";
  }
}

function runtimeStateLabel(runtimeState: Me3CapabilityRuntimeState): string {
  switch (runtimeState) {
    case "setup_required":
      return "setup required";
    case "coming_soon":
      return "coming soon";
    case "not_installed":
      return "not installed";
    default:
      return runtimeState.replace(/_/g, " ");
  }
}
