---
name: release
description: Cut an AutoTrace release — pick the semver bump, update versions, draft release notes, verify, and (only after explicit confirmation) tag to trigger the multi-OS GitHub Release workflow.
disable-model-invocation: true
argument-hint: "[patch|minor|major|X.Y.Z]"
---

# Release AutoTrace

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds Windows, Linux and macOS installers and publishes a GitHub Release that the in-app updater picks up. **Treat the tag push as publishing: confirm with the user before it.**

## 1. Pre-flight

- Must be on `main`, up to date with `origin/main`, clean working tree, and CI green on the head commit.
- Run the local checks:
  ```bash
  node scripts/check-ipc.mjs && npx tsc --noEmit && pnpm test:unit && pnpm build
  (cd src-tauri && cargo test --lib)
  ```

## 2. Choose the version

Use `$ARGUMENTS` if given. Otherwise read `git log $(git describe --tags --abbrev=0)..HEAD --oneline` and propose one:
- **patch**: fixes only
- **minor**: new features, backward compatible
- **major**: breaking changes to data, the local API or MCP, the webhook format, or the sync protocol

Anything that changes what integrators must do (auth, headers, payloads) is at least **minor** and must be called out.

## 3. Bump

```bash
./scripts/bump-version.sh <patch|minor|major|X.Y.Z>
(cd src-tauri && cargo check)   # refreshes the autotrace version in Cargo.lock
```

This updates `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Commit them with `Cargo.lock`.

## 4. Release notes

Draft from the commit log, grouped as **Highlights · Fixes · Security · Breaking / action needed · Known issues**. Write for users, not developers. Include the "action needed" steps for integrators (for example, "verify `X-AutoTrace-Signature-256`"). Show the draft to the user.

## 5. Commit, then confirm, then tag

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release vX.Y.Z"
git push origin main
```

**Stop and ask the user to confirm** the version and notes. Only then:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 6. After

- Watch **Actions → Release** until all four platform jobs pass. If one fails, report it; don't re-tag the same version.
- Paste the notes into the GitHub Release body.
- Remind the user that unsigned builds trigger SmartScreen/Gatekeeper warnings (signing is on the roadmap).
