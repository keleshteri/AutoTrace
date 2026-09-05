# CPU / memory budget

Phase 1 success criterion (vision): the tracker runs all day with **negligible** overhead.

## Targets (desktop, release build)

| Metric | Budget | Notes |
|---|---|---|
| Idle RSS (tray, window hidden) | **≤ 120 MB** | Prefer ≤ 80 MB on Windows after warm-up |
| Active RSS (UI open, timeline visible) | **≤ 200 MB** | React webview dominates; still far below Electron norms |
| Average CPU while idle (1s poll) | **≤ 1%** of one core over 5 min | Spikes on window switch OK |
| Average CPU while UI focused | **≤ 5%** of one core | Scrolling timeline / charts |
| Disk | SQLite growth | Roughly tens of MB per heavy month of metadata only |

These are **acceptance budgets** for smoke tests, not hard OS limits.

## How to measure

### Windows

1. Build release: `pnpm tauri:build`.
2. Start AutoTrace; hide to tray; wait 2 minutes.
3. Task Manager → Details → `autotrace.exe` (or product name): note **Memory (private working set)** and CPU.
4. Sample again after 4+ hours of background use (full-day smoke test).

### macOS

1. Activity Monitor → Memory / CPU for AutoTrace.
2. Same idle vs UI-open comparison.

### Linux / WSL (dev only)

```bash
# After starting the app:
ps -o pid,rss,pcpu,cmd -C autotrace
# RSS is in KB — divide by 1024 for MB
```

Or use the helper script:

```bash
./scripts/measure-resources.sh
```

## Baseline measurement log

Recorded during Phase 1 close-out (dev/debug build on Linux where GUI available; **re-measure on Windows release** for ship sign-off):

| Date | Build | Platform | Idle RSS | Notes |
|---|---|---|---|---|
| 2026-09-05 | docs + `scripts/measure-resources.sh` | Linux (WSL) | N/A without GUI process | Procedure ready; run script while app is up |
| _TBD_ | release | Windows 11 | _fill in during [windows-smoke-test.md](windows-smoke-test.md)_ | Required for Pass |

**Rule:** Only **release** numbers on Windows (and later macOS) count toward the budgets above.

## Design choices that protect the budget

- Tauri 2 + OS webview (no bundled Chromium) — see [stack-decision.md](../decisions/stack-decision.md)
- ~1s poll on a background thread; no continuous screenshot pipeline
- SQLite locally; no sync network stack in MVP
- Close-to-tray instead of tearing down/recreating the process each show

## If over budget

1. Confirm measuring release, not `tauri dev`.
2. Check for leaked tracker threads after pause/quit.
3. Reduce UI poll intervals (status/timeline refresh) when window is hidden.
4. Profile Rust poll path (Win32 / Accessibility) for unnecessary process opens.
