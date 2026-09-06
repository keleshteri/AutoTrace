#!/usr/bin/env bash
# Print GitHub Actions secret values for AutoTrace updater signing.
# Private key lives in .keys/ (gitignored). Public key is already in tauri.conf.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$ROOT/.keys/autotrace.key"
if [[ ! -f "$KEY" ]]; then
  echo "Missing $KEY — run: pnpm tauri signer generate -w .keys/autotrace.key -p '' --ci"
  exit 1
fi
echo "Add these repository secrets (Settings → Secrets and variables → Actions):"
echo
echo "=== TAURI_SIGNING_PRIVATE_KEY ==="
cat "$KEY"
echo
echo "=== TAURI_SIGNING_PRIVATE_KEY_PASSWORD ==="
echo "(leave empty / omit if the key was generated with an empty password)"
echo
echo "Public key is already embedded in src-tauri/tauri.conf.json"
echo "Updater endpoint: https://github.com/keleshteri/AutoTrace/releases/latest/download/latest.json"
