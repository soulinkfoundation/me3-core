import { describe, expect, it } from "vitest";
import {
  buildMe3AgentContextPrompt,
  createMe3AgentContextManifest,
  createMe3AgentContextPacket,
  resolveMe3AgentContextPacket,
  summarizeMe3AgentContextManifest,
  validateMe3AgentContextPacket,
  type Me3AgentContextContact,
  type Me3AgentContextEmailThread,
  type Me3AgentContextPrivateMemory,
  type Me3AgentContextProject,
  type Me3AgentContextSource,
  type Me3AgentContextTask,
} from "./agent-context";

const ownerSource: Me3AgentContextSource = {
  id: "owner",
  kind: "owner_profile",
  label: "Owner profile",
  visibility: "public",
  reason: "Always include a small owner profile.",
};

const meJsonSource: Me3AgentContextSource = {
  id: "owner-me-json",
  kind: "public_me_json",
  label: "Public me.json",
  visibility: "public",
  reason: "Public identity context for agents.",
};

const missionStatementSource: Me3AgentContextSource = {
  id: "mission-statement",
  kind: "mission_statement",
  label: "Mission statement",
  visibility: "private",
  reason: "Primary owner intent for agent replies.",
};

const lifeSnapshotSource: Me3AgentContextSource = {
  id: "wheel-snapshot-1",
  kind: "wheel_of_life",
  label: "Wheel of Life snapshot",
  visibility: "private",
  reason: "Current life snapshot for balancing advice.",
};

