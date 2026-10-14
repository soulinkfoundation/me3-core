# Agent runtime contributor guide

The canonical architecture is [ME3 agent runtime](../../docs/projects/me3-agent-runtime.md)
in the shared ecosystem docs. Execution criteria and checkpoints live in bead
`me3-ahsk.17`.

The implementation is in `packages/agent`, with Worker integration in
`apps/worker/src/me3-agent.ts`, `agent-runtime.ts` and `routes/new-agent.ts`.
Every chat entry point uses the `ME3_AGENT` Durable Object. A missing binding
returns an explicit unavailable response. There is no runtime selector or legacy
dispatcher. `ME3_USER_AGENT` retains mailbox events and installation cleanup.
The Wrangler configs retain historical class migrations and retire only the SDK
wrapper with a `deleted_classes` migration. D1 migrations `0058` and `0059` create portable
turn, receipt, approval, target, selection, cancellation and request-alias state.
The `agent-chat` package now contains retained domain services and wire contracts;
the loop and domain tools live in `packages/agent`.

Run `pnpm build` for workspace typechecks and the web build. Check the final
Worker without deploying:

```sh
pnpm exec wrangler deploy --dry-run --config apps/worker/wrangler.core.example.toml --outdir /tmp/me3-agent-dryrun
```

See [evaluation commands and limits](agent-evaluation.md) for disposable scripted
and authorized live model runs. Tests and fixtures must never use owner data,
production installation settings or real outbound delivery.
