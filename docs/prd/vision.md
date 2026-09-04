# Product Vision — AutoTrace

## One-liner

Install once. Work normally. Every session gets tracked on your own machine. Tag it to a client when you want. Connect ClickUp — or anything else — only if and when you decide to.

## Principles

1. **Local-only first.** Activity metadata (app, title, URL, timestamps) lives in a local SQLite database. Nothing leaves the device by default.
2. **Privacy by design, not by setting.** No screenshots, no keystroke logging, no clipboard capture, no webcam. These aren't togglable "off" — they don't exist in the codebase.
3. **The user owns integrations.** Every connector ships disabled. Turning one on is an explicit, scoped decision, made per-integration, not a global "sync everything" switch.
4. **Zero-friction capture.** No start/stop timer to remember. The app watches the foreground window and figures out the rest.
5. **Honest billing data without surveillance culture.** The goal is recovering forgotten billable hours, not proving to a manager that someone was "active."

## Personas

- **Freelancer** who bills hourly and hates reconstructing timesheets from memory on Friday.
- **Agency contributor** juggling multiple clients/projects a day who wants tagging automated, not manual.
- **Privacy-sensitive professional** (legal, finance, health) who has rejected every cloud-based tracker so far because "where does my data go" has no good answer.

## Success criteria for MVP

- Tracker runs all day in the background with negligible CPU/RAM overhead.
- User can generate an accurate per-project time report without any data leaving their device.
- Excluding an app, pausing tracking, or deleting a time range each take 3 clicks or fewer.
