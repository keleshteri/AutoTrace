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

Keep these in sync:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `version`

Tag format: `vMAJOR.MINOR.PATCH` (example `v0.1.0`).
