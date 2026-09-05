#!/usr/bin/env bash
# Best-effort resource sample for a running AutoTrace process.
set -euo pipefail

NAME_PATTERN='[a]utotrace'

pids=$(pgrep -f "$NAME_PATTERN" || true)
if [[ -z "${pids}" ]]; then
  echo "No AutoTrace process found."
  echo "Start the app (pnpm tauri:dev or a release build), then re-run."
  exit 1
fi

echo "=== AutoTrace resource sample ($(date -Iseconds)) ==="
echo "PID(s): ${pids}"
echo
ps -o pid,rss,pcpu,etime,cmd -p $(echo "$pids" | tr '\n' ',' | sed 's/,$//')
echo
echo "RSS is KB. Divide by 1024 for MB."
echo "Compare against docs/quality/resource-budget.md (release builds only for ship)."
