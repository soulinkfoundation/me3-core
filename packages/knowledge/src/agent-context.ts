export const ME3_AGENT_CONTEXT_SCHEMA_VERSION = "2026-05-16.v1";

export type Me3AgentContextPurpose =
  | "chat_reply"
  | "mission_review"
  | "memory_review"
  | "debug";

export type Me3AgentContextSurface = "core" | "hosted" | "shared";

export type Me3AgentContextVisibility = "public" | "private" | "internal";

export type Me3AgentContextSourceKind =
  | "owner_profile"
  | "mission_statement"
  | "wheel_of_life"
  | "public_me_json"
  | "private_memory"
  | "contact"
  | "email_thread"
  | "calendar_event"
  | "task"
  | "project"
  | "assistant_message"
  | "agent_skill"
  | "plugin"
  | "manual"
  | "unknown";

export type Me3AgentContextSourceStatus =
  | "included"
  | "trimmed"
  | "omitted"
  | "failed";

export type Me3AgentContextSource = {
  id: string;
  kind: Me3AgentContextSourceKind;
  label: string;
  visibility: Me3AgentContextVisibility;
  status?: Me3AgentContextSourceStatus;
  reason?: string;
  sourceRef?: string | null;
  updatedAt?: string | null;
};

export type Me3AgentContextBudget = {
  maxPromptChars: number;
  reservedResponseChars?: number;
  strategy: "stable_order_trim_tail";
  usedPromptChars?: number;
  wasTrimmed?: boolean;
  trimReason?: string | null;
};

