# Roadmap

| Phase | Timeframe | Focus | Outcome | Status |
|---|---|---|---|---|
| 0 — Foundation | Weeks 1-2 | Tauri 2 scaffold, SQLite schema, docs, CI stubs | Buildable empty app, project structure locked | Done |
| 1 — MVP (local-only personal tracker) | Weeks 3-8 | Capture on Windows (+ Linux/dev), timeline UI, client/project/task tagging via rules, review/approve/merge/split, CSV export, privacy controls | Complete, useful, fully local product | **Done** |
| 2 — Smart tagging + focus | Weeks 9-14 | Rule/heuristic tagging with confidence, calendar ICS opt-in, focus score + weekly digest, confirm-before-log | Reduces manual correction, adds wellness insight | **Done** |
| 3 — Integrations | Weeks 15-22 | First PM-tool connector (ClickUp) fully opt-in, webhooks, local export API | Users who want it can push approved entries out | **Done** |
| 4 — Teams (optional) | Weeks 23+ | Cloud sync/team workspace, only for users who opt in; utilization/profitability views | Agency use case, still privacy-gated | Not started |

MVP (Phase 1) is a shippable, complete personal product on its own. Integrations and team features never block it and are never required to use the app.

## Phase 2 progress

- [x] Confirm-before-log mode + pending review queue
- [x] Tagging confidence (rules + light heuristic)
- [x] Focus score + weekly digest UI
- [x] Calendar opt-in via local ICS import → suggested sessions
- [ ] Richer ML/local model tagging (deferred — optional later)
- [ ] Live calendar sync providers (deferred — ICS remains the Phase 2 deliverable)

## Phase 3 progress

- [x] Integration framework: per-connector enable/scope UI, sync log, disconnect clears secrets
- [x] ClickUp opt-in push of approved tagged time entries
- [x] Webhooks for approved time entries
- [x] Localhost export API (token-gated, 127.0.0.1 only)
- [ ] MCP server (stretch / later)
- [ ] Live OAuth flows for ClickUp (personal API token ships first)
