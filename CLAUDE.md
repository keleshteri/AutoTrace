# AutoTrace

Privacy-first, fully automatic desktop time tracker. Captures app / window title / URL locally, tags time to clients → projects → tasks with rules, and stores everything in on-device SQLite. **No screenshots, no keylogging, no cloud by default** — every integration is opt-in.

## Stack and layout

| Path | What |
|---|---|
| `src-tauri/src/` | Rust backend (Tauri 2). `commands.rs` = every IPC command; `lib.rs` = plugin setup + `generate_handler!` |
| `src-tauri/src/store/` | SQLite via `rusqlite` (bundled). `mod.rs` queries, `schema.rs` migrations, `ai.rs` AI tables |
| `src-tauri/src/tracker/` | Background capture loop (`service.rs`), per-OS capture (`capture.rs`), browser URLs |
| `src-tauri/src/integrations/` | ClickUp, webhooks (`webhook.rs`), localhost API + MCP (`local_api.rs`) |
| `src-tauri/src/ai/` | AI gateway (budgets, providers, optional sidecar) and at-rest key encryption |
| `src-tauri/src/vault.rs` | Opt-in DB encryption (AES-256-GCM + Argon2id) |
| `src/` | React 19 + TypeScript UI (Vite). `src/lib/api.ts` = typed wrappers for every IPC call |
| `e2e/` | Playwright tests; `e2e/mockTauri.ts` mocks IPC in the browser |
| `ai-sidecar/` | Optional LangGraph.js process on 127.0.0.1:17991 (plain ESM JS) |
| `sync-server/` | Optional Node sync server for workspace packs |
| `docs/` | PRD, architecture, privacy, plans — `docs/tasks/improvement-plan.md` is the current roadmap |

## Commands

```bash
pnpm install                 # deps (SessionStart hook does this automatically)
npx tsc --noEmit             # typecheck (pnpm build runs tsc + vite build)
pnpm test:unit               # vitest (jsdom)
node scripts/check-ipc.mjs   # Rust commands ↔ lib.rs ↔ api.ts ↔ e2e mock stay in sync
cd src-tauri && cargo check --all-targets && cargo test --lib
pnpm test:e2e                # Playwright against the mocked IPC
pnpm tauri:dev               # run the desktop app
```

CI (`.github/workflows/ci.yml`) runs build + unit tests + `cargo check`/`cargo test --lib` on pushes to `main` and `claude/**`. If crates.io is unreachable in a sandbox, push and let CI compile the Rust — say so rather than claiming it was tested.

## Conventions

- **Adding an IPC command** touches four places: the `#[tauri::command]` fn, `generate_handler!` in `lib.rs`, a wrapper in `src/lib/api.ts`, and (if the UI calls it on load) a `case` in `e2e/mockTauri.ts`. Use the `add-tauri-command` skill.
- Rust commands return `Result<T, String>`; map store errors with `.map_err(|e| e.to_string())`.
- Tests: Rust unit tests live in `#[cfg(test)] mod tests` beside the code (`store/timer_tests.rs` for the store). Frontend tests are `*.test.tsx` next to the component; mock `../lib/api` with `vi.mock` and call `cleanup` in `afterEach`.
- Style: CSS variables in `src/App.css` (`--bg-*`, `--text`, `--muted`, `--accent*`, `--danger`, `--radius*`). Prefer classes over new inline `style={{}}`.
- Settings are key/value rows (`settings` table) read via `get_setting` / written via `set_feature_flag`. Keys are `[a-z0-9_]`; `schema_version`, `db_encryption`, `last_break_at` are backend-owned.
- Schema changes: add a new `MIGRATION_Vn` const in `store/schema.rs`, a matching `if current < n` step in `migrate()`, and bump `SCHEMA_VERSION`. Never edit a shipped step. Propagate errors with `?` (older steps use `let _ =`, which hides failures).

## Security invariants (do not regress)

These were fixed deliberately; the `validate-code.sh` hook and the `security-reviewer` agent check them.

1. **No shell for user data.** `open_external_url` accepts only `https://` and spawns the opener directly (`rundll32` / `open` / `xdg-open`) — never `cmd /C`, `sh -c`.
2. **Strict CSP** in `tauri.conf.json`; no `dangerouslySetInnerHTML`, `eval`, or third-party assets (fonts are bundled via `@fontsource`).
3. **Vault:** stop the tracker + local API and `store.close_file()` before encrypting; write atomically; verify before deleting plaintext; unlock happens before `Store::open` (see `VaultGate`). Keep `key_from_passphrase` byte-compatible with existing vaults.
4. **AI keys** are encrypted with the per-install key in `ai-secrets.key` (`ai/secrets.rs`, `v2:` prefix). Keys go only to the chosen provider, or to the sidecar when `ai_sidecar_enabled=1` **and** its URL is loopback.
5. **Local API:** 127.0.0.1 only, `Authorization: Bearer` only (no query tokens), constant-time compare, body size cap.
6. **Webhooks** sign with HMAC-SHA256 → `X-AutoTrace-Signature-256`.
7. **Sync:** token only over `https://` or loopback; the sync server refuses to start without `SYNC_TOKEN`.
8. **Privacy:** nothing leaves the device unless the user enabled that integration; log outbound pushes to the privacy audit (`log_privacy_event`).

## Known debt (see the improvement plan)

- IPC commands are synchronous, so network work blocks the UI thread → convert to `async` + non-blocking HTTP. Never call `reqwest::blocking` from inside an async runtime.
- UI polls every 1–4 s; prefer Tauri events for new work.
- `store/mod.rs`, `commands.rs`, `SettingsView.tsx`, `App.tsx` are oversized — put new code in new domain modules/components rather than growing them.
- Integration secrets and sync tokens are still plaintext in SQLite.
