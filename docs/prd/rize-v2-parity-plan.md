# AutoTrace Plan v2 — Match & Beat Rize's "New Look" Release

**Status:** Shipped (Waves Q, D, M, S, F, C, G, L1, L3) — L2 deferred
**Date:** 2026-10-17
**Inputs:** Rize "What's new" tour (11 screens, Oct 2026) + audit of current AutoTrace code
**Supersedes nothing** — extends [`rize-parity-plan.md`](rize-parity-plan.md) (Waves T/A/R/X, all shipped).

---

## 0. TL;DR

The previous plan matched Rize's **capture + timer** core. This Rize release moves the
battle to **analysis and automation**: pivot-table Tracked Time, saved Dashboards,
Reports that run on dashboards, Routines (scheduled AI jobs), @mentions in chat,
meeting transcripts, Silent mode, and an "open in browser" web app.

AutoTrace already has many of the *data* pieces (AI agent + sidecar, templates,
MCP over local API, planned sessions, capacity setting, block rules, calendar sync,
distraction report). What's missing is the **analysis layer on top**: a flexible
query engine, saved views, and a scheduler. Build that once and 5 of the 11 features
fall out of it.

**Our edge stays the same:** everything runs locally, AI is opt-in and BYO-provider,
and nothing needs an account.

---

## 1. Feature-by-feature audit

| # | Rize feature | AutoTrace today | Gap | How we beat it |
|---|---|---|---|---|
| 1 | **Unified grid layout** (sidebar groups Agent / Track / Analyze, right summary panel, bottom bar) | Sidebar is flat (`Sidebar.tsx`), `SummaryPanel.tsx` + `StatusBar.tsx` exist, pages use ad-hoc layouts | **Medium** — mostly UI polish | Same grid + a `⌘K` command palette and keyboard nav on every page |
| 2 | **Tracked Time pivot** (rows by X, columns by date, filter, heat-shaded cells, KPI cards with "vs last week", Tables/Charts/Log tabs) | `ReportsView.tsx` is **single-day only**, three fixed lists (project/app/client). No range, no pivot, no comparison | **Critical** | Pivot on *any* dimension incl. app, domain, category, billable; drill-down to raw events (Rize can't — it doesn't keep them locally) |
| 3 | **Dashboards** (save a view, sidebar pin, templates) | None | **High** | Dashboards = saved pivot JSON; exportable/importable files; also exposed via MCP |
| 4 | **Reports on dashboards** (AI summary + Highlight/Anomaly cards, run history, daily schedule) | AI templates exist (`ai-sidecar/src/graphs/template.js`) but take only `day`, no dashboard binding, no run history | **High** | Deterministic anomaly detection computed locally first, AI only writes prose (cheaper, no hallucinated numbers); "View JSON" for every run |
| 5 | **Resourcing** (planned vs tracked vs capacity, utilization, per-week load) | `planned_sessions` table, `capacity_hours_week` setting, `utilization_pct` in `ProfitView.tsx` — but no planned-vs-tracked view | **Medium** | Solo-first: "My capacity" — planned vs tracked per week, overbooking warning *before* the week starts using local plan + ClickUp estimates |
| 6 | **Routines** (scheduled AI tasks, run history, active toggle) | None — no scheduler at all | **High** | Runs on-device, can trigger non-AI actions too (export CSV, push webhook, ClickUp sync); dry-run + "what left my machine" audit per run |
| 7 | **Meetings with transcripts** (notetaker → time entries) | Calendar sync (Google/Outlook/ICS), meeting detection in `tagger/mod.rs`. No meetings page, no transcripts | **Medium** | No bot joins your call. Import transcript files (.vtt/.srt/.txt, Zoom/Meet/Teams exports) or local whisper later; tag meeting by client from transcript + attendees, locally |
| 8 | **Silent mode + simpler Focus** (blocklist as short list, top distractions in focus, week bars) | Focus timer + extend ✔, `block_rules` ✔ but buried in Settings → Distraction Blocker; distraction report ✔ in `FocusView.tsx`; **no Silent mode** | **Medium** | Silent mode auto-on during focus; inline block list on the Focus page; "top distractions *during focus*" (not whole day) |
| 9 | **Use in browser** | Local API on `127.0.0.1:17890` exists, no web UI | **Low/Medium** | Serve the same React UI from the local API — "open in browser" with zero cloud, LAN-opt-in for a second machine |
| 10 | **@mentions in AI chat** (clients, projects, dashboards, people) | `AiView.tsx` chat, quick prompts — no mentions, context is just `day` | **High** (cheap win) | Mentions resolve to exact IDs + date range sent to the agent, and show a "context chip" of exactly what data the AI will see |
| 11 | **In-app feedback / changelog / support** | `UpdatePanel.tsx` GitHub update check only | **Low** | Help menu: Docs, Report bug (prefilled GitHub issue with *opt-in* diagnostics), Feature request, "What's new" tour from release notes |

