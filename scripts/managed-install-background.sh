#!/usr/bin/env bash
# Lets a provisioning step hand work to the background so the next steps overlap it.
#
#   start NAME COMMAND...  runs COMMAND in the background, keeping its output and exit status
#   wait NAME...           waits for each task, prints its output, and fails if any failed
#   settle NAME...         waits for whichever of the tasks were started, ignoring how they ended
#
# Background processes outlive their step on GitHub runners, so a later step can wait for them.
set -euo pipefail

dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/me3-background"
timeout_seconds="${ME3_BACKGROUND_TIMEOUT_SECONDS:-900}"
mkdir -p "$dir"

valid_name() {
  [[ "$1" =~ ^[a-z0-9-]+$ ]] || { echo "invalid background task name" >&2; exit 2; }
}

# Prints the task's output and returns its exit status; 124 when it never finished.
finish() {
  local name="$1" waited=0 status
  until [ -f "$dir/$name.status" ]; do
    if [ "$waited" -ge "$timeout_seconds" ]; then
      echo "::error::$name did not finish within ${timeout_seconds}s"
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "::group::$name"
  cat "$dir/$name.log"
  echo "::endgroup::"
  status="$(cat "$dir/$name.status")"
  [ "$status" = 0 ] || echo "::error::$name failed with exit status $status"
  return "$status"
}

command="${1:-}"
shift || true
case "$command" in
  start)
    name="${1:-}"
    valid_name "$name"
    shift
    [ "$#" -gt 0 ] || { echo "start needs a command" >&2; exit 2; }
    [ ! -e "$dir/$name.log" ] || { echo "$name was already started" >&2; exit 2; }
    : > "$dir/$name.log"
    # The task keeps none of the step's output open, or the runner would wait for it to end.
    (
      set +e
      "$@" >> "$dir/$name.log" 2>&1
      echo "$?" > "$dir/$name.status.tmp"
      mv "$dir/$name.status.tmp" "$dir/$name.status"
    ) < /dev/null > /dev/null 2>&1 &
    ;;
  wait)
    [ "$#" -gt 0 ] || { echo "wait needs a task name" >&2; exit 2; }
    failed=0
    for name in "$@"; do
      valid_name "$name"
      if [ ! -e "$dir/$name.log" ]; then
        echo "::error::$name was never started"
        failed=1
        continue
      fi
      finish "$name" || failed=1
    done
    exit "$failed"
    ;;
  settle)
    for name in "$@"; do
      valid_name "$name"
      [ -e "$dir/$name.log" ] || continue
      finish "$name" || true
    done
    ;;
  *)
    echo "usage: managed-install-background.sh start NAME COMMAND... | wait NAME... | settle NAME..." >&2
    exit 2
    ;;
esac
