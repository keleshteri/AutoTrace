# Improvement plan: quality, UI/UX, reliability

_Written after the September 2026 security and correctness pass. Covers what that pass fixed, what's still open, and a phased plan to make AutoTrace feel polished._

Sizes: **S** ≈ ½ day · **M** ≈ 1–3 days · **L** ≈ 1–2 weeks.

---

## 1. Fixed in this pass

| Area | Problem | Fix |
|---|---|---|
| CI | `tsc` failed (bad import in `TimerView.test.tsx`), so `pnpm build` was red; unit tests never ran in CI | Import fixed; CI runs `vitest` and `cargo test --lib`, caches Rust, and runs on `claude/**` pushes |
| Security | `open_external_url` ran `cmd /C start <url>`, allowing command injection on Windows; no CSP | https-only validation, `rundll32` without a shell, strict CSP (+ dev CSP) |
| Privacy | Google Fonts loaded on every launch | Plus Jakarta Sans bundled via `@fontsource` |
| Data safety | Vault lock copied and deleted a DB that was still open; no startup unlock; unlock overwrote a live DB | Tracker/API stopped and connection closed first, atomic writes, verify-before-delete, launch-time unlock screen (`VaultGate`), 4 Rust tests |
| Security | AI provider key + local API token sent to anything answering on `127.0.0.1:17991` | Sidecar is opt-in (toggle in AI view) and loopback-only |
| Security | `set_feature_flag` could overwrite any setting | Key validation + protected keys + loopback check for `ai_sidecar_url` |
| Security | Webhook signature was `sha256(secret‖body)` (length extension) | HMAC-SHA256 in `X-AutoTrace-Signature-256` (RFC 4231-tested) |
| Security | Local API accepted `?access_token=`, non-constant-time compare, unbounded body | Header-only bearer, constant-time compare, 1 MB cap |
| Security | Sync server allowed everything without `SYNC_TOKEN`, bound all interfaces, unbounded | Token required (16+ chars), loopback by default, 5 MB cap, JSON-only, keeps the newest 20 packs; app refuses to send the token over plain http |
| Security | AI keys "encrypted" with a key derived from the DB path | Random per-install key file (`ai-secrets.key`, 0600); legacy values still readable |
| AI | No UI to add a provider or budget, so AI could not actually be used | **AI → Providers** panel: providers, test, model allow-list, daily/monthly limits, usage |
| AI | Claude replies could come back empty (`content[0]` may be a thinking block); retired default model; sidecar sent `temperature` | Text blocks joined, refusals surfaced, default `claude-opus-5`, sidecar omits sampling params |
| UI | `--text` token was used but undefined; no visible keyboard focus | Token defined; global `:focus-visible` ring |

> **Breaking for integrators:** webhook receivers must verify `X-AutoTrace-Signature-256` (HMAC) instead of `X-AutoTrace-Signature`. Local API clients must send `Authorization: Bearer <token>`; `?access_token=` no longer works. The sync server won't start without `SYNC_TOKEN`.

---

## 2. Still open: correctness and architecture (do before new features)

