//! Local SQLite persistence for AutoTrace.
//!
//! Data lives under the OS app-data directory. Nothing is synced unless the
//! user later enables an opt-in integration (out of scope for MVP).

mod ai;
mod models;
mod schema;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Datelike;
use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;

pub use models::*;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Msg(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;

fn default_workspace_settings_json() -> String {
    serde_json::json!({
        "features": {
            "profitability": true,
            "invoicing": true,
            "billable_hours": true,
            "tasks": true,
            "projects": true,
            "clients": true,
            "client_tagging": true,
            "labels": true,
            "team_creation_admin_only": false
        },
        "invoicing": {
            "company_name": "",
            "company_address": "",
            "payment_instructions": "",
            "default_payment_terms": "Net 30"
        },
        "logo_data_url": null
    })
    .to_string()
}

/// Thread-safe handle to the on-disk SQLite database.
pub struct Store {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Store {
    /// Open (or create) the database at `path`, running migrations as needed.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        schema::migrate(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> Result<i64> {
        Ok(self
            .get_setting("schema_version")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let value = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn idle_threshold_secs(&self) -> Result<u64> {
        Ok(self
            .get_setting("idle_threshold_secs")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(180))
    }

    /// Find or create an app row; returns its id.
    pub fn upsert_app(&self, name: &str, executable: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        if let Some(id) = conn
            .query_row(
                "SELECT id FROM apps WHERE name = ?1 AND IFNULL(executable, '') = IFNULL(?2, '')",
                params![name, executable],
                |row| row.get(0),
            )
            .optional()?
        {
            return Ok(id);
        }

        conn.execute(
            "INSERT INTO apps (name, executable) VALUES (?1, ?2)",
            params![name, executable],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Open a new session; returns session id.
    pub fn start_session(
        &self,
        app_id: i64,
        title: Option<&str>,
        url: Option<&str>,
        started_at: &str,
        idle: bool,
        confidence: Option<f32>,
        pending: bool,
        category: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO sessions (app_id, title, url, started_at, ended_at, idle, confidence, pending, category)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8)",
            params![
                app_id,
                title,
                url,
                started_at,
                idle as i64,
                confidence.map(|c| c as f64),
                pending as i64,
                category
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Extend the open end of a session (used by the 1s poll loop).
    pub fn touch_session(&self, session_id: i64, ended_at: &str, idle: bool) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE sessions SET ended_at = ?1, idle = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![ended_at, idle as i64, session_id],
        )?;
        Ok(())
    }

    pub fn end_session(&self, session_id: i64, ended_at: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE sessions SET ended_at = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![ended_at, session_id],
        )?;
        Ok(())
    }

    /// Sessions overlapping a calendar day (`YYYY-MM-DD`, local wall-clock strings).
    pub fn sessions_for_day(&self, day: &str) -> Result<Vec<SessionRow>> {
        let start = format!("{day}T00:00:00");
        let end = format!("{day}T23:59:59");
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT s.id, s.app_id, a.name, s.title, s.url, s.started_at, s.ended_at, s.idle,
                    s.client_id, s.project_id, s.task_id,
                    c.name, p.name, t.name,
                    s.approved, s.manual, s.notes, s.confidence, s.pending, s.category, s.billable
             FROM sessions s
             LEFT JOIN apps a ON a.id = s.app_id
             LEFT JOIN clients c ON c.id = s.client_id
             LEFT JOIN projects p ON p.id = s.project_id
             LEFT JOIN tasks t ON t.id = s.task_id
             WHERE s.started_at <= ?2 AND IFNULL(s.ended_at, s.started_at) >= ?1
             ORDER BY s.started_at ASC",
        )?;

        let rows = stmt
            .query_map(params![start, end], map_session_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_client(&self, name: &str, color: Option<&str>) -> Result<Client> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO clients (name, color) VALUES (?1, ?2)",
            params![name, color],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Client {
            id,
            name: name.to_string(),
            color: color.map(str::to_string),
            archived: false,
            hourly_rate: None,
        })
    }

    pub fn create_project(
        &self,
        client_id: i64,
        name: &str,
        color: Option<&str>,
    ) -> Result<Project> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO projects (client_id, name, color) VALUES (?1, ?2, ?3)",
            params![client_id, name, color],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Project {
            id,
            client_id,
            name: name.to_string(),
            color: color.map(str::to_string),
            archived: false,
            hourly_rate: None,
            budget_hours: None,
        })
    }

    pub fn create_task(&self, project_id: i64, name: &str) -> Result<Task> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO tasks (project_id, name) VALUES (?1, ?2)",
            params![project_id, name],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Task {
            id,
            project_id,
            name: name.to_string(),
            archived: false,
        })
    }

    pub fn tag_session(
        &self,
        session_id: i64,
        client_id: Option<i64>,
        project_id: Option<i64>,
        task_id: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE sessions SET client_id = ?1, project_id = ?2, task_id = ?3,
             updated_at = datetime('now') WHERE id = ?4",
            params![client_id, project_id, task_id, session_id],
        )?;
        Ok(())
    }

    pub fn hierarchy(&self) -> Result<Hierarchy> {
        let conn = self.conn.lock().expect("store mutex poisoned");

        let mut clients_stmt = conn.prepare(
            "SELECT id, name, color, hourly_rate FROM clients WHERE archived = 0 ORDER BY name COLLATE NOCASE",
        )?;
        let clients: Vec<(i64, String, Option<String>, Option<f64>)> = clients_stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut nodes = Vec::new();
        for (cid, cname, ccolor, crate_) in clients {
            let mut projects_stmt = conn.prepare(
                "SELECT id, name, color, hourly_rate, budget_hours FROM projects
                 WHERE client_id = ?1 AND archived = 0 ORDER BY name COLLATE NOCASE",
            )?;
            let projects: Vec<(i64, String, Option<String>, Option<f64>, Option<f64>)> = projects_stmt
                .query_map(params![cid], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            let mut project_nodes = Vec::new();
            for (pid, pname, pcolor, prate, pbudget) in projects {
                let mut tasks_stmt = conn.prepare(
                    "SELECT id, project_id, name, archived FROM tasks
                     WHERE project_id = ?1 AND archived = 0 ORDER BY name COLLATE NOCASE",
                )?;
                let tasks: Vec<Task> = tasks_stmt
                    .query_map(params![pid], |row| {
                        Ok(Task {
                            id: row.get(0)?,
                            project_id: row.get(1)?,
                            name: row.get(2)?,
                            archived: row.get::<_, i64>(3)? != 0,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;

                project_nodes.push(ProjectNode {
                    id: pid,
                    name: pname,
                    color: pcolor,
                    hourly_rate: prate,
                    budget_hours: pbudget,
                    tasks,
                });
            }

            nodes.push(ClientNode {
                id: cid,
                name: cname,
                color: ccolor,
                hourly_rate: crate_,
                projects: project_nodes,
            });
        }

        Ok(Hierarchy { clients: nodes })
    }

    pub fn list_rules(&self) -> Result<Vec<Rule>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, pattern, match_field, client_id, project_id, task_id, priority, enabled,
                    COALESCE(action, 'tag')
             FROM rules ORDER BY priority DESC, id ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Rule {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    pattern: row.get(2)?,
                    match_field: row.get(3)?,
                    client_id: row.get(4)?,
                    project_id: row.get(5)?,
                    task_id: row.get(6)?,
                    priority: row.get(7)?,
                    enabled: row.get::<_, i64>(8)? != 0,
                    action: row.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_rule(
        &self,
        name: &str,
        pattern: &str,
        match_field: &str,
        client_id: Option<i64>,
        project_id: Option<i64>,
        task_id: Option<i64>,
        priority: i64,
        action: &str,
    ) -> Result<Rule> {
        let action = if action == "exclude" { "exclude" } else { "tag" };
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO rules (name, pattern, match_field, client_id, project_id, task_id, priority, action)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                name,
                pattern,
                match_field,
                client_id,
                project_id,
                task_id,
                priority,
                action
            ],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Rule {
            id,
            name: name.to_string(),
            pattern: pattern.to_string(),
            match_field: match_field.to_string(),
            client_id,
            project_id,
            task_id,
            priority,
            enabled: true,
            action: action.to_string(),
        })
    }

    pub fn delete_rule(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM rules WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_rule_enabled(&self, id: i64, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE rules SET enabled = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![enabled as i64, id],
        )?;
        Ok(())
    }

    pub fn list_apps(&self) -> Result<Vec<AppRow>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, executable, excluded FROM apps ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AppRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    executable: row.get(2)?,
                    excluded: row.get::<_, i64>(3)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn set_app_excluded(&self, app_id: i64, excluded: bool) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE apps SET excluded = ?1 WHERE id = ?2",
            params![excluded as i64, app_id],
        )?;
        Ok(())
    }

    pub fn is_app_excluded(&self, name: &str, executable: Option<&str>) -> Result<bool> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let excluded: Option<i64> = conn
            .query_row(
                "SELECT excluded FROM apps
                 WHERE name = ?1 AND IFNULL(executable, '') = IFNULL(?2, '')",
                params![name, executable],
                |row| row.get(0),
            )
            .optional()?;
        Ok(excluded.unwrap_or(0) != 0)
    }

    pub fn tracker_settings(&self) -> Result<TrackerSettings> {
        Ok(TrackerSettings {
            idle_threshold_secs: self.idle_threshold_secs()?,
            work_hours_enabled: self
                .get_setting("work_hours_enabled")?
                .map(|v| v == "1")
                .unwrap_or(false),
            work_hours_start: self
                .get_setting("work_hours_start")?
                .unwrap_or_else(|| "09:00".into()),
            work_hours_end: self
                .get_setting("work_hours_end")?
                .unwrap_or_else(|| "18:00".into()),
            launch_at_login: self
                .get_setting("launch_at_login")?
                .map(|v| v == "1")
                .unwrap_or(false),
            confirm_before_log: self
                .get_setting("confirm_before_log")?
                .map(|v| v == "1")
                .unwrap_or(false),
            focus_goal_mins: self
                .get_setting("focus_goal_mins")?
                .and_then(|v| v.parse().ok())
                .unwrap_or(360),
            calendar_enabled: self
                .get_setting("calendar_enabled")?
                .map(|v| v == "1")
                .unwrap_or(false),
            track_titles: self
                .get_setting("track_titles")?
                .map(|v| v != "0")
                .unwrap_or(true),
            url_mode: self
                .get_setting("url_mode")?
                .unwrap_or_else(|| "full".into()),
            schedule_json: self
                .get_setting("schedule_json")?
                .unwrap_or_default(),
        })
    }

    pub fn update_tracker_settings(&self, settings: &TrackerSettings) -> Result<()> {
        self.set_setting(
            "idle_threshold_secs",
            &settings.idle_threshold_secs.to_string(),
        )?;
        self.set_setting(
            "work_hours_enabled",
            if settings.work_hours_enabled { "1" } else { "0" },
        )?;
        self.set_setting("work_hours_start", &settings.work_hours_start)?;
        self.set_setting("work_hours_end", &settings.work_hours_end)?;
        self.set_setting(
            "launch_at_login",
            if settings.launch_at_login { "1" } else { "0" },
        )?;
        self.set_setting(
            "confirm_before_log",
            if settings.confirm_before_log { "1" } else { "0" },
        )?;
        self.set_setting("focus_goal_mins", &settings.focus_goal_mins.to_string())?;
        self.set_setting(
            "calendar_enabled",
            if settings.calendar_enabled { "1" } else { "0" },
        )?;
        self.set_setting(
            "track_titles",
            if settings.track_titles { "1" } else { "0" },
        )?;
        let mode = match settings.url_mode.as_str() {
            "off" | "domain" => settings.url_mode.as_str(),
            _ => "full",
        };
        self.set_setting("url_mode", mode)?;
        self.set_setting("schedule_json", &settings.schedule_json)?;
        Ok(())
    }

    /// True when schedule allows tracking at this local weekday + time.
    pub fn within_work_hours(&self, now_hhmm: &str) -> Result<bool> {
        let settings = self.tracker_settings()?;
        if let Some(ok) = schedule_allows(&settings.schedule_json, now_hhmm) {
            return Ok(ok);
        }
        if !settings.work_hours_enabled {
            return Ok(true);
        }
        let start = settings.work_hours_start.as_str();
        let end = settings.work_hours_end.as_str();
        if start <= end {
            Ok(now_hhmm >= start && now_hhmm < end)
        } else {
            Ok(now_hhmm >= start || now_hhmm < end)
        }
    }

    /// Apply privacy filters to captured title/URL before persist.
    pub fn filter_capture_fields(
        &self,
        title: Option<&str>,
        url: Option<&str>,
    ) -> Result<(Option<String>, Option<String>)> {
        let settings = self.tracker_settings()?;
        let title_out = if settings.track_titles {
            title.map(|s| s.to_string())
        } else {
            None
        };
        let url_out = match settings.url_mode.as_str() {
            "off" => None,
            "domain" => url.map(domain_only),
            _ => url.map(|s| s.to_string()),
        };
        Ok((title_out, url_out))
    }

    pub fn is_excluded_by_rules(
        &self,
        app_name: &str,
        title: Option<&str>,
        url: Option<&str>,
    ) -> Result<bool> {
        let rules = self.list_rules()?;
        let app_l = app_name.to_lowercase();
        let title_l = title.unwrap_or("").to_lowercase();
        let url_l = url.unwrap_or("").to_lowercase();
        for rule in rules.iter().filter(|r| r.enabled && r.action == "exclude") {
            let pat = rule.pattern.to_lowercase();
            if pat.is_empty() {
                continue;
            }
            let hay = match rule.match_field.as_str() {
                "app" => app_l.as_str(),
                "url" => url_l.as_str(),
                _ => title_l.as_str(),
            };
            if hay.contains(&pat) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn delete_sessions_in_range(&self, start: &str, end: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let changed = conn.execute(
            "DELETE FROM sessions WHERE started_at >= ?1 AND started_at <= ?2",
            params![start, end],
        )?;
        Ok(changed as i64)
    }

    pub fn create_manual_session(
        &self,
        title: &str,
        started_at: &str,
        ended_at: &str,
        client_id: Option<i64>,
        project_id: Option<i64>,
        task_id: Option<i64>,
        notes: Option<&str>,
        category: Option<&str>,
    ) -> Result<i64> {
        let category = category.or_else(|| {
            if notes.map(|n| n.eq_ignore_ascii_case("Focus session")).unwrap_or(false)
                || title.eq_ignore_ascii_case("focus")
            {
                Some("Focus")
            } else {
                Some("Other")
            }
        });
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO sessions (title, started_at, ended_at, idle, client_id, project_id, task_id, manual, notes, approved, confidence, pending, category)
             VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, 1, ?7, 1, 1.0, 0, ?8)",
            params![
                title,
                started_at,
                ended_at,
                client_id,
                project_id,
                task_id,
                notes,
                category
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn approve_session(&self, session_id: i64, approved: bool) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE sessions SET approved = ?1, pending = 0, updated_at = datetime('now') WHERE id = ?2",
            params![approved as i64, session_id],
        )?;
        Ok(())
    }

    pub fn list_pending_sessions(&self) -> Result<Vec<SessionRow>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT s.id, s.app_id, a.name, s.title, s.url, s.started_at, s.ended_at, s.idle,
                    s.client_id, s.project_id, s.task_id,
                    c.name, p.name, t.name,
                    s.approved, s.manual, s.notes, s.confidence, s.pending, s.category, s.billable
             FROM sessions s
             LEFT JOIN apps a ON a.id = s.app_id
             LEFT JOIN clients c ON c.id = s.client_id
             LEFT JOIN projects p ON p.id = s.project_id
             LEFT JOIN tasks t ON t.id = s.task_id
             WHERE s.pending = 1
             ORDER BY s.started_at DESC
             LIMIT 100",
        )?;
        let rows = stmt
            .query_map([], map_session_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn reject_pending_session(&self, session_id: i64) -> Result<()> {
        self.delete_session(session_id)
    }

    pub fn focus_digest_for_day(&self, day: &str) -> Result<FocusDigest> {
        let report = self.day_report(day)?;
        let settings = self.tracker_settings()?;
        let goal = settings.focus_goal_mins as i64;
        let focus = report.total_minutes;
        // Crude meeting heuristic: titles containing meet/zoom/teams
        let sessions = self.sessions_for_day(day)?;
        let meeting = sessions
            .iter()
            .filter(|s| {
                let t = s.title.as_deref().unwrap_or("").to_lowercase();
                !s.idle
                    && (t.contains("meet")
                        || t.contains("zoom")
                        || t.contains("teams")
                        || t.contains("call"))
            })
            .map(|s| session_minutes(&s.started_at, s.ended_at.as_deref()))
            .sum::<i64>();
        let deep = (focus - meeting).max(0);
        let score = if goal <= 0 {
            0.0
        } else {
            ((deep as f32 / goal as f32) * 100.0).clamp(0.0, 200.0)
        };
        Ok(FocusDigest {
            day: day.to_string(),
            focus_minutes: deep,
            meeting_minutes: meeting,
            idle_minutes: report.idle_minutes,
            focus_score: score,
            goal_minutes: goal,
            goal_pct: if goal > 0 {
                (deep as f32 / goal as f32 * 100.0).clamp(0.0, 200.0)
            } else {
                0.0
            },
            top_projects: report.by_project.into_iter().take(5).collect(),
        })
    }

    pub fn weekly_digest(&self, week_start: &str) -> Result<WeeklyDigest> {
        let start = chrono::NaiveDate::parse_from_str(week_start, "%Y-%m-%d")
            .map_err(|e| StoreError::Msg(e.to_string()))?;
        let mut days = Vec::new();
        for i in 0..7 {
            let d = (start + chrono::Duration::days(i))
                .format("%Y-%m-%d")
                .to_string();
            days.push(self.focus_digest_for_day(&d)?);
        }
        let total: i64 = days.iter().map(|d| d.focus_minutes).sum();
        let avg = if days.is_empty() {
            0.0
        } else {
            days.iter().map(|d| d.focus_score).sum::<f32>() / days.len() as f32
        };
        Ok(WeeklyDigest {
            week_start: week_start.to_string(),
            days,
            total_focus_minutes: total,
            avg_focus_score: avg,
        })
    }

    pub fn list_calendar_events(&self, day: &str) -> Result<Vec<CalendarEvent>> {
        let start = format!("{day}T00:00:00");
        let end = format!("{day}T23:59:59");
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, title, started_at, ended_at, source FROM calendar_events
             WHERE started_at <= ?2 AND ended_at >= ?1
             ORDER BY started_at ASC",
        )?;
        let rows = stmt
            .query_map(params![start, end], |row| {
                Ok(CalendarEvent {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    started_at: row.get(2)?,
                    ended_at: row.get(3)?,
                    source: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Minimal ICS parser: VEVENT SUMMARY / DTSTART / DTEND (local floating or basic UTC Z).
    pub fn import_ics(&self, ics: &str) -> Result<i64> {
        let mut count = 0i64;
        let mut title = String::new();
        let mut start = String::new();
        let mut end = String::new();
        let mut in_event = false;

        for raw in ics.lines() {
            let line = raw.trim();
            if line == "BEGIN:VEVENT" {
                in_event = true;
                title.clear();
                start.clear();
                end.clear();
                continue;
            }
            if line == "END:VEVENT" {
                if in_event && !title.is_empty() && !start.is_empty() && !end.is_empty() {
                    let conn = self.conn.lock().expect("store mutex poisoned");
                    conn.execute(
                        "INSERT INTO calendar_events (title, started_at, ended_at, source)
                         VALUES (?1, ?2, ?3, 'ics')",
                        params![title, start, end],
                    )?;
                    count += 1;
                }
                in_event = false;
                continue;
            }
            if !in_event {
                continue;
            }
            if let Some(v) = line.strip_prefix("SUMMARY:") {
                title = v.to_string();
            } else if let Some(v) = line.strip_prefix("DTSTART:") {
                start = ics_to_local(v);
            } else if let Some(v) = line.strip_prefix("DTSTART;") {
                if let Some((_, rest)) = v.split_once(':') {
                    start = ics_to_local(rest);
                }
            } else if let Some(v) = line.strip_prefix("DTEND:") {
                end = ics_to_local(v);
            } else if let Some(v) = line.strip_prefix("DTEND;") {
                if let Some((_, rest)) = v.split_once(':') {
                    end = ics_to_local(rest);
                }
            }
        }
        Ok(count)
    }

    pub fn suggest_sessions_from_calendar(&self, day: &str) -> Result<i64> {
        let events = self.list_calendar_events(day)?;
        let mut created = 0i64;
        for ev in events {
            let exists = {
                let conn = self.conn.lock().expect("store mutex poisoned");
                conn.query_row(
                    "SELECT COUNT(1) FROM sessions WHERE manual = 1 AND title = ?1 AND started_at = ?2",
                    params![ev.title, ev.started_at],
                    |row| row.get::<_, i64>(0),
                )?
            };
            if exists > 0 {
                continue;
            }
            self.create_manual_session(
                &ev.title,
                &ev.started_at,
                &ev.ended_at,
                None,
                None,
                None,
                Some("From calendar"),
                Some("Meeting"),
            )?;
            created += 1;
        }
        Ok(created)
    }

    pub fn get_session(&self, session_id: i64) -> Result<Option<SessionRow>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let row = conn
            .query_row(
                "SELECT s.id, s.app_id, a.name, s.title, s.url, s.started_at, s.ended_at, s.idle,
                        s.client_id, s.project_id, s.task_id,
                        c.name, p.name, t.name,
                        s.approved, s.manual, s.notes, s.confidence, s.pending, s.category, s.billable
                 FROM sessions s
                 LEFT JOIN apps a ON a.id = s.app_id
                 LEFT JOIN clients c ON c.id = s.client_id
                 LEFT JOIN projects p ON p.id = s.project_id
                 LEFT JOIN tasks t ON t.id = s.task_id
                 WHERE s.id = ?1",
                params![session_id],
                map_session_row,
            )
            .optional()?;
        Ok(row)
    }

    pub fn update_session(
        &self,
        session_id: i64,
        title: Option<&str>,
        started_at: &str,
        ended_at: Option<&str>,
        notes: Option<&str>,
        client_id: Option<i64>,
        project_id: Option<i64>,
        task_id: Option<i64>,
        category: Option<&str>,
    ) -> Result<()> {
        if let Some(end) = ended_at {
            if end < started_at {
                return Err(StoreError::Msg(
                    "ended_at must be >= started_at".into(),
                ));
            }
        }
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE sessions SET title = ?1, started_at = ?2, ended_at = ?3, notes = ?4,
             client_id = ?5, project_id = ?6, task_id = ?7, category = ?8, updated_at = datetime('now')
             WHERE id = ?9",
            params![
                title,
                started_at,
                ended_at,
                notes,
                client_id,
                project_id,
                task_id,
                category,
                session_id
            ],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, session_id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
        Ok(())
    }

    /// Merge multiple sessions into the earliest one (min start → max end).
    pub fn merge_sessions(&self, ids: &[i64]) -> Result<i64> {
        if ids.len() < 2 {
            return Err(StoreError::Msg("merge needs at least 2 sessions".into()));
        }
        let mut rows = Vec::new();
        for id in ids {
            let Some(row) = self.get_session(*id)? else {
                return Err(StoreError::Msg(format!("session {id} not found")));
            };
            rows.push(row);
        }
        rows.sort_by(|a, b| a.started_at.cmp(&b.started_at));

        let keep_id = rows[0].id;
        let started_at = rows[0].started_at.clone();
        let ended_at = rows
            .iter()
            .filter_map(|r| r.ended_at.clone())
            .max()
            .or_else(|| rows.last().and_then(|r| r.ended_at.clone()));

        let title = rows
            .iter()
            .find_map(|r| r.title.clone().filter(|t| !t.is_empty()))
            .or_else(|| rows[0].title.clone());
        let notes = rows.iter().find_map(|r| r.notes.clone());
        let tagged = rows
            .iter()
            .find(|r| r.client_id.is_some() || r.project_id.is_some() || r.task_id.is_some())
            .unwrap_or(&rows[0]);

        let category = rows
            .iter()
            .find_map(|r| r.category.clone())
            .or_else(|| rows[0].category.clone());
        self.update_session(
            keep_id,
            title.as_deref(),
            &started_at,
            ended_at.as_deref(),
            notes.as_deref(),
            tagged.client_id,
            tagged.project_id,
            tagged.task_id,
            category.as_deref(),
        )?;

        let conn = self.conn.lock().expect("store mutex poisoned");
        for row in rows.iter().skip(1) {
            conn.execute("DELETE FROM sessions WHERE id = ?1", params![row.id])?;
        }
        Ok(keep_id)
    }

    /// Split a session at `at` (local `YYYY-MM-DDTHH:MM:SS`). Returns the new session id.
    pub fn split_session(&self, session_id: i64, at: &str) -> Result<i64> {
        let Some(row) = self.get_session(session_id)? else {
            return Err(StoreError::Msg(format!("session {session_id} not found")));
        };
        let ended = row
            .ended_at
            .clone()
            .ok_or_else(|| StoreError::Msg("cannot split an open session".into()))?;
        if at <= row.started_at.as_str() || at >= ended.as_str() {
            return Err(StoreError::Msg(
                "split time must be strictly inside the session".into(),
            ));
        }

        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "UPDATE sessions SET ended_at = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![at, session_id],
            )?;
            conn.execute(
                "INSERT INTO sessions (app_id, title, url, started_at, ended_at, idle,
                 client_id, project_id, task_id, approved, manual, notes, confidence, pending, category)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    row.app_id,
                    row.title,
                    row.url,
                    at,
                    ended,
                    row.idle as i64,
                    row.client_id,
                    row.project_id,
                    row.task_id,
                    row.approved as i64,
                    row.manual as i64,
                    row.notes,
                    row.confidence.map(|c| c as f64),
                    row.pending as i64,
                    row.category,
                ],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }

    pub fn day_report(&self, day: &str) -> Result<DayReport> {
        let sessions = self.sessions_for_day(day)?;
        Ok(aggregate_report(&sessions))
    }

    pub fn export_csv_for_day(&self, day: &str) -> Result<String> {
        let sessions = self.sessions_for_day(day)?;
        let mut out = String::from(
            "id,started_at,ended_at,app,title,client,project,task,idle,manual,approved,notes\n",
        );
        for s in sessions {
            out.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},{},{},{}\n",
                s.id,
                csv_escape(&s.started_at),
                csv_escape(s.ended_at.as_deref().unwrap_or("")),
                csv_escape(s.app_name.as_deref().unwrap_or("")),
                csv_escape(s.title.as_deref().unwrap_or("")),
                csv_escape(s.client_name.as_deref().unwrap_or("")),
                csv_escape(s.project_name.as_deref().unwrap_or("")),
                csv_escape(s.task_name.as_deref().unwrap_or("")),
                s.idle as u8,
                s.manual as u8,
                s.approved as u8,
                csv_escape(s.notes.as_deref().unwrap_or("")),
            ));
        }
        Ok(out)
    }

    /// Resolve the default DB path under the OS app-data directory.
    pub fn default_db_path(app_data_dir: impl AsRef<Path>) -> PathBuf {
        app_data_dir.as_ref().join("autotrace.db")
    }
}

