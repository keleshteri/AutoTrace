//! Unit tests for timer / break / planned / distraction store APIs.

use super::*;
use std::path::PathBuf;
use std::time::Duration;

struct TempStore {
    dir: PathBuf,
    store: Store,
}

impl TempStore {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "autotrace-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(dir.join("t.db")).unwrap();
        Self { dir, store }
    }
}

impl Drop for TempStore {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn stamp_offset(secs: i64) -> String {
    (chrono::Local::now() + chrono::Duration::seconds(secs))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string()
}

#[test]
fn store_open_migrate_and_session() {
    let tmp = TempStore::new("session");
    assert!(tmp.store.schema_version().unwrap() >= 7);
    let app = tmp.store.upsert_app("Code", None).unwrap();
    let id = tmp
        .store
        .start_session(
            app,
            Some("hello"),
            None,
            "2026-09-05T09:00:00",
            false,
            None,
            false,
            Some("Code"),
        )
        .unwrap();
    tmp.store
        .touch_session(id, "2026-09-05T09:15:00", false)
        .unwrap();
    let rows = tmp.store.sessions_for_day("2026-09-05").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].category.as_deref(), Some("Code"));
}

#[test]
fn focus_lifecycle_pause_resume_end() {
    let tmp = TempStore::new("focus-life");
    let started = tmp
        .store
        .start_timer_session("focus", Some("Ship tests"), None, None, None, Some(50 * 60), None)
        .unwrap();
    assert_eq!(started.status, "active");
    assert_eq!(started.kind, "focus");
    assert_eq!(started.planned_secs, Some(50 * 60));
    assert!(started.goal.as_deref() == Some("Ship tests"));

    std::thread::sleep(Duration::from_millis(1100));
    let paused = tmp.store.pause_focus().unwrap().unwrap();
    assert_eq!(paused.status, "paused");
    assert!(paused.elapsed_secs >= 1);

    let resumed = tmp.store.resume_focus().unwrap().unwrap();
    assert_eq!(resumed.status, "active");
    let frozen = resumed.elapsed_secs;

    let ended = tmp.store.end_focus().unwrap().unwrap();
    assert_eq!(ended.status, "ended");
    assert!(ended.elapsed_secs >= frozen);
    assert!(tmp.store.get_active_focus().unwrap().is_none());

    let day = today();
    let sessions = tmp.store.sessions_for_day(&day).unwrap();
    assert!(
        sessions.iter().any(|s| s.manual && s.category.as_deref() == Some("Focus")),
        "ending focus should write a Focus calendar block"
    );
}

#[test]
fn starting_new_session_ends_prior() {
    let tmp = TempStore::new("switch");
    tmp.store
        .start_timer_session("focus", Some("A"), None, None, None, None, None)
        .unwrap();
    let meeting = tmp
        .store
        .start_timer_session("meeting", Some("Standup"), None, None, None, Some(1800), None)
        .unwrap();
    assert_eq!(meeting.kind, "meeting");
    assert_eq!(meeting.goal.as_deref(), Some("Standup"));
    let active = tmp.store.get_active_focus().unwrap().unwrap();
    assert_eq!(active.id, meeting.id);
}

#[test]
fn break_end_resets_time_since_last_break() {
    let tmp = TempStore::new("break-reset");
    tmp.store
        .mark_break_ended(&stamp_offset(-3600))
        .unwrap();
    let before = tmp.store.time_since_last_break_secs().unwrap();
    assert!(before.secs >= 3500);

    tmp.store
        .start_timer_session("break", None, None, None, None, Some(300), None)
        .unwrap();
    tmp.store.end_focus().unwrap();
    let after = tmp.store.time_since_last_break_secs().unwrap();
    assert!(
        after.secs < 5,
        "break end should reset since-break clock, got {}",
        after.secs
    );
}

#[test]
fn idle_session_end_marks_break() {
    let tmp = TempStore::new("idle-break");
    let app = tmp.store.upsert_app("Idle", None).unwrap();
    let id = tmp
        .store
        .start_session(
            app,
            None,
            None,
            &stamp_offset(-120),
            true,
            None,
            false,
            Some("Break"),
        )
        .unwrap();
    let end = stamp_offset(0);
    tmp.store.end_session(id, &end).unwrap();
    let since = tmp.store.time_since_last_break_secs().unwrap();
    assert!(since.secs < 3);
    assert_eq!(since.last_break_at, end);
}

