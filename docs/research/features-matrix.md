# Feature Matrix → AutoTrace

Legend: **M** = MVP · **P** = Phase 2 · **L** = Later · **N** = Non-goal (won't build)

## Capture

| Feature | AutoTrace |
|---|---|
| Background desktop capture (tray/background process) | M |
| App name + window/document title | M |
| Browser URL | M |
| Idle detection (pause/merge when no input) | M |
| Work-hours schedule (only track during set hours) | M |
| Exclude rules (apps/sites never tracked) | M |
| Launch at login | M |
| Multi-monitor — track focused window only | M |
| Browser extension for richer URL capture | P |
| Screenshots | N |
| Keystroke logging | N |
| Clipboard capture | N |
| Webcam / audio capture | N |

## Categorization & timesheets

| Feature | AutoTrace |
|---|---|
| Client → Project → Task hierarchy | M |
| Keyword/rules-based auto-tagging | M |
| Daily timeline view | M |
| Review panel: edit / merge / split / approve | M |
| Manual entry (add/edit anytime) | M |
| CSV export | M |
| Confirm-before-log mode (Timely-style) | P |
| AI/ML tagging with confidence + explanation | P |
| Calendar meeting → auto session | P |

## Focus & wellness

| Feature | AutoTrace |
|---|---|
| Focus time / focus score | P |
| Break reminders | P |
| Daily/weekly digest | P |
| Distraction blocker | L |

## Teams & money

| Feature | AutoTrace |
|---|---|
| Local reports (by project/app/day) | M |
| Cloud team sync | L, opt-in |
| Utilization / profitability dashboards | L |
| Client-facing PDF reports | L |
| Built-in invoicing | L (CSV export first) |

## Integrations (all opt-in, all disabled by default)

| Feature | AutoTrace |
|---|---|
| ClickUp / Linear / Asana / Jira / Notion | L — user enables per-integration |
| Calendar (Google/Outlook) | P — user enables |
| Webhooks / public API | P — user enables |
| Zapier / MCP | L — user enables |

MVP = the smallest thing that is a complete, useful, local-only product: capture + timeline + client/project tagging + review + CSV export + privacy controls. Nothing in MVP talks to the network.