fn ics_to_local(raw: &str) -> String {
    // 20260905T100000Z or 20260905T100000
    let s = raw.trim();
    if s.len() >= 15 {
        let date = &s[0..8];
        let time = &s[9..15];
        format!(
            "{}-{}-{}T{}:{}:{}",
            &date[0..4],
            &date[4..6],
            &date[6..8],
            &time[0..2],
            &time[2..4],
            &time[4..6]
        )
    } else {
        s.to_string()
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        app_id: row.get(1)?,
        app_name: row.get(2)?,
        title: row.get(3)?,
        url: row.get(4)?,
        started_at: row.get(5)?,
        ended_at: row.get(6)?,
        idle: row.get::<_, i64>(7)? != 0,
        client_id: row.get(8)?,
        project_id: row.get(9)?,
        task_id: row.get(10)?,
        client_name: row.get(11)?,
        project_name: row.get(12)?,
        task_name: row.get(13)?,
        approved: row.get::<_, i64>(14)? != 0,
        manual: row.get::<_, i64>(15)? != 0,
        notes: row.get(16)?,
        confidence: row
            .get::<_, Option<f64>>(17)?
            .map(|v| v as f32),
        pending: row.get::<_, Option<i64>>(18)?.unwrap_or(0) != 0,
        category: row.get(19)?,
        billable: row.get::<_, Option<i64>>(20)?.unwrap_or(1) != 0,
    })
}

