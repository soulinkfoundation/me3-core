export type Me3BundledAgentSkill = {
  id: string;
  name: string;
  description: string;
  sourceRef: string;
  triggerHints: string[];
  instructions: string;
  updatedAt: string;
};

export const ME3_BUNDLED_AGENT_SKILL_UPDATED_AT = "2026-06-12T00:00:00.000Z";

export const ME3_BUNDLED_AGENT_SKILLS: readonly Me3BundledAgentSkill[] = [
  {
    id: "core.me3-configuration",
    name: "ME3 Configuration",
    description:
      "ME3-specific setup, update, configuration, plugins, local executor, and recovery guidance.",
    sourceRef: "docs/how-to-me3.md",
    triggerHints: [
      "me3",
      "configure",
      "configuration",
      "setup",
      "install",
      "update",
      "domain",
      "mailbox",
      "assistant",
      "plugin",
      "executor",
      "recovery",
    ],
    instructions: `# ME3 Configuration

Use this skill for ME3-specific setup and configuration questions.

ME3 setup guidance should stay focused on ME3 concepts: installable-runtime vs plugin-owned vs hosted-only boundaries, owner setup state, assistant configuration, custom domain state, mailbox state, local executor capabilities, and recovery.

When the owner asks for provider-specific mechanics, explain the ME3 state ME3 needs, then use the bundled provider skill for the provider details. For Cloudflare tasks, use the bundled Cloudflare Platform skill.

Do not claim external provider actions are complete unless a ME3 tool or provider API result confirms them. Saving settings, connecting providers, sending mail, routing domains, running local commands, and changing external infrastructure require explicit owner action or an approved capability.`,
    updatedAt: ME3_BUNDLED_AGENT_SKILL_UPDATED_AT,
  },
  {
    id: "core.cloudflare-platform",
    name: "Cloudflare Platform",
    description:
      "Cloudflare-specific setup context for ME3 installations running on Workers, D1, R2, KV, Queues, Email Routing, and Workers AI.",
    sourceRef: "https://github.com/cloudflare/skills/tree/main/skills/cloudflare",
    triggerHints: [
      "cloudflare",
      "worker",
      "workers",
      "wrangler",
      "d1",
      "r2",
      "kv",
      "queue",
      "queues",
      "email",
      "routing",
      "dns",
      "domain",
      "ai",
      "gateway",
    ],
    instructions: `# Cloudflare Platform

Use this skill for Cloudflare-specific setup and troubleshooting inside ME3.

ME3 runs on Cloudflare infrastructure. Cloudflare knowledge is first-class setup knowledge for ME3, especially Workers, custom domains, D1 migrations, R2 assets, KV/session storage, Queues, scheduled triggers, Email Routing, Email Sending, Workers AI, and AI Gateway.

Keep the distinction clear:

- ME3 decides what state it needs and which ME3 settings should be saved.
- Cloudflare owns provider-specific resource creation, DNS, routes, bindings, queues, email routing, and provider diagnostics.
- The assistant may explain and prepare steps, but should not claim Cloudflare resources were changed unless a Cloudflare tool/API result confirms it.

For risky or external changes, ask for explicit owner confirmation before using any capability that can write provider state. Prefer exact resource names and bindings from the ME3 install when available. If the owner needs current Cloudflare console labels or API behavior, prefer official Cloudflare docs or the official Cloudflare skill source rather than guessing.`,
    updatedAt: ME3_BUNDLED_AGENT_SKILL_UPDATED_AT,
  },
];
