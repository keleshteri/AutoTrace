//! Foreground-window tracker.
//!
//! Phase 0: module boundaries and status surface only.
//! Phase 1: Windows Win32 polling (~1s), then macOS Accessibility.

#![allow(dead_code)]

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackerStatus {
    /// Capture loop not started yet (foundation scaffold).
    Idle,
    Running,
    Paused,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackerInfo {
    pub status: TrackerStatus,
    pub platform: &'static str,
    pub capture_ready: bool,
}

impl TrackerInfo {
    pub fn current() -> Self {
        Self {
            status: TrackerStatus::Idle,
            platform: current_platform(),
            // Windows capture lands in Phase 1; scaffold reports not ready.
            capture_ready: false,
        }
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// Placeholder for the future polling loop.
pub struct Tracker {
    status: TrackerStatus,
}

impl Tracker {
    pub fn new() -> Self {
        Self {
            status: TrackerStatus::Idle,
        }
    }

    pub fn status(&self) -> TrackerStatus {
        self.status
    }

    pub fn pause(&mut self) {
        if self.status == TrackerStatus::Running {
            self.status = TrackerStatus::Paused;
        }
    }

    pub fn resume(&mut self) {
        if self.status == TrackerStatus::Paused || self.status == TrackerStatus::Idle {
            self.status = TrackerStatus::Running;
        }
    }
}

impl Default for Tracker {
    fn default() -> Self {
        Self::new()
    }
}