fn session_minutes(started: &str, ended: Option<&str>) -> i64 {
    let Ok(start) = chrono::NaiveDateTime::parse_from_str(started, "%Y-%m-%dT%H:%M:%S") else {
        return 0;
    };
    let end = ended
        .and_then(|e| chrono::NaiveDateTime::parse_from_str(e, "%Y-%m-%dT%H:%M:%S").ok())
        .unwrap_or(start);
    (end - start).num_minutes().max(0)
}

fn aggregate_report(sessions: &[SessionRow]) -> DayReport {
    use std::collections::HashMap;

    let mut by_project: HashMap<String, ReportBucket> = HashMap::new();
    let mut by_app: HashMap<String, ReportBucket> = HashMap::new();
    let mut by_client: HashMap<String, ReportBucket> = HashMap::new();
    let mut total = 0i64;
    let mut idle = 0i64;

    for s in sessions {
        let mins = session_minutes(&s.started_at, s.ended_at.as_deref());
        if s.idle {
            idle += mins;
            continue;
        }
        total += mins;

        let project_key = s
            .project_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "untagged".into());
        let project_label = s
            .project_name
            .clone()
            .unwrap_or_else(|| "Untagged".into());
        bump_bucket(&mut by_project, &project_key, &project_label, mins);

        let app_key = s
            .app_name
            .clone()
            .unwrap_or_else(|| "Unknown".into());
        bump_bucket(&mut by_app, &app_key, &app_key, mins);

        let client_key = s
            .client_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "untagged".into());
        let client_label = s
            .client_name
            .clone()
            .unwrap_or_else(|| "Untagged".into());
        bump_bucket(&mut by_client, &client_key, &client_label, mins);
    }

    let sort = |a: &ReportBucket, b: &ReportBucket| b.minutes.cmp(&a.minutes);
    let mut by_project: Vec<_> = by_project.into_values().collect();
    let mut by_app: Vec<_> = by_app.into_values().collect();
    let mut by_client: Vec<_> = by_client.into_values().collect();
    by_project.sort_by(sort);
    by_app.sort_by(sort);
    by_client.sort_by(sort);

    DayReport {
        by_project,
        by_app,
        by_client,
        total_minutes: total,
        idle_minutes: idle,
    }
}

