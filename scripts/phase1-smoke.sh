#!/usr/bin/env bash
# Structural Phase 1 smoke checks (does not replace Windows full-day checklist).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Frontend build =="
pnpm build

echo "== Rust check + tests =="
cd src-tauri
cargo check
cargo test
cd ..

echo "== Docs present =="
test -f docs/quality/windows-smoke-test.md
test -f docs/quality/macos-accessibility.md
test -f docs/quality/resource-budget.md

echo "OK — structural smoke passed. Run docs/quality/windows-smoke-test.md on a Windows PC for ship."