#[test]
fn reconcile_stale_focus_pauses_without_accruing_dead_time() {
    let tmp = TempStore::new("reconcile");
    tmp.store
        .start_timer_session("focus", Some("Deep work"), None, None, None, Some(3000), None)
        .unwrap();
    // Simulate a long-running segment that would accrue if we paused normally.
    {
        let conn = tmp.store.conn.lock().unwrap();
        conn.execute(
            "UPDATE focus_sessions SET segment_started_at = ?1 WHERE status = 'active'",
            params![stamp_offset(-7200)],
        )
        .unwrap();
    }
    let before = tmp.store.get_active_focus().unwrap().unwrap();
    assert!(before.elapsed_secs >= 7000);

    let reconciled = tmp.store.reconcile_stale_focus_on_launch().unwrap().unwrap();
    assert_eq!(reconciled.status, "paused");
    assert_eq!(
        reconciled.elapsed_secs, 0,
        "reconcile must not count downtime since last open (got {}, before live was {})",
        reconciled.elapsed_secs,
        before.elapsed_secs
    );
    assert!(
        before.elapsed_secs >= 7000,
        "precondition: live elapsed should include stale segment"
    );
}

#[test]
fn extend_focus_grows_planned_secs() {
    let tmp = TempStore::new("extend");
    tmp.store
        .start_timer_session("focus", None, None, None, None, Some(600), None)
        .unwrap();
    let extended = tmp.store.extend_focus(300).unwrap().unwrap();
    assert_eq!(extended.planned_secs, Some(900));

    // Floor at 60s when caller asks for less.
    let again = tmp.store.extend_focus(10).unwrap().unwrap();
    assert_eq!(again.planned_secs, Some(960));
}

#[test]
fn category_override_used_on_end() {
    let tmp = TempStore::new("override");
    tmp.store
        .start_timer_session(
            "focus",
            Some("Billable"),
            None,
            None,
            None,
            None,
            Some("Code"),
        )
        .unwrap();
    tmp.store.end_focus().unwrap();
    let day = today();
    let sessions = tmp.store.sessions_for_day(&day).unwrap();
    assert!(sessions.iter().any(|s| s.category.as_deref() == Some("Code")));
}

#[test]
fn plan_pomodoro_builds_focus_and_breaks() {
    let tmp = TempStore::new("pomo");
    let day = today();
    let rows = tmp
        .store
        .plan_pomodoro(&day, Some(&format!("{day}T10:00:00")), 25, 5, 15, 2)
        .unwrap();
    // 2 focus + 1 short break between + 1 long after final = 4
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0].kind, "focus");
    assert_eq!(rows[1].kind, "break");
    assert_eq!(rows[2].kind, "focus");
    assert_eq!(rows[3].kind, "break");
    assert_eq!(rows[0].duration_secs, 25 * 60);
    assert_eq!(rows[1].duration_secs, 5 * 60);
    assert_eq!(rows[3].duration_secs, 15 * 60);

    let cleared = tmp.store.clear_planned_for_day(&day).unwrap();
    assert_eq!(cleared, 4);
    assert!(tmp.store.list_planned_for_day(&day).unwrap().is_empty());
}

#[test]
fn start_from_planned_and_next_due() {
    let tmp = TempStore::new("from-plan");
    let start = stamp_offset(-30);
    let end = stamp_offset(1470);
    let plan = tmp
        .store
        .create_planned_session(
            "focus",
            Some("Block"),
            &start,
            &end,
            Some("Do it"),
            None,
            None,
            None,
        )
        .unwrap();
    assert_eq!(plan.status, "planned");

    let due = tmp.store.next_due_planned().unwrap();
    assert!(due.is_some());
    assert_eq!(due.unwrap().id, plan.id);

    let focus = tmp.store.start_from_planned(plan.id).unwrap();
    assert_eq!(focus.status, "active");
    assert_eq!(focus.kind, "focus");
    assert!(focus.planned_secs.unwrap_or(0) >= 60);

    let updated = tmp.store.get_planned(plan.id).unwrap().unwrap();
    assert_eq!(updated.status, "started");
    assert!(tmp.store.next_due_planned().unwrap().is_none());
}

