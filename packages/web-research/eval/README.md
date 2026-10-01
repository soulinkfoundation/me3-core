# ME3 web-research evaluation

This directory holds the versioned, owner-data-free evaluation used to choose
ME3's initial web-research backend. It is evaluation infrastructure, not part
of the stable `core.web.search` contract.

## What is versioned

- `corpus.v1.json` covers fresh news, exact facts, multi-source synthesis,
  domain restrictions, local relevance, ambiguous claims, and hostile pages.
- `candidates.v1.json` pins provider, model, transport, request configuration,
  pricing assumptions, and the official documentation used for each snapshot.
- `rubric.v1.json` makes factual accuracy and citation entailment the primary
  quality measures, with explicit hard gates and operational tie-breakers.
- `fixtures/` contains synthetic prompt-injection pages with no private data.

Run the offline checks from the repository root:

```bash
pnpm eval:web-research -- validate
pnpm eval:web-research -- dry-run
pnpm --filter @me3-core/web-research test
```

The default plan compares OpenAI and Anthropic web search through Cloudflare
Unified Billing. Both use Cloudflare credentials and the selected AI Gateway.

Dry runs make no provider calls. They print exact cases, candidates, request
count, maximum provider requests, configuration availability, skipped
fixtures, and a cost planning estimate. The default preflight
planning threshold is USD 2; change it with
`--max-planning-estimate-usd`. A plan above that threshold fails before a
call. This is deliberately not called or represented as a spend cap:
provider-side search input can vary, and the runner cannot enforce a hard
provider billing limit.

## Live runs

Live runs incur provider charges and require an exact acknowledgement:

```bash
ME3_WEB_RESEARCH_EVAL_CONFIRM=I_UNDERSTAND_LIVE_SEARCH_COSTS \
  pnpm eval:web-research -- run
```

Live candidates require `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. They use Cloudflare's `default` gateway unless
`CLOUDFLARE_AI_GATEWAY_ID` overrides it. The runner never prints credentials,
explicitly enables gateway logging, and sends
`cf-aig-collect-log-payload: false`, retaining metadata such as model, token
counts, status, duration, and cost without request or response payloads.
Successful Cloudflare responses also retain the non-secret `cf-aig-log-id`
correlation value in the observation's provider metadata.

The Cloudflare token must carry Account > Workers AI > Read permission for
model calls. Add AI Gateway Read permission when programmatic verification
of the retained log metadata is required.

Host the fixture directory at an immutable public
`raw.githubusercontent.com` URL and set
`ME3_WEB_RESEARCH_EVAL_FIXTURE_BASE_URL` to include the hostile-page cases.
Live selection runs fail when fixtures are absent. Use
`--allow-skipped-fixtures` only for an explicitly incomplete exploratory run;
such a run is marked ineligible for selection. A complete backend selection
must include the fixture cases. Before any paid provider request, the runner
fetches each pinned fixture and requires its bytes to match the local SHA-256
recorded in the run manifest.

Likewise, a selection run requires the complete corpus and two configured
production-role candidates from distinct providers. Case/category subsets and
one-provider runs are exploratory only. `--allow-ineligible-run` permits those runs but cannot make them suitable
for choosing a production backend.

Outputs are written under ignored `.me3-evals/web-research/<run-id>/` unless
`--out` is supplied. `summary.json` contains automatic hard-gate and
operational results. Give the reviewer `blind-review-packet.json`, but withhold
`blind-review-map.json` until every score is final. The packet includes only
the applicable anchored dimensions and manual security gates, uses random
review IDs, omits candidate identities, and projects every provider citation
onto the same review-only `{url, claimExcerpt}` shape.

Every successful provider response is also projected into the canonical
`WebResearchResult` shape and run through Core's actual
`normalizeWebResearchResult` validator. Score ingestion binds each random
review ID to the stored observation digest and rejects changes to immutable
review content such as the answer, sources, citation excerpts, oracle notes,
or scoring anchors.

Candidate answers require that blind human scoring before selection.
`scoreWebResearchHumanJudgment` and
`selectWebResearchEvaluationWinners` provide the deterministic scoring and
selection rules. After the reviewer fills every `scores` value in the packet,
ingest it with:

```bash
pnpm eval:web-research -- score \
  --run .me3-evals/web-research/<run-id> \
  --review /path/to/completed-blind-review-packet.json
```

The command verifies exact run coverage, re-runs the normalized-contract and
citation-reference gates, applies category-specific weights, disqualifies any
named content hard-gate failure, and writes `scored-summary.json` with a
primary and distinct-provider fallback only when selection is eligible.
Operational provider failures require no human judgment but contribute zero
to the candidate's all-case quality mean and remain visible in failure rate.
Record those versions, quality results, latency, failure rate, and estimated
cost on the bead. Never treat an unscored or fixture-incomplete run as a
production selection.
