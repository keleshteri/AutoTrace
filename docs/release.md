# Releasing AutoTrace

AutoTrace ships as native installers via **Tauri 2**. Prefer **GitHub Actions** so Windows, Linux, and macOS builds are produced automatically and attached to a [GitHub Release](https://github.com/keleshteri/AutoTrace/releases).

## Installer types

| OS | Typical assets |
|---|---|
| Windows | NSIS `.exe`, optionally `.msi` |
| Linux | `.AppImage`, `.deb` |
| macOS | `.dmg` (arm64 + Intel) |

Early releases may be **unsigned**. Users may see SmartScreen (Windows) or Gatekeeper (macOS) warnings until code signing certificates are configured.

## Publish from GitHub (recommended)

1. Ensure `main` has the commit you want to ship.
2. Create and push a version tag matching `package.json` / `tauri.conf.json`:

```bash
# bump version in package.json + src-tauri/tauri.conf.json + src-tauri/Cargo.toml first if needed
git tag v0.1.0
git push origin v0.1.0
```

3. Open **Actions → Release** — four jobs build in parallel (Windows, Linux, macOS arm64, macOS x64).
4. When finished, open **Releases** — download links appear for each platform.

You can also run **Actions → Release → Run workflow** without a tag (uses `v` + `package.json` version).

### Optional: code signing later

| Platform | Secrets / notes |
|---|---|
| macOS | Apple Developer ID + notarization (`APPLE_CERTIFICATE`, `APPLE_ID`, …) |
| Windows | Authenticode cert for fewer SmartScreen prompts |
| Linux | Usually no signing required for AppImage/deb |

Add secrets in the repo settings when you have certificates; unsigned builds remain usable.

## Build locally (one OS only)

```bash
chmod +x scripts/release-local.sh
./scripts/release-local.sh
```

Artifacts land under `src-tauri/target/release/bundle/`.

Requirements:

- **All:** Node 22+, pnpm 10+, Rust stable
- **Linux:** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf`
- **macOS:** Xcode CLT; Accessibility permission for capture
- **Windows:** WebView2 (usually preinstalled on Win10/11)

## Version bumps

Run the bump script (updates all three files together):

```bash
pnpm release:bump
# or: ./scripts/bump-version.sh
```

It asks **patch / minor / major / custom**, then writes the same version to:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Non-interactive:

```bash
pnpm release:bump -- patch
pnpm release:bump -- minor
pnpm release:bump -- major
pnpm release:bump -- 0.2.0
```

Tag format: `vMAJOR.MINOR.PATCH` (example `v0.2.0`).

## In-app updates

Users can open **Settings → Account → Check for updates**.

| Mode | What happens |
|---|---|
| **GitHub check** | Compares installed version to the latest [GitHub Release](https://github.com/keleshteri/AutoTrace/releases). Opens the download page if newer. |
| **Signed install** | When CI publishes `latest.json` + `.sig` artifacts, the app can **Download & install** and restart (Tauri updater). |

### One-time: add signing secrets (required for in-app install)

A keypair was generated for this repo (public key is in `tauri.conf.json`). Keep the **private** key only in GitHub secrets:

```bash
chmod +x scripts/print-updater-secrets.sh
./scripts/print-updater-secrets.sh
```

Add repo secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — full private key contents from `.keys/autotrace.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty if the key has no password

If you lose the private key, generate a new pair, update `plugins.updater.pubkey` in `tauri.conf.json`, and ship a **manual** installer once — existing installs cannot verify updates signed with a new key.

### Publish a version users can update to

1. Bump versions in the three files above.
2. Commit, tag `vX.Y.Z`, push the tag.
3. Wait for **Actions → Release** to finish (needs the signing secrets for updater artifacts).
4. Existing installs: **Settings → Check for updates** → Download & install.

Without signing secrets, Release still builds installers; users update by downloading from GitHub Releases.
