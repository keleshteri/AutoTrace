# AutoTrace AI sidecar (LangGraph.js)

Optional local process that runs multi-agent graphs for AutoTrace.

## Run

```bash
cd ai-sidecar
npm install
npm start
# listens on http://127.0.0.1:17991
```

Or from repo root: `pnpm ai:sidecar:install` then `pnpm ai:sidecar`.

Plain Node ESM + LangGraph.js (no TypeScript build step).

Then enable AI in the app, add a provider, and tick **Sidecar** in the AI view. The Rust gateway forwards your provider API key to the sidecar, so it only does so when that toggle is on **and** the sidecar URL is loopback (`127.0.0.1`, `localhost`, `[::1]`) and `/health` succeeds. Otherwise it runs completions in-process.

## Endpoints

- `GET /health`
- `POST /v1/run` — body includes `agent`, `model`, `prompt`, `provider`, optional `local_api` token for tools

## Agents

- `chat` — LangGraph + local API session tools
- `tracking_analyst` — day analysis graph
- `template` — structured report templates
