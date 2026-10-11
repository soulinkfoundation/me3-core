# ME3 Knowledge

Shared, typed product and capability knowledge for self-hosted and managed ME3
surfaces.

Think of this package as ME3's capability map, not as a single agent skill. Agent
runtimes should inject only the compact `buildMe3CapabilityContext` output, while
apps can render the fuller snapshot in help surfaces, onboarding, setup panels,
and empty states.

The package also owns the portable agent context packet contract. Chat and
plugin tools should use `createMe3AgentContextPacket` plus
`buildMe3AgentContextPrompt` to pass small, source-labeled slices of profile,
public identity, private memory, contacts, email, project/task/calendar context,
and recent messages into model calls. Keep source manifests visible enough for
debugging, and keep private context marked private.

The first slice is intentionally static and versioned with code. Plugin manifests
and user-specific install state can be merged at runtime through
`getMe3KnowledgeSnapshot` or `buildMe3CapabilityContext`.

## LLM Docs Artifact

`pnpm generate:llms` writes `apps/web/public/llms.txt` from this package so Core
installs can expose a compact, public-safe capability map at `/llms.txt`.

Keep this artifact generated from typed knowledge rather than hand-edited. The
future `llms-full.txt` docs bundle should stay separate until the Core docs
corpus is large enough to justify one-shot ingestion.
