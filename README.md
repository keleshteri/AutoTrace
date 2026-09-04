# AutoTrace

Privacy-first, fully automatic time tracker. Background capture of apps, window titles, and URLs; rules-based tagging to clients/projects; local SQLite only — **no screenshots, no keylogging, no cloud by default**.

Product docs live in [`docs/`](docs/README.md). Start with the [vision](docs/prd/vision.md), [stack decision](docs/decisions/stack-decision.md), and [MVP checklist](docs/prd/mvp.md).

## Stack

| Layer | Choice |
|---|---|
| Shell | [Tauri 2](https://tauri.app/) |
| Backend | Rust (`store`, `tracker`, `tagger`) |
| UI | React + TypeScript (Vite) |
| Data | SQLite via `rusqlite` (bundled), under the OS app-data directory |

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) stable
- Platform deps for Tauri: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)
  - **Windows**: WebView2 (usually preinstalled on Win10/11)
  - **macOS**: Xcode CLT
  - **Linux**: `webkit2gtk`, `libgtk-3`, etc.

## Develop

```bash
pnpm install
pnpm tauri:dev
```

Frontend-only (no Rust IPC):

```bash
pnpm dev
```

## Build

```bash
pnpm tauri:build
```

## Project layout

```
docs/           Product / architecture / privacy docs
src/            React UI
src-tauri/      Rust backend
  src/store/    SQLite schema + open/migrate
  src/tracker/  Foreground-window capture (stub → Windows first)
  src/tagger/   Rules engine (stub)
  src/commands.rs
.github/        CI stubs
```

## Privacy defaults

- Tracks only: app name, window/document title, URL (browsers), timestamps, idle flags
- Stored only on-device
- Integrations (ClickUp, calendar, …) are **off until the user turns each one on**
- See [docs/privacy/policy.md](docs/privacy/policy.md)

## Current phase

**Phase 0 — Foundation**: buildable Tauri shell, SQLite schema, module stubs. Capture and timeline UI land in Phase 1 (see [roadmap](docs/timeline/roadmap.md)).