1. **Blocking commands freeze the UI (M, high impact).** Every `#[tauri::command]` is synchronous, so Tauri runs it on the main thread. Network calls (sync push/pull, OAuth exchange, calendar sync, update check, AI runs up to 120 s, webhook/ClickUp push) freeze the window while they run. Convert these to `async fn` with async `reqwest`, or wrap the blocking work in `tauri::async_runtime::spawn_blocking`. Don't just add `#[tauri::command(async)]` around `reqwest::blocking`: blocking reqwest panics inside a Tokio worker.
2. **Polling → events (M).** `App.tsx` polls status every 2 s and sessions + hierarchy + digest every 4 s; `ActivityView` polls every 4 s; four 1-second tickers re-render the root. Emit Tauri events from the tracker (`session-changed`, `status-changed`, `focus-changed`) and keep one shared 1 s clock in context. Less CPU and battery, and the UI updates instantly.
3. **Split the god files (L, incremental).** `store/mod.rs` has 3.3k lines, `commands.rs` 1.7k, `SettingsView.tsx` 1.6k and `App.tsx` 900. Split by domain (`store/{sessions,focus,planning,integrations,workspaces,reports}.rs`, `commands/{…}.rs`, `settings/*Panel.tsx`), and move App state into a few hooks (`useTrackerStatus`, `useDay`, `useFocus`).
4. **Transactions (S).** `import_sync_pack`, merge/split sessions and multi-row deletes should run in one SQLite transaction, so a failure can't leave half-applied changes. `import_sync_pack` also re-reads the whole hierarchy per row (O(n²)).
5. **Typed IPC (M).** `api.ts` hand-writes 150+ command signatures that can drift from Rust. Generate them with `tauri-specta`, or at least add a CI test comparing the `generate_handler!` list with `api.ts`.
6. **Test coverage (ongoing).** Rust tests now cover the vault, secrets, HMAC, URL and settings guards, and local API helpers. Add tests for the tagger rules, session merge/split, schema migrations (open an old DB fixture and migrate it), and profitability math. Grow the Playwright e2e suite past the timer (review queue, tagging, export).
7. **Store integration secrets like AI keys (S).** Sync tokens (`workspaces.sync_token`) and integration `config_json` secrets (ClickUp, webhook, OAuth refresh tokens) are still plaintext in SQLite. Reuse `ai::secrets`. Longer term, move all secrets to the OS keychain (`keyring` crate).
8. **Mutex poisoning (S).** `expect("store mutex poisoned")` everywhere means one panic in any command kills every later DB call. Recover with `lock().unwrap_or_else(|e| e.into_inner())`, or add a poisoned-state error that the UI can show.
9. **Migrations swallow errors (S).** From V3 on, `store/schema.rs::migrate` runs `let _ = conn.execute_batch(MIGRATION_Vn)` and then bumps `schema_version` anyway, so a failed migration is silently marked done. Run each step in a transaction, propagate the error, and add a test that migrates an old DB fixture.
10. **Sidecar authentication (S).** Now opt-in and loopback-only. For defence in depth, have the app launch the sidecar itself with a per-launch shared secret, so a squatting process can't impersonate it.

---

## 3. UI/UX plan

### Phase A: foundations (1–2 weeks)

| # | Item | Why | Size |
|---|---|---|---|
| A1 | **Design tokens + component kit.** Replace ~227 inline `style={{…}}` with a small set of primitives (`Button`, `Field`, `Card`, `Toggle`, `Modal`, `Tabs`, `EmptyState`, `Toast`) built on the existing CSS variables. | Consistency, less CSS drift, faster feature work | M |
| A2 | **Toasts instead of `alert()`/`confirm()`.** 10 native dialogs block the window and look foreign. Use non-blocking toasts plus an accessible confirm modal (focus trap, Esc, danger styling). | Feels native; no frozen UI | S |
| A3 | **Error model.** The single global `error` string is overwritten by each poll. Show per-view inline errors, "retry" actions, and human wording (map Rust errors to friendly text). | Users see what failed and what to do | M |
| A4 | **Loading and empty states.** Only one component has a loading state. Add skeletons for Calendar/Activity/Reports and helpful empty states ("No tracked time yet — AutoTrace records automatically while you work. Check permissions →"). | First-run clarity | S |
| A5 | **Accessibility pass.** Only 29 `aria-*` attributes; 7 clickable `div`/`span`/`li`s; modals lack `role="dialog"` focus management. Make everything keyboard-reachable, label icon buttons, trap focus in modals. | Required for a pro tool; helps everyone | M |
| A6 | **Light theme + system theme.** The app is dark-only. Add a light token set and follow `prefers-color-scheme`, with a manual override in Settings. | Common request; daytime readability | S |

### Phase B: first-run and daily flow (1–2 weeks)