---

## 2. Architecture: build the analysis core once

```
            ┌───────────────── Query engine (Rust) ─────────────────┐
sessions ──▶│  query(range, rows_by, cols_by, filters, metric)      │──▶ Tracked Time page
events   ──▶│  → cells + totals + previous-period comparison        │──▶ Dashboards (saved query JSON)
planned  ──▶│                                                       │──▶ Reports (AI over query result)
            └───────────────────────────────────────────────────────┘──▶ MCP tool `query_time`
                                                                     ──▶ @mention context in chat
            ┌─────── Scheduler (Rust, in tracker service thread) ───┐
            │ routines(cron-ish schedule) → action: report | export │──▶ Routines page + run history
            │ | webhook | clickup_sync | ai_prompt                  │
            └───────────────────────────────────────────────────────┘
```

**Query engine (`store/query.rs`)**
- `TimeQuery { from, to, rows_by, cols_by, filters[], metric: minutes|sessions|pct, compare_previous: bool }`
- Dimensions: `client, project, task, category, app, domain, billable, workspace, date:day|week|month, weekday, hour`
- Returns `{ rows[], cols[], cells[][], row_totals, col_totals, kpis{ total, entries, daily_avg, delta_pct } }`
- One SQL builder with whitelisted dimensions (no string interpolation of user input)

**New tables**
- `dashboards (id, workspace_id, name, query_json, pinned, created_at, updated_at)`
- `reports (id, dashboard_id, name, template_slug, schedule, enabled)`
- `report_runs (id, report_id, period_from, period_to, trigger, status, result_json, ai_summary, created_at)`
- `routines (id, name, schedule, action_kind, action_json, enabled, last_run_at)`
- `routine_runs (id, routine_id, status, output, started_at, ended_at)`
- `meetings (id, calendar_event_id, title, started_at, ended_at, attendees_json, client_id, project_id, transcript, summary)`

---

## 3. Build waves

### Wave Q — Query engine + Tracked Time (P0)
| ID | Task |
|---|---|
| Q1 | `store/query.rs` engine + unit tests (empty range, DST day, cross-workspace) |
| Q2 | `run_time_query` command + `api.runTimeQuery` |
| Q3 | **Tracked Time** page: range picker (Day/Week/Month), Rows by / Columns by / Filter, heat-shaded cells, KPI row with vs-previous delta |
| Q4 | Tabs: Tables / Charts (stacked bar) / Log (raw sessions) ; h vs % toggle |
| Q5 | Row drill-down (expand → sub-dimension, click cell → sessions/events) |
| Q6 | CSV export of any pivot |

**Done when:** "hours by project per day this week, billable only, vs last week" is 3 clicks.

### Wave D — Dashboards + Reports (P0/P1)
| ID | Task |
|---|---|
| D1 | `dashboards` CRUD; "Save as dashboard" on Tracked Time; pinned under Analyze in sidebar |
| D2 | Templates: Weekly timesheet, Client breakdown, Category mix, Billable vs non-billable |
| D3 | Reports bound to a dashboard; local stats pass computes highlights + anomalies (vs baseline) |
| D4 | AI summary (opt-in provider) writes prose from the computed JSON only; store every run with "View JSON" |
| D5 | MCP tools: `list_dashboards`, `get_dashboard`, `query_time` |

### Wave M — Mentions + Agent context (P1, cheap)
| ID | Task |
|---|---|
| M1 | `@` autocomplete in chat input: clients, projects, tasks, dashboards, apps |
| M2 | Mentions → structured context (ids + query result) passed to `run_ai_agent` |
| M3 | Context chips above the input showing what the AI will see; removable |

### Wave S — Routines scheduler (P1)
| ID | Task |
|---|---|
| S1 | Scheduler loop in tracker service (minute tick, catch-up on wake, no double-run) |
| S2 | Actions: run report, AI prompt, CSV export to folder, webhook push, ClickUp sync |
| S3 | Routines page: list (schedule, delivery, last run, active toggle, run now), per-routine run history |
| S4 | Built-ins: Start of day, End of day, Weekly timesheet, Untagged cleanup |
| S5 | Every network-touching run writes to `privacy_audit_log` |