describe("ME3 agent context contract", () => {
  it("serializes a stable source-labeled context packet", () => {
    const packet = createMe3AgentContextPacket({
      id: "packet-1",
      generatedAt: "2026-05-16T10:00:00.000Z",
      ownerId: "owner",
      purpose: "chat_reply",
      requestSummary: "Help reply to Ada.",
      ownerProfile: {
        displayName: "Kieran",
        username: "kieran",
        bio: "Builds ME3.",
        timezone: "Europe/Dublin",
        source: ownerSource,
      },
      publicIdentity: {
        summary: "Kieran helps people build useful agentic products.",
        meJsonUrl: "https://example.com/.well-known/me.json",
        offers: ["Product strategy"],
        actions: ["book"],
        source: meJsonSource,
      },
      missionStatement: {
        statement: "Help thoughtful builders make useful agentic products.",
        source: missionStatementSource,
      },
      lifeSnapshot: {
        id: "wheel-snapshot-1",
        createdAt: "2026-05-16T09:00:00.000Z",
        summary: "Work is strong; health needs attention.",
        areas: [
          { label: "Work", score: 8, note: "Shipping consistently." },
          { label: "Health", score: 5, note: "Needs more recovery." },
        ],
        source: lifeSnapshotSource,
      },
      privateMemory: [
        {
          id: "memory-1",
          kind: "preference",
          title: "Email tone",
          body: "Prefers short, warm, practical replies.",
          source: {
            id: "memory-1",
            kind: "private_memory",
            label: "Email tone",
            visibility: "private",
            reason: "Relevant to drafting a reply.",
          },
        },
      ],
      contacts: [
        {
          id: "contact-ada",
          name: "Ada Lovelace",
          relationship: "client",
          summary: "Working on an analytics workflow.",
          source: {
            id: "contact-ada",
            kind: "contact",
            label: "Ada Lovelace",
            visibility: "private",
            reason: "Mentioned by name.",
          },
        },
      ],
      emailThreads: [
        {
          id: "thread-1",
          subject: "Workflow notes",
          participants: ["Ada", "Kieran"],
          summary: "Ada asked for a concise update by Friday.",
          source: {
            id: "thread-1",
            kind: "email_thread",
            label: "Workflow notes",
            visibility: "private",
            reason: "Active reply context.",
          },
        },
      ],
      projects: [
        {
          id: "project-1",
          name: "Analytics Workflow",
          status: "active",
          summary: "Ship a first usable review flow.",
          source: {
            id: "project-1",
            kind: "project",
            label: "Analytics Workflow",
            visibility: "private",
            reason: "Linked to Ada.",
          },
        },
      ],
      tasks: [
        {
          id: "task-1",
          title: "Send Friday update",
          status: "open",
          dueAt: "2026-05-22",
          projectId: "project-1",
          source: {
            id: "task-1",
            kind: "task",
            label: "Send Friday update",
            visibility: "private",
            reason: "Open task for this contact.",
          },
        },
      ],
      calendarEvents: [
        {
          id: "event-1",
          title: "Ada check-in",
          startsAt: "2026-05-18T14:00:00Z",
          timezone: "Europe/Dublin",
          source: {
            id: "event-1",
            kind: "calendar_event",
            label: "Ada check-in",
            visibility: "private",
            reason: "Upcoming related meeting.",
          },
        },
      ],
      recentMessages: [
        {
          id: "message-1",
          role: "user",
          content: "Help me answer Ada.",
          source: {
            id: "message-1",
            kind: "assistant_message",
            label: "Recent chat",
            visibility: "private",
            reason: "Immediate conversation context.",
          },
        },
      ],
      budget: { maxPromptChars: 4000 },
    });

    const prompt = buildMe3AgentContextPrompt(packet);

    expect(prompt.budget.wasTrimmed).toBe(false);
    expect(prompt.text).toMatchInlineSnapshot(`
      "ME3 agent context packet:
      Schema: 2026-05-16.v1
      Purpose: chat_reply
      Owner: owner
      Request: Help reply to Ada.

      Owner profile:
      - Name: Kieran
      - Username: kieran
      - Bio: Builds ME3.
      - Timezone: Europe/Dublin
      Mission statement:
      - Help thoughtful builders make useful agentic products.
      Wheel of Life snapshot:
      - Summary: Work is strong; health needs attention.
      - Saved: 2026-05-16T09:00:00.000Z
      - Work: 8/10. Shipping consistently.
      - Health: 5/10. Needs more recovery.
      Public identity:
      - Summary: Kieran helps people build useful agentic products.
      - me.json: https://example.com/.well-known/me.json
      - Offers: Product strategy
      - Actions: book
      Private memory
      - preference / Email tone: Prefers short, warm, practical replies.
      Contacts
      - Ada Lovelace (client): Working on an analytics workflow.
      Email threads
      - Workflow notes: Ada asked for a concise update by Friday. Participants: Ada, Kieran.
      Projects
      - Analytics Workflow [active]: Ship a first usable review flow.
      Tasks
      - Send Friday update [open] due 2026-05-22
      Calendar
      - Ada check-in starts 2026-05-18T14:00:00Z Europe/Dublin
      Recent assistant messages
      - user: Help me answer Ada.
      Context sources
      - assistant_message:message-1 [private, included] Recent chat - Immediate conversation context.
      - calendar_event:event-1 [private, included] Ada check-in - Upcoming related meeting.
      - contact:contact-ada [private, included] Ada Lovelace - Mentioned by name.
      - email_thread:thread-1 [private, included] Workflow notes - Active reply context.
      - mission_statement:mission-statement [private, included] Mission statement - Primary owner intent for agent replies.
      - owner_profile:owner [public, included] Owner profile - Always include a small owner profile.
      - private_memory:memory-1 [private, included] Email tone - Relevant to drafting a reply.
      - project:project-1 [private, included] Analytics Workflow - Linked to Ada.
      - public_me_json:owner-me-json [public, included] Public me.json - Public identity context for agents.
      - task:task-1 [private, included] Send Friday update - Open task for this contact.
      - wheel_of_life:wheel-snapshot-1 [private, included] Wheel of Life snapshot - Current life snapshot for balancing advice."
    `);
  });

  it("trims long prompt output predictably", () => {
    const packet = createMe3AgentContextPacket({
      id: "packet-trim",
      ownerId: "owner",
      purpose: "chat_reply",
      ownerProfile: {
        displayName: "Kieran",
        source: ownerSource,
      },
      privateMemory: [
        {
          id: "memory-long",
          kind: "owner_note",
          body: "A".repeat(1000),
          source: {
            id: "memory-long",
            kind: "private_memory",
            label: "Long note",
            visibility: "private",
          },
        },
      ],
      budget: { maxPromptChars: 240 },
    });

    const prompt = buildMe3AgentContextPrompt(packet);

    expect(prompt.text.length).toBeLessThanOrEqual(240);
    expect(prompt.text).toContain("[Context trimmed to prompt budget]");
    expect(prompt.budget).toMatchObject({
      usedPromptChars: prompt.text.length,
      wasTrimmed: true,
      trimReason: "maxPromptChars",
    });
    expect(validateMe3AgentContextPacket(packet)).toEqual([]);
  });

  it("normalizes private sources away from public visibility", () => {
    const packet = createMe3AgentContextPacket({
      id: "packet-privacy",
      ownerId: "owner",
      purpose: "chat_reply",
      publicIdentity: {
        summary: "Public identity stays public.",
        source: meJsonSource,
      },
      privateMemory: [
        {
          id: "memory-private",
          kind: "learning",
          body: "This is private.",
          source: {
            id: "memory-private",
            kind: "private_memory",
            label: "Private learning",
            visibility: "public",
          },
        },
      ],
      contacts: [
        {
          id: "contact-private",
          name: "Private Contact",
          source: {
            id: "contact-private",
            kind: "contact",
            label: "Private Contact",
            visibility: "public",
          },
        },
      ],
    });

    expect(packet.publicIdentity?.source.visibility).toBe("public");
    expect(packet.privateMemory[0]?.source.visibility).toBe("private");
    expect(packet.contacts[0]?.source.visibility).toBe("private");
    expect(packet.sources.find((source) => source.id === "memory-private")).toMatchObject({
      visibility: "private",
    });
    expect(validateMe3AgentContextPacket(packet)).toEqual([]);
  });

  it("creates display-ready source manifests with failures and trimming decisions", () => {
    const packet = createMe3AgentContextPacket({
      id: "packet-manifest",
      generatedAt: "2026-05-16T11:00:00.000Z",
      ownerId: "owner",
      purpose: "debug",
      ownerProfile: {
        displayName: "Kieran",
        source: ownerSource,
      },
      privateMemory: [
        {
          id: "memory-tone",
          kind: "preference",
          body: "Prefers concise replies.",
          source: {
            id: "memory-tone",
            kind: "private_memory",
            label: "Tone preference",
            visibility: "private",
            reason: "Matched reply request.",
          },
        },
      ],
      contacts: [
        {
          id: "contact-ada",
          name: "Ada Lovelace",
          source: {
            id: "contact-ada",
            kind: "contact",
            label: "Ada Lovelace",
            visibility: "private",
            reason: "Contact name matched the request.",
          },
        },
      ],
      sources: [
        {
          id: "thread-long",
          kind: "email_thread",
          label: "Long thread",
          visibility: "private",
          status: "trimmed",
          reason: "Exceeded prompt budget.",
        },
        {
          id: "gmail-sync",
          kind: "plugin",
          label: "Gmail sync",
          visibility: "private",
          status: "failed",
          reason: "Provider unavailable.",
        },
      ],
      budget: { maxPromptChars: 240 },
      warnings: ["Calendar lookup skipped."],
    });

    const manifest = createMe3AgentContextManifest(packet, {
      ...packet.budget,
      usedPromptChars: 240,
      wasTrimmed: true,
      trimReason: "maxPromptChars",
    });

    expect(manifest.sources).toContainEqual(
      expect.objectContaining({
        id: "contact-ada",
        kind: "contact",
        reason: "Contact name matched the request.",
        status: "included",
      }),
    );
    expect(manifest.sources).toContainEqual(
      expect.objectContaining({
        id: "thread-long",
        status: "trimmed",
        reason: "Exceeded prompt budget.",
      }),
    );
    expect(manifest.sources).toContainEqual(
      expect.objectContaining({
        id: "gmail-sync",
        status: "failed",
        reason: "Provider unavailable.",
      }),
    );
    expect(manifest.budget).toMatchObject({
      usedPromptChars: 240,
      wasTrimmed: true,
      trimReason: "maxPromptChars",
    });
    expect(summarizeMe3AgentContextManifest(manifest)).toBe(
      "Used context from: 1 owner profile, 1 private memory, 1 contact. 1 failed; 1 source trimmed; prompt trimmed; 1 warning.",
    );
  });
});

