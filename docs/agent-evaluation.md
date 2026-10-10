# Agent acceptance evaluation

`pnpm eval:agent -- --runtime=new --model=scripted-fixture --repeat=1` checks seeded plumbing without spending model credits. It cannot satisfy the live release gate. `sdk` is retained only as an informational same-model comparison; the harness does not offer a legacy baseline.

For an authorized live run, export `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI Read), and optionally `CLOUDFLARE_AI_GATEWAY_ID`. Then run:

```sh
pnpm eval:agent -- --runtime=new --model=openai:gpt-5.5 --repeat=3 --max-cost-usd=40
```

The runner includes published standard rates for GPT-5.5, GPT-6.1 Sol, Opus 5.5 and Sonnet 5.5, verified on 2026-10-10 from their official model pages. An optional `--pricing=/path/to/pricing.json` overrides or adds public rates in USD per million tokens, keyed by the exact candidate and fixed grader model IDs:

```json
{
  "openai:gpt-5.5": {
    "input": 5,
    "output": 30,
    "cached": 0.5,
    "source": "https://developers.openai.com/api/docs/models/gpt-5.5"
  }
}
```

Unknown rates stop a live run before spending credits and fail the cost-evidence gate. The shared agent-plus-grader cost guard defaults to $40, reserves a conservative bound before each request, and settles to reported usage afterward. Missing usage retains its reservation. The guard stops before a request that would exceed the limit. Bead `me3-ahsk.17` requires owner approval above approximately $50 across the entire session; choose a lower per-run limit when remaining gateway credits or earlier reservations require it. The fixed grader is `openai:gpt-5.5`, recorded in each report. Grader cost is separate from the agent conversation cost. The $29.99 comparison uses the mean complete synthetic scenario, including its follow-ups, before infrastructure and billing overhead. It is not a prediction of owner usage or subscription margin.

Defaults are 63 scenarios and three independent repeats, each with a fresh migrated SQLite installation containing only synthetic `example.invalid` identities. The 48 existing phrasing controls are followed by 15 realistic journeys: cross-feature availability and email draft, calendar/reminder pronouns, duplicate reminder clarification and selection, contact-list pronouns, contacts/journal ambiguity, rambling dictation, unread email triage, mailbox keyword search and full draft retrieval, cited public research, no-tool conversation, unsupported bank transfer, and a DST wall-time move. Destructive actions pause for explicit approval. Optional checks between owner turns catch writes made before clarification or approval.

Mailbox transport, public-web retrieval and network providers are simulated. Availability uses the real Worker scheduling service; domain tools run against persisted SQLite state. The public-web scenario assesses grounded citation use against a fixed official-source fixture, not live search coverage or freshness. No email, Soulink message or bank transfer can leave the eval installation. The eval is seeded integration evidence, not deployed or native end-to-end acceptance.

Live model requests preserve the provider SSE stream through Cloudflare's native compatibility endpoints. The harness rejects buffered JSON responses to streaming requests. TTFT starts at each owner turn and stops at the first nonempty runtime delta, including time spent on tools before model text arrives. A pure tool call that pauses for approval may have no provider text delta; its TTFT stays `null` and is excluded from the latency percentile. Other missing deltas fail the streaming gate. Reports contain per-turn and per-scenario timings, nearest-rank p50/p95, task state and grader pass rates, token totals, cost, write-safety counts, revision, exact command and fixture procedure. A scenario with mixed repeat outcomes is flagged as flaky. Conversation cost remains unknown if any candidate request lacks reported usage.

JSON and Markdown checkpoints are written after every scenario to `.me3-evals/agent/` by default. This gitignored directory is durable local evidence; archive or link these reports in the bead rather than leaving the only evidence in `/tmp`. `--report=/absolute/path/report.json` overrides the destination. `--scenarios=id,id` or `--limit=N` selects a diagnostic subset. `--report-only` preserves reports without a nonzero exit code; it never changes a gate result.

The absolute gate requires the entire live suite on the new runtime with at least three distinct repeats per scenario, at least 90% state checks and grader passes, zero duplicate/unauthorized/wrong-record writes, no provider failures, streaming TTFT p95 at most 2.5 seconds, single-tool scenario p95 at most 5 seconds, and known conversation cost. A diagnostic subset or a single repeat cannot authorize promotion. Scripted runs exit according to their state/safety checks while their release gate remains failed. The SDK report is always informational. Nightly CI runs the new scripted harness and contract tests without making billed calls.

`scripts/agent-eval-adapters.mjs` is the runtime seam: seeded environment, owner, history, model route and event callback go in; final text and normalized tool results come out. Only the removable SDK adapter imports the old turn runtime. Scenarios, seed, gateway, grader and report modules do not import old turn or routing code.
