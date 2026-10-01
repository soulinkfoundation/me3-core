# ME3 real site journey

Run `pnpm --filter @me3/web test:e2e:real` from the repository root. It creates a new local D1 state in the operating system's temporary directory, starts a Worker with the example configuration (away from `.dev.vars`), and runs the real web app against it. Each run creates its own owner and profile; the local state is disposable.

The test creates and restores a wizard draft, publishes it through the Worker, then reads the public HTML and `me.json` from a fresh signed-out browser. Review `apps/web/playwright-report/real/index.html` and its `published-profile` attachment. The HTML report includes the trace; do not share it beyond the development team without inspecting it for private data.
