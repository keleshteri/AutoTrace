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
  - **Linux**: `webkit2gtk`, `libgtk-3`, etc. For capture while developing: `xdotool` (and optionally `xprintidle`)


## Develop

```bash
pnpm install
pnpm tauri:dev
```

Frontend-only (no Rust IPC):

```bash
pnpm dev
```

## Build (this machine only)

```bash
pnpm tauri:build
# or
pnpm release:local
```

## Downloads (Windows / Linux / macOS)

Prefer **GitHub Releases** so all three platforms are built in CI:

1. Push a version tag: `git tag v0.1.0 && git push origin v0.1.0`
2. **Actions → Release** builds NSIS/MSI, AppImage/deb, and macOS DMGs
3. Installers appear under [Releases](https://github.com/keleshteri/AutoTrace/releases)

Details: [docs/release.md](docs/release.md).

## Project layout

```
docs/           Product / architecture / privacy docs
src/            React UI (calendar, projects, reports, settings)
src-tauri/      Rust backend (store, tracker, tagger, vault, integrations)
sync-server/    Optional local-first sync helper
.github/        CI + multi-OS release workflow
scripts/        Local release helper
```

## Privacy defaults

- Tracks only: app name, window/document title, URL (browsers), timestamps, idle flags
- Stored only on-device
- Integrations (ClickUp, calendar, …) are **off until the user turns each one on**
- See [docs/privacy/policy.md](docs/privacy/policy.md)

## Current phase

**Phases 0–4 + Rize waves done** for the personal product. See [roadmap](docs/timeline/roadmap.md). Shipping: tag a release for multi-OS installers.
