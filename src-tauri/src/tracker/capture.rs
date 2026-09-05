//! OS-specific foreground window + idle time sampling.

use serde::Serialize;

use super::browser_url;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CaptureSample {
    pub app_name: String,
    pub executable: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
}

fn with_url(mut sample: CaptureSample) -> CaptureSample {
    if sample.url.is_none() {
        sample.url = browser_url::resolve_url(
            &sample.app_name,
            sample.title.as_deref(),
        )
        .or_else(|| {
            sample
                .title
                .as_deref()
                .and_then(|t| browser_url::infer_url_from_browser_title(&sample.app_name, t))
        });
    }
    sample
}

pub type IdleSecs = u64;

/// Sample the foreground window. Returns `None` when capture is unavailable.
pub fn sample_foreground() -> Option<CaptureSample> {
    platform::sample_foreground()
}

/// Seconds since last user input, when the platform can report it.
pub fn idle_seconds() -> Option<IdleSecs> {
    platform::idle_seconds()
}

pub fn capture_supported() -> bool {
    platform::capture_supported()
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{CaptureSample, IdleSecs};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, MAX_PATH};
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    pub fn capture_supported() -> bool {
        true
    }

    pub fn sample_foreground() -> Option<CaptureSample> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }

            let title = window_title(hwnd);
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return None;
            }

            let (app_name, executable) = process_info(pid)?;
            Some(super::with_url(CaptureSample {
                app_name,
                executable,
                title,
                url: None,
            }))
        }
    }

    pub fn idle_seconds() -> Option<IdleSecs> {
        unsafe {
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if !GetLastInputInfo(&mut info).as_bool() {
                return None;
            }
            let tick = windows::Win32::System::SystemInformation::GetTickCount();
            Some(((tick.wrapping_sub(info.dwTime)) / 1000) as u64)
        }
    }

    unsafe fn window_title(hwnd: HWND) -> Option<String> {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return None;
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let read = GetWindowTextW(hwnd, &mut buf);
        if read <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..read as usize]))
    }

    unsafe fn process_info(pid: u32) -> Option<(String, Option<String>)> {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let result = process_info_from_handle(handle);
        let _ = CloseHandle(handle);
        result
    }

    unsafe fn process_info_from_handle(handle: HANDLE) -> Option<(String, Option<String>)> {
        let mut size = MAX_PATH;
        let mut path_buf = vec![0u16; size as usize];
        let exe = if QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(path_buf.as_mut_ptr()),
            &mut size,
        )
        .is_ok()
        {
            let os = OsString::from_wide(&path_buf[..size as usize]);
            Some(os.to_string_lossy().into_owned())
        } else {
            None
        };

        let mut name_buf = vec![0u16; MAX_PATH as usize];
        let name_len = GetModuleBaseNameW(handle, None, &mut name_buf);
        let app_name = if name_len > 0 {
            String::from_utf16_lossy(&name_buf[..name_len as usize])
        } else if let Some(ref path) = exe {
            Path::new(path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Unknown".into())
        } else {
            "Unknown".into()
        };

        Some((app_name, exe))
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{CaptureSample, IdleSecs};
    use std::process::Command;

    pub fn capture_supported() -> bool {
        which("xdotool")
            || which("hyprctl")
            || which("swaymsg")
            || std::env::var_os("WAYLAND_DISPLAY").is_some()
    }

    pub fn sample_foreground() -> Option<CaptureSample> {
        if let Some(s) = sample_hyprland() {
            return Some(s);
        }
        if let Some(s) = sample_sway() {
            return Some(s);
        }
        sample_xdotool()
    }

    pub fn idle_seconds() -> Option<IdleSecs> {
        if which("xprintidle") {
            let ms = run_stdout(&["xprintidle"])?.parse::<u64>().ok()?;
            return Some(ms / 1000);
        }
        None
    }

    fn sample_xdotool() -> Option<CaptureSample> {
        if !which("xdotool") {
            return None;
        }
        let title = run_stdout(&["xdotool", "getactivewindow", "getwindowname"])?;
        let pid = run_stdout(&["xdotool", "getactivewindow", "getwindowpid"])?;
        let exe = std::fs::read_link(format!("/proc/{pid}/exe"))
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
        let app_name = exe
            .as_ref()
            .and_then(|p| std::path::Path::new(p).file_name())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Unknown".into());
        Some(super::with_url(CaptureSample {
            app_name,
            executable: exe,
            title: if title.is_empty() { None } else { Some(title) },
            url: None,
        }))
    }

    fn sample_hyprland() -> Option<CaptureSample> {
        if !which("hyprctl") {
            return None;
        }
        let json = run_stdout(&["hyprctl", "activewindow", "-j"])?;
        let v: serde_json::Value = serde_json::from_str(&json).ok()?;
        let app_name = v.get("class").and_then(|x| x.as_str()).unwrap_or("Unknown").to_string();
        let title = v.get("title").and_then(|x| x.as_str()).map(str::to_string);
        Some(super::with_url(CaptureSample {
            app_name,
            executable: None,
            title,
            url: None,
        }))
    }

    fn sample_sway() -> Option<CaptureSample> {
        if !which("swaymsg") {
            return None;
        }
        let json = run_stdout(&["swaymsg", "-t", "get_tree"])?;
        let v: serde_json::Value = serde_json::from_str(&json).ok()?;
        find_focused(&v).map(|(app, title)| {
            super::with_url(CaptureSample {
                app_name: app,
                executable: None,
                title,
                url: None,
            })
        })
    }

    fn find_focused(node: &serde_json::Value) -> Option<(String, Option<String>)> {
        if node.get("focused").and_then(|x| x.as_bool()) == Some(true) {
            let app = node
                .get("app_id")
                .and_then(|x| x.as_str())
                .or_else(|| node.get("name").and_then(|x| x.as_str()))
                .unwrap_or("Unknown")
                .to_string();
            let title = node.get("name").and_then(|x| x.as_str()).map(str::to_string);
            return Some((app, title));
        }
        for key in ["nodes", "floating_nodes"] {
            if let Some(arr) = node.get(key).and_then(|x| x.as_array()) {
                for child in arr {
                    if let Some(hit) = find_focused(child) {
                        return Some(hit);
                    }
                }
            }
        }
        None
    }

    fn which(bin: &str) -> bool {
        Command::new("which").arg(bin).output().map(|o| o.status.success()).unwrap_or(false)
    }

    fn run_stdout(cmd: &[&str]) -> Option<String> {
        let (bin, args) = cmd.split_first()?;
        let out = Command::new(bin).args(args).output().ok()?;
        if !out.status.success() { return None; }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{CaptureSample, IdleSecs};
    use std::process::Command;

    pub fn capture_supported() -> bool {
        which("osascript")
    }

    pub fn sample_foreground() -> Option<CaptureSample> {
        let app = run_osascript(
            r#"tell application "System Events" to get name of first application process whose frontmost is true"#,
        )?;
        let title = run_osascript(
            r#"tell application "System Events" to get title of first window of (first application process whose frontmost is true)"#,
        )
        .filter(|s| !s.is_empty());
        Some(super::with_url(CaptureSample {
            app_name: app,
            executable: None,
            title,
            url: None,
        }))
    }

    pub fn idle_seconds() -> Option<IdleSecs> {
        let out = Command::new("ioreg").args(["-c", "IOHIDSystem"]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if line.contains("HIDIdleTime") {
                let digits: String = line.chars().filter(|c| c.is_ascii_digit()).collect();
                if let Ok(ns) = digits.parse::<u64>() {
                    return Some(ns / 1_000_000_000);
                }
            }
        }
        None
    }

    fn which(bin: &str) -> bool {
        Command::new("which").arg(bin).output().map(|o| o.status.success()).unwrap_or(false)
    }

    fn run_osascript(script: &str) -> Option<String> {
        let out = Command::new("osascript").args(["-e", script]).output().ok()?;
        if !out.status.success() { return None; }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use super::{CaptureSample, IdleSecs};

    pub fn capture_supported() -> bool {
        false
    }

    pub fn sample_foreground() -> Option<CaptureSample> {
        None
    }

    pub fn idle_seconds() -> Option<IdleSecs> {
        None
    }
}
