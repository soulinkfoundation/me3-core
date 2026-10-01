# Agent Instructions

- Start every response with the wizard emoji "🧙" when working in this repo.
- Use pnpm.
- Do development directly on `main` unless the user explicitly asks for a branch.
- Never commit real secrets, `.dev.vars`, `.env`, production Cloudflare IDs, private owner data, or hosted subscription billing config.
- Keep ME3 Core, plugin-owned, and hosted-only boundaries explicit in code, docs, and examples.
- Run the narrow quality gate for the change. For web app work, run `pnpm build`.
- Follow the shared testing policy in `/Users/kieranbutler/Coding/docs/testing.md`.
- Verify git scope before staging so install-local or unrelated user work is not hidden or reverted.

## Ecosystem Source Of Truth

- Canonical high-level ecosystem docs live at `/Users/kieranbutler/Coding/docs`.
- Read `/Users/kieranbutler/Coding/docs/README.md` and `/Users/kieranbutler/Coding/docs/projects/me3-core.md` before strategic or cross-app work.
- Shared UI guidance lives at `/Users/kieranbutler/Coding/docs/design-system/README.md`.
- Durable architecture belongs in the shared docs. Actionable plans, acceptance criteria, and execution history belong in beads.

## Worker API Structure

- Keep `apps/worker/src/index.ts` for runtime wiring. Put feature routes in `routes/` and business logic beside the owning service.

## Core Updates And Releases

- Core install repositories may intentionally merge upstream stable tags. Resolve conflicts, commit the merge, and push `main`; do not rebase a completed update merge unless the user explicitly asks.
- When creating a new upstream stable tag, update Core release metadata first:
  - `me3-core.json` must have the new installed Core `version`.
  - `updates/stable.json` must set `latest.version`, `latest.tag`, `releasedAt`, `releaseNotesUrl`, and add the release to the top of `releases`.
  - Set `migrationRequired: true` when the release includes Worker/D1 migrations since the previous stable release.
- Commit and push the metadata update on `main`, then create and push the tag from that commit.
- After tagging, verify with `pnpm update:check -- --manifest-url updates/stable.json --json`.

## Landing work

- Review the staged diff, preserve unrelated work, and land only completed changes on `main`. Before pushing, run `git pull --rebase` and `bd sync`; never force-push. For a completed Core update merge in an install repository, push the verified merge without rebasing it.
- Never run destructive cleanup commands unless the user asks.
