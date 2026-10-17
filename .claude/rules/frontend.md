---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# Frontend rules

- **All IPC goes through `src/lib/api.ts`.** Never call `invoke` from a component. Add the type next to the wrapper.
- **No `window.alert` / `confirm` / `prompt` in new code.** Show inline errors (`role="alert"`) or status text (`role="status"`); destructive actions need an explicit confirm step or undo.
- **Every async view has three states:** loading, empty (with a hint on what to do next), and error (with the message and a way to retry).
- **Styling:** use the CSS tokens in `src/App.css` (`--bg-panel`, `--bg-elevated`, `--border`, `--text`, `--muted`, `--accent`, `--accent-soft`, `--danger`, `--radius`, `--radius-sm`) and add classes. Avoid new inline `style={{}}` beyond one-off layout tweaks. Never hard-code colours that exist as tokens.
- **Accessibility:** interactive things are `<button>`/`<a>`/form controls, not clickable `div`s. Every input has a `<label>` (or `aria-label`); icon-only buttons get `aria-label`; dialogs get `role="dialog"`, `aria-modal`, `aria-labelledby`, Esc-to-close, and focus management. Don't remove the `:focus-visible` outline.
- **Security:** no `dangerouslySetInnerHTML`, `eval`, `new Function`, remote scripts/fonts/images (the CSP blocks them anyway). Open links only via `api.openExternalUrl` (https only).
- **Polling:** don't add new `setInterval` polling of the backend; prefer Tauri events or refresh-on-action. If you must poll, clear the interval on unmount and keep it ≥ 2 s.
- **Tests:** `Component.test.tsx` beside the component, `vi.mock("../lib/api", ...)`, `afterEach(cleanup)`, query by role/label (not class names). Run `pnpm test:unit` and `npx tsc --noEmit`.
