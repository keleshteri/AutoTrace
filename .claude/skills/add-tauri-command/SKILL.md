---
name: add-tauri-command
description: Add or change an AutoTrace IPC command end to end — Rust #[tauri::command], registration in lib.rs generate_handler!, typed wrapper in src/lib/api.ts, e2e mock, and tests. Use whenever a UI feature needs new backend data or actions, or when renaming/removing a command.
---

# Add a Tauri IPC command

A command lives in four places. Missing one fails only at runtime ("command not found" or a hung e2e test), so do all four, then run the checks.

## 1. Rust: the command

Put it in `src-tauri/src/commands.rs`, or, for a new domain, a new module with a thin command in `commands.rs` that calls into it.

```rust
#[tauri::command]
pub fn thing_summary(state: State<'_, AppState>, day: String) -> Result<ThingSummary, String> {
    state.store.thing_summary(&day).map_err(|e| e.to_string())
}
```

- Arguments arrive camelCase from JS and are converted to snake_case automatically (`dayCount` → `day_count`).
- Return `Result<T, String>` where `T: serde::Serialize`.
- **Network or slow I/O?** Make it `pub async fn` and use async `reqwest` (or `tauri::async_runtime::spawn_blocking` around blocking work) so the UI thread isn't blocked. Never use `reqwest::blocking` inside async code.
- Validate inputs at this boundary (URLs, keys, sizes). See `validate_external_url` and `check_setting_write` for the pattern.
- Store logic goes in `src-tauri/src/store/` with SQL parameters bound via `params![]`, and in a transaction if it writes several rows.

## 2. Register it

Add `commands::thing_summary,` to `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.

## 3. Frontend wrapper

In `src/lib/api.ts`, add the type (if new) and a wrapper inside the `api` object:

```ts
thingSummary: (day: string) => invoke<ThingSummary>("thing_summary", { day }),
```

Components call `api.thingSummary(...)`, never `invoke` directly. Mirror Rust field names in snake_case in the TS type; that's what serde emits.

## 4. e2e mock

If any view calls the command on load, add a `case "thing_summary":` returning realistic data in `e2e/mockTauri.ts`. Otherwise the Playwright mock logs "unhandled command" and returns `null`.

## 5. Tests

- Rust: a `#[cfg(test)]` test for the store function or validator (`cargo test --lib`).
- UI: if a component uses it, mock it in that component's test: `vi.mock("../lib/api", () => ({ api: { thingSummary: vi.fn() } }))`.

## 6. Verify

```bash
node scripts/check-ipc.mjs     # all four places agree
npx tsc --noEmit
pnpm test:unit
cd src-tauri && cargo check --all-targets && cargo test --lib
```

When removing or renaming a command, `check-ipc.mjs` lists every leftover reference.