fn bump_bucket(
    map: &mut std::collections::HashMap<String, ReportBucket>,
    key: &str,
    label: &str,
    mins: i64,
) {
    let entry = map.entry(key.to_string()).or_insert(ReportBucket {
        key: key.to_string(),
        label: label.to_string(),
        minutes: 0,
        sessions: 0,
    });
    entry.minutes += mins;
    entry.sessions += 1;
}

impl Store {
    pub fn list_integrations(&self) -> Result<Vec<IntegrationRow>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, kind, enabled, config_json, created_at, updated_at
             FROM integrations ORDER BY kind ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(IntegrationRow {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    enabled: row.get::<_, i64>(2)? != 0,
                    config_json: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_integration_by_kind(&self, kind: &str) -> Result<Option<IntegrationRow>> {
        Ok(self
            .list_integrations()?
            .into_iter()
            .find(|i| i.kind == kind))
    }

    pub fn any_integration_enabled(&self) -> Result<bool> {
        Ok(self.list_integrations()?.iter().any(|i| i.enabled))
    }

    pub fn update_integration(
        &self,
        kind: &str,
        enabled: bool,
        config_json: &str,
    ) -> Result<IntegrationRow> {
        // Validate JSON
        let _: serde_json::Value = serde_json::from_str(config_json)
            .map_err(|e| StoreError::Msg(format!("invalid config_json: {e}")))?;
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "INSERT INTO integrations (kind, enabled, config_json)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(kind) DO UPDATE SET
                   enabled = excluded.enabled,
                   config_json = excluded.config_json,
                   updated_at = datetime('now')",
                params![kind, enabled as i64, config_json],
            )?;
        }
        self.get_integration_by_kind(kind)?
            .ok_or_else(|| StoreError::Msg("integration missing after upsert".into()))
    }

