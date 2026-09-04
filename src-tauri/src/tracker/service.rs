//! Background ~1s polling loop that merges foreground samples into sessions.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use chrono::Local;
use serde::Serialize;

use crate::store::Store;
use crate::tracker::capture::{self, CaptureSample};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackerStatus {
    Idle,
    Running,
    Paused,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackerInfo {
    pub status: TrackerStatus,
    pub platform: &'static str,
    pub capture_ready: bool,
    pub current_app: Option<String>,
    pub current_title: Option<String>,
}

struct LiveSession {
    id: i64,
    app_name: String,
    title: Option<String>,
    idle: bool,
}

struct Inner {
    status: TrackerStatus,
    current: Option<CaptureSample>,
    live: Option<LiveSession>,
}

pub struct TrackerHandle {
    inner: Arc<Mutex<Inner>>,
    stop: Arc<AtomicBool>,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl TrackerHandle {
    pub fn start(store: Arc<Store>) -> Self {
        let inner = Arc::new(Mutex::new(Inner {
            status: TrackerStatus::Running,
            current: None,
            live: None,
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let inner_clone = Arc::clone(&inner);
        let stop_clone = Arc::clone(&stop);

        let join = thread::Builder::new()
            .name("autotrace-tracker".into())
            .spawn(move || poll_loop(store, inner_clone, stop_clone))
            .expect("spawn tracker thread");

        Self {
            inner,
            stop,
            join: Mutex::new(Some(join)),
        }
    }

    pub fn info(&self) -> TrackerInfo {
        let g = self.inner.lock().expect("tracker mutex poisoned");
        TrackerInfo {
            status: g.status,
            platform: current_platform(),
            capture_ready: capture::capture_supported(),
            current_app: g.current.as_ref().map(|c| c.app_name.clone()),
            current_title: g.current.as_ref().and_then(|c| c.title.clone()),
        }
    }

    pub fn pause(&self) {
        let mut g = self.inner.lock().expect("tracker mutex poisoned");
        if g.status == TrackerStatus::Running {
            g.status = TrackerStatus::Paused;
        }
    }

    pub fn resume(&self) {
        let mut g = self.inner.lock().expect("tracker mutex poisoned");
        if g.status == TrackerStatus::Paused || g.status == TrackerStatus::Idle {
            g.status = TrackerStatus::Running;
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.join.lock().expect("join mutex").take() {
            let _ = handle.join();
        }
    }
}

impl Drop for TrackerHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn poll_loop(store: Arc<Store>, inner: Arc<Mutex<Inner>>, stop: Arc<AtomicBool>) {
    let mut was_paused = false;
    while !stop.load(Ordering::SeqCst) {
        let status = {
            inner.lock().expect("tracker mutex").status
        };

        if status == TrackerStatus::Running {
            was_paused = false;
            tick(&store, &inner);
        } else if status == TrackerStatus::Paused && !was_paused {
            was_paused = true;
            end_live(&store, &inner);
        }

        thread::sleep(Duration::from_secs(1));
    }

    end_live(&store, &inner);
}

fn end_live(store: &Store, inner: &Mutex<Inner>) {
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    if let Ok(mut g) = inner.lock() {
        if let Some(live) = g.live.take() {
            let _ = store.end_session(live.id, &now);
        }
        g.current = None;
    }
}

fn tick(store: &Store, inner: &Mutex<Inner>) {
    let threshold = store.idle_threshold_secs().unwrap_or(180);
    let idle_secs = capture::idle_seconds().unwrap_or(0);
    let is_idle = idle_secs >= threshold;
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();

    let sample = if is_idle {
        None
    } else {
        capture::sample_foreground()
    };

    let mut g = inner.lock().expect("tracker mutex poisoned");
    g.current = sample.clone();

    let same_activity = match (&g.live, &sample, is_idle) {
        (Some(live), Some(sample), false) => {
            live.app_name == sample.app_name && live.title == sample.title && !live.idle
        }
        (Some(live), None, true) => live.idle,
        _ => false,
    };

    if same_activity {
        let id = g.live.as_ref().map(|l| l.id);
        drop(g);
        if let Some(id) = id {
            let _ = store.touch_session(id, &now, is_idle);
        }
        return;
    }

    // Activity changed — close previous, open new.
    if let Some(live) = g.live.take() {
        drop(g);
        let _ = store.end_session(live.id, &now);
    } else {
        drop(g);
    }

    if let Some(sample) = sample {
        open_session(store, inner, sample, &now, false);
    } else if is_idle {
        open_session(
            store,
            inner,
            CaptureSample {
                app_name: "Idle".into(),
                executable: None,
                title: Some("Idle".into()),
                url: None,
            },
            &now,
            true,
        );
    }
}

fn open_session(
    store: &Store,
    inner: &Mutex<Inner>,
    sample: CaptureSample,
    now: &str,
    idle: bool,
) {
    let Ok(app_id) = store.upsert_app(&sample.app_name, sample.executable.as_deref()) else {
        return;
    };
    let Ok(id) = store.start_session(
        app_id,
        sample.title.as_deref(),
        sample.url.as_deref(),
        now,
        idle,
    ) else {
        return;
    };
    if let Ok(mut g) = inner.lock() {
        g.live = Some(LiveSession {
            id,
            app_name: sample.app_name,
            title: sample.title,
            idle,
        });
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
