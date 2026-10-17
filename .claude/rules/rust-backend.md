---
paths:
  - "src-tauri/**/*.rs"
---

# Rust backend rules

- **Don't block the UI thread with I/O in new code.** Plain `#[tauri::command] fn` runs on the main thread. Anything that touches the network or may take >50 ms should be `async fn` using async `reqwest`, or wrap blocking work in `tauri::async_runtime::spawn_blocking`. Never call `reqwest::blocking` inside an async context (it panics).
- **Multi-row writes go in one transaction** (`conn.transaction()` / `unchecked_transaction()`), e.g. merge/split, imports, bulk deletes. Don't call other `Store` methods that re-lock `conn` while holding the lock — `Mutex` is not reentrant and will deadlock.
- **Errors:** commands return `Result<T, String>` with `.map_err(|e| e.to_string())`. No `unwrap()`/`expect()` on user data, file I/O or network results. Error text is shown to users — say what failed and what to do.
- **SQL:** always bind parameters (`params![...]`), never `format!` values into SQL.
- **New command?** Follow the `add-tauri-command` skill; `node scripts/check-ipc.mjs` must pass.
- **Outbound network** only from an integration the user enabled; validate URLs (`https://`, or loopback via `ai::gateway::is_loopback_http_url`), set a timeout, and record it with `store.log_privacy_event`.
- **Secrets** (API keys, tokens) are encrypted with `ai::secrets::encrypt_secret` before storing and redacted (`integrations::redact_config`) before returning to the UI.
- **Tests:** add `#[cfg(test)] mod tests` beside the code. Use a unique temp dir per test (see `vault.rs` tests), never the real app-data dir.
- Keep `store/mod.rs` and `commands.rs` from growing: new domains get their own module.
