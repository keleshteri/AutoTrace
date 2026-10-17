#!/usr/bin/env bash
# PostToolUse (Write|Edit): deterministic guardrails for AutoTrace's security invariants.
# Exit 2 sends the message back to Claude so it fixes the edit; exit 0 otherwise.
set -uo pipefail

input=$(cat)
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' <<<"$input")
[[ -z "$file" || ! -f "$file" ]] && exit 0

root=${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)}
rel=${file#"$root"/}
problems=()

check() { # pattern message
  local hits
  hits=$(grep -nE "$1" "$file" 2>/dev/null | head -5)
  [[ -n "$hits" ]] && problems+=("$2"$'\n'"$hits")
}

case "$rel" in
  src-tauri/src/*.rs)
    check 'Command::new\("(cmd|sh|bash|powershell|pwsh)"\)' \
      "Never route data through a shell (command injection). Pass args directly; see open_external_url."
    check 'access_token=' \
      "Local API tokens are header-only (Authorization: Bearer). Don't accept or build ?access_token= URLs."
    check 'danger_accept_invalid_(certs|hostnames)' \
      "Never disable TLS verification."
    check '"X-AutoTrace-Signature"' \
      "Webhooks sign with HMAC in X-AutoTrace-Signature-256 (hmac_sha256), not the old header."
    ;;
  src/*.ts|src/*.tsx|e2e/*.ts)
    check 'dangerouslySetInnerHTML|[^.[:alnum:]_]eval\(|new Function\(' \
      "No dangerouslySetInnerHTML / eval / new Function — the webview can reach privileged IPC."
    check 'fonts\.googleapis|fonts\.gstatic' \
      "No third-party font/CDN requests; bundle assets locally (privacy-first, strict CSP)."
    ;;
  src-tauri/tauri.conf.json)
    check '"csp": *null' "Keep a strict CSP in tauri.conf.json; csp must not be null."
    ;;
  sync-server/*.js)
    check "if \(!TOKEN\) return true" "The sync server must require SYNC_TOKEN."
    ;;
esac

if ((${#problems[@]})); then
  printf 'AutoTrace guardrail (%s):\n' "$rel" >&2
  printf -- '- %s\n' "${problems[@]}" >&2
  exit 2
fi
exit 0
