# Backlog

See [prd/mvp.md](../prd/mvp.md) for the MVP checklist. Phases 1–4 product scope is complete; remaining items are polish / ops.

## P1 — Phase 2 (smart tagging + focus) — done

- [x] Confirm-before-log mode (Timely-style) as an alternative to full-auto
- [x] Focus time + weekly digest
- [x] Calendar integration (opt-in) — ICS import; meetings become suggested sessions
- [x] Merge/split sessions in the review panel
- [x] Optional local database encryption (at-rest vault)
- [x] Live calendar provider sync (Google / Outlook OAuth)
- [x] Break reminders

## P2 — Phase 3 integrations (all user opt-in) — done

- [x] Integration framework: per-connector permission/scope UI
- [x] ClickUp push of approved tagged entries, opt-in
- [x] Webhooks for approved time entries
- [x] Public local API (localhost, token-gated) for AutoTrace data
- [x] MCP JSON-RPC server on local API
- [x] ClickUp OAuth (plus Google / Outlook)

## P3 — teams and beyond — done (local-first)

- [x] Optional team/cloud workspace (local workspaces + sync-server)
- [x] Utilization and profitability dashboards
- [x] Client-facing PDF reports
- [x] Linux support (xdotool + Hyprland + Sway)
- [x] Distraction blocker (soft / hard)

## Ops / ship (not product gaps)

- [ ] Tag `v0.1.0` and publish GitHub Release installers
- [ ] Windows full-day smoke + resource budget numbers on release build
- [ ] Optional code signing / notarization secrets
