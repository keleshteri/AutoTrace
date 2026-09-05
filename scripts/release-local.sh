#!/usr/bin/env bash
# Build AutoTrace installers for the current machine (local).
# For multi-OS artifacts, push a version tag and let GitHub Actions build all platforms.
#
# Usage:
#   ./scripts/release-local.sh           # release build for this OS
#   ./scripts/release-local.sh --debug  # faster debug bundle

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="--release"
if [[ "${1:-}" == "--debug" ]]; then
  MODE=""
fi

echo "==> Installing frontend deps"
pnpm install

echo "==> Building AutoTrace (Tauri)"
if [[ -n "$MODE" ]]; then
  pnpm tauri build
else
  pnpm tauri build --debug
fi

BUNDLE="$ROOT/src-tauri/target/release/bundle"
if [[ "${1:-}" == "--debug" ]]; then
  BUNDLE="$ROOT/src-tauri/target/debug/bundle"
fi

echo ""
echo "==> Done. Look for installers under:"
echo "    $BUNDLE"
echo ""
if [[ -d "$BUNDLE" ]]; then
  find "$BUNDLE" -type f \( -name '*.exe' -o -name '*.msi' -o -name '*.dmg' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) -print 2>/dev/null || true
fi
echo ""
echo "To publish all platforms via GitHub:"
echo "  git tag v0.1.0 && git push origin v0.1.0"
echo "  → Actions → Release workflow uploads assets to GitHub Releases"
