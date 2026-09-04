# MVP Checklist

Local-only personal tracker. See [prd/vision.md](vision.md) for the why and [research/features-matrix.md](../research/features-matrix.md) for the full feature scope this pulls from.

## Runtime

- [x] Tauri 2 app shell (Rust + React/TS) builds and runs
- [ ] System tray icon with show/hide/pause/resume/quit
- [ ] Launch-at-login option
- [ ] Foreground-window tracker (Windows first) logs active app + window title + timestamp every ~1s
- [ ] Idle detection (configurable threshold, default 2-5 min)
- [ ] Work-hours schedule (only track during set hours)
- [ ] Exclude rules for specific apps/sites

## Data

- [x] Local SQLite database created on first run, under the OS app-data directory
- [x] Schema: sessions, apps, clients, projects, tasks, rules, settings
- [ ] Delete/redact a date range
- [x] No network calls of any kind in the MVP build (aside from an optional, explicit update check)

## UI

- [ ] Day timeline view
- [ ] Client → Project → Task manager (create/edit)
- [ ] Keyword/rules-based auto-tagging of sessions
- [ ] Review panel: edit, merge, split, approve a session's tag
- [ ] Manual time entry (add/edit anytime)
- [ ] Reports by project / app / day
- [ ] CSV export
- [ ] Privacy settings page that plainly states what is and isn't tracked

## Quality

- [ ] Windows 10/11 smoke test for a full working day
- [ ] macOS Accessibility permission-onboarding flow documented (even if capture ships Windows-first)
- [ ] CPU/memory budget documented and measured
- [x] Contributor README