#[test]
fn suggest_planned_from_calendar_imports_meetings() {
    let tmp = TempStore::new("cal-plan");
    let day = today();
    tmp.store
        .insert_calendar_event(
            "Sync",
            &format!("{day}T14:00:00"),
            &format!("{day}T14:30:00"),
            "test",
        )
        .unwrap();
    let suggested = tmp.store.suggest_planned_from_calendar(&day).unwrap();
    assert_eq!(suggested.len(), 1);
    assert_eq!(suggested[0].kind, "meeting");
    assert_eq!(suggested[0].title.as_deref(), Some("Sync"));

    // Second call should not duplicate.
    let again = tmp.store.suggest_planned_from_calendar(&day).unwrap();
    assert!(again.is_empty());
}

#[test]
fn plan_schedule_merges_permanent_instructions() {
    let tmp = TempStore::new("plan-instr");
    let day = today();
    tmp.store
        .set_setting("planning_instructions", "25 focus 5 break 2 rounds")
        .unwrap();
    let rows = tmp
        .store
        .plan_schedule_from_instructions(&day, "", Some(&format!("{day}T09:00:00")))
        .unwrap();
    assert!(!rows.is_empty());
    assert!(rows.iter().any(|r| r.kind == "focus"));
}

#[test]
fn distraction_block_matches_app_title_url() {
    let tmp = TempStore::new("distract");
    tmp.store.set_setting("distraction_block", "1").unwrap();
    tmp.store
        .create_block_rule("twitter", "app", "soft")
        .unwrap();
    tmp.store
        .create_block_rule("reddit.com", "url", "hard")
        .unwrap();
    tmp.store
        .create_block_rule("cat videos", "title", "soft")
        .unwrap();

    assert_eq!(
        tmp.store
            .is_distraction_blocked("Twitter", None, None)
            .unwrap()
            .as_deref(),
        Some("soft")
    );
    assert_eq!(
        tmp.store
            .is_distraction_blocked("Chrome", None, Some("https://www.reddit.com/r/x"))
            .unwrap()
            .as_deref(),
        Some("hard")
    );
    assert_eq!(
        tmp.store
            .is_distraction_blocked("YouTube", Some("Funny cat videos"), None)
            .unwrap()
            .as_deref(),
        Some("soft")
    );
    assert!(tmp
        .store
        .is_distraction_blocked("Code", Some("main.rs"), None)
        .unwrap()
        .is_none());

    tmp.store.set_setting("distraction_block", "0").unwrap();
    assert!(tmp
        .store
        .is_distraction_blocked("Twitter", None, None)
        .unwrap()
        .is_none());
}

#[test]
fn auto_break_detect_starts_when_idle_and_due() {
    let tmp = TempStore::new("auto-break");
    tmp.store.set_setting("auto_break_detect", "1").unwrap();
    tmp.store.set_setting("auto_focus_detect", "0").unwrap();
    tmp.store.set_setting("break_every_mins", "1").unwrap();
    tmp.store.set_setting("break_length_mins", "5").unwrap();
    tmp.store
        .mark_break_ended(&stamp_offset(-600))
        .unwrap();

    let app = tmp.store.upsert_app("IdleApp", None).unwrap();
    let started = stamp_offset(-180);
    let id = tmp
        .store
        .start_session(app, None, None, &started, true, None, false, Some("Break"))
        .unwrap();
    tmp.store.touch_session(id, &stamp_offset(0), true).unwrap();

    let started_break = tmp.store.maybe_auto_detect_sessions().unwrap();
    assert!(started_break.is_some());
    let s = started_break.unwrap();
    assert_eq!(s.kind, "break");
    assert_eq!(s.status, "active");
}

#[test]
fn invalid_session_kind_rejected() {
    let tmp = TempStore::new("bad-kind");
    let err = tmp
        .store
        .start_timer_session("nap", None, None, None, None, None, None)
        .unwrap_err();
    let msg = err.to_string().to_lowercase();
    assert!(msg.contains("kind") || msg.contains("invalid") || msg.contains("nap"));
}