describe("ME3 agent context resolvers", () => {
  it("selects relevant contact, email, project, task, calendar, and memory context", () => {
    const packet = resolveMe3AgentContextPacket({
      id: "resolved-1",
      generatedAt: "2026-05-16T10:00:00.000Z",
      ownerId: "owner",
      purpose: "chat_reply",
      requestText: "Help me reply to Ada about the workflow notes.",
      ownerProfile: {
        displayName: "Kieran",
        source: ownerSource,
      },
      publicIdentity: {
        summary: "Public identity.",
        source: meJsonSource,
      },
      candidateContacts: [
        contact("contact-ada", "Ada Lovelace", "client"),
        contact("contact-grace", "Grace Hopper", "lead"),
      ],
      candidateEmailThreads: [
        emailThread(
          "thread-ada",
          "Workflow notes",
          "Ada asked for a Friday update.",
          "contact-ada",
          "project-analytics",
        ),
        emailThread(
          "thread-grace",
          "Compiler invoices",
          "Grace sent a finance note.",
          "contact-grace",
          "project-compiler",
        ),
      ],
      candidateProjects: [
        project("project-analytics", "Analytics Workflow"),
        project("project-compiler", "Compiler Research"),
      ],
      candidateTasks: [
        task("task-ada", "Send Ada the Friday workflow update", "project-analytics"),
        task("task-grace", "Review compiler invoice", "project-compiler"),
      ],
      candidateCalendarEvents: [
        {
          id: "event-ada",
          title: "Ada workflow check-in",
          startsAt: "2026-05-18T14:00:00Z",
          source: source("calendar_event", "event-ada", "Ada workflow check-in"),
        },
      ],
      candidatePrivateMemory: [
        memory(
          "memory-ada",
          "preference",
          "Ada prefers concise Friday updates.",
          "contact:contact-ada",
        ),
        memory(
          "memory-compiler",
          "project_context",
          "Compiler research is finance-sensitive.",
          "project:project-compiler",
        ),
      ],
      activeScope: { date: "2026-05-18" },
    });

    expect(packet.contacts.map((item) => item.id)).toEqual(["contact-ada"]);
    expect(packet.emailThreads.map((item) => item.id)).toEqual(["thread-ada"]);
    expect(packet.projects.map((item) => item.id)).toEqual(["project-analytics"]);
    expect(packet.tasks.map((item) => item.id)).toEqual(["task-ada"]);
    expect(packet.calendarEvents.map((item) => item.id)).toEqual(["event-ada"]);
    expect(packet.privateMemory.map((item) => item.id)).toEqual(["memory-ada"]);
    expect(JSON.stringify(packet)).not.toContain("contact-grace");
    expect(JSON.stringify(packet)).not.toContain("thread-grace");
    expect(JSON.stringify(packet)).not.toContain("project-compiler");
    expect(packet.sources.find((item) => item.id === "contact-ada")).toMatchObject({
      reason: "Contact token matched the request.",
    });
  });

  it("degrades safely when a contact mention is ambiguous", () => {
    const packet = resolveMe3AgentContextPacket({
      id: "resolved-ambiguous",
      generatedAt: "2026-05-16T10:00:00.000Z",
      ownerId: "owner",
      purpose: "chat_reply",
      requestText: "Can you check Ada?",
      candidateContacts: [
        contact("contact-ada-lovelace", "Ada Lovelace", "client"),
        contact("contact-ada-byron", "Ada Byron", "lead"),
      ],
      candidateEmailThreads: [
        emailThread(
          "thread-lovelace",
          "Budget",
          "Follow-up needed.",
          "contact-ada-lovelace",
          null,
        ),
      ],
    });

    expect(packet.contacts).toEqual([]);
    expect(packet.emailThreads).toEqual([]);
    expect(packet.warnings).toEqual([
      'Ambiguous contact match for "Can you check Ada?"; no contact context was selected.',
    ]);
  });

  it("includes contacts when the owner asks for their contact directory", () => {
    const packet = resolveMe3AgentContextPacket({
      id: "resolved-contact-directory",
      generatedAt: "2026-05-16T10:00:00.000Z",
      ownerId: "owner",
      purpose: "chat_reply",
      requestText: "Can you list the contacts I have?",
      candidateContacts: [
        contact("contact-ada", "Ada Lovelace", "client"),
        contact("contact-grace", "Grace Hopper", "contact"),
        contact("contact-mina", "Mina Murray", "prospect"),
      ],
    });

    expect(packet.contacts.map((item) => item.id)).toEqual([
      "contact-ada",
      "contact-grace",
      "contact-mina",
    ]);
    expect(packet.sources.filter((item) => item.kind === "contact")).toHaveLength(3);
    expect(packet.sources.find((item) => item.id === "contact-ada")).toMatchObject({
      reason: "Contact directory requested by the owner.",
    });
    expect(packet.warnings).toEqual([]);
  });

  it("uses active scopes even when the request text is sparse", () => {
    const packet = resolveMe3AgentContextPacket({
      id: "resolved-active",
      generatedAt: "2026-05-16T10:00:00.000Z",
      ownerId: "owner",
      purpose: "mission_review",
      requestText: "Run the project review.",
      activeScope: {
        emailThreadId: "thread-active",
        projectId: "project-active",
        date: "2026-05-18",
      },
      candidateContacts: [
        contact("contact-active", "Mina Murray", "client"),
        contact("contact-other", "Lucy Westenra", "lead"),
      ],
      candidateEmailThreads: [
        emailThread(
          "thread-active",
          "Quiet subject",
          "No obvious request tokens.",
          "contact-active",
          "project-active",
        ),
        emailThread(
          "thread-other",
          "Other subject",
          "No obvious request tokens.",
          "contact-other",
          "project-other",
        ),
      ],
      candidateProjects: [
        project("project-active", "Client Review"),
        project("project-other", "Compiler Project"),
      ],
      candidateTasks: [
        task("task-active", "Prepare active review", "project-active"),
        task("task-other", "Prepare other review", "project-other"),
      ],
      candidateCalendarEvents: [
        {
          id: "event-active",
          title: "Client review",
          startsAt: "2026-05-18T09:00:00Z",
          source: source("calendar_event", "event-active", "Client review"),
        },
        {
          id: "event-other",
          title: "Other review",
          startsAt: "2026-05-19T09:00:00Z",
          source: source("calendar_event", "event-other", "Other review"),
        },
      ],
    });

    expect(packet.emailThreads.map((item) => item.id)).toEqual(["thread-active"]);
    expect(packet.contacts.map((item) => item.id)).toEqual(["contact-active"]);
    expect(packet.projects.map((item) => item.id)).toEqual(["project-active"]);
    expect(packet.tasks.map((item) => item.id)).toEqual(["task-active"]);
    expect(packet.calendarEvents.map((item) => item.id)).toEqual(["event-active"]);
  });
});

