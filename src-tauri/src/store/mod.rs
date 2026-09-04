//! Local SQLite persistence for AutoTrace.
//!
//! Data lives under the OS app-data directory. Nothing is synced unless the
//! user later enables an opt-in integration (out of scope for MVP).

mod models;
mod schema;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;

pub use models::*;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

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

    #[allow(dead_code)]
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
    ) -> Result<i64> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO sessions (app_id, title, url, started_at, ended_at, idle)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
            params![app_id, title, url, started_at, idle as i64],
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
                    s.approved, s.manual, s.notes
             FROM sessions s
             LEFT JOIN apps a ON a.id = s.app_id
             LEFT JOIN clients c ON c.id = s.client_id
             LEFT JOIN projects p ON p.id = s.project_id
             LEFT JOIN tasks t ON t.id = s.task_id
             WHERE s.started_at <= ?2 AND IFNULL(s.ended_at, s.started_at) >= ?1
             ORDER BY s.started_at ASC",
        )?;

        let rows = stmt
            .query_map(params![start, end], |row| {
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
                })
            })?
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
            "SELECT id, name, color FROM clients WHERE archived = 0 ORDER BY name COLLATE NOCASE",
        )?;
        let clients: Vec<(i64, String, Option<String>)> = clients_stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut nodes = Vec::new();
        for (cid, cname, ccolor) in clients {
            let mut projects_stmt = conn.prepare(
                "SELECT id, name, color FROM projects
                 WHERE client_id = ?1 AND archived = 0 ORDER BY name COLLATE NOCASE",
            )?;
            let projects: Vec<(i64, String, Option<String>)> = projects_stmt
                .query_map(params![cid], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            let mut project_nodes = Vec::new();
            for (pid, pname, pcolor) in projects {
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
                    tasks,
                });
            }

            nodes.push(ClientNode {
                id: cid,
                name: cname,
                color: ccolor,
                projects: project_nodes,
            });
        }

        Ok(Hierarchy { clients: nodes })
    }

    /// Resolve the default DB path under the OS app-data directory.
    pub fn default_db_path(app_data_dir: impl AsRef<Path>) -> PathBuf {
        app_data_dir.as_ref().join("autotrace.db")
    }
}

/// App-managed state shared across IPC commands and the tray.
pub struct AppState {
    pub store: std::sync::Arc<Store>,
    pub tracker: std::sync::Arc<crate::tracker::TrackerHandle>,
}
