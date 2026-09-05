# Windows 10/11 — Full-day smoke test

Manual acceptance checklist for Phase 1 on **Windows 10 or 11**. Run once per release candidate before calling MVP “shipped.”

## Prerequisites

- WebView2 installed (default on modern Win10/11)
- Build: `pnpm tauri:build` → install or run the produced `.msi` / `.exe`
- Or dev: `pnpm tauri:dev` on a Windows host (not WSL-only for Win32 capture)

## Pass criteria (summary)

| Area | Pass if |
|---|---|
| Stability | App runs ≥ 8 hours without crash or tray disappearance |
| Capture | Foreground app + title logged ~every 1s when active |
| Idle | After idle threshold (default 3 min), time marked idle |
| Overhead | Idle RSS typically **&lt; 150 MB**; sustained CPU usually **&lt; 2%** (see [resource-budget.md](resource-budget.md)) |
| Privacy | No outbound network except optional update check (none in MVP) |
| UX | Pause / exclude / delete range each ≤ 3 clicks |

## Checklist

### Boot & tray

- [ ] App starts; main window opens with Calendar view
- [ ] Closing window hides to tray (tracker keeps running)
- [ ] Tray → Show restores window
- [ ] Tray → Pause stops new session accrual; Resume continues
- [ ] Tray → Quit stops process cleanly

### Capture (working day)

- [ ] Switch between 3+ apps (e.g. browser, editor, Slack); each appears on the day timeline
- [ ] Window title changes within the same app create a new or extended session appropriately
- [ ] Idle: leave machine unused past threshold → Idle block appears
- [ ] Resume activity → normal sessions resume
- [ ] Excluded app (Settings → Exclude) does not create new sessions

### Work hours & login

- [ ] Enable work hours; outside window, no new activity sessions
- [ ] Launch at login toggle persists after restart (check Task Manager → Startup)

### Tagging & review

- [ ] Create client → project → task
- [ ] Add a rule (match app or title); new matching sessions auto-tag
- [ ] Click a block → edit title/times → Save
- [ ] Split a session; merge two with Ctrl+click → Merge
- [ ] Approve a session; delete one session; redact a date range

### Reports

- [ ] Reports page shows by project / app / client for today
- [ ] Export CSV downloads and opens in Excel/Sheets with expected columns

### End of day

- [ ] Total tracked time roughly matches wall-clock work (spot-check 1–2 hours)
- [ ] SQLite file exists under `%APPDATA%\com.autotrace.app\autotrace.db` (or equivalent app-data path)
- [ ] After Quit, no orphaned `autotrace` process in Task Manager

## Recording results

Copy into a PR or release note:

```
Date:
Windows build:
Tester:
Duration run:
Idle RSS (MB):
Peak RSS (MB):
Notes / failures:
Pass / Fail:
```

## Automated helpers

From repo root (any OS), structural checks:

```bash
pnpm build
cd src-tauri && cargo test && cargo check
```

Win32 capture itself must be validated on a real Windows desktop using this checklist.
