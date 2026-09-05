# Local export API (Phase 3)

Opt-in HTTP API bound to **127.0.0.1 only**. Disabled until you enable **Integrations → Local export API**, set a bearer token, and save.

## Auth

```
Authorization: Bearer <token>
```

Requests without a valid token receive `401`. An empty token refuses all traffic.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` or `/v1/health` | Liveness |
| GET | `/v1/sessions?day=YYYY-MM-DD` | Approved + tagged entry summaries (optional day filter) |
| GET | `/v1/export/YYYY-MM-DD` | CSV of eligible summaries for that day |

Payloads never include raw window titles or URLs — only client/project/task labels, duration, and optional notes.

Default port: **17890** (`http://127.0.0.1:17890`).
