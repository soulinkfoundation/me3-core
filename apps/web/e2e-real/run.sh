#!/bin/sh
# Every spec bootstraps its own owner, so each one gets its own Worker and fresh local D1
# (playwright.real.config.ts starts e2e-real/start-worker.sh per invocation).
# Usage: sh e2e-real/run.sh [spec ...]   (default: every e2e-real spec)
set -u
cd "$(dirname -- "$0")/.."
specs=${*:-$(ls e2e-real/*.spec.ts)}
failed=""
for spec in $specs; do
  name=$(basename "$spec" .spec.ts)
  echo "== $name"
  E2E_REAL_REPORT="playwright-report/real/$name" pnpm exec playwright test --config playwright.real.config.ts "$spec" || failed="$failed $name"
done
if [ -n "$failed" ]; then echo "Failed:$failed"; exit 1; fi
echo "All e2e-real specs passed."
