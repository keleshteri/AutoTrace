//! OS-specific foreground window + idle time sampling.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CaptureSample {
    pub app_name: String,
    pub executable: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
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
            Some(CaptureSample {
                app_name,
                executable,
                title,
                url: None,
            })
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
        // Best-effort via xdotool when available (WSLg / X11).
        which("xdotool")
    }

    pub fn sample_foreground() -> Option<CaptureSample> {
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

        Some(CaptureSample {
            app_name,
            executable: exe,
            title: if title.is_empty() { None } else { Some(title) },
            url: None,
        })
    }

    pub fn idle_seconds() -> Option<IdleSecs> {
        if which("xprintidle") {
            let ms = run_stdout(&["xprintidle"])?.parse::<u64>().ok()?;
            return Some(ms / 1000);
        }
        None
    }

    fn which(bin: &str) -> bool {
        Command::new("which")
            .arg(bin)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn run_stdout(cmd: &[&str]) -> Option<String> {
        let (bin, args) = cmd.split_first()?;
        let out = Command::new(bin).args(args).output().ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{CaptureSample, IdleSecs};

    pub fn capture_supported() -> bool {
        false
    }

    pub fn sample_foreground() -> Option<CaptureSample> {
        // Accessibility API capture arrives after Windows MVP.
        None
    }

    pub fn idle_seconds() -> Option<IdleSecs> {
        None
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
