# AutoTrace AI agents (LangGraph.js)

Opt-in local AI layer. Off by default. Keys and usage stay on-device.

## Architecture

```
React AI views  →  Tauri IPC  →  Rust AI gateway (budgets, encrypt keys, audit)
                                      │
                          ┌───────────┴────────────┐
                          ▼                        ▼
                   LangGraph sidecar         In-process LLM
                   (ai-sidecar :17991)       (fallback)
                          │
                          ▼
                   Local API tools + OpenAI/Anthropic/Ollama/LM Studio
```

## Providers

| Kind | Notes |
|---|---|
| OpenAI / Anthropic / OpenRouter | API **keys** only — not ChatGPT Plus / Claude Pro chat subscriptions |
| Ollama | Default `http://127.0.0.1:11434/v1` |
| LM Studio | Default `http://127.0.0.1:1234/v1` |
| Custom | Any OpenAI-compatible base URL |

Model **allowlists** and **day/month token + request budgets** are enforced in Rust before every call.

## Agents

1. **chat** — conversational assistant with optional local API context
2. **tracking_analyst** — day insights (focus leaks, untagged, billable gaps)
3. **template** — seeded templates: daily work report, weekly focus digest, untagged cleanup, client status email

## Sidecar

```bash
pnpm ai:sidecar:install
pnpm ai:sidecar
```

See [ai-sidecar/README.md](../../ai-sidecar/README.md).

## Privacy

- `ai_enabled` must be on
- `ai_send_titles` / `ai_send_urls` default off
- Each request is logged to `privacy_audit_log` and `ai_usage`

## Future agents (same pattern)

`rule_suggester`, `meeting_prep`, `invoice_narrative` — add a template row + graph node.
