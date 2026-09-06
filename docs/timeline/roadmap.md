# Roadmap

| Phase | Timeframe | Focus | Outcome | Status |
|---|---|---|---|---|
| 0 — Foundation | Weeks 1-2 | Tauri 2 scaffold, SQLite schema, docs, CI stubs | Buildable empty app, project structure locked | **Done** |
| 1 — MVP (local-only personal tracker) | Weeks 3-8 | Capture on Windows (+ Linux/mac), timeline UI, client/project/task tagging via rules, review/approve/merge/split, CSV export, privacy controls, browser URL capture | Complete, useful, fully local product | **Done (100%)** |
| 2 — Smart tagging + focus | Weeks 9-14 | Rule/heuristic + local ML keyword tagging, calendar ICS + live Google/Outlook sync, focus score + weekly digest, confirm-before-log, break reminders | Reduces manual correction, adds wellness insight | **Done (100%)** |
| 3 — Integrations | Weeks 15-22 | ClickUp (token + OAuth), webhooks, local export API, MCP JSON-RPC | Users who want it can push approved entries out | **Done (100%)** |
| Rize Waves T/A/R | — | Timer (pause/resume), Activity, Calendar live Tracking, categories, review tabs, keyboard | Personal product parity complete | **Done (100%)** |
| 4 — Teams + extras | — | Workspaces sync push/pull, profitability, real PDF, MCP, OAuth calendars, vault at-rest encryption, blocker soft/hard, ambient tracks, distraction score, privacy audit | Opt-in local-first expansion | **Done (100%)** |
| AI — Local agents | — | LangGraph.js sidecar, providers (API/Ollama/LM Studio), budgets, chat/analyst/templates | Opt-in AI with hard usage limits | **Done (v1)** |
| Ship — multi-OS installers | — | GitHub Actions Release (Win/Linux/macOS) + local `scripts/release-local.sh` | Downloadable assets on GitHub Releases | Ready (tag `v*`) |

MVP (Phase 1) is a shippable, complete personal product on its own. Integrations and team features never block it and are never required to use the app.

## Phase 2 progress

- [x] Confirm-before-log mode + pending review queue
- [x] Tagging confidence (rules + light heuristic)
- [x] Focus score + weekly digest UI
- [x] Calendar opt-in via local ICS import → suggested sessions
- [x] Local ML/keyword tagging banks (opt-in `ml_tagging`)
- [x] Live calendar sync providers (Google / Outlook OAuth + day sync)
- [x] Break reminders during Focus

## Phase 3 progress

- [x] Integration framework: per-connector enable/scope UI, sync log, disconnect clears secrets
- [x] ClickUp opt-in push of approved tagged time entries
- [x] Webhooks for approved time entries
- [x] Localhost export API (token-gated, 127.0.0.1 only)
- [x] MCP JSON-RPC (`initialize` / `tools/list` / `tools/call`) on local API
- [x] Live OAuth flows for ClickUp / Google / Outlook (open browser + paste code)

## Phase 4 progress

- [x] Utilization & profitability dashboards
- [x] Client PDF export (real `.pdf` bytes)
- [x] Teams workspaces + push/pull sync pack
- [x] Distraction soft/hard block + status bar notice + privacy audit
- [x] Ambient music (Space / Rain / Focus tracks)
- [x] Local MCP tools including distraction report
- [x] DB encryption at rest (vault removes plaintext)
- [x] Context-switch / distraction score on Focus view
- [x] Browser URL capture (title/host + macOS AppleScript)
- [x] Focus timer pause / resume
- [x] Billable toggle on session review