| # | Item | Why | Size |
|---|---|---|---|
| B1 | **Onboarding wizard** (first launch): what's tracked and what isn't → OS permissions (macOS Accessibility, Linux `xdotool`) with a live check → work hours → create a first client/project, or import from ClickUp → optional starter rules. | Today a new user lands in an empty calendar with no guidance | M |
| B2 | **Permission health banner.** If capture isn't ready (`capture_ready=false`), show a persistent banner with the exact fix for this OS. | Silent "nothing tracked" is the #1 churn risk for trackers | S |
| B3 | **Review inbox.** One place for untagged time, pending confirm-before-log items and calendar suggestions, with bulk actions (tag, merge, approve) and keyboard shortcuts (J/K to move, T to tag, A to approve). | Daily review becomes a 60-second habit | M |
| B4 | **Command palette (⌘/Ctrl-K).** Jump to views, start focus/meeting/break, tag the current session, switch workspace. | Fast power-user path; discoverability | S |
| B5 | **Tray upgrades.** Show the current session + timer in the tray menu/tooltip, and quick-tag recent projects from the tray. Add a small always-on-top mini timer window (optional). | Most interaction happens without opening the main window | M |
| B6 | **Native notifications** (`tauri-plugin-notification`) for break reminders, planned-session due, budget warnings and sync failures, respecting OS Do-Not-Disturb. | Reminders work when the window is hidden | S |

### Phase C: insight and polish (2–3 weeks)

| # | Item | Why | Size |
|---|---|---|---|
| C1 | **Reports redesign.** Consistent charts (one palette, accessible colours, hover values), week/month comparisons, per-client trends, saved report presets, and one-click CSV/PDF from any report. | Reports are what users pay for | L |
| C2 | **Rules editor UX.** Live preview ("this rule would tag 14 sessions from the last 7 days"), rule ordering by drag, conflict warnings, suggestions from repeated manual tagging. | Better auto-tagging means less manual work | M |
| C3 | **Settings information architecture.** `SettingsView` is 1.6k lines of mixed concerns. Regroup as General · Tracking & privacy · Focus & breaks · Calendar · Integrations · AI · Data (export, encryption, delete) · About/updates, with search. | Findability | M |
| C4 | **Data control centre.** In one place: storage size, export everything (JSON/CSV), delete a range, encryption status, privacy audit log, what each integration can see. | Reinforces the privacy-first promise | S |
| C5 | **AI in context.** Beyond the chat page: "Summarize this day" on the calendar, "Suggest a project" on untagged blocks, and a weekly report draft in Reports. Always show which provider and how many tokens it used. | AI where the work is, with transparency | M |
| C6 | **Micro-interactions.** Optimistic updates for tagging/approving, undo toasts (instead of confirms) for deletes, subtle transitions, and remember the last view, date and filters. | Feels fast and forgiving | S |

---

## 4. Ops and release recommendations

- **Code signing + notarization** (Windows Authenticode, Apple notarization). Unsigned trackers trigger SmartScreen and Gatekeeper warnings and look like malware to users. Highest-leverage trust item before a public release.
- **Crash + error reporting (opt-in, local-first).** Write panics to a local log with a "copy diagnostics" button. Never send data automatically.
- **Release checklist in CI:** `cargo clippy -D warnings`, `cargo fmt --check`, `eslint` + `prettier --check`, Playwright e2e, and `cargo audit` / `pnpm audit` on a schedule.
- **Resource budget** (already in `docs/quality/resource-budget.md`): measure after moving from polling to events, and add a CI smoke test that fails on regressions.
- **Backups:** automatic daily SQLite backup (`VACUUM INTO`) with retention, restorable from Settings. Include `ai-secrets.key` with it, or re-enter AI keys after a restore.
- **Docs:** `docs/architecture/local-api.md` now documents header-only auth and webhook verification. Keep the in-app integration help text in sync when either changes.

---

## 5. Suggested order

1. §2.1 async commands + §2.2 events (biggest felt-performance win).
2. Phase A (A2, A3, A4 first; they're small and visible).
3. B1 onboarding + B2 permission banner + B3 review inbox.
4. §2.3 file splits alongside the Phase B work that touches those files.
5. Signing/notarization, then tag a public release.
6. Phase C.
