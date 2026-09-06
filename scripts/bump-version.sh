#!/usr/bin/env bash
# Bump AutoTrace version in package.json, tauri.conf.json, and Cargo.toml.
#
# Usage:
#   ./scripts/bump-version.sh              # interactive: major / minor / patch / custom
#   ./scripts/bump-version.sh patch        # non-interactive
#   ./scripts/bump-version.sh minor
#   ./scripts/bump-version.sh major
#   ./scripts/bump-version.sh 0.2.0        # set exact version
#   pnpm release:bump
#   pnpm release:bump -- patch

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PKG="$ROOT/package.json"
TAURI="$ROOT/src-tauri/tauri.conf.json"
CARGO="$ROOT/src-tauri/Cargo.toml"

if [[ ! -f "$PKG" || ! -f "$TAURI" || ! -f "$CARGO" ]]; then
  echo "error: expected package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml"
  exit 1
fi

CURRENT="$(node -p "require('./package.json').version")"
if [[ ! "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]]; then
  echo "error: current version looks invalid: $CURRENT"
  exit 1
fi

# Strip prerelease/build for arithmetic (0.1.0-beta → 0.1.0)
BASE="${CURRENT%%[-+]*}"
IFS='.' read -r MAJOR MINOR PATCH <<<"$BASE"
MAJOR="${MAJOR:-0}"
MINOR="${MINOR:-0}"
PATCH="${PATCH:-0}"

bump_kind="${1:-}"

ask_kind() {
  echo "Current version: v${CURRENT}"
  echo ""
  echo "What kind of release?"
  echo "  1) patch   (${MAJOR}.${MINOR}.$((PATCH + 1)))  — bug fixes"
  echo "  2) minor   (${MAJOR}.$((MINOR + 1)).0)  — new features"
  echo "  3) major   ($((MAJOR + 1)).0.0)  — breaking changes"
  echo "  4) custom  — type exact version (e.g. 0.2.0)"
  echo ""
  read -r -p "Choose [1/2/3/4] (default 2=minor): " choice
  case "${choice:-2}" in
    1|p|patch) bump_kind="patch" ;;
    2|n|minor) bump_kind="minor" ;;
    3|M|major) bump_kind="major" ;;
    4|c|custom)
      read -r -p "New version (no leading v): " custom
      bump_kind="$custom"
      ;;
    *)
      echo "error: invalid choice"
      exit 1
      ;;
  esac
}

if [[ -z "$bump_kind" ]]; then
  if [[ -t 0 ]]; then
    ask_kind
  else
    echo "error: non-interactive shell — pass patch|minor|major|X.Y.Z"
    echo "example: ./scripts/bump-version.sh minor"
    exit 1
  fi
fi

case "$bump_kind" in
  patch) NEW="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  minor) NEW="${MAJOR}.$((MINOR + 1)).0" ;;
  major) NEW="$((MAJOR + 1)).0.0" ;;
  *)
    NEW="${bump_kind#v}"
    if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
      echo "error: invalid version '$bump_kind' (use patch|minor|major or X.Y.Z)"
      exit 1
    fi
    ;;
esac

if [[ "$NEW" == "$CURRENT" ]]; then
  echo "Version is already ${CURRENT} — nothing to do."
  exit 0
fi

echo "Bumping ${CURRENT} → ${NEW}"

# package.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = process.argv[1];
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
" "$NEW"

# tauri.conf.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
p.version = process.argv[1];
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(p, null, 2) + '\n');
" "$NEW"

# Cargo.toml — only the [package] version line
python3 - <<PY
from pathlib import Path
new = "${NEW}"
path = Path("src-tauri/Cargo.toml")
lines = path.read_text().splitlines(keepends=True)
out = []
in_package = False
done = False
for line in lines:
    stripped = line.strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        in_package = stripped == "[package]"
    if not done and in_package and stripped.startswith("version"):
        out.append(f'version = "{new}"\n')
        done = True
        continue
    out.append(line)
if not done:
    raise SystemExit("error: could not find version under [package] in Cargo.toml")
path.write_text("".join(out))
PY

echo ""
echo "Updated:"
echo "  package.json                 → ${NEW}"
echo "  src-tauri/tauri.conf.json    → ${NEW}"
echo "  src-tauri/Cargo.toml         → ${NEW}"
echo ""
echo "Next steps:"
echo "  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml"
echo "  git commit -m \"chore: release v${NEW}\""
echo "  git push origin main"
echo "  git tag v${NEW}"
echo "  git push origin v${NEW}"
echo ""
echo "Then open: https://github.com/keleshteri/AutoTrace/actions"