export type Me3AgentContextOwnerProfile = {
  displayName?: string | null;
  username?: string | null;
  bio?: string | null;
  timezone?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextPublicIdentity = {
  summary?: string | null;
  meJsonUrl?: string | null;
  offers?: readonly string[];
  actions?: readonly string[];
  source: Me3AgentContextSource;
};

export type Me3AgentContextMissionStatement = {
  statement: string;
  source: Me3AgentContextSource;
};

export type Me3AgentContextLifeSnapshotArea = {
  label: string;
  score?: number | null;
  note?: string | null;
};

export type Me3AgentContextLifeSnapshot = {
  id: string;
  createdAt?: string | null;
  summary?: string | null;
  areas: readonly Me3AgentContextLifeSnapshotArea[];
  source: Me3AgentContextSource;
};

export type Me3AgentContextPrivateMemory = {
  id: string;
  kind: string;
  title?: string | null;
  body: string;
  scope?: string | null;
  confidence?: number | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextContact = {
  id: string;
  name: string;
  aliases?: readonly string[];
  email?: string | null;
  relationship?: string | null;
  summary?: string | null;
  lastInteractionAt?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextEmailThread = {
  id: string;
  subject?: string | null;
  participants?: readonly string[];
  contactId?: string | null;
  projectId?: string | null;
  summary: string;
  lastMessageAt?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextProject = {
  id: string;
  name: string;
  aliases?: readonly string[];
  summary?: string | null;
  status?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextTask = {
  id: string;
  title: string;
  status?: string | null;
  dueAt?: string | null;
  projectId?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextCalendarEvent = {
  id: string;
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextRecentMessage = {
  id?: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextSkill = {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  reason?: string | null;
  source: Me3AgentContextSource;
};

export type Me3AgentContextResolverScope = {
  contactId?: string | null;
  emailThreadId?: string | null;
  projectId?: string | null;
  date?: string | null;
};

export type Me3AgentContextResolverOptions = {
  maxPrivateMemory?: number;
  maxContacts?: number;
  maxEmailThreads?: number;
  maxProjects?: number;
  maxTasks?: number;
  maxCalendarEvents?: number;
  maxRecentMessages?: number;
};

export type Me3AgentContextResolverInput = Omit<
  Me3AgentContextPacketInput,
  | "privateMemory"
  | "contacts"
  | "emailThreads"
  | "projects"
  | "tasks"
  | "calendarEvents"
  | "recentMessages"
> & {
  requestText?: string | null;
  activeScope?: Me3AgentContextResolverScope;
  candidatePrivateMemory?: readonly Me3AgentContextPrivateMemory[];
  candidateContacts?: readonly Me3AgentContextContact[];
  candidateEmailThreads?: readonly Me3AgentContextEmailThread[];
  candidateProjects?: readonly Me3AgentContextProject[];
  candidateTasks?: readonly Me3AgentContextTask[];
  candidateCalendarEvents?: readonly Me3AgentContextCalendarEvent[];
  candidateRecentMessages?: readonly Me3AgentContextRecentMessage[];
  resolverOptions?: Me3AgentContextResolverOptions;
};

export type Me3AgentContextPacketInput = {
  id?: string;
  generatedAt?: string;
  ownerId: string;
  purpose: Me3AgentContextPurpose;
  surface?: Me3AgentContextSurface;
  requestSummary?: string | null;
  ownerProfile?: Me3AgentContextOwnerProfile | null;
  missionStatement?: Me3AgentContextMissionStatement | null;
  lifeSnapshot?: Me3AgentContextLifeSnapshot | null;
  publicIdentity?: Me3AgentContextPublicIdentity | null;
  privateMemory?: readonly Me3AgentContextPrivateMemory[];
  contacts?: readonly Me3AgentContextContact[];
  emailThreads?: readonly Me3AgentContextEmailThread[];
  projects?: readonly Me3AgentContextProject[];
  tasks?: readonly Me3AgentContextTask[];
  calendarEvents?: readonly Me3AgentContextCalendarEvent[];
  recentMessages?: readonly Me3AgentContextRecentMessage[];
  skills?: readonly Me3AgentContextSkill[];
  sources?: readonly Me3AgentContextSource[];
  budget?: Partial<Me3AgentContextBudget>;
  warnings?: readonly string[];
};

export type Me3AgentContextPacket = {
  schemaVersion: typeof ME3_AGENT_CONTEXT_SCHEMA_VERSION;
  id: string;
  generatedAt: string;
  ownerId: string;
  purpose: Me3AgentContextPurpose;
  surface: Me3AgentContextSurface;
  requestSummary: string | null;
  ownerProfile: Me3AgentContextOwnerProfile | null;
  missionStatement: Me3AgentContextMissionStatement | null;
  lifeSnapshot: Me3AgentContextLifeSnapshot | null;
  publicIdentity: Me3AgentContextPublicIdentity | null;
  privateMemory: readonly Me3AgentContextPrivateMemory[];
  contacts: readonly Me3AgentContextContact[];
  emailThreads: readonly Me3AgentContextEmailThread[];
  projects: readonly Me3AgentContextProject[];
  tasks: readonly Me3AgentContextTask[];
  calendarEvents: readonly Me3AgentContextCalendarEvent[];
  recentMessages: readonly Me3AgentContextRecentMessage[];
  skills: readonly Me3AgentContextSkill[];
  sources: readonly Me3AgentContextSource[];
  budget: Me3AgentContextBudget;
  warnings: readonly string[];
};

export type Me3AgentContextPrompt = {
  text: string;
  budget: Me3AgentContextBudget;
};

export type Me3AgentContextManifestSource = {
  id: string;
  kind: Me3AgentContextSourceKind;
  label: string;
  visibility: Me3AgentContextVisibility;
  status: NonNullable<Me3AgentContextSource["status"]>;
  reason: string | null;
  sourceRef: string | null;
  updatedAt: string | null;
};

export type Me3AgentContextManifest = {
  packetId: string;
  schemaVersion: typeof ME3_AGENT_CONTEXT_SCHEMA_VERSION;
  generatedAt: string;
  purpose: Me3AgentContextPurpose;
  surface: Me3AgentContextSurface;
  sourceCount: number;
  sources: readonly Me3AgentContextManifestSource[];
  budget: Pick<
    Me3AgentContextBudget,
    "maxPromptChars" | "usedPromptChars" | "wasTrimmed" | "trimReason"
  >;
  warnings: readonly string[];
};

export type Me3AgentContextValidationIssue = {
  path: string;
  message: string;
};

const DEFAULT_CONTEXT_BUDGET: Me3AgentContextBudget = {
  maxPromptChars: 6000,
  reservedResponseChars: 1200,
  strategy: "stable_order_trim_tail",
  usedPromptChars: 0,
  wasTrimmed: false,
  trimReason: null,
};

const DEFAULT_RESOLVER_OPTIONS: Required<Me3AgentContextResolverOptions> = {
  maxPrivateMemory: 6,
  maxContacts: 3,
  maxEmailThreads: 3,
  maxProjects: 3,
  maxTasks: 8,
  maxCalendarEvents: 6,
  maxRecentMessages: 8,
};

const PUBLIC_SOURCE_KINDS = new Set<Me3AgentContextSourceKind>([
  "owner_profile",
  "public_me_json",
]);

export function resolveMe3AgentContextPacket(
  input: Me3AgentContextResolverInput,
): Me3AgentContextPacket {
  const options = normalizeResolverOptions(input.resolverOptions);
  const requestText = input.requestText || input.requestSummary || "";
  const requestTokens = tokenize(requestText);
  const warnings: string[] = [...(input.warnings || [])];

  let contacts = resolveContacts({
    contacts: input.candidateContacts || [],
    activeContactId: input.activeScope?.contactId || null,
    requestText,
    requestTokens,
    maxContacts: options.maxContacts,
    warnings,
  });
  const contactIds = new Set(contacts.map((contact) => contact.id));

  const emailThreads = resolveEmailThreads({
    emailThreads: input.candidateEmailThreads || [],
    activeEmailThreadId: input.activeScope?.emailThreadId || null,
    contactIds,
    projectId: input.activeScope?.projectId || null,
    requestTokens,
    maxEmailThreads: options.maxEmailThreads,
  });
  for (const thread of emailThreads) {
    if (thread.contactId) contactIds.add(thread.contactId);
  }
  contacts = [
    ...contacts,
    ...(input.candidateContacts || [])
      .filter(
        (contact) =>
          contactIds.has(contact.id) &&
          !contacts.some((selected) => selected.id === contact.id),
      )
      .slice(0, Math.max(0, options.maxContacts - contacts.length))
      .map((contact) => withSourceReason(contact, "Linked to selected email thread.")),
  ];

  const projects = resolveProjects({
    projects: input.candidateProjects || [],
    activeProjectId: input.activeScope?.projectId || null,
    emailThreads,
    requestText,
    requestTokens,
    maxProjects: options.maxProjects,
    warnings,
  });
  const projectIds = new Set(projects.map((project) => project.id));
  if (!input.activeScope?.projectId) {
    for (const thread of emailThreads) {
      if (thread.projectId) projectIds.add(thread.projectId);
    }
  }

  const tasks = resolveTasks({
    tasks: input.candidateTasks || [],
    projectIds,
    requestTokens,
    activeDate: input.activeScope?.date || null,
    maxTasks: options.maxTasks,
  });
  const calendarEvents = resolveCalendarEvents({
    events: input.candidateCalendarEvents || [],
    requestTokens,
    activeDate: input.activeScope?.date || null,
    maxCalendarEvents: options.maxCalendarEvents,
  });
  const privateMemory = resolvePrivateMemory({
    memory: input.candidatePrivateMemory || [],
    contactIds,
    projectIds,
    requestTokens,
    maxPrivateMemory: options.maxPrivateMemory,
  });
  const recentMessages = [...(input.candidateRecentMessages || [])]
    .slice(-options.maxRecentMessages)
    .map((message) =>
      withSourceReason(
        message,
        "Recent assistant message retained for immediate conversation context.",
      ),
    );

  return createMe3AgentContextPacket({
    ...input,
    privateMemory,
    contacts,
    emailThreads,
    projects,
    tasks,
    calendarEvents,
    recentMessages,
    warnings,
  });
}

export function createMe3AgentContextPacket(
  input: Me3AgentContextPacketInput,
): Me3AgentContextPacket {
  const packetWithoutSources: Omit<Me3AgentContextPacket, "sources"> = {
    schemaVersion: ME3_AGENT_CONTEXT_SCHEMA_VERSION,
    id: input.id || `agent-context:${input.ownerId}:${input.purpose}`,
    generatedAt: input.generatedAt || new Date().toISOString(),
    ownerId: input.ownerId,
    purpose: input.purpose,
    surface: input.surface || "core",
    requestSummary: input.requestSummary || null,
    ownerProfile: input.ownerProfile
      ? normalizeOwnerProfile(input.ownerProfile)
      : null,
    missionStatement: input.missionStatement
      ? normalizeMissionStatement(input.missionStatement)
      : null,
    lifeSnapshot: input.lifeSnapshot
      ? normalizeLifeSnapshot(input.lifeSnapshot)
      : null,
    publicIdentity: input.publicIdentity
      ? normalizePublicIdentity(input.publicIdentity)
      : null,
    privateMemory: (input.privateMemory || []).map(normalizePrivateMemory),
    contacts: (input.contacts || []).map(normalizeContact),
    emailThreads: (input.emailThreads || []).map(normalizeEmailThread),
    projects: (input.projects || []).map(normalizeProject),
    tasks: (input.tasks || []).map(normalizeTask),
    calendarEvents: (input.calendarEvents || []).map(normalizeCalendarEvent),
    recentMessages: (input.recentMessages || []).map(normalizeRecentMessage),
    skills: (input.skills || []).map(normalizeSkill),
    budget: normalizeBudget(input.budget),
    warnings: [...(input.warnings || [])],
  };

  const providedSources = (input.sources || []).map(normalizeSource);
  const derivedSources = collectMe3AgentContextSources(packetWithoutSources);

  return {
    ...packetWithoutSources,
    sources: mergeSources([...providedSources, ...derivedSources]),
  };
}

export function buildMe3AgentContextPrompt(
  packet: Me3AgentContextPacket,
): Me3AgentContextPrompt {
  const lines = [
    "ME3 agent context packet:",
    `Schema: ${packet.schemaVersion}`,
    `Purpose: ${packet.purpose}`,
    `Owner: ${packet.ownerId}`,
    packet.requestSummary ? `Request: ${packet.requestSummary}` : null,
    "",
    formatOwnerProfile(packet.ownerProfile),
    formatMissionStatement(packet.missionStatement),
    formatLifeSnapshot(packet.lifeSnapshot),
    formatPublicIdentity(packet.publicIdentity),
    formatList(
      "Private memory",
      packet.privateMemory,
      (item) => `- ${labelWithOptionalTitle(item.kind, item.title)}: ${item.body}`,
    ),
    formatList(
      "Contacts",
      packet.contacts,
      (contact) =>
        `- ${contact.name}${contact.relationship ? ` (${contact.relationship})` : ""}: ${
          contact.summary || "No summary."
        }`,
    ),
    formatList(
      "Email threads",
      packet.emailThreads,
      (thread) =>
        `- ${thread.subject || thread.id}: ${thread.summary}${
          thread.participants?.length
            ? ` Participants: ${thread.participants.join(", ")}.`
            : ""
        }`,
    ),
    formatList(
      "Projects",
      packet.projects,
      (project) =>
        `- ${project.name}${project.status ? ` [${project.status}]` : ""}: ${
          project.summary || "No summary."
        }`,
    ),
    formatList(
      "Tasks",
      packet.tasks,
      (task) =>
        `- ${task.title}${task.status ? ` [${task.status}]` : ""}${
          task.dueAt ? ` due ${task.dueAt}` : ""
        }`,
    ),
    formatList(
      "Calendar",
      packet.calendarEvents,
      (event) =>
        `- ${event.title}${event.startsAt ? ` starts ${event.startsAt}` : ""}${
          event.timezone ? ` ${event.timezone}` : ""
        }`,
    ),
    formatList(
      "Recent assistant messages",
      packet.recentMessages,
      (message) => `- ${message.role}: ${message.content}`,
    ),
    formatList(
      "Agent skills",
      packet.skills,
      (skill) =>
        `- ${skill.name}: ${skill.description || "No description."}${
          skill.reason ? ` Match: ${skill.reason}` : ""
        }${skill.instructions ? `\n  Instructions: ${skill.instructions}` : ""}`,
    ),
    formatList(
      "Context sources",
      packet.sources,
      (source) =>
        `- ${source.kind}:${source.id} [${source.visibility}, ${
          source.status || "included"
        }] ${source.label}${source.reason ? ` - ${source.reason}` : ""}`,
    ),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const maxPromptChars = Math.max(120, packet.budget.maxPromptChars);
  if (lines.length <= maxPromptChars) {
    return {
      text: lines,
      budget: {
        ...packet.budget,
        usedPromptChars: lines.length,
        wasTrimmed: false,
        trimReason: null,
      },
    };
  }

  const suffix = "\n[Context trimmed to prompt budget]";
  const text = `${lines.slice(0, maxPromptChars - suffix.length)}${suffix}`;
  return {
    text,
    budget: {
      ...packet.budget,
      usedPromptChars: text.length,
      wasTrimmed: true,
      trimReason: "maxPromptChars",
    },
  };
}

export function createMe3AgentContextManifest(
  packet: Me3AgentContextPacket,
  budget: Me3AgentContextBudget = packet.budget,
): Me3AgentContextManifest {
  return {
    packetId: packet.id,
    schemaVersion: packet.schemaVersion,
    generatedAt: packet.generatedAt,
    purpose: packet.purpose,
    surface: packet.surface,
    sourceCount: packet.sources.length,
    sources: packet.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label,
      visibility: source.visibility,
      status: source.status || "included",
      reason: source.reason ?? null,
      sourceRef: source.sourceRef ?? null,
      updatedAt: source.updatedAt ?? null,
    })),
    budget: {
      maxPromptChars: budget.maxPromptChars,
      usedPromptChars: budget.usedPromptChars,
      wasTrimmed: budget.wasTrimmed,
      trimReason: budget.trimReason ?? null,
    },
    warnings: [...packet.warnings],
  };
}

export function summarizeMe3AgentContextManifest(
  manifest: Me3AgentContextManifest,
): string {
  const included = manifest.sources.filter((source) => source.status === "included");
  const failedCount = manifest.sources.filter((source) => source.status === "failed").length;
  const trimmedCount = manifest.sources.filter((source) => source.status === "trimmed").length;
  const groups = groupManifestSources(included);
  const groupSummary = groups.length
    ? groups.join(", ")
    : "no matched sources";
  const suffixes = [
    failedCount ? `${failedCount} failed` : null,
    trimmedCount ? `${trimmedCount} source${trimmedCount === 1 ? "" : "s"} trimmed` : null,
    manifest.budget.wasTrimmed ? "prompt trimmed" : null,
    manifest.warnings.length ? `${manifest.warnings.length} warning${manifest.warnings.length === 1 ? "" : "s"}` : null,
  ].filter((item): item is string => Boolean(item));

  return suffixes.length
    ? `Used context from: ${groupSummary}. ${suffixes.join("; ")}.`
    : `Used context from: ${groupSummary}.`;
}

export function validateMe3AgentContextPacket(
  packet: Me3AgentContextPacket,
): readonly Me3AgentContextValidationIssue[] {
  const issues: Me3AgentContextValidationIssue[] = [];

  for (const source of packet.sources) {
    if (!PUBLIC_SOURCE_KINDS.has(source.kind) && source.visibility === "public") {
      issues.push({
        path: `sources.${source.id}.visibility`,
        message: `${source.kind} context cannot be marked public.`,
      });
    }
  }

  if (packet.publicIdentity && packet.publicIdentity.source.visibility !== "public") {
    issues.push({
      path: "publicIdentity.source.visibility",
      message: "Public identity context must come from a public source.",
    });
  }

  for (const [index, memory] of packet.privateMemory.entries()) {
    if (memory.source.visibility === "public") {
      issues.push({
        path: `privateMemory.${index}.source.visibility`,
        message: "Private memory cannot be marked public.",
      });
    }
  }

  return issues;
}

function normalizeBudget(
  budget: Partial<Me3AgentContextBudget> | undefined,
): Me3AgentContextBudget {
  return {
    ...DEFAULT_CONTEXT_BUDGET,
    ...budget,
    strategy: "stable_order_trim_tail",
    maxPromptChars: Math.max(120, budget?.maxPromptChars ?? DEFAULT_CONTEXT_BUDGET.maxPromptChars),
    trimReason: budget?.trimReason ?? null,
  };
}

function normalizeResolverOptions(
  options: Me3AgentContextResolverOptions | undefined,
): Required<Me3AgentContextResolverOptions> {
  return {
    maxPrivateMemory: positiveLimit(options?.maxPrivateMemory, DEFAULT_RESOLVER_OPTIONS.maxPrivateMemory),
    maxContacts: positiveLimit(options?.maxContacts, DEFAULT_RESOLVER_OPTIONS.maxContacts),
    maxEmailThreads: positiveLimit(options?.maxEmailThreads, DEFAULT_RESOLVER_OPTIONS.maxEmailThreads),
    maxProjects: positiveLimit(options?.maxProjects, DEFAULT_RESOLVER_OPTIONS.maxProjects),
    maxTasks: positiveLimit(options?.maxTasks, DEFAULT_RESOLVER_OPTIONS.maxTasks),
    maxCalendarEvents: positiveLimit(options?.maxCalendarEvents, DEFAULT_RESOLVER_OPTIONS.maxCalendarEvents),
    maxRecentMessages: positiveLimit(options?.maxRecentMessages, DEFAULT_RESOLVER_OPTIONS.maxRecentMessages),
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

function normalizeOwnerProfile(
  profile: Me3AgentContextOwnerProfile,
): Me3AgentContextOwnerProfile {
  return {
    ...profile,
    source: normalizeSource(profile.source),
  };
}

function normalizePublicIdentity(
  identity: Me3AgentContextPublicIdentity,
): Me3AgentContextPublicIdentity {
  return {
    ...identity,
    offers: identity.offers ? [...identity.offers] : undefined,
    actions: identity.actions ? [...identity.actions] : undefined,
    source: {
      ...normalizeSource(identity.source),
      visibility: "public",
    },
  };
}

function normalizeMissionStatement(
  missionStatement: Me3AgentContextMissionStatement,
): Me3AgentContextMissionStatement {
  return {
    ...missionStatement,
    statement: missionStatement.statement.trim(),
    source: normalizeSource(missionStatement.source),
  };
}

function normalizeLifeSnapshot(
  snapshot: Me3AgentContextLifeSnapshot,
): Me3AgentContextLifeSnapshot {
  return {
    ...snapshot,
    areas: snapshot.areas.map((area) => ({ ...area })),
    source: normalizeSource(snapshot.source),
  };
}

function normalizePrivateMemory(
  memory: Me3AgentContextPrivateMemory,
): Me3AgentContextPrivateMemory {
  return {
    ...memory,
    source: normalizeSource(memory.source),
  };
}

function normalizeContact(contact: Me3AgentContextContact): Me3AgentContextContact {
  return {
    ...contact,
    source: normalizeSource(contact.source),
  };
}

function normalizeEmailThread(
  thread: Me3AgentContextEmailThread,
): Me3AgentContextEmailThread {
  return {
    ...thread,
    participants: thread.participants ? [...thread.participants] : undefined,
    source: normalizeSource(thread.source),
  };
}

function normalizeProject(project: Me3AgentContextProject): Me3AgentContextProject {
  return {
    ...project,
    source: normalizeSource(project.source),
  };
}

function normalizeTask(task: Me3AgentContextTask): Me3AgentContextTask {
  return {
    ...task,
    source: normalizeSource(task.source),
  };
}

function normalizeCalendarEvent(
  event: Me3AgentContextCalendarEvent,
): Me3AgentContextCalendarEvent {
  return {
    ...event,
    source: normalizeSource(event.source),
  };
}

function normalizeRecentMessage(
  message: Me3AgentContextRecentMessage,
): Me3AgentContextRecentMessage {
  return {
    ...message,
    source: normalizeSource(message.source),
  };
}

function normalizeSkill(skill: Me3AgentContextSkill): Me3AgentContextSkill {
  return {
    ...skill,
    source: normalizeSource(skill.source),
  };
}

function normalizeSource(source: Me3AgentContextSource): Me3AgentContextSource {
  return {
    ...source,
    visibility: normalizeSourceVisibility(source.kind, source.visibility),
    status: source.status || "included",
    sourceRef: source.sourceRef ?? null,
  };
}

function normalizeSourceVisibility(
  kind: Me3AgentContextSourceKind,
  visibility: Me3AgentContextVisibility,
): Me3AgentContextVisibility {
  if (visibility === "public" && !PUBLIC_SOURCE_KINDS.has(kind)) {
    return "private";
  }
  return visibility;
}

type ScoredContextItem<T> = {
  item: T;
  score: number;
  reason: string;
};

function resolveContacts(input: {
  contacts: readonly Me3AgentContextContact[];
  activeContactId: string | null;
  requestText: string;
  requestTokens: ReadonlySet<string>;
  maxContacts: number;
  warnings: string[];
}): readonly Me3AgentContextContact[] {
  if (!input.contacts.length) return [];
  const requestText = normalizeText(input.requestText);
  const isContactDirectoryRequest = hasContactDirectoryIntent(input.requestTokens);
  const scored = input.contacts
    .map((contact): ScoredContextItem<Me3AgentContextContact> | null => {
      if (input.activeContactId && contact.id === input.activeContactId) {
        return { item: contact, score: 100, reason: "Active contact scope." };
      }
      if (isContactDirectoryRequest) {
        return {
          item: contact,
          score: 70,
          reason: "Contact directory requested by the owner.",
        };
      }
      const labels = contactLabels(contact);
      if (labels.some((label) => phraseMatches(requestText, label, 2))) {
        return { item: contact, score: 80, reason: "Contact name matched the request." };
      }
      if (contact.email && phraseMatches(requestText, contact.email, 1)) {
        return { item: contact, score: 75, reason: "Contact email matched the request." };
      }
      if (labels.some((label) => tokenOverlap(label, input.requestTokens) > 0)) {
        return { item: contact, score: 45, reason: "Contact token matched the request." };
      }
      return null;
    })
    .filter((item): item is ScoredContextItem<Me3AgentContextContact> => Boolean(item));

  const topScore = Math.max(0, ...scored.map((item) => item.score));
  const topMatches = scored.filter((item) => item.score === topScore);
  if (
    !input.activeContactId &&
    !isContactDirectoryRequest &&
    topScore < 80 &&
    topMatches.length > 1
  ) {
    input.warnings.push(
      `Ambiguous contact match for "${input.requestText.trim()}"; no contact context was selected.`,
    );
    return [];
  }

  return scored
    .sort(compareScoredItems)
    .slice(0, input.maxContacts)
    .map(({ item, reason }) => withSourceReason(item, reason));
}

function resolveEmailThreads(input: {
  emailThreads: readonly Me3AgentContextEmailThread[];
  activeEmailThreadId: string | null;
  contactIds: ReadonlySet<string>;
  projectId: string | null;
  requestTokens: ReadonlySet<string>;
  maxEmailThreads: number;
}): readonly Me3AgentContextEmailThread[] {
  return input.emailThreads
    .map((thread): ScoredContextItem<Me3AgentContextEmailThread> | null => {
      if (input.activeEmailThreadId && thread.id === input.activeEmailThreadId) {
        return { item: thread, score: 100, reason: "Active email thread scope." };
      }
      if (thread.contactId && input.contactIds.has(thread.contactId)) {
        return { item: thread, score: 70, reason: "Linked to selected contact." };
      }
      if (thread.projectId && thread.projectId === input.projectId) {
        return { item: thread, score: 65, reason: "Linked to active project." };
      }
      const searchable = [thread.subject, thread.summary, ...(thread.participants || [])]
        .filter((value): value is string => Boolean(value))
        .join(" ");
      const overlap = tokenOverlap(searchable, input.requestTokens);
      if (overlap > 0) {
        return { item: thread, score: 40 + overlap, reason: "Email thread matched the request." };
      }
      return null;
    })
    .filter((item): item is ScoredContextItem<Me3AgentContextEmailThread> => Boolean(item))
    .sort(compareScoredItems)
    .slice(0, input.maxEmailThreads)
    .map(({ item, reason }) => withSourceReason(item, reason));
}

function resolveProjects(input: {
  projects: readonly Me3AgentContextProject[];
  activeProjectId: string | null;
  emailThreads: readonly Me3AgentContextEmailThread[];
  requestText: string;
  requestTokens: ReadonlySet<string>;
  maxProjects: number;
  warnings: string[];
}): readonly Me3AgentContextProject[] {
  if (input.activeProjectId) {
    return input.projects
      .filter((project) => project.id === input.activeProjectId)
      .slice(0, input.maxProjects)
      .map((project) => withSourceReason(project, "Active project scope."));
  }
  const requestText = normalizeText(input.requestText);
  const emailProjectIds = new Set(
    input.emailThreads
      .map((thread) => thread.projectId)
      .filter((projectId): projectId is string => Boolean(projectId)),
  );
  const scored = input.projects
    .map((project): ScoredContextItem<Me3AgentContextProject> | null => {
      if (input.activeProjectId && project.id === input.activeProjectId) {
        return { item: project, score: 100, reason: "Active project scope." };
      }
      if (emailProjectIds.has(project.id)) {
        return { item: project, score: 75, reason: "Linked to selected email thread." };
      }
      const labels = projectLabels(project);
      if (labels.some((label) => phraseMatches(requestText, label, 2))) {
        return { item: project, score: 80, reason: "Project name matched the request." };
      }
      if (labels.some((label) => tokenOverlap(label, input.requestTokens) > 0)) {
        return { item: project, score: 45, reason: "Project token matched the request." };
      }
      return null;
    })
    .filter((item): item is ScoredContextItem<Me3AgentContextProject> => Boolean(item));

  const topScore = Math.max(0, ...scored.map((item) => item.score));
  const topMatches = scored.filter((item) => item.score === topScore);
  if (!input.activeProjectId && topScore < 80 && topMatches.length > 1) {
    input.warnings.push(
      `Ambiguous project match for "${input.requestText.trim()}"; no project context was selected.`,
    );
    return [];
  }

  return scored
    .sort(compareScoredItems)
    .slice(0, input.maxProjects)
    .map(({ item, reason }) => withSourceReason(item, reason));
}

function resolveTasks(input: {
  tasks: readonly Me3AgentContextTask[];
  projectIds: ReadonlySet<string>;
  requestTokens: ReadonlySet<string>;
  activeDate: string | null;
  maxTasks: number;
}): readonly Me3AgentContextTask[] {
  return input.tasks
    .map((task): ScoredContextItem<Me3AgentContextTask> | null => {
      const projectMatch = task.projectId && input.projectIds.has(task.projectId);
      const dateMatch = Boolean(input.activeDate && task.dueAt?.startsWith(input.activeDate));
      const overlap = tokenOverlap(task.title, input.requestTokens);
      const score = (projectMatch ? 70 : 0) + (dateMatch ? 45 : 0) + overlap * 5;
      if (score <= 0) return null;
      return {
        item: task,
        score,
        reason: projectMatch
          ? "Linked to selected project."
          : dateMatch
            ? "Due in active date scope."
            : "Task title matched the request.",
      };
    })
    .filter((item): item is ScoredContextItem<Me3AgentContextTask> => Boolean(item))
    .sort(compareScoredItems)
    .slice(0, input.maxTasks)
    .map(({ item, reason }) => withSourceReason(item, reason));
}

function resolveCalendarEvents(input: {
  events: readonly Me3AgentContextCalendarEvent[];
  requestTokens: ReadonlySet<string>;
  activeDate: string | null;
  maxCalendarEvents: number;
}): readonly Me3AgentContextCalendarEvent[] {
  return input.events
    .map((event): ScoredContextItem<Me3AgentContextCalendarEvent> | null => {
      const dateMatch = Boolean(input.activeDate && event.startsAt?.startsWith(input.activeDate));
      const overlap = tokenOverlap(event.title, input.requestTokens);
      const score = (dateMatch ? 70 : 0) + overlap * 5;
      if (score <= 0) return null;
      return {
        item: event,
        score,
        reason: dateMatch ? "In active date scope." : "Calendar event matched the request.",
      };
    })
    .filter((item): item is ScoredContextItem<Me3AgentContextCalendarEvent> => Boolean(item))
    .sort(compareScoredItems)
    .slice(0, input.maxCalendarEvents)
    .map(({ item, reason }) => withSourceReason(item, reason));
}

function resolvePrivateMemory(input: {
  memory: readonly Me3AgentContextPrivateMemory[];
  contactIds: ReadonlySet<string>;
  projectIds: ReadonlySet<string>;
  requestTokens: ReadonlySet<string>;
  maxPrivateMemory: number;
}): readonly Me3AgentContextPrivateMemory[] {
  return input.memory
    .map((memory): ScoredContextItem<Me3AgentContextPrivateMemory> | null => {
      const scope = memory.scope || "";
      const scopedToContact = matchesScopedId(scope, "contact", input.contactIds);
      const scopedToProject = matchesScopedId(scope, "project", input.projectIds);
      const searchable = [memory.kind, memory.title, memory.body]
        .filter((value): value is string => Boolean(value))
        .join(" ");
      const overlap = tokenOverlap(searchable, input.requestTokens);
      const score = (scopedToContact || scopedToProject ? 80 : 0) + overlap * 5;
      if (score <= 0) return null;
      return {
        item: memory,
        score,
        reason: scopedToContact
          ? "Scoped to selected contact."
          : scopedToProject
            ? "Scoped to selected project."
            : "Memory matched the request.",
      };
    })
    .filter((item): item is ScoredContextItem<Me3AgentContextPrivateMemory> => Boolean(item))
    .sort(compareScoredItems)
    .slice(0, input.maxPrivateMemory)
    .map(({ item, reason }) => withSourceReason(item, reason));
}

function withSourceReason<T extends { source: Me3AgentContextSource }>(
  item: T,
  reason: string,
): T {
  return {
    ...item,
    source: {
      ...item.source,
      reason: item.source.reason || reason,
      status: item.source.status || "included",
    },
  };
}

function compareScoredItems<T>(
  left: ScoredContextItem<T>,
  right: ScoredContextItem<T>,
): number {
  return right.score - left.score || stableItemLabel(left.item).localeCompare(stableItemLabel(right.item));
}

function contactLabels(contact: Me3AgentContextContact): readonly string[] {
  return [contact.name, ...(contact.aliases || [])].filter(Boolean);
}

function projectLabels(project: Me3AgentContextProject): readonly string[] {
  return [project.name, ...(project.aliases || []), project.summary].filter(
    (label): label is string => Boolean(label),
  );
}

function hasContactDirectoryIntent(requestTokens: ReadonlySet<string>): boolean {
  if (!requestTokens.has("contacts")) return false;
  return [
    "access",
    "all",
    "available",
    "directory",
    "have",
    "know",
    "list",
    "manage",
    "mine",
    "my",
    "show",
    "view",
  ].some((token) => requestTokens.has(token));
}

function phraseMatches(
  normalizedHaystack: string,
  value: string,
  minTokens: number,
): boolean {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return false;
  if (tokenize(normalizedValue).size < minTokens) return false;
  return normalizedHaystack.includes(normalizedValue);
}

function tokenOverlap(value: string, requestTokens: ReadonlySet<string>): number {
  let count = 0;
  for (const token of tokenize(value)) {
    if (requestTokens.has(token)) count += 1;
  }
  return count;
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesScopedId(
  scope: string,
  kind: "contact" | "project",
  ids: ReadonlySet<string>,
): boolean {
  if (!scope || ids.size === 0) return false;
  const normalizedScope = normalizeText(scope).replace(/\s/g, "");
  for (const id of ids) {
    const normalizedId = normalizeText(id).replace(/\s/g, "");
    if (
      normalizedScope === normalizedId ||
      normalizedScope === `${kind}:${normalizedId}` ||
      normalizedScope === `${kind}-${normalizedId}`
    ) {
      return true;
    }
  }
  return false;
}

function stableItemLabel(item: unknown): string {
  if (isRecord(item)) {
    for (const key of ["id", "name", "title", "subject"]) {
      const value = item[key];
      if (typeof value === "string") return value;
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function collectMe3AgentContextSources(
  packet: Omit<Me3AgentContextPacket, "sources">,
): readonly Me3AgentContextSource[] {
  return [
    packet.ownerProfile?.source,
    packet.missionStatement?.source,
    packet.lifeSnapshot?.source,
    packet.publicIdentity?.source,
    ...packet.privateMemory.map((item) => item.source),
    ...packet.contacts.map((item) => item.source),
    ...packet.emailThreads.map((item) => item.source),
    ...packet.projects.map((item) => item.source),
    ...packet.tasks.map((item) => item.source),
    ...packet.calendarEvents.map((item) => item.source),
    ...packet.recentMessages.map((item) => item.source),
    ...packet.skills.map((item) => item.source),
  ].filter((source): source is Me3AgentContextSource => Boolean(source));
}

function mergeSources(
  sources: readonly Me3AgentContextSource[],
): readonly Me3AgentContextSource[] {
  const byKey = new Map<string, Me3AgentContextSource>();
  for (const source of sources) {
    byKey.set(`${source.kind}:${source.id}`, source);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
  );
}

function groupManifestSources(
  sources: readonly Me3AgentContextManifestSource[],
): readonly string[] {
  const counts = new Map<Me3AgentContextSourceKind, number>();
  for (const source of sources) {
    counts.set(source.kind, (counts.get(source.kind) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => sourceKindDisplayOrder(left) - sourceKindDisplayOrder(right))
    .map(([kind, count]) => formatManifestSourceGroup(kind, count));
}

function sourceKindDisplayOrder(kind: Me3AgentContextSourceKind): number {
  const order: Me3AgentContextSourceKind[] = [
    "owner_profile",
    "mission_statement",
    "wheel_of_life",
    "public_me_json",
    "private_memory",
    "contact",
    "email_thread",
    "project",
    "task",
    "calendar_event",
    "assistant_message",
    "agent_skill",
    "plugin",
    "manual",
    "unknown",
  ];
  const index = order.indexOf(kind);
  return index === -1 ? order.length : index;
}

function formatManifestSourceGroup(kind: Me3AgentContextSourceKind, count: number): string {
  const label = manifestSourceKindLabel(kind, count);
  return count === 1 ? `1 ${label}` : `${count} ${label}`;
}

function manifestSourceKindLabel(kind: Me3AgentContextSourceKind, count: number): string {
  const plural = count !== 1;
  switch (kind) {
    case "owner_profile":
      return plural ? "owner profiles" : "owner profile";
    case "mission_statement":
      return plural ? "mission statements" : "mission statement";
    case "wheel_of_life":
      return plural ? "Wheel of Life snapshots" : "Wheel of Life snapshot";
    case "public_me_json":
      return "public me.json";
    case "private_memory":
      return plural ? "private memories" : "private memory";
    case "contact":
      return plural ? "contacts" : "contact";
    case "email_thread":
      return plural ? "email threads" : "email thread";
    case "calendar_event":
      return plural ? "calendar events" : "calendar event";
    case "task":
      return plural ? "tasks" : "task";
    case "project":
      return plural ? "projects" : "project";
    case "assistant_message":
      return plural ? "recent messages" : "recent message";
    case "agent_skill":
      return plural ? "agent skills" : "agent skill";
    case "plugin":
      return plural ? "plugins" : "plugin";
    case "manual":
      return plural ? "manual sources" : "manual source";
    case "unknown":
      return plural ? "unknown sources" : "unknown source";
  }
}

function formatOwnerProfile(
  profile: Me3AgentContextOwnerProfile | null,
): string | null {
  if (!profile) return null;
  return [
    "Owner profile:",
    profile.displayName ? `- Name: ${profile.displayName}` : null,
    profile.username ? `- Username: ${profile.username}` : null,
    profile.bio ? `- Bio: ${profile.bio}` : null,
    profile.timezone ? `- Timezone: ${profile.timezone}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatPublicIdentity(
  identity: Me3AgentContextPublicIdentity | null,
): string | null {
  if (!identity) return null;
  return [
    "Public identity:",
    identity.summary ? `- Summary: ${identity.summary}` : null,
    identity.meJsonUrl ? `- me.json: ${identity.meJsonUrl}` : null,
    identity.offers?.length ? `- Offers: ${identity.offers.join(", ")}` : null,
    identity.actions?.length ? `- Actions: ${identity.actions.join(", ")}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatMissionStatement(
  missionStatement: Me3AgentContextMissionStatement | null,
): string | null {
  if (!missionStatement?.statement) return null;
  return ["Mission statement:", `- ${missionStatement.statement}`].join("\n");
}

function formatLifeSnapshot(
  snapshot: Me3AgentContextLifeSnapshot | null,
): string | null {
  if (!snapshot) return null;
  const lines = [
    "Wheel of Life snapshot:",
    snapshot.summary ? `- Summary: ${snapshot.summary}` : null,
    snapshot.createdAt ? `- Saved: ${snapshot.createdAt}` : null,
    ...snapshot.areas.map((area) => {
      const score =
        typeof area.score === "number" && Number.isFinite(area.score)
          ? `${area.score}/10`
          : "not scored";
      return `- ${area.label}: ${score}${area.note ? `. ${area.note}` : ""}`;
    }),
  ].filter((line): line is string => Boolean(line));
  return lines.length > 1 ? lines.join("\n") : null;
}

function formatList<T>(
  title: string,
  items: readonly T[],
  format: (item: T) => string,
): string | null {
  if (!items.length) return null;
  return [title, ...items.map(format)].join("\n");
}

function labelWithOptionalTitle(kind: string, title?: string | null): string {
  return title ? `${kind} / ${title}` : kind;
}
