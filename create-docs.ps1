$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot "docs"

$dirs = @(
    $root,
    (Join-Path $root "decisions"),
    (Join-Path $root "architecture"),
    (Join-Path $root "prd")
)

foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$files = @{
    (Join-Path $root "README.md") = @"
# AutoTrace

Local-first time/activity tracking app.

- [Locked decisions](decisions/locked-decisions.md)
- [Architecture overview](architecture/overview.md)
- [MVP scope](prd/mvp.md)
"@

    (Join-Path $root "decisions/locked-decisions.md") = @"
# Locked Product Decisions

| Decision | Choice |
|----------|--------|
| Stack | Tauri 2 |
| Privacy | Local-only first |
| Integrations | Opt-in later (ClickUp etc. - user decides) |
| Surveillance | Never default |
"@

    (Join-Path $root "architecture/overview.md") = @"
# Architecture Overview

- Shell: Tauri 2 (Rust backend, React/TS frontend)
- Storage: local SQLite, no cloud sync by default
- Tracking: foreground-window tracker (Windows first), runs as a background/tray process
- Integrations: disabled by default; each one is opt-in and configured explicitly by the user
"@

    (Join-Path $root "prd/mvp.md") = @"
# MVP Checklist

- [ ] Tauri 2 app shell (Rust + React/TS) builds and runs
- [ ] System tray icon with show/hide/quit
- [ ] Local SQLite database created on first run
- [ ] Foreground-window tracker stub (Windows) logs active window title + timestamp
- [ ] Basic local UI to view tracked activity
- [ ] No network calls / integrations enabled by default
"@
}

foreach ($path in $files.Keys) {
    Set-Content -Path $path -Value $files[$path] -Encoding utf8
}

Write-Host "Created docs under $root"
Get-ChildItem $root -Recurse -File | Select-Object FullName
