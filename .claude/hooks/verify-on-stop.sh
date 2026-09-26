#!/usr/bin/env bash
# Stop: before Claude finishes a turn, typecheck the frontend and verify the IPC
# surface — but only when relevant files changed. Exit 2 = keep working and fix it.
set -uo pipefail

input=$(cat)
# Don't loop forever: if we already blocked once this turn, let it stop.
[[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == "true" ]] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
changed=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u)
[[ -z "$changed" ]] && exit 0

errors=""

if grep -qE '^(src|e2e)/.*\.tsx?$|^tsconfig' <<<"$changed" && [[ -d node_modules ]]; then
  mkdir -p node_modules/.cache
  if ! out=$(npx --no-install tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsc.tsbuildinfo 2>&1); then
    errors+=$'TypeScript errors (npx tsc --noEmit):\n'"$(head -40 <<<"$out")"$'\n'
  fi
fi

if grep -qE '^(src-tauri/src/.*\.rs|src/lib/api\.ts|e2e/mockTauri\.ts)$' <<<"$changed"; then
  if ! out=$(node scripts/check-ipc.mjs 2>&1); then
    errors+="$out"$'\n'
  fi
fi

if [[ -n "$errors" ]]; then
  printf '%s' "$errors" >&2
  exit 2
fi
exit 0
