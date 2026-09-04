# Architecture Overview

- Shell: Tauri 2 (Rust backend, React/TS frontend)
- Storage: local SQLite, no cloud sync by default
- Tracking: foreground-window tracker (Windows first, macOS next), runs as a background/tray process
- Integrations: disabled by default; each one is opt-in and configured explicitly by the user

## Diagram

```
[OS: Win32 foreground APIs / macOS Accessibility API]
                |
                v
      [Rust tracker service]  -- session merge, idle detection, rules engine
                |
                v
         [SQLite on device]   -- sessions, apps, clients, projects, rules, settings
                |
      IPC (Tauri commands)
                |
                v
           [React UI]         -- timeline, clients/projects, reports, privacy settings
                |
     (optional, user-enabled)
                v
     [Integration adapters]   -- ClickUp / Linear / Calendar / webhooks / export
```

## Modules

- `tracker` — polls the foreground window (~1s interval), applies idle detection and the work-hours schedule.
- `store` — SQLite schema: `sessions`, `apps`, `clients`, `projects`, `tasks`, `rules`, `settings`.
- `tagger` — keyword/rules engine for mapping sessions to client/project/task; fully offline. AI-assisted tagging is a Phase 2 addition, not a dependency for MVP.
- `ui` — day timeline, CRUD for the client/project/task hierarchy, review panel, privacy controls.
- `integrations/` — pluggable adapters; empty and inert by default. Each adapter requires explicit OAuth/API-key setup and a defined data scope before it can send or receive anything.

## Data leaves the device only when

1. The user exports a CSV/report, or
2. The user explicitly enables a named integration and confirms what it's allowed to sync.

There is no other path to the network in the MVP build.
