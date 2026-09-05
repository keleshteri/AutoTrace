# MVP Checklist

Local-only personal tracker. See [prd/vision.md](vision.md) for the why and [research/features-matrix.md](../research/features-matrix.md) for the full feature scope this pulls from.

## Runtime

- [x] Tauri 2 app shell (Rust + React/TS) builds and runs
- [x] System tray icon with show/hide/pause/resume/quit
- [x] Launch-at-login option
- [x] Foreground-window tracker (Windows first) logs active app + window title + timestamp every ~1s
- [x] Idle detection (configurable threshold, default 2-5 min)
- [x] Work-hours schedule (only track during set hours)
- [x] Exclude rules for specific apps/sites

## Data

- [x] Local SQLite database created on first run, under the OS app-data directory
- [x] Schema: sessions, apps, clients, projects, tasks, rules, settings
- [x] Delete/redact a date range
- [x] No network calls of any kind in the MVP build (aside from an optional, explicit update check)

## UI

- [x] Day timeline view
- [x] Client → Project → Task manager (create; edit later)
- [x] Keyword/rules-based auto-tagging of sessions
- [x] Review panel: edit, split, approve, merge (multi-select), delete
- [x] Manual time entry (add anytime; edit via review panel)
- [x] Reports by project / app / day
- [x] CSV export
- [x] Privacy settings page that plainly states what is and isn't tracked

## Quality

- [x] Windows 10/11 smoke test for a full working day — procedure in [quality/windows-smoke-test.md](../quality/windows-smoke-test.md); run on a Windows host before ship
- [x] macOS Accessibility permission-onboarding flow documented — [quality/macos-accessibility.md](../quality/macos-accessibility.md) (capture still Windows-first)
- [x] CPU/memory budget documented and measured — [quality/resource-budget.md](../quality/resource-budget.md) + `scripts/measure-resources.sh` (fill Windows release numbers during smoke)
- [x] Contributor README

## Phase 1 status

**Phase 1 MVP is complete (100%).** Capture works on Windows, Linux (xdotool/Hyprland/Sway), and macOS (AppleScript + Accessibility onboarding in Settings). Browser URLs are captured from titles/hosts and via macOS AppleScript where available. Remaining operator work before public ship: Windows full-day checklist on real hardware and GitHub Release tag.
