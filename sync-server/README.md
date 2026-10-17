# AutoTrace sync server (opt-in Phase 4)

Minimal Node service for workspace sync packs. Put it behind HTTPS (e.g. Railway, Fly, Caddy).

```bash
# Local (listens on 127.0.0.1 only)
SYNC_TOKEN=$(openssl rand -hex 24) pnpm start

# Deploy: point Railway root to sync-server/ and set
#   SYNC_TOKEN=<random, 16+ chars>   (required — the server refuses to start without it)
#   HOST=0.0.0.0                     (needed inside most containers)
```

Optional: `MAX_BODY_BYTES` (default 5 MB). Only the 20 most recent packs are kept, in memory — a restart clears them.

In AutoTrace → Teams: set Sync URL to `https://your-host`, the same token, and push a pack.
