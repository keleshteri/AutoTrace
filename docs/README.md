# AutoTrace

**AutoTrace** is a privacy-first, fully automatic time tracker in the vein of Rize: background capture of apps/window titles/URLs, rules-based (later AI-assisted) tagging to clients/projects, focus insights — **local-only by default**, no screenshots, no keylogging.

## Where to look

| Folder | Purpose |
|---|---|
| [research/](research/) | Competitor study (Rize, Timely, Memtime, RescueTime, Toggl, Hubstaff) and the resulting feature matrix |
| [prd/](prd/) | Product vision and MVP checklist |
| [architecture/](architecture/) | System design and module breakdown |
| [decisions/](decisions/) | Locked decisions and the stack-choice rationale |
| [privacy/](privacy/) | What's tracked, what never is, and how opt-in integrations work |
| [timeline/](timeline/) | Phased roadmap |
| [tasks/](tasks/) | Backlog beyond MVP |

## Start here

1. [prd/vision.md](prd/vision.md) — what we're building and why
2. [decisions/stack-decision.md](decisions/stack-decision.md) — why Tauri 2
3. [privacy/policy.md](privacy/policy.md) — the privacy model, including how integrations stay opt-in
4. [prd/mvp.md](prd/mvp.md) — what ships first

## Decision snapshot

| Topic | Decision |
|---|---|
| Stack | **Tauri 2** (Rust tracker + TypeScript/React UI) |
| Data | **Local-only first** — SQLite on device, nothing leaves without explicit opt-in |
| Integrations | Optional (ClickUp, Linear, calendar, ...) — each one off until the user turns it on |
| Platforms v1 | Windows 10/11 first, macOS next |
| Non-goals | Screenshots, keystroke logging, clipboard capture, surveillance-by-default |

See [decisions/locked-decisions.md](decisions/locked-decisions.md) for the short version.