function contact(
  id: string,
  name: string,
  relationship: string,
): Me3AgentContextContact {
  return {
    id,
    name,
    relationship,
    summary: `${name} summary.`,
    source: source("contact", id, name),
  };
}

function emailThread(
  id: string,
  subject: string,
  summary: string,
  contactId: string | null,
  projectId: string | null,
): Me3AgentContextEmailThread {
  return {
    id,
    subject,
    summary,
    contactId,
    projectId,
    source: source("email_thread", id, subject),
  };
}

function project(id: string, name: string): Me3AgentContextProject {
  return {
    id,
    name,
    summary: `${name} summary.`,
    source: source("project", id, name),
  };
}

function task(
  id: string,
  title: string,
  projectId: string,
): Me3AgentContextTask {
  return {
    id,
    title,
    status: "open",
    projectId,
    source: source("task", id, title),
  };
}

function memory(
  id: string,
  kind: string,
  body: string,
  scope: string,
): Me3AgentContextPrivateMemory {
  return {
    id,
    kind,
    body,
    scope,
    source: source("private_memory", id, kind),
  };
}

function source(
  kind: Me3AgentContextSource["kind"],
  id: string,
  label: string,
): Me3AgentContextSource {
  return {
    id,
    kind,
    label,
    visibility:
      kind === "owner_profile" || kind === "public_me_json" ? "public" : "private",
  };
}