### Wave F — Focus polish + Silent mode (P1)
| ID | Task |
|---|---|
| F1 | Silent mode toggle (header + auto during focus): suppress AutoTrace notifications; optional OS DND on Win/macOS |
| F2 | Inline "Blocked during focus" short list on Focus page (reuse `block_rules`) |
| F3 | Right panel: Today's focus, This week bars, Top distractions *during focus sessions* |
| F4 | Merge Timer + Focus digest into one Focus page |

### Wave C — Capacity (P2)
| ID | Task |
|---|---|
| C1 | Planned vs Tracked vs Capacity KPIs + cumulative chart for month |
| C2 | Weekly load row with over-capacity highlight; ClickUp estimates import into planned |

### Wave G — Meetings (P2)
| ID | Task |
|---|---|
| G1 | Meetings page from synced calendar events, attend / won't attend |
| G2 | Transcript import (.vtt/.srt/.txt) → summary + client/project match (opt-in AI) |
| G3 | Auto-create tagged session for the meeting window |

### Wave L — Layout, browser, support (P2)
| ID | Task |
|---|---|
| L1 | Sidebar groups Agent / Track / Analyze; shared page grid; command palette |
| L2 | Serve built UI from local API; "Open in browser" icon on every page (localhost only by default) |
| L3 | Help menu: docs, bug report (prefilled GitHub issue), feature request, What's new tour |

---

## 4. Execution order

```
Q1–Q6  →  D1–D2  →  M1–M3  →  D3–D5  →  S1–S5  →  F1–F4  →  C  →  G  →  L
```

Q is the foundation: D, M, S and C all consume the query engine.

## 5. Non-goals (still)

- Cloud notetaker bot joining calls
- Music player
- Multi-member team analytics (Rize's member rows) — solo + workspace first; teams via existing opt-in sync later
- Any AI that runs without a user-configured provider

---

## 6. Build status (2026-10-17)

| Wave | Status | Where |
|---|---|---|
| Q — Query engine + Tracked Time | ✅ | `src-tauri/src/store/query.rs`, `src/components/TrackedTimeView.tsx`, `src/components/charts.tsx` |
| D — Dashboards + Reports | ✅ | `store/analytics.rs`, `DashboardsView.tsx`, `ReportsHubView.tsx`; MCP tools `query_time`, `list_dashboards`, `get_dashboard` |
| M — @mentions | ✅ | `mention_search` / `mention_context` / `run_ai_chat_with_context`, `AiView.tsx` |
| S — Routines scheduler | ✅ | `src-tauri/src/automation.rs` (30s tick, catch-up once), `RoutinesView.tsx` |
| F — Focus polish + Silent mode | ✅ | `focus_overview`, `FocusPanel.tsx`, Silent toggle in `TimerView.tsx` (auto during focus) |
| C — Capacity | ✅ | `capacity_report`, `CapacityView.tsx` (settings `capacity_hours_week`, `capacity_days_week`) |
| G — Meetings | ✅ | `meetings` table, transcript import (VTT/SRT/TXT), local client match, optional AI summary, `MeetingsView.tsx` |
| L1 — Grouped sidebar | ✅ | Agent / Track / Analyze, pinned dashboards nested |
| L2 — Open in browser | ⏸ Deferred | The UI calls Tauri IPC directly; serving it from the local API needs an authenticated HTTP bridge for every command. Needs its own design (token pairing, CSRF, LAN opt-in). |
| L3 — Help / feedback / What's new | ✅ | Sidebar Help menu, prefilled GitHub issues, `WhatsNew.tsx` tour |

**Schema:** v14 adds `dashboards`, `reports`, `report_runs`, `routines`, `routine_runs`, `meetings`.

**Privacy guarantees kept:**
- Report insights are computed locally; the AI only receives totals, row labels and insights — never window titles or URLs.
- Meeting transcripts are clipped to 24k chars before an (opt-in) summary.
- Routines that touch the network only use integrations/AI the user already enabled; those paths already write to the privacy audit log.
- `open_external_url` now only accepts http(s) (+ macOS settings deep link) and no longer goes through `cmd /C start` on Windows.

**Tests:** `store::query` (7), `store::analytics` (8), URL allowlist (1); e2e `e2e/analytics.spec.ts` (9) with an in-browser analytics mock (`e2e/mockAnalytics.ts`).
