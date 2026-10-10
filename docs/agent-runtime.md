# Agent runtime contributor guide

The canonical architecture is [ME3 agent runtime](../../docs/projects/me3-agent-runtime.md)
in the shared ecosystem docs. Execution criteria and checkpoints live in bead
`me3-ahsk.17`.

The implementation is in `packages/agent`, with Worker integration in
`apps/worker/src/me3-agent.ts`, `agent-runtime.ts` and `routes/new-agent.ts`.
The opt-in switch `ME3_ASSISTANT_RUNTIME=agent` selects the new `ME3_AGENT`
Durable Object; the old runtime remains available until the live and client
acceptance gates pass. The example Wrangler config declares the new binding and
additive Durable Object migration. D1 migrations `0058` and `0059` create portable
turn, receipt, approval, target, selection, cancellation and request-alias state.

Run `pnpm build` for workspace typechecks and the web build. Check the final
Worker without deploying:

```sh
pnpm exec wrangler deploy --dry-run --config apps/worker/wrangler.core.example.toml --outdir /tmp/me3-agent-dryrun
```

See [evaluation commands and limits](agent-evaluation.md) for disposable scripted
and authorized live model runs. Tests and fixtures must never use owner data,
production installation settings or real outbound delivery.
