# Stack Decision — Tauri 2

## Choice

**Tauri 2**: Rust for the native tracker/backend, TypeScript + React for the UI.

## Options considered

| | Tauri 2 | Electron | .NET (Avalonia/MAUI) |
|---|---|---|---|
| Idle RAM/CPU (matters — this runs all day) | Excellent — native shell + OS webview | Poor — ships a Chromium instance | Good on Windows |
| OS integration (foreground window, Accessibility/UI Automation) | Strong via Rust/native plugins | Possible via native Node addons, heavier | C# is excellent on Windows, weaker cross-platform |
| UI development speed | Fast — React/TS, same ecosystem as any web dashboard | Fast — same | Slower — XAML has a steeper curve for rich charts/timelines |
| Bundle size | ~10-20 MB | ~150-200 MB | Medium |
| Windows + macOS support | First-class on both | First-class on both | Avalonia is workable; MAUI's Mac story is weaker |

## Why not Electron

A tray app that's supposed to sit in the background all day cannot justify a bundled Chromium process per install. That directly fights the "negligible CPU/RAM overhead" success criterion in the vision doc.

## Why not pure .NET

Excellent choice for a Windows-only monitoring tool, but AutoTrace needs macOS parity and a UI-heavy dashboard (timeline, reports, charts) where React's ecosystem is faster to build in than XAML.

## Consequences

- Windows: foreground window + idle detection via Win32 APIs, called from Rust.
- macOS: Accessibility API via Rust, with its own permission-onboarding flow (System Settings → Privacy & Security → Accessibility).
- UI: Vite + React + TypeScript, talking to the Rust backend over Tauri's IPC commands.
- DB: SQLite via `rusqlite` or `sqlx`, stored under the OS's app-data directory.
