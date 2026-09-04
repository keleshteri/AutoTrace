# Privacy & Integrations Policy

## Default behavior (what ships in MVP)

- Tracks only: app name, window/document title, URL (when the foreground app is a browser), timestamps, idle flags.
- Stored only on the device, in a local SQLite file.
- No account or sign-up required to use the app.
- No screenshots, no keystroke logging, no clipboard capture, no webcam/mic access — not present in the codebase, not a setting to toggle.
- Pause tracking, exclude an app/site, and delete a date range are always available and take at most a few clicks.

## Integrations (Phase 2+, all opt-in)

Examples: ClickUp, Linear, Asana, Jira, Notion, Google/Outlook Calendar, webhooks, Zapier.

Rules every integration must follow:

1. **Off by default.** No integration activates itself or syncs anything until the user turns it on.
2. **Scoped consent.** The UI states plainly what would be sent (e.g. "only approved project time entries, not raw window titles") before the user confirms.
3. **Reversible.** Disconnecting an integration stops future syncs and clears any locally stored remote IDs/tokens for it.
4. **Untagged stays local.** Personal or unassigned activity never syncs to an integration, even after one is enabled — only entries explicitly tagged to a client/project (and approved, if using confirm mode) are eligible.
5. **Prefer approved summaries over raw data.** Where the integration allows it, push the user-approved time entry (client, project, duration) rather than the raw window title/URL.

## Cloud sync / team features

Not part of MVP. If built later:

- Requires an explicit account creation step — never silently provisioned.
- Encryption approach (at minimum in-transit, ideally at-rest/E2E) documented before ship.
- Same opt-in gate as any other integration: off until the user turns it on.
