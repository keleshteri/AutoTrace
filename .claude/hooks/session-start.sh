#!/usr/bin/env bash
# SessionStart: make sure JS deps are installed so tests/typecheck work immediately
# (fresh clones and Claude Code on the web start without node_modules).
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

if [[ ! -d node_modules ]] && command -v pnpm >/dev/null; then
  if pnpm install --frozen-lockfile >/dev/null 2>&1; then
    echo "AutoTrace: installed JS dependencies (pnpm install)."
  else
    echo "AutoTrace: pnpm install failed — run it manually before tests." >&2
  fi
fi
exit 0
