# AutoTrace sync server (opt-in Phase 4)

Minimal HTTPS-ready Node service for workspace sync packs.

```bash
SYNC_TOKEN=secret pnpm start
# Deploy: point Railway root to sync-server/
```

In AutoTrace → Teams: set Sync URL to `https://your-host` and push a pack.
