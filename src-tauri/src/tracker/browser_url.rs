//! Extract browser URLs from the foreground window (privacy-filtered later by url_mode).

/// Pull the first http(s) URL from free text (title bars sometimes embed them).
pub fn extract_url_from_text(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    for needle in ["https://", "http://"] {
        if let Some(start) = lower.find(needle) {
            let slice = &text[start..];
            let end = slice
                .find(|c: char| c.is_whitespace() || "<>\"'`)]},;".contains(c))
                .unwrap_or(slice.len());
            let url = slice[..end].trim_end_matches(['.', ',', ';', ')', ']']);
            if url.len() > needle.len() + 3 {
                return Some(url.to_string());
            }
        }
    }
    None
}

pub fn looks_like_browser(app_name: &str) -> bool {
    let a = app_name.to_lowercase();
    let stem = a
        .trim_end_matches(".exe")
        .trim_end_matches(".app");
    [
        "chrome",
        "chromium",
        "msedge",
        "edge",
        "firefox",
        "brave",
        "opera",
        "vivaldi",
        "arc",
        "safari",
        "waterfox",
        "librewolf",
        "zen",
        "thorium",
        "google-chrome",
        "microsoft-edge",
    ]
    .iter()
    .any(|b| stem.contains(b))
}

/// Best-effort URL for the current sample (title parse + OS helpers).
pub fn resolve_url(app_name: &str, title: Option<&str>) -> Option<String> {
    if let Some(t) = title {
        if let Some(u) = extract_url_from_text(t) {
            return Some(u);
        }
    }
    if !looks_like_browser(app_name) {
        return None;
    }
    platform_browser_url(app_name).or_else(|| title.and_then(extract_url_from_text))
}

#[cfg(target_os = "macos")]
fn platform_browser_url(app_name: &str) -> Option<String> {
    let a = app_name.to_lowercase();
    let script = if a.contains("safari") {
        r#"tell application "Safari" to get URL of front document"#
    } else if a.contains("chrome") || a.contains("chromium") {
        r#"tell application "Google Chrome" to get URL of active tab of front window"#
    } else if a.contains("edge") {
        r#"tell application "Microsoft Edge" to get URL of active tab of front window"#
    } else if a.contains("brave") {
        r#"tell application "Brave Browser" to get URL of active tab of front window"#
    } else if a.contains("arc") {
        r#"tell application "Arc" to get URL of active tab of front window"#
    } else if a.contains("firefox") {
        // Firefox has limited AppleScript; fall back to title only.
        return None;
    } else {
        return None;
    };
    let out = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.starts_with("http") {
        Some(s)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn platform_browser_url(app_name: &str) -> Option<String> {
    // Chromium/Firefox rarely expose URL via window props; title parse is primary.
    // Try xprop WM_NAME (already in title) and _NET_WM_NAME — skip heavy DBus.
    let _ = app_name;
    None
}

#[cfg(target_os = "windows")]
fn platform_browser_url(app_name: &str) -> Option<String> {
    // UI Automation address-bar reads are fragile across browser versions.
    // Title-embedded URLs + Accessibility docs cover the supported path;
    // Chrome "URL in title" is uncommon, so we also try the document title
    // pattern "… — example.com" → https://example.com when it looks like a host.
    let _ = app_name;
    None
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn platform_browser_url(_app_name: &str) -> Option<String> {
    None
}

/// Infer https://host from titles like "Inbox - mail.google.com - Google Chrome".
pub fn infer_url_from_browser_title(app_name: &str, title: &str) -> Option<String> {
    if !looks_like_browser(app_name) {
        return None;
    }
    if let Some(u) = extract_url_from_text(title) {
        return Some(u);
    }
    // Split on common browser separators and look for host-like tokens.
    for part in title.split(['-', '—', '|', '·']).map(str::trim) {
        let p = part.to_lowercase();
        if p.contains(' ') || p.len() < 4 {
            continue;
        }
        if p.contains('.')
            && !p.ends_with(".exe")
            && !p.contains("chrome")
            && !p.contains("firefox")
            && !p.contains("edge")
            && !p.contains("brave")
            && !p.contains("safari")
            && !p.contains("opera")
        {
            // Avoid treating "React.dev Docs" style with spaces — already filtered.
            if part.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c)) {
                return Some(format!("https://{part}"));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_embedded_url() {
        assert_eq!(
            extract_url_from_text("see https://example.com/path?q=1 more"),
            Some("https://example.com/path?q=1".into())
        );
    }

    #[test]
    fn infers_host_from_title() {
        let u = infer_url_from_browser_title(
            "chrome.exe",
            "Inbox (2) - mail.google.com - Google Chrome",
        );
        assert_eq!(u.as_deref(), Some("https://mail.google.com"));
    }
}
