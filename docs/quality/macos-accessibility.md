# macOS — Accessibility permission onboarding

AutoTrace’s macOS capture (Phase 1 platform parity / early Phase 2) uses the **Accessibility** API to read the frontmost application and window title. Until the user grants permission, capture will not work — the UI must explain this clearly.

Windows capture does **not** need this flow. This doc is the source of truth for the macOS onboarding copy and steps, even while Windows ships first.

## What we ask for

| Permission | Why | What we do **not** ask for |
|---|---|---|
| **Accessibility** | Read frontmost app name + window title | Screen Recording, Input Monitoring, Full Disk, Camera, Mic |

We never request Screen Recording (no screenshots), Input Monitoring (no keylogging), or clipboard access.

## User-facing steps (System Settings)

1. Open **System Settings** → **Privacy & Security** → **Accessibility**.
2. Click the lock and authenticate if required.
3. Enable **AutoTrace** in the list (or click **+** and select the app if missing).
4. If AutoTrace was already running, **quit from the menu bar** and reopen so the new grant applies.
5. Return to AutoTrace → **Settings**; status should show capture ready for macOS.

### Ventura / Sonoma / Sequoia path notes

- Older macOS: **System Preferences** → **Security & Privacy** → **Privacy** → **Accessibility**.
- If the toggle flips off after an app update, macOS often requires re-grant after a code signature change — re-add the binary via **+**.

## In-app onboarding (required UX when macOS capture ships)

Show a blocking or prominent panel on first macOS launch (and when `capture_ready == false` on macOS):

1. Short explanation: “AutoTrace needs Accessibility access to see which app you’re using — titles only, no screen recording.”
2. Primary button: **Open System Settings** (deep-link `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` when available).
3. Secondary: **I’ve enabled it — Recheck**.
4. Link to this doc / Privacy policy.

## Developer notes

- Capability is checked at runtime before the poll loop treats macOS as `capture_supported`.
- Prefer failing soft: keep the tray/UI alive; show “Permission needed” instead of crashing.
- TCC resets in development are common when the bundle id or signing identity changes.

## Test checklist (macOS)

- [ ] Fresh install → onboarding appears before useful capture
- [ ] Deny permission → app still runs; no crash; clear status message
- [ ] Grant permission → after relaunch, timeline receives sessions
- [ ] Idle detection works with Accessibility granted
- [ ] Revoke permission mid-run → next samples stop; UI reflects not ready