    /// Disable + wipe secrets/config + sync log + mappings for one connector.
    pub fn disconnect_integration(&self, kind: &str) -> Result<()> {
        let Some(row) = self.get_integration_by_kind(kind)? else {
            return Ok(());
        };
        let default = if kind == "local_api" {
            r#"{"port":17890}"#
        } else {
            "{}"
        };
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "DELETE FROM integration_sync_log WHERE integration_id = ?1",
            params![row.id],
        )?;
        conn.execute(
            "DELETE FROM integration_mappings WHERE integration_id = ?1",
            params![row.id],
        )?;
        conn.execute(
            "UPDATE integrations SET enabled = 0, config_json = ?1, updated_at = datetime('now')
             WHERE id = ?2",
            params![default, row.id],
        )?;
        Ok(())
    }

    pub fn set_mapping(
        &self,
        integration_id: i64,
        local_type: &str,
        local_id: i64,
        remote_id: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO integration_mappings (integration_id, local_type, local_id, remote_id)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(integration_id, local_type, local_id)
             DO UPDATE SET remote_id = excluded.remote_id",
            params![integration_id, local_type, local_id, remote_id],
        )?;
        Ok(())
    }

    pub fn get_mapping(
        &self,
        integration_id: i64,
        local_type: &str,
        local_id: i64,
    ) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let v = conn
            .query_row(
                "SELECT remote_id FROM integration_mappings
                 WHERE integration_id = ?1 AND local_type = ?2 AND local_id = ?3",
                params![integration_id, local_type, local_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(v)
    }

    pub fn record_sync(
        &self,
        integration_id: i64,
        session_id: i64,
        status: &str,
        remote_id: Option<&str>,
        detail: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO integration_sync_log (integration_id, session_id, remote_id, status, detail)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(integration_id, session_id) DO UPDATE SET
               remote_id = excluded.remote_id,
               status = excluded.status,
               detail = excluded.detail,
               synced_at = datetime('now')",
            params![integration_id, session_id, remote_id, status, detail],
        )?;
        Ok(())
    }

    pub fn list_sync_log(&self, integration_id: Option<i64>) -> Result<Vec<SyncLogRow>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut rows = Vec::new();
        if let Some(id) = integration_id {
            let mut stmt = conn.prepare(
                "SELECT id, integration_id, session_id, remote_id, status, detail, synced_at
                 FROM integration_sync_log WHERE integration_id = ?1
                 ORDER BY synced_at DESC LIMIT 100",
            )?;
            let mapped = stmt.query_map(params![id], map_sync_log)?;
            for r in mapped {
                rows.push(r?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, integration_id, session_id, remote_id, status, detail, synced_at
                 FROM integration_sync_log ORDER BY synced_at DESC LIMIT 100",
            )?;
            let mapped = stmt.query_map([], map_sync_log)?;
            for r in mapped {
                rows.push(r?);
            }
        }
        Ok(rows)
    }

    /// Privacy gate: approved, not pending, not idle, tagged to client or project.
    pub fn eligible_export_entries(
        &self,
        include_unsynced_for: Option<i64>,
    ) -> Result<Vec<ExportEntry>> {
        let sessions = {
            let conn = self.conn.lock().expect("store mutex poisoned");
            let mut stmt = conn.prepare(
                "SELECT s.id, s.app_id, a.name, s.title, s.url, s.started_at, s.ended_at, s.idle,
                        s.client_id, s.project_id, s.task_id,
                        c.name, p.name, t.name,
                        s.approved, s.manual, s.notes, s.confidence, s.pending, s.category, s.billable
                 FROM sessions s
                 LEFT JOIN apps a ON a.id = s.app_id
                 LEFT JOIN clients c ON c.id = s.client_id
                 LEFT JOIN projects p ON p.id = s.project_id
                 LEFT JOIN tasks t ON t.id = s.task_id
                 WHERE s.approved = 1 AND s.pending = 0 AND s.idle = 0
                   AND (s.client_id IS NOT NULL OR s.project_id IS NOT NULL)
                   AND s.ended_at IS NOT NULL
                 ORDER BY s.started_at DESC
                 LIMIT 500",
            )?;
            let rows = stmt
                .query_map([], map_session_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };

        let mut out = Vec::new();
        for s in sessions {
            if let Some(iid) = include_unsynced_for {
                if self.already_synced_ok(iid, s.id)? {
                    continue;
                }
            }
            out.push(session_to_export_entry(&s));
        }
        Ok(out)
    }

    pub fn export_entry_by_id(&self, session_id: i64) -> Result<Option<ExportEntry>> {
        let Some(s) = self.get_session(session_id)? else {
            return Ok(None);
        };
        if !s.approved || s.pending || s.idle || (s.client_id.is_none() && s.project_id.is_none()) {
            return Ok(None);
        }
        if s.ended_at.is_none() {
            return Ok(None);
        }
        Ok(Some(session_to_export_entry(&s)))
    }

    fn already_synced_ok(&self, integration_id: i64, session_id: i64) -> Result<bool> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let status: Option<String> = conn
            .query_row(
                "SELECT status FROM integration_sync_log
                 WHERE integration_id = ?1 AND session_id = ?2",
                params![integration_id, session_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(matches!(status.as_deref(), Some("ok")))
    }

    // —— Focus timer ——

    pub fn get_active_focus(&self) -> Result<Option<FocusSession>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let row = conn
            .query_row(
                "SELECT f.id, f.goal, f.client_id, f.project_id, f.task_id,
                        c.name, p.name, t.name, f.started_at, f.ended_at, f.status,
                        IFNULL(f.accumulated_secs, 0), f.segment_started_at, f.paused_at
                 FROM focus_sessions f
                 LEFT JOIN clients c ON c.id = f.client_id
                 LEFT JOIN projects p ON p.id = f.project_id
                 LEFT JOIN tasks t ON t.id = f.task_id
                 WHERE f.status IN ('active', 'paused')
                 ORDER BY f.id DESC LIMIT 1",
                [],
                map_focus_row,
            )
            .optional()?;
        Ok(row)
    }

    pub fn start_focus(
        &self,
        goal: Option<&str>,
        client_id: Option<i64>,
        project_id: Option<i64>,
        task_id: Option<i64>,
    ) -> Result<FocusSession> {
        if self.get_active_focus()?.is_some() {
            return Err(StoreError::Msg(
                "A focus session is already running — end it first".into(),
            ));
        }
        let now = chrono::Local::now()
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "INSERT INTO focus_sessions (goal, client_id, project_id, task_id, started_at, status, accumulated_secs, segment_started_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'active', 0, ?5)",
                params![goal, client_id, project_id, task_id, now],
            )?;
        }
        self.get_active_focus()?
            .ok_or_else(|| StoreError::Msg("failed to start focus".into()))
    }

    pub fn pause_focus(&self) -> Result<Option<FocusSession>> {
        let Some(active) = self.get_active_focus()? else {
            return Ok(None);
        };
        if active.status != "active" {
            return Ok(Some(active));
        }
        let now = chrono::Local::now()
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        let segment = active
            .started_at
            .clone(); // overwritten below from DB
        let conn = self.conn.lock().expect("store mutex poisoned");
        let (accum, segment_started): (i64, String) = conn.query_row(
            "SELECT IFNULL(accumulated_secs,0), IFNULL(segment_started_at, started_at)
             FROM focus_sessions WHERE id = ?1",
            params![active.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let _ = segment;
        let extra = (parse_local_ts(&now) - parse_local_ts(&segment_started)).max(0);
        conn.execute(
            "UPDATE focus_sessions SET status = 'paused', paused_at = ?1, accumulated_secs = ?2
             WHERE id = ?3",
            params![now, accum + extra, active.id],
        )?;
        drop(conn);
        self.get_active_focus()
    }

    pub fn resume_focus(&self) -> Result<Option<FocusSession>> {
        let Some(active) = self.get_active_focus()? else {
            return Ok(None);
        };
        if active.status != "paused" {
            return Ok(Some(active));
        }
        let now = chrono::Local::now()
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "UPDATE focus_sessions SET status = 'active', paused_at = NULL, segment_started_at = ?1
                 WHERE id = ?2",
                params![now, active.id],
            )?;
        }
        self.get_active_focus()
    }

    pub fn end_focus(&self) -> Result<Option<FocusSession>> {
        let Some(active) = self.get_active_focus()? else {
            return Ok(None);
        };
        let now = chrono::Local::now()
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            let (accum, segment_started, status): (i64, String, String) = conn.query_row(
                "SELECT IFNULL(accumulated_secs,0), IFNULL(segment_started_at, started_at), status
                 FROM focus_sessions WHERE id = ?1",
                params![active.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            let final_accum = if status == "active" {
                accum + (parse_local_ts(&now) - parse_local_ts(&segment_started)).max(0)
            } else {
                accum
            };
            conn.execute(
                "UPDATE focus_sessions SET ended_at = ?1, status = 'ended', accumulated_secs = ?2, paused_at = NULL
                 WHERE id = ?3",
                params![now, final_accum, active.id],
            )?;
        }
        // Mirror onto calendar as a tagged manual session.
        let title = active
            .goal
            .clone()
            .filter(|g| !g.trim().is_empty())
            .unwrap_or_else(|| "Focus".into());
        let _ = self.create_manual_session(
            &title,
            &active.started_at,
            &now,
            active.client_id,
            active.project_id,
            active.task_id,
            Some("Focus session"),
            Some("Focus"),
        );
        let conn = self.conn.lock().expect("store mutex poisoned");
        let row = conn.query_row(
            "SELECT f.id, f.goal, f.client_id, f.project_id, f.task_id,
                    c.name, p.name, t.name, f.started_at, f.ended_at, f.status,
                    IFNULL(f.accumulated_secs, 0), f.segment_started_at, f.paused_at
             FROM focus_sessions f
             LEFT JOIN clients c ON c.id = f.client_id
             LEFT JOIN projects p ON p.id = f.project_id
             LEFT JOIN tasks t ON t.id = f.task_id
             WHERE f.id = ?1",
            params![active.id],
            map_focus_row,
        )?;
        Ok(Some(row))
    }

    pub fn list_focus_for_day(&self, day: &str) -> Result<Vec<FocusSession>> {
        let start = format!("{day}T00:00:00");
        let end = format!("{day}T23:59:59");
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT f.id, f.goal, f.client_id, f.project_id, f.task_id,
                    c.name, p.name, t.name, f.started_at, f.ended_at, f.status,
                    IFNULL(f.accumulated_secs, 0), f.segment_started_at, f.paused_at
             FROM focus_sessions f
             LEFT JOIN clients c ON c.id = f.client_id
             LEFT JOIN projects p ON p.id = f.project_id
             LEFT JOIN tasks t ON t.id = f.task_id
             WHERE f.started_at >= ?1 AND f.started_at <= ?2
             ORDER BY f.started_at ASC",
        )?;
        let rows = stmt
            .query_map(params![start, end], map_focus_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // —— Activity events ——

    pub fn record_activity_event(
        &self,
        app_name: &str,
        title: Option<&str>,
        url: Option<&str>,
        recorded_at: &str,
    ) -> Result<i64> {
        let (title, url) = self.filter_capture_fields(title, url)?;
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO activity_events (app_name, title, url, recorded_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![app_name, title, url, recorded_at],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_activity_events(
        &self,
        day: &str,
        query: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ActivityEvent>> {
        let start = format!("{day}T00:00:00");
        let end = format!("{day}T23:59:59");
        let conn = self.conn.lock().expect("store mutex poisoned");
        let lim = limit.clamp(1, 2000);
        let mut out = Vec::new();
        if let Some(q) = query.filter(|s| !s.trim().is_empty()) {
            let like = format!("%{}%", q.trim().to_lowercase());
            let mut stmt = conn.prepare(
                "SELECT id, app_name, title, url, recorded_at FROM activity_events
                 WHERE recorded_at >= ?1 AND recorded_at <= ?2
                   AND (lower(app_name) LIKE ?3 OR lower(IFNULL(title,'')) LIKE ?3
                        OR lower(IFNULL(url,'')) LIKE ?3)
                 ORDER BY recorded_at DESC LIMIT ?4",
            )?;
            let rows = stmt.query_map(params![start, end, like, lim], map_activity_row)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, app_name, title, url, recorded_at FROM activity_events
                 WHERE recorded_at >= ?1 AND recorded_at <= ?2
                 ORDER BY recorded_at DESC LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![start, end, lim], map_activity_row)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    }

    pub fn list_activity_events_in_range(
        &self,
        started_at: &str,
        ended_at: &str,
        limit: i64,
    ) -> Result<Vec<ActivityEvent>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let lim = limit.clamp(1, 2000);
        let mut stmt = conn.prepare(
            "SELECT id, app_name, title, url, recorded_at FROM activity_events
             WHERE recorded_at >= ?1 AND recorded_at <= ?2
             ORDER BY recorded_at ASC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![started_at, ended_at, lim], map_activity_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn delete_activity_event(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM activity_events WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn activity_app_breakdown(&self, day: &str) -> Result<Vec<AppUsageBucket>> {
        let events = self.list_activity_events(day, None, 2000)?;
        if events.is_empty() {
            return Ok(vec![]);
        }
        // Approximate duration: gap to next event (capped 5 min), newest-first list so reverse.
        let mut chronological = events;
        chronological.sort_by(|a, b| a.recorded_at.cmp(&b.recorded_at));
        let mut map: std::collections::HashMap<String, AppUsageBucket> =
            std::collections::HashMap::new();
        for i in 0..chronological.len() {
            let e = &chronological[i];
            let start = parse_local_ts(&e.recorded_at);
            let end = chronological
                .get(i + 1)
                .map(|n| parse_local_ts(&n.recorded_at))
                .unwrap_or_else(|| chrono::Local::now().timestamp());
            let secs = (end - start).clamp(0, 300);
            let mins = ((secs as f64) / 60.0).round() as i64;
            let key = e.app_name.clone();
            let entry = map.entry(key.clone()).or_insert(AppUsageBucket {
                key: key.clone(),
                label: key,
                minutes: 0,
                events: 0,
            });
            entry.minutes += mins.max(0);
            entry.events += 1;
        }
        let mut buckets: Vec<_> = map.into_values().collect();
        buckets.sort_by(|a, b| b.minutes.cmp(&a.minutes));
        Ok(buckets)
    }

    pub fn redact_activity_metadata(&self) -> Result<i64> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let a = conn.execute("UPDATE activity_events SET title = NULL, url = NULL", [])?;
        let b = conn.execute("UPDATE sessions SET title = NULL, url = NULL", [])?;
        Ok((a + b) as i64)
    }

    // —— Phase 4: rates, profitability, workspaces, block rules ——

    pub fn insert_calendar_event(
        &self,
        title: &str,
        started_at: &str,
        ended_at: &str,
        source: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO calendar_events (title, started_at, ended_at, source) VALUES (?1, ?2, ?3, ?4)",
            params![title, started_at, ended_at, source],
        )?;
        Ok(conn.last_insert_rowid())
    }


    pub fn set_client_rate(&self, client_id: i64, hourly_rate: Option<f64>) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE clients SET hourly_rate = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![hourly_rate, client_id],
        )?;
        Ok(())
    }

    pub fn set_project_rate(
        &self,
        project_id: i64,
        hourly_rate: Option<f64>,
        budget_hours: Option<f64>,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE projects SET hourly_rate = ?1, budget_hours = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![hourly_rate, budget_hours, project_id],
        )?;
        Ok(())
    }

    pub fn set_session_billable(&self, session_id: i64, billable: bool) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE sessions SET billable = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![billable as i64, session_id],
        )?;
        Ok(())
    }

    pub fn profitability_report(&self, from_day: &str, to_day: &str) -> Result<ProfitabilityReport> {
        use std::collections::HashMap;
        let start = format!("{from_day}T00:00:00");
        let end = format!("{to_day}T23:59:59");
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT s.started_at, s.ended_at, s.idle, s.billable,
                    s.client_id, s.project_id, c.name, p.name,
                    COALESCE(p.hourly_rate, c.hourly_rate, 0)
             FROM sessions s
             LEFT JOIN clients c ON c.id = s.client_id
             LEFT JOIN projects p ON p.id = s.project_id
             WHERE s.started_at <= ?2 AND IFNULL(s.ended_at, s.started_at) >= ?1",
        )?;
        let rows: Vec<(String, Option<String>, i64, i64, Option<i64>, Option<i64>, Option<String>, Option<String>, f64)> =
            stmt.query_map(params![start, end], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, Option<i64>>(3)?.unwrap_or(1),
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut tracked = 0i64;
        let mut billable_mins = 0i64;
        let mut by_client: HashMap<String, ProfitRow> = HashMap::new();
        let mut by_project: HashMap<String, ProfitRow> = HashMap::new();
        let mut revenue = 0.0;

        for (started, ended, idle, billable, cid, pid, cname, pname, rate) in rows {
            let mins = session_minutes(&started, ended.as_deref());
            if idle != 0 {
                continue;
            }
            tracked += mins;
            let is_billable = billable != 0 && (cid.is_some() || pid.is_some());
            if is_billable {
                billable_mins += mins;
                let rev = (mins as f64 / 60.0) * rate;
                revenue += rev;
                let ckey = cid.map(|id| id.to_string()).unwrap_or_else(|| "untagged".into());
                let clabel = cname.unwrap_or_else(|| "Untagged".into());
                let entry = by_client.entry(ckey.clone()).or_insert(ProfitRow {
                    key: ckey,
                    label: clabel,
                    minutes: 0,
                    billable_minutes: 0,
                    rate,
                    revenue: 0.0,
                });
                entry.minutes += mins;
                entry.billable_minutes += mins;
                entry.revenue += rev;
                if rate > entry.rate {
                    entry.rate = rate;
                }

                let pkey = pid.map(|id| id.to_string()).unwrap_or_else(|| "untagged".into());
                let plabel = pname.unwrap_or_else(|| "Untagged".into());
                let entry = by_project.entry(pkey.clone()).or_insert(ProfitRow {
                    key: pkey,
                    label: plabel,
                    minutes: 0,
                    billable_minutes: 0,
                    rate,
                    revenue: 0.0,
                });
                entry.minutes += mins;
                entry.billable_minutes += mins;
                entry.revenue += rev;
                if rate > entry.rate {
                    entry.rate = rate;
                }
            }
        }

        let capacity_hours: f64 = self
            .get_setting("capacity_hours_week")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(40.0);
        // Approximate capacity for range as weeks * capacity
        let days = {
            let a = chrono::NaiveDate::parse_from_str(from_day, "%Y-%m-%d").ok();
            let b = chrono::NaiveDate::parse_from_str(to_day, "%Y-%m-%d").ok();
            match (a, b) {
                (Some(a), Some(b)) => (b - a).num_days().max(0) + 1,
                _ => 7,
            }
        };
        let capacity_minutes = ((capacity_hours / 7.0) * days as f64 * 60.0).round() as i64;
        let utilization_pct = if capacity_minutes > 0 {
            (tracked as f32 / capacity_minutes as f32) * 100.0
        } else {
            0.0
        };

        let mut by_client: Vec<_> = by_client.into_values().collect();
        by_client.sort_by(|a, b| b.revenue.partial_cmp(&a.revenue).unwrap_or(std::cmp::Ordering::Equal));
        let mut by_project: Vec<_> = by_project.into_values().collect();
        by_project.sort_by(|a, b| b.revenue.partial_cmp(&a.revenue).unwrap_or(std::cmp::Ordering::Equal));

        Ok(ProfitabilityReport {
            from_day: from_day.into(),
            to_day: to_day.into(),
            tracked_minutes: tracked,
            billable_minutes: billable_mins,
            capacity_minutes,
            utilization_pct,
            revenue,
            by_client,
            by_project,
        })
    }

    pub fn client_pdf_html(&self, client_id: i64, from_day: &str, to_day: &str) -> Result<String> {
        let report = self.profitability_report(from_day, to_day)?;
        let client = report
            .by_client
            .iter()
            .find(|c| c.key == client_id.to_string());
        let name = client.map(|c| c.label.as_str()).unwrap_or("Client");
        let hours = client.map(|c| c.billable_minutes as f64 / 60.0).unwrap_or(0.0);
        let rev = client.map(|c| c.revenue).unwrap_or(0.0);
        let rate = client.map(|c| c.rate).unwrap_or(0.0);
        Ok(format!(
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>AutoTrace — {name}</title>
<style>body{{font-family:system-ui,sans-serif;padding:40px;color:#111}}h1{{font-size:22px}}table{{border-collapse:collapse;width:100%;margin-top:24px}}td,th{{border-bottom:1px solid #ddd;padding:8px;text-align:left}}.muted{{color:#666}}</style></head>
<body><h1>Time report — {name}</h1>
<p class="muted">{from_day} → {to_day} · Generated by AutoTrace (local)</p>
<p><strong>Billable hours:</strong> {hours:.2}<br>
<strong>Rate:</strong> ${rate:.2}/hr<br>
<strong>Amount:</strong> ${rev:.2}</p>
<p class="muted">Titles and URLs omitted for privacy.</p>
</body></html>"#
        ))
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, role, sync_url, is_active,
                    IFNULL(icon, 'briefcase'), IFNULL(settings_json, '{}')
             FROM workspaces ORDER BY id",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    role: row.get(2)?,
                    sync_url: row.get(3)?,
                    is_active: row.get::<_, i64>(4)? != 0,
                    icon: row.get(5)?,
                    settings_json: row.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_workspace(&self, name: &str) -> Result<Workspace> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let settings = default_workspace_settings_json();
        conn.execute(
            "INSERT INTO workspaces (name, role, is_active, icon, settings_json)
             VALUES (?1, 'owner', 0, 'briefcase', ?2)",
            params![name, settings],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Workspace {
            id,
            name: name.into(),
            role: "owner".into(),
            sync_url: None,
            is_active: false,
            icon: "briefcase".into(),
            settings_json: settings,
        })
    }

    pub fn update_workspace(
        &self,
        id: i64,
        name: &str,
        icon: &str,
        settings_json: &str,
    ) -> Result<Workspace> {
        // Validate JSON
        let _: serde_json::Value = serde_json::from_str(settings_json)
            .map_err(|e| StoreError::Msg(format!("invalid settings_json: {e}")))?;
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE workspaces SET name = ?1, icon = ?2, settings_json = ?3 WHERE id = ?4",
            params![name, icon, settings_json, id],
        )?;
        drop(conn);
        self.list_workspaces()?
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| StoreError::Msg("workspace not found".into()))
    }

    pub fn set_active_workspace(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("UPDATE workspaces SET is_active = 0", [])?;
        conn.execute("UPDATE workspaces SET is_active = 1 WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_workspace_sync(&self, id: i64, sync_url: Option<&str>, sync_token: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE workspaces SET sync_url = ?1, sync_token = ?2 WHERE id = ?3",
            params![sync_url, sync_token, id],
        )?;
        Ok(())
    }

    pub fn export_sync_pack(&self) -> Result<String> {
        let hierarchy = self.hierarchy()?;
        let workspaces = self.list_workspaces()?;
        let payload = serde_json::json!({
            "format": "autotrace-sync-v1",
            "exported_at": chrono::Local::now().to_rfc3339(),
            "workspaces": workspaces,
            "hierarchy": hierarchy,
        });
        Ok(payload.to_string())
    }

    pub fn workspace_sync_token(&self, id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.query_row(
            "SELECT sync_token FROM workspaces WHERE id = ?1",
            params![id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(Into::into)
    }

    /// Merge clients/projects/tasks from a sync pack (by name; does not delete local).
    pub fn import_sync_pack(&self, json: &str) -> Result<i64> {
        let v: serde_json::Value =
            serde_json::from_str(json).map_err(|e| StoreError::Msg(e.to_string()))?;
        let mut created = 0i64;
        let clients = v
            .pointer("/hierarchy/clients")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        for c in clients {
            let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("").trim();
            if name.is_empty() {
                continue;
            }
            let color = c.get("color").and_then(|x| x.as_str());
            let client = match self.hierarchy() {
                Ok(h) => h.clients.into_iter().find(|x| x.name.eq_ignore_ascii_case(name)),
                Err(_) => None,
            };
            let client_id = if let Some(existing) = client {
                existing.id
            } else {
                created += 1;
                self.create_client(name, color)?.id
            };
            let projects = c
                .get("projects")
                .and_then(|p| p.as_array())
                .cloned()
                .unwrap_or_default();
            for p in projects {
                let pname = p.get("name").and_then(|n| n.as_str()).unwrap_or("").trim();
                if pname.is_empty() {
                    continue;
                }
                let pcolor = p.get("color").and_then(|x| x.as_str());
                let existing_p = self.hierarchy()?.clients.iter().find(|c| c.id == client_id).and_then(|c| {
                    c.projects.iter().find(|x| x.name.eq_ignore_ascii_case(pname)).map(|x| x.id)
                });
                let project_id = if let Some(id) = existing_p {
                    id
                } else {
                    created += 1;
                    self.create_project(client_id, pname, pcolor)?.id
                };
                let tasks = p
                    .get("tasks")
                    .and_then(|t| t.as_array())
                    .cloned()
                    .unwrap_or_default();
                for t in tasks {
                    let tname = t.get("name").and_then(|n| n.as_str()).unwrap_or("").trim();
                    if tname.is_empty() {
                        continue;
                    }
                    let exists = self.hierarchy()?.clients.iter().find(|c| c.id == client_id).and_then(|c| {
                        c.projects.iter().find(|p| p.id == project_id).map(|p| {
                            p.tasks.iter().any(|x| x.name.eq_ignore_ascii_case(tname))
                        })
                    }).unwrap_or(false);
                    if !exists {
                        created += 1;
                        let _ = self.create_task(project_id, tname)?;
                    }
                }
            }
        }
        self.log_privacy_event("sync_import", Some(&format!("merged {created} items")))?;
        Ok(created)
    }

    pub fn log_privacy_event(&self, kind: &str, detail: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        // Table may not exist on very old DBs mid-migration; ignore failure softly.
        let _ = conn.execute(
            "INSERT INTO privacy_audit_log (kind, detail) VALUES (?1, ?2)",
            params![kind, detail],
        );
        Ok(())
    }

    pub fn list_privacy_audit(&self, limit: i64) -> Result<Vec<PrivacyAuditRow>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, kind, detail, created_at FROM privacy_audit_log
             ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(PrivacyAuditRow {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    detail: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn distraction_report(&self, day: &str) -> Result<DistractionReport> {
        let events = self.list_activity_events(day, None, 5000)?;
        let mut switches = 0i64;
        let mut last_app: Option<String> = None;
        let mut by_app: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        for e in &events {
            if last_app.as_ref().map(|a| !a.eq_ignore_ascii_case(&e.app_name)).unwrap_or(true) {
                switches += 1;
                last_app = Some(e.app_name.clone());
            }
            *by_app.entry(e.app_name.clone()).or_default() += 1;
        }
        let block_rules = self.list_block_rules().unwrap_or_default();
        let mut blocked_hits = 0i64;
        let mut top_distractions = Vec::new();
        for (app, count) in &by_app {
            let hit = block_rules.iter().any(|r| {
                r.enabled
                    && r.match_field == "app"
                    && app.to_lowercase().contains(&r.pattern.to_lowercase())
            });
            if hit {
                blocked_hits += count;
                top_distractions.push(ReportBucket {
                    key: app.clone(),
                    label: app.clone(),
                    minutes: count / 60, // events ≈ seconds at 1Hz-ish title changes; treat as rough
                    sessions: *count,
                });
            }
        }
        top_distractions.sort_by(|a, b| b.sessions.cmp(&a.sessions));
        top_distractions.truncate(5);
        // Score 0–100: fewer switches and blocked hits → higher focus.
        let switch_penalty = (switches as f32 / 40.0).min(1.0) * 50.0;
        let block_penalty = (blocked_hits as f32 / 60.0).min(1.0) * 50.0;
        let score = (100.0 - switch_penalty - block_penalty).clamp(0.0, 100.0);
        Ok(DistractionReport {
            day: day.into(),
            context_switches: switches,
            blocked_event_hits: blocked_hits,
            focus_score: score,
            top_distractions,
        })
    }

    /// Minimal PDF 1.4 bytes for a client profitability summary.
    pub fn client_pdf_bytes(&self, client_id: i64, from_day: &str, to_day: &str) -> Result<Vec<u8>> {
        let report = self.profitability_report(from_day, to_day)?;
        let client = report
            .by_client
            .iter()
            .find(|c| c.key == client_id.to_string());
        let name = client.map(|c| c.label.as_str()).unwrap_or("Client");
        let hours = client.map(|c| c.billable_minutes as f64 / 60.0).unwrap_or(0.0);
        let rev = client.map(|c| c.revenue).unwrap_or(0.0);
        let rate = client.map(|c| c.rate).unwrap_or(0.0);
        let lines = [
            format!("AutoTrace time report"),
            format!("{name}"),
            format!("{from_day} to {to_day}"),
            format!("Billable hours: {hours:.2}"),
            format!("Rate: ${rate:.2}/hr"),
            format!("Amount: ${rev:.2}"),
            "Titles and URLs omitted.".into(),
        ];
        Ok(build_simple_pdf(&lines))
    }

    pub fn list_block_rules(&self) -> Result<Vec<BlockRule>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, pattern, match_field, mode, enabled FROM block_rules ORDER BY id DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(BlockRule {
                    id: row.get(0)?,
                    pattern: row.get(1)?,
                    match_field: row.get(2)?,
                    mode: row.get(3)?,
                    enabled: row.get::<_, i64>(4)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_block_rule(&self, pattern: &str, match_field: &str, mode: &str) -> Result<BlockRule> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO block_rules (pattern, match_field, mode, enabled) VALUES (?1, ?2, ?3, 1)",
            params![pattern, match_field, mode],
        )?;
        let id = conn.last_insert_rowid();
        Ok(BlockRule {
            id,
            pattern: pattern.into(),
            match_field: match_field.into(),
            mode: mode.into(),
            enabled: true,
        })
    }

    pub fn delete_block_rule(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM block_rules WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn is_distraction_blocked(&self, app: &str, title: Option<&str>, url: Option<&str>) -> Result<Option<String>> {
        let enabled = self
            .get_setting("distraction_block")?
            .map(|v| v == "1")
            .unwrap_or(false);
        if !enabled {
            return Ok(None);
        }
        let rules = self.list_block_rules()?;
        let app_l = app.to_lowercase();
        let title_l = title.unwrap_or("").to_lowercase();
        let url_l = url.unwrap_or("").to_lowercase();
        for r in rules.into_iter().filter(|r| r.enabled) {
            let pat = r.pattern.to_lowercase();
            if pat.is_empty() {
                continue;
            }
            let hay = match r.match_field.as_str() {
                "url" => url_l.as_str(),
                "title" => title_l.as_str(),
                _ => app_l.as_str(),
            };
            if hay.contains(&pat) {
                return Ok(Some(r.mode));
            }
        }
        Ok(None)
    }

    pub fn upsert_oauth_token(
        &self,
        provider: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        expires_at: Option<&str>,
        account_label: Option<&str>,
        extra_json: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, account_label, extra_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
             ON CONFLICT(provider) DO UPDATE SET
               access_token = excluded.access_token,
               refresh_token = excluded.refresh_token,
               expires_at = excluded.expires_at,
               account_label = excluded.account_label,
               extra_json = excluded.extra_json,
               updated_at = datetime('now')",
            params![provider, access_token, refresh_token, expires_at, account_label, extra_json],
        )?;
        Ok(())
    }

    pub fn get_oauth_token(&self, provider: &str) -> Result<Option<(String, Option<String>, Option<String>)>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let row = conn
            .query_row(
                "SELECT access_token, refresh_token, account_label FROM oauth_tokens WHERE provider = ?1",
                params![provider],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        Ok(row)
    }

    pub fn clear_oauth_token(&self, provider: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM oauth_tokens WHERE provider = ?1", params![provider])?;
        Ok(())
    }


}

fn map_sync_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncLogRow> {
    Ok(SyncLogRow {
        id: row.get(0)?,
        integration_id: row.get(1)?,
        session_id: row.get(2)?,
        remote_id: row.get(3)?,
        status: row.get(4)?,
        detail: row.get(5)?,
        synced_at: row.get(6)?,
    })
}

fn map_focus_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FocusSession> {
    let started_at: String = row.get(8)?;
    let ended_at: Option<String> = row.get(9)?;
    let status: String = row.get(10)?;
    let accumulated: i64 = row.get::<_, i64>(11).unwrap_or(0);
    let segment_started: Option<String> = row.get(12)?;
    let now = chrono::Local::now().timestamp();
    let elapsed = match status.as_str() {
        "active" => {
            let seg = segment_started.as_deref().unwrap_or(&started_at);
            accumulated + (now - parse_local_ts(seg)).max(0)
        }
        "paused" => accumulated,
        _ => {
            ended_at
                .as_ref()
                .map(|_| accumulated)
                .unwrap_or(accumulated)
        }
    };
    Ok(FocusSession {
        id: row.get(0)?,
        goal: row.get(1)?,
        client_id: row.get(2)?,
        project_id: row.get(3)?,
        task_id: row.get(4)?,
        client_name: row.get(5)?,
        project_name: row.get(6)?,
        task_name: row.get(7)?,
        started_at,
        ended_at,
        status,
        elapsed_secs: elapsed,
    })
}

fn map_activity_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityEvent> {
    Ok(ActivityEvent {
        id: row.get(0)?,
        app_name: row.get(1)?,
        title: row.get(2)?,
        url: row.get(3)?,
        recorded_at: row.get(4)?,
    })
}

fn parse_local_ts(iso: &str) -> i64 {
    let normalized = if iso.contains('T') {
        iso.to_string()
    } else {
        iso.replace(' ', "T")
    };
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%dT%H:%M:%S") {
        return ndt
            .and_local_timezone(chrono::Local)
            .single()
            .map(|d| d.timestamp())
            .unwrap_or(0);
    }
    0
}

fn domain_only(url: &str) -> String {
    let trimmed = url.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    without_scheme
        .split('/')
        .next()
        .unwrap_or(without_scheme)
        .to_string()
}

/// Tiny PDF writer (Helvetica) — enough for a client summary page.
fn build_simple_pdf(lines: &[String]) -> Vec<u8> {
    let mut content = String::from("BT /F1 12 Tf 50 750 Td 14 TL\n");
    for (i, line) in lines.iter().enumerate() {
        let safe = line.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)");
        if i == 0 {
            content.push_str(&format!("({safe}) Tj\n"));
        } else {
            content.push_str(&format!("T* ({safe}) Tj\n"));
        }
    }
    content.push_str("ET");
    let content_bytes = content.as_bytes();
    let objects: Vec<String> = vec![
        "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n".into(),
        "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n".into(),
        "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n".into(),
        format!(
            "4 0 obj<< /Length {} >>stream\n{}\nendstream\nendobj\n",
            content_bytes.len(),
            content
        ),
        "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n".into(),
    ];
    let mut out = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for obj in &objects {
        offsets.push(out.len());
        out.push_str(obj);
    }
    let xref_at = out.len();
    out.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    out.push_str("0000000000 65535 f \n");
    for off in offsets {
        out.push_str(&format!("{off:010} 00000 n \n"));
    }
    out.push_str(&format!(
        "trailer<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF",
        objects.len() + 1
    ));
    out.into_bytes()
}

/// If schedule_json is a non-empty object, evaluate weekday gate. `None` = fall back to work_hours.
fn schedule_allows(schedule_json: &str, now_hhmm: &str) -> Option<bool> {
    if schedule_json.trim().is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(schedule_json).ok()?;
    let obj = v.as_object()?;
    if obj.is_empty() {
        return None;
    }
    let weekday = match chrono::Local::now().weekday() {
        chrono::Weekday::Mon => "mon",
        chrono::Weekday::Tue => "tue",
        chrono::Weekday::Wed => "wed",
        chrono::Weekday::Thu => "thu",
        chrono::Weekday::Fri => "fri",
        chrono::Weekday::Sat => "sat",
        chrono::Weekday::Sun => "sun",
    };
    let day = obj.get(weekday)?;
    let enabled = day.get("enabled").and_then(|x| x.as_bool()).unwrap_or(false);
    if !enabled {
        return Some(false);
    }
    let start = day
        .get("start")
        .and_then(|x| x.as_str())
        .unwrap_or("09:00");
    let end = day.get("end").and_then(|x| x.as_str()).unwrap_or("18:00");
    if start <= end {
        Some(now_hhmm >= start && now_hhmm < end)
    } else {
        Some(now_hhmm >= start || now_hhmm < end)
    }
}

fn session_to_export_entry(s: &SessionRow) -> ExportEntry {
    let mins = session_minutes(&s.started_at, s.ended_at.as_deref());
    let description = match (
        s.client_name.as_deref(),
        s.project_name.as_deref(),
        s.task_name.as_deref(),
    ) {
        (Some(c), Some(p), Some(t)) => format!("{c} / {p} / {t}"),
        (Some(c), Some(p), None) => format!("{c} / {p}"),
        (Some(c), None, _) => c.to_string(),
        (None, Some(p), Some(t)) => format!("{p} / {t}"),
        (None, Some(p), None) => p.to_string(),
        _ => "Tagged time".into(),
    };
    ExportEntry {
        session_id: s.id,
        started_at: s.started_at.clone(),
        ended_at: s.ended_at.clone(),
        duration_mins: mins,
        client_id: s.client_id,
        project_id: s.project_id,
        task_id: s.task_id,
        client_name: s.client_name.clone(),
        project_name: s.project_name.clone(),
        task_name: s.task_name.clone(),
        notes: s.notes.clone(),
        description,
    }
}


/// App-managed state shared across IPC commands and the tray.
pub struct AppState {
    pub store: std::sync::Arc<Store>,
    pub tracker: std::sync::Arc<crate::tracker::TrackerHandle>,
    pub local_api: std::sync::Arc<crate::integrations::LocalApiHandle>,
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_open_migrate_and_session() {
        let dir = std::env::temp_dir().join(format!("autotrace-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(dir.join("t.db")).unwrap();
        assert!(store.schema_version().unwrap() >= 7);
        let app = store.upsert_app("Code", None).unwrap();
        let id = store
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
        store
            .touch_session(id, "2026-09-05T09:15:00", false)
            .unwrap();
        let rows = store.sessions_for_day("2026-09-05").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].category.as_deref(), Some("Code"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
