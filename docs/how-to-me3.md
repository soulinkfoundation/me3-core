# ME3 How-To Guide

This is the public, agent-readable how-to source for ME3 installs. It is meant for ME3, Codex, and other AI agents to answer owner questions without guessing.

Keep this guide:

- Operational: prefer commands, exact setting names, route names, and expected outcomes.
- Safe: never include real secrets, production Cloudflare IDs, hosted billing config, or private owner data.
- Sparse: add a major feature section only when there is useful instruction to put in it.
- Runtime-aware: clearly separate installable ME3 behavior from plugin-owned or hosted-only ME3 Cloud behavior.

When a user asks about something not covered here, say that this guide does not document it yet, then inspect the repo or current install before answering.

## Document Structure

Use one top-level section per major feature. Do not keep empty placeholder sections.

## Cloudflare Components

ME3 is a Cloudflare Worker app. The web app is built into Worker assets and managed through the Cloudflare Workers & Pages dashboard; it is not a separate Pages project in this repo.

| Component | ME3 use | Docs |
| --- | --- | --- |
| Workers | Main runtime, API, static assets, scheduled/queue/email handlers | [Workers](https://developers.cloudflare.com/workers/) |
| D1 | Owner data, settings, plugin state, jobs, mailbox metadata | [D1](https://developers.cloudflare.com/d1/) |
| R2 | Optional at install; required for mailbox attachments, assistant images, generated images, and larger site media | [R2](https://developers.cloudflare.com/r2/) |
| Queues | Assistant job events, booking reminders, social publishing work | [Queues](https://developers.cloudflare.com/queues/) |
| Custom Domains | Public site host and `me3.<domain>` owner/admin host | [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) |
| Email Routing | Incoming mailbox mail routed to the Worker email handler | [Email Routing](https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/) |
| Email Service | Optional Cloudflare outbound email sender binding | [Email Sending](https://developers.cloudflare.com/email-service/get-started/send-emails/) |
| Workers AI | Default no-key model provider when the `AI` binding exists | [Workers AI](https://developers.cloudflare.com/workers-ai/) |
| AI Gateway | Usage, token, and cost visibility for model calls | [AI Gateway](https://developers.cloudflare.com/ai-gateway/) |
| Pages | Related Cloudflare product; useful context for the dashboard, but not the current deploy target | [Pages](https://developers.cloudflare.com/pages/) |

## Owner Auth

ME3 can protect the owner app with password auth, ME3.app auth, or both. This section covers password auth.

### Short Answer

Do not generate a long-term password hash manually.

For password setup or password recovery, generate a setup/recovery password and store it as a Cloudflare Worker Secret named `SETUP_PASSWORD`. ME3 exposes that value to the Worker as `env.SETUP_PASSWORD`.

The owner then opens the ME3 login page, enters the setup password as the setup code, and chooses their real account password. The Worker hashes the real account password with PBKDF2-SHA256 and stores the hash in D1 at `owner_profile.password_hash`.

### Concepts

- `SETUP_PASSWORD` is a setup and recovery secret. It authorizes first owner bootstrap, custom password setup, and password reset.
- The owner account password is separate from `SETUP_PASSWORD`.
- The owner account password must be at least 8 characters.
- The owner account password hash is stored in D1, not in Cloudflare environment variables.
- Never commit `SETUP_PASSWORD`, `.dev.vars`, `.env`, or real generated secret values to git.

### Configure Password Auth

Preferred production path:

```bash
SETUP_PASSWORD="$(openssl rand -hex 16)"
pnpm init:cloudflare -- --setup-password "$SETUP_PASSWORD"
printf 'Save this setup password privately: %s\n' "$SETUP_PASSWORD"
unset SETUP_PASSWORD
```

Manual production path:

```bash
SETUP_PASSWORD="$(openssl rand -hex 16)"
printf '%s\n' "$SETUP_PASSWORD" | pnpm exec wrangler secret put SETUP_PASSWORD --config wrangler.toml
printf 'Save this setup password privately: %s\n' "$SETUP_PASSWORD"
unset SETUP_PASSWORD
```

Dashboard production path: Cloudflare Dashboard -> Workers & Pages -> ME3 Worker -> Settings -> Variables and Secrets -> add a `Secret` named `SETUP_PASSWORD`.

Local path:

```bash
pnpm setup:dev-vars
```

This creates ignored local values in `apps/worker/.dev.vars`.

To add relevant stock photography to Assistant-built landing pages, put a
Pexels API key in that ignored file:

```text
PEXELS_API_KEY=your-key-here
```

Without the key, site creation still succeeds and uses the selected design's
built-in visual treatment.

For the managed fleet, store the shared provider key once as the GitHub Actions
secret `ME3_MANAGED_PEXELS_API_KEY`. Managed provisioning copies it into new
Workers as the encrypted `PEXELS_API_KEY` binding, and managed upgrades refresh
that binding for existing installs. Local `.dev.vars` values never propagate to
deployed Workers.

### Bootstrap The First Owner

1. Deploy or run ME3.
2. Open the owner login page. In local dev, this is usually `http://localhost:4000/login`.
3. If the app says setup is required, confirm `SETUP_PASSWORD` exists in Cloudflare or `apps/worker/.dev.vars`.
4. Enter the setup password as the setup code.
5. Enter the owner email, name, and new owner account password.
6. Submit the form.

On success, the Worker calls `POST /api/admin/bootstrap`, stores the owner profile, writes `owner_profile.password_hash`, creates any missing install secrets, and starts an owner session.

### Reset Or Enable Password Auth

Use the `SETUP_PASSWORD` recovery flow when the owner has forgotten their password and has no
authenticated owner session.

An owner who is already signed in through ME3.app does not need the operator's `SETUP_PASSWORD`.
Open Account -> App Connections -> Local password, choose and confirm a password, then save it. The
authenticated Worker calls `PUT /api/account/password`, verifies the newly generated hash before
storing it, and returns only readiness state. Passwords and hashes are never returned by the API or
written to logs.

Use the recovery flow below only when there is no authenticated owner session:

1. Make sure the current `SETUP_PASSWORD` is known. If it is not known, rotate it with `wrangler secret put SETUP_PASSWORD`.
2. Open the ME3 login page.
3. Use the reset or advanced custom password option shown by the login UI.
4. Enter the owner email, the setup password, and a new account password.

On success, the Worker calls `POST /api/auth/password-reset/bootstrap`, updates `owner_profile.password_hash`, and clears the existing owner session.

### Rotate The Setup Password

Rotate `SETUP_PASSWORD` if it was exposed, lost, shared too broadly, or used during recovery on an untrusted machine.

```bash
SETUP_PASSWORD="$(openssl rand -hex 16)"
printf '%s\n' "$SETUP_PASSWORD" | pnpm exec wrangler secret put SETUP_PASSWORD --config wrangler.toml
printf 'Save the new setup password privately: %s\n' "$SETUP_PASSWORD"
unset SETUP_PASSWORD
```

Rotating `SETUP_PASSWORD` does not change the owner account password. It only changes the secret that authorizes setup and recovery.

### Troubleshooting

- If `/api/config` or `/health` includes `SETUP_PASSWORD` in `setupRequired`, the Worker cannot see `env.SETUP_PASSWORD`.
- If bootstrap fails with `Invalid setup password`, use the exact current setup password or rotate `SETUP_PASSWORD`.
- If login fails after bootstrap, use the owner email and real account password, not the setup password.

## Account Setup

Use Account for owner-facing setup. Keep answers short and point owners back to the UI when it can do the work.

### Local UI Against A Remote Installation

For frontend work against an already-deployed Worker API, run only the web app
locally and send its relative `/api` requests through Vite's local proxy:

```bash
ME3_DEV_API_TARGET=https://your-install.example.com pnpm dev:web
```

Open `http://localhost:4000` and choose **Use installation password**. This mode
uses the remote installation's real data, so ME3 displays a persistent warning.
Campaign send, test-send, and cancel requests are blocked by the local proxy;
draft creation and editing still change the remote installation. The server is
forced to `localhost` while this mode is active. Stop it when testing is done.

This mode does not make newer Worker endpoints or migrations available. Use a
managed sandbox or a stable deployment when the frontend depends on backend
changes that are not yet installed remotely.

### Deploy Core

Use `pnpm deploy:cloudflare` for manual Cloudflare deploys. It prepares D1 bindings, preserves any existing real `SITE_ASSETS` R2 binding, builds the app, applies D1 migrations, and runs `wrangler deploy`.

Do not use `pnpm deploy`; `deploy` is a pnpm built-in command and can skip ME3's deploy preparation. The `deploy` package script exists for Cloudflare's Deploy button, which provisions declared D1 resources from `wrangler.toml`, then runs migrations and deploys.

R2 storage is not required for first install. Activate it later from Account settings > Storage when email attachments, assistant image uploads, generated images, or larger site media are needed. Power users can still run `pnpm deploy:cloudflare:with-r2` or `pnpm storage:r2:provision`.

### Custom Domain

1. In Cloudflare, add or transfer the domain if needed.
2. In Workers & Pages, open the ME3 Worker and add Custom Domains for the root domain and `me3.<domain>`.
3. In ME3 Account -> Domain & mailbox settings -> Custom domain, save the root domain.
4. After Cloudflare provisions DNS/certificates, visit `https://me3.<domain>` and sign in again.

### Mailbox And Sending

- Receiving mail requires a custom domain and Cloudflare Email Routing.
- In Cloudflare Email Routing, onboard the domain, open Routing rules, create an address such as `assistant@example.com`, choose `Send to worker`, and select the ME3 Worker.
- In ME3 Account -> Mailbox, save the same address. Optional forwarding can send a copy to another inbox.
- Outbound sending can use Cloudflare Email Service, SMTP, Mailgun, or Postmark. SMTP is the stable generic option; Cloudflare Email Service may require a Workers paid plan.
- Test real sending from `/email`; drafting is not the same as sending.

### App Connections

- ME3.app: links hosted ME3 sign-in and public `me.json` preference back to this Core install. Disconnect is only available when password auth remains available.
- Soulink: creates a private Soulink chat between the owner and their ME3 assistant. It requires a live public Core URL; local callback URLs cannot connect.
- Telegram: create a bot with BotFather, save the bot username and token in Account, sync the webhook, then open the setup link or QR code and tap Start in Telegram.

### AI Models And Gateway

- Account -> AI selects the provider and model route for the ME3 agent.
- Workers AI uses the Cloudflare `AI` binding and does not need an API key.
- OpenAI and Anthropic keys can be saved in Account; Core encrypts stored provider secrets and never returns them to the browser.
- AI Gateway usage is backend-only setup. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as Worker secrets. Set `CLOUDFLARE_AI_GATEWAY_ID` when an install should use a gateway other than Cloudflare's `default`.
- Use `/mission-control` -> AI Usage -> Configure for the Cloudflare dashboard steps.
- To set or rotate them manually:

```bash
printf '%s\n' "your-account-id" | pnpm exec wrangler secret put CLOUDFLARE_ACCOUNT_ID --config wrangler.toml
printf '%s\n' "your-gateway-id" | pnpm exec wrangler secret put CLOUDFLARE_AI_GATEWAY_ID --config wrangler.toml
pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN --config wrangler.toml
```

#### Internal Live Model Evaluation

The fixed 30-task evaluator is for explicitly internal evaluation only. It sends synthetic tasks
through Core's existing provider-neutral model and tool runtime, can incur provider charges, and
prints a metadata-only report without prompts, responses, tool arguments, owner context, or keys.
Normal tests and builds never dispatch these live requests.

Set Workers AI credentials in the shell, optionally select a comma-separated subset with
`ME3_MODEL_EVAL_CANDIDATES`, then acknowledge the live provider cost before running:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
ME3_MODEL_EVAL_CONFIRM=I_UNDERSTAND_LIVE_PROVIDER_COSTS pnpm eval:models
```

The default candidates are Gemma 4 26B and GLM 4.7 Flash for Everyday plus GLM 5.2 for Advanced.
The optional existing Anthropic Sonnet candidate also requires
`ME3_MODEL_EVAL_ANTHROPIC_API_KEY` and explicit inclusion in `ME3_MODEL_EVAL_CANDIDATES`.

## Portable Snapshot And Clean Restore

`me3-portable-v1` is the Core-owned, owner-portable D1/R2 snapshot format. It is a
quiescent snapshot and restore proof, not a live transfer system: stop writes while the source D1
and R2 material are captured. The local CLI does not create a maintenance write barrier,
dual-write, provisioning, DNS cutover, billing, or managed fleet orchestration. Managed hosting
uses the separate lifecycle controls described below to create and prove that write barrier.

The archive is a directory with this versioned shape:

```text
manifest.json
data/d1-sanitized.sql.gz
objects/r2-manifest.ndjson
objects/blobs/...
config/install.json
config/provider-connections.json
secrets/portable-secrets.enc
checksums.sha256
README.txt
```

The manifest records the exact Core version/tag/commit, D1 and runtime migration levels, logical
installation ID, classified per-table row counts/checksums, R2 object counts/checksums, and restore
requirements. The secret envelope uses a fresh AES-256-GCM data key wrapped with an owner
passphrase through scrypt and authenticates a binding over the manifest's D1, R2, configuration,
identity, version, and migration checksums. The passphrase is never written into the archive.

Platform and managed-only credentials are not portable. The snapshot excludes active sessions,
mobile tokens, pairing/claim/OAuth state, rate limits, ephemeral idempotency state, Cloudflare AI
Gateway credentials, ME3 Cloud update/bridge credentials, Telegram/channel/daemon/local-executor
pairings, and host-bound Cloudflare IDs. The local password hash and approved owner-encrypted
provider credentials remain portable. Restore creates a fresh JWT secret, leaves device credentials
empty, and requires clients to pair again.

Social account identity rows are retained so owner Posting plans, Preferred posting times, and
Publication history keep stable references. Their access and refresh credentials, expiry, scopes,
provider metadata, and verification state are irreversibly sanitized; every restored account is
marked revoked until OAuth reconnects it. An interrupted Posting plan confirmation is restored as
needs attention with no confirmation token, suggested rather than reserved items, and released
reservations. Any Publication already created before the interruption remains owner data.

Source-backed Carousel models, exact Source evidence, uploaded raster media, deterministic SVG
assets, content hashes, and Version attachments are portable owner data. Restores keep these
immutable render sets intact; they do not require an image-generation provider or hosted object
storage to reproduce and preview the saved output.

Installation-owned bookings, commerce orders, and Accounts ledger entries remain owner data and
are portable. ME3 Managed subscription entitlements and control-plane billing records are
hosted-only, do not belong in Core D1, and are never included.

### Managed Hosting Cancellation And Decommission

Cancelling a managed hosting subscription normally uses two operations. Export and decommission use
different operation and attempt IDs, and the default path never deletes a runtime-backed install
without a retained, cryptographically verified owner export. An account owner can instead request
immediate deletion and explicitly waive both remaining paid service and the retained export. That
strict waiver is recorded and attested before the workflow can enter any destructive stage; it is
not inferred from a missing or failed export.

At the paid service end, ME3 Cloud dispatches the export operation with the installation's complete,
write-once resource manifest: exact Worker name, D1 name and UUID, R2 bucket, every dedicated Queue,
the `Me3UserAgent` Durable Object namespace, and deployed release tag. The runtime must expose the
generation-fenced `me3-managed-lifecycle-v2` protocol, the compatible portable-export policy, and
the exact recorded release.
Older managed installs that do not expose the signed lifecycle route stop with
`runtime_upgrade_required`; they must first go through the managed runtime upgrade/reconciliation
rollout. Operators must not bypass that prerequisite or delete those installs manually.
The control-plane `ME3_MANAGED_LIFECYCLE_ENABLED` gate remains off until that attested rollout can
record the actual lifecycle-capable deployed release for each install; changing a recorded tag
without proving the deployment is not a reconciliation process.

The managed export then:

1. Quiesces the runtime and waits for every tracked foreground and background write lease to drain.
2. Captures only classified D1 tables at one D1 export bookmark and materializes the SQL into a fresh,
   migrated SQLite database before accepting it.
3. Materializes R2 twice and requires stable before/after source listings plus identical full-file
   SHA-256 hashes in both local copies.
4. Creates a login-capable `me3-portable-v1` archive, then encrypts and authenticates the complete
   archive as `me3-managed-export-v1` with a high-entropy per-export passphrase.
5. Retains an artifact of at most 5 GiB with a single-part, `If-None-Match: *` R2 write, Content-MD5,
   SHA-256/MD5 metadata, and its export-key version. An existing key is never overwritten.
6. Independently downloads and re-hashes the retained bytes, verifies the envelope, records the
   immutable evidence, then suspends and drains the runtime while leaving credentials and storage
   intact until decommission is authorized.

Only after those facts are reported can the export operation succeed. If capture, retention, or
verification fails, deletion does not start. Failure compensation first tries an authenticated
resume, which the control plane authorizes only when billing renewed or account deletion was
canceled; otherwise it leaves the runtime quiesced for a safe retry. A retry may safely continue from
an intact quiesced runtime. Export key rotation must retain every referenced key version in the
managed export keyring until all
artifacts using that version have passed their retention policy.

Before a decommission attempt is claimed, a paid renewal or canceled account deletion can restore
service after either an interrupted or completed export. The control plane freezes the current
attempt, reads a fresh authenticated runtime generation, sends a generation-bound `resume`, and
releases the lifecycle lock only after the runtime reports `active` with credentials and storage
untouched. Every successful resume increments the runtime generation, so a quiesce or suspend token
issued before cancellation cannot take effect afterward. Once decommission is claimed, credential
revocation and storage deletion are irreversible and the cancellation path is closed.

The later decommission operation re-downloads and re-verifies the same retained artifact and key
version before any destructive control. It then suspends and drains again, revokes credentials,
purges runtime-owned D1/R2/Durable Object data, and proves the source R2 bucket empty before deleting
it. It removes only Queue consumers whose exact `script_name` matches the managed Worker, deploys an
inert binding-free tombstone with the Durable Object `deleted_classes` migration, and waits for
complete Queue consumer evidence before replacing the live Worker. After explicitly clearing and
verifying its resource bindings, it normal-deletes the inert tombstone without force so Cloudflare
detaches any retained producer registration. It waits for complete Queue producer/consumer evidence
to reach zero, deletes source Queues before their dead-letter Queues, re-reads every non-D1 resource
as absent, and deletes D1 last so its persisted termination proof remains available through every
retryable partial failure.

The strict-waiver path skips retained-export capture and S3 credential derivation, but it does not
weaken resource-deletion proof. The runtime must first persist that it is suspended and drained, its
credentials are revoked, and storage purge completed. R2 bucket deletion is the first provider
deletion: Cloudflare rejects deletion of a non-empty bucket, and the workflow must then confirm the
exact bucket is absent before it can touch Queues, the Worker, Durable Objects, or D1. If R2 remains
while the D1 purge proof is unavailable, the retry fails closed.

Both paths succeed only after GET/list checks prove every manifest resource absent. These deletion
steps are idempotent, so an interrupted attempt can retry without broad cleanup or name-prefix scans.
An authoritative `NoSuchBucket` counts as an already-absent R2 bucket; authorization and transient
errors never do. If the Worker is already absent or has been replaced by the Durable Object deletion
tombstone, persisted D1 state must prove suspension, credential revocation, and storage purge before
the retry may skip runtime controls and continue exact-manifest cleanup.

Owners receive the retained artifact with a `.me3export` download name and the per-export passphrase
through authenticated owner-only delivery. The master keyring is never disclosed. To extract it:

```bash
read -rs ME3_MANAGED_EXPORT_PASSPHRASE
export ME3_MANAGED_EXPORT_PASSPHRASE
node scripts/managed-export-envelope.mjs extract \
  --envelope owner-download.me3export \
  --output owner-portable-v1
unset ME3_MANAGED_EXPORT_PASSPHRASE
pnpm portable:verify -- --archive owner-portable-v1
```

The lifecycle workflow requires separate, narrowly scoped GitHub secrets for the lifecycle callback,
Cloudflare resource API, retained-export R2 access, and the versioned managed export keyring. For
export and retained-export decommission, it derives source R2 S3 credentials inside each runner job
from the existing Cloudflare resource API token, masks them before writing them to the runner
environment, and verifies access to the exact managed bucket. A strict-waiver decommission and
never-public failed-provision cleanup do not receive those S3 credentials. No separate source R2
access-key secret is stored. Do not reuse the provisioning callback secret as the lifecycle secret,
and do not expose provider or export-key secrets to code checked out from an older deployed release.

### Reproducible Local Proof

The proof creates two fresh local D1 installations from the real migration chain, seeds
representative owner data and five R2 objects, exports, restores into the clean target, verifies all
counts/checksums and the logical identity, boots the restored Worker, rejects the old browser and
device credentials, signs in with the preserved synthetic local password, and issues a fresh proof
client credential after re-pair:

```bash
pnpm portable:test
pnpm portable:proof
```

Add `-- --keep` to keep the temporary archive and databases for inspection. The proof uses only a
loopback local Worker; no external network calls or Cloudflare/GitHub mutations occur.

### Owner-Scoped Export And Restore

The CLI consumes a materialized D1 SQLite file and an optional directory containing the objects
from that installation's dedicated R2 bucket. Use credentials scoped to the owner's own account;
Core does not receive fleet-level credentials.

Set the passphrase without putting it in shell history:

```bash
read -rs ME3_PORTABLE_PASSPHRASE
export ME3_PORTABLE_PASSPHRASE
```

During a quiescent window, materialize D1 with Wrangler and materialize the dedicated R2 bucket
with an owner-configured S3-compatible client:

```bash
mkdir -p .me3-portable
pnpm exec wrangler d1 export DB --remote --config wrangler.toml --output .me3-portable/source.sql
sqlite3 .me3-portable/source.sqlite < .me3-portable/source.sql
pnpm portable:export -- \
  --db .me3-portable/source.sqlite \
  --r2-dir .me3-portable/source-r2 \
  --output .me3-portable/source.me3-portable
pnpm portable:verify -- --archive .me3-portable/source.me3-portable
```

Omit `--r2-dir` only when the installation has no R2 binding or objects. Export fails with
`LOCAL_PASSWORD_REQUIRED` before creating output unless the owner has a valid email and supported
local password hash. It also fails closed for an unknown table, unclassified credential field or
`install_secrets` name, incomplete runtime migrations, unsafe secret material, or invalid logical
installation ID.

Prepare a clean target from the exact recorded Core tag/commit, apply D1 migrations, and let Core
finish its runtime migrations. Materialize that empty target D1 as SQLite, then restore locally:

```bash
pnpm portable:restore -- \
  --archive .me3-portable/source.me3-portable \
  --target-db .me3-portable/target.sqlite \
  --target-r2-dir .me3-portable/target-r2 \
  --sql-output .me3-portable/target-import.sql
```

Restore verifies the archive before mutation, requires an empty target, stages D1 and R2, verifies
the staged counts/checksums/foreign keys/identity, and only then replaces the local target. The
optional import SQL is mode `0600` and contains freshly generated installation credentials; treat
it as a temporary secret and never commit or retain it as evidence.

### Explicitly Opt-In Cloudflare Drill

The CLI never provisions resources or applies changes remotely. After the local restore passes,
an owner may separately approve applying the generated transaction to an already-provisioned clean
target D1 and syncing the restored object directory to its empty dedicated R2 bucket:

```bash
pnpm exec wrangler d1 execute DB --remote --config wrangler.toml \
  --file .me3-portable/target-import.sql
```

The R2 upload uses the owner's S3-compatible client and target bucket; keep bucket/account names and
credentials outside the repository. Delete the sensitive import SQL after D1 succeeds. Start the
target Worker, sign in with the preserved local owner password, and pair each client again. Do not
perform these remote steps without explicit approval of the target resources.

To verify the live drill, re-export the restored D1/R2 through the same quiescent procedure and
compare the two portable archives:

```bash
pnpm portable:compare -- \
  --source .me3-portable/source.me3-portable \
  --restored .me3-portable/restored.me3-portable
```

Keep `manifest.json`, the JSON output from `portable:restore`, `portable:verify`, and
`portable:compare`, plus the drill timestamp as evidence. Those records contain versions, logical
identity, counts, and checksums without passphrases or credential values. Never retain raw D1/R2
data, the secret envelope plaintext, Cloudflare tokens, or the generated import SQL as shared
evidence.

## Core Plugins

ME3 exposes its first-party capability catalog through `/api/plugins`. Account -> Plugins lists owner-manageable optional plugins; foundational Agent Chat, Tasks and Projects, Calendar, and Journal capabilities remain in the catalog for runtime discovery but are hidden from plugin management.

| Plugin | Current status | Purpose |
| --- | --- | --- |
| ME3 Agent Chat | Bundled, default on | Full assistant chat workspace, voice transcription route, and sandbox replies. |
| ME3 Tasks and Projects | Bundled, default on | Projects, tasks, approvals, private memory, sources, activity, and review surfaces. |
| ME3 Journal | Bundled, optional | Private daily writing, notes, drafts, and longer-form capture. |
| Accounts | Bundled, optional | Income, expenses, customers, categories, CSV import/export, and Stripe-backed context. |
| ME3 Calendar | Bundled | Events, reminders, bookings, birthdays, tasks, imports, recurring event expansion, and ready-plugin Social Publication visibility. |
| Local Executor | Bundled, optional setup | Pairs a local runner for approved local tasks with policies, run history, and audit. |
| ME3 Landing Pages | Bundled but coming soon; activation blocked | Landing-page draft generation and rendering package, not a live owner feature unless runtime state proves otherwise. |
| Social publishing | Bundled/catalog depending runtime; setup required | Grounded Suggestions, Source-backed Posts, account-specific Versions, connected accounts, approval-first Publications, and delivery history. |

### Social Publishing

Social Publishing uses five owner-facing domain terms:

- A **Source** is explicit human-authored material such as a Journal entry, task,
  site article, file, script, or pasted text. An agent-saved Post requires a stable Source reference,
  immutable snapshot, and visible Source text. Brainstorming from a blank prompt may remain
  conversational, but it cannot be saved as a publishable Post.
- A **Suggestion** is review material extracted or transformed from one Source. Quote, Short Post,
  Thread, and carousel outline Suggestions keep visible Source text. The owner can edit, discard, or
  choose each one; choosing creates a separate Post linked to that same Source.
- A **Post** is reusable social content derived from a Source.
- A **Version** is the exact platform- and account-specific copy, media, format, and rendered output
  for a Post. Approval applies to that exact Version. Editing its copy, media, format, or account
  removes approval and cancels future scheduled Publications that no longer match. Already queued
  or completed Publications keep their immutable delivery snapshots and history.
- A **Publication** is one planned or completed use of an approved Version, with its own delivery
  time, timezone, request context, delivery state, provider result, recovery, and history. The same
  approved Version can have many future and historical Publications; reposting creates another one.

LinkedIn, X, Instagram, and Instagram Business support the complete approval, scheduling, direct
publishing, and recovery workflow when an active account and the Social Publishing queue are ready.
YouTube requires a reviewed visibility, audience, and altered-or-synthetic-content choice before
uploading. YouTube may keep API uploads private until the owning API project passes its compliance
audit. TikTok supports either a creator draft for completion in TikTok or a reviewed Direct Post;
neither short-video path supports ME3 scheduling.

Production installations offer the ME3 Cloud LinkedIn, Instagram, YouTube, and TikTok OAuth bridge
as the default connection path. The installation must first be linked to ME3 Cloud; provider app
secrets stay in the bridge, while the resulting owner-authorized social token is encrypted and stored
in the installation. Owners can select the advanced bring-your-own-app path where supported, and
independent self-hosted installs can leave the bridge unset.

The X adapter publishes text, up to four validated PNG, JPEG, or WebP images with optional alt text,
or one bounded MP4 video through the current X v2 APIs. A true managed installation uses the
ME3-owned X app by default. ME3 Cloud enforces its separate internal monthly cost allowance; Core
shows no allowance message below 80 percent and only `X usage: N%` at or above the threshold. At the
ceiling, new managed X Publications stop while drafts remain available.

Open `Advanced: use my own app` to switch an X connection to owner-funded credentials. The owner
must acknowledge `I pay X API charges.` and reconnect; that connection bypasses the hosted allowance.
Linked and unlinked self-hosted installations always use owner-funded X credentials. Dedicated hosted
X app secrets and its private cost ledger belong only in ME3 Cloud and must never be copied into this
Core repository or an installation.

`SOCIAL_PUBLISH_QUEUE` targets `me3-social-publish`. Its Worker consumer uses batch size 10, a
five-second batch timeout, two retries after the initial delivery, and
`me3-social-publish-dlq`. The zero-retry dead-letter consumer records a guarded terminal failure
without calling a provider again or overwriting completed or owner-recovered state. Keep the
producer and both consumers aligned in root and install-local Wrangler configuration.

The canonical owner API includes `GET|POST /api/social/suggestions`,
`PATCH|DELETE /api/social/suggestions/:id`, and
`POST /api/social/suggestions/:id/post` for grounded review and choosing. Posts use
`GET|POST /api/social/posts`, `GET /api/social/posts/:id`,
`PATCH /api/social/versions/:id`, `GET|POST /api/social/versions/:id/publications`, and the immediate
publish convenience route `POST /api/social/versions/:id/publish`. Cancel a future Publication with
`DELETE /api/social/publications/:id`, or reschedule only its planned time with
`PATCH /api/social/publications/:id`; resolve an ambiguous provider outcome for that exact attempt
with `POST /api/social/publications/:id/resolve`. Calendar's approved-Version chooser reads
`GET /api/social/scheduling/approved-versions`. Account connection and runtime readiness remain
under `/api/social/accounts` and `/api/social/status`.

Post library and Posting plan APIs use `GET /api/social/library`,
`GET|PUT /api/social/accounts/:id/preferred-posting-times`,
`POST /api/social/posting-plans`, `GET /api/social/posting-plans/:id`, and
`POST /api/social/posting-plans/:id/confirm`. Confirmation requires the exact reviewed plan
revision and an explicit owner action. Carousel media, deterministic rendering, immutable render
sets, and assets live under `/api/social/carousels/*` and remain owner-authenticated.

When Social Publishing is ready, `/api/calendar/feed` includes a bounded, read-only projection of
planned, publishing, published, failed, and attention-required Publications. Calendar presents a
toggleable Social publishing source in its existing schedule, day, week, and month views. Each
entry deep-links to the exact Post Version and Publication; Calendar never copies a Publication
into `user_calendar_events`. Scheduling, rescheduling, and cancellation from Calendar call those
plugin-owned Social Publishing APIs rather than mutating a personal calendar row.

Plugin boundaries:

- Core owns install, auth, account, public profile, `me.json`, and shared runtime wiring.
- Plugins own their domain routes, UI slots, permissions, data, tools, and setup state.
- Hosted-only billing, quotas, managed OAuth bridges, and ME3 Cloud operations stay outside this Core repo.

## Assistant Jobs

Assistant Jobs live in the Assistant workspace. Use the Jobs modal to add starter jobs, pause/resume them, edit schedules, run them manually, duplicate them, or remove them.

Current starter recipes:

| Recipe | State | Purpose |
| --- | --- | --- |
| Weekly Review | Ready | Summarizes projects, tasks, approvals, and carry-over choices. |
| Daily Briefing | Ready | Prepares a morning review of tasks, approvals, due items, and optional owner notification. |
| Inbox Watch | Needs setup | Watches scoped email and creates review packets; provider adapters are still setup-dependent. |
| Invoice and Receipt Triage | Needs setup | Extracts receipts/invoices from email and proposes Accounts ledger entries. |
| Booking Reminder | Needs setup | Uses calendar booking events to prepare context and follow-up tasks. |

Job rules for agents:

- Creating a job draft is review-first; saving a confirmed job is an owner action.
- Review packets and ledger entries can require owner review before becoming final.
- If a recipe says `needs_setup`, explain the missing setup rather than claiming it will run.
- Scheduled jobs use owner timezone settings where available; be explicit about dates and times.
