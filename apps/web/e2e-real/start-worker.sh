#!/bin/sh
set -eu

worker_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../../worker" && pwd)
state_dir=$(mktemp -d "${TMPDIR:-/tmp}/me3-e2e.XXXXXX")
config="$state_dir/wrangler.toml"

# A separate config directory prevents Wrangler from loading the developer's .dev.vars.
sed "s|^main = \"src/index.ts\"|main = \"$worker_dir/src/index.ts\"|" "$worker_dir/wrangler.core.example.toml" > "$config"
cat >> "$config" <<EOF

[assets]
directory = "$worker_dir/../web/dist"
binding = "ASSETS"
run_worker_first = true
not_found_handling = "single-page-application"
EOF
ln -s "$worker_dir/migrations" "$state_dir/migrations"
export WRANGLER_LOG_PATH="$state_dir/wrangler.log"

CI=1 pnpm --dir "$worker_dir" exec wrangler d1 migrations apply DB --local --config "$config" --persist-to "$state_dir/state"
pnpm --dir "$worker_dir" exec wrangler dev --config "$config" --persist-to "$state_dir/state" --local --ip 127.0.0.1 --port 8787 --var SETUP_PASSWORD:me3-e2e-local-only --var ME3_CLOUD_API_ORIGIN:http://127.0.0.1:9999 --var CORE_WEB_ORIGIN:http://127.0.0.1:8787 --var CORE_API_ORIGIN:http://127.0.0.1:8787
