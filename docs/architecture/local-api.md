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

## Webhook signatures

When a webhook secret is set, each POST carries
`X-AutoTrace-Signature-256: sha256=<hex HMAC-SHA256(secret, raw request body)>`.
Verify it against the raw bytes before parsing, using a constant-time compare:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header?.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

(Builds before September 2026 sent `X-AutoTrace-Signature` = `sha256(secret ‖ body)`; that header is gone.)
