//! SQLite schema for AutoTrace local storage.
//!
//! Tables: sessions, apps, clients, projects, tasks, rules, settings.

use rusqlite::Connection;

use super::Result;

pub const SCHEMA_VERSION: i64 = 1; // used by migrate / future migrations

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (client_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS apps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    executable   TEXT,
    bundle_id    TEXT,
    excluded     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (name, executable)
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id      INTEGER REFERENCES apps(id) ON DELETE SET NULL,
    title       TEXT,
    url         TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    idle        INTEGER NOT NULL DEFAULT 0,
    client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    approved    INTEGER NOT NULL DEFAULT 0,
    manual      INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);

CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    pattern     TEXT NOT NULL,
    match_field TEXT NOT NULL DEFAULT 'title', -- title | app | url
    client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    priority    INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('idle_threshold_secs', '180');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tracking_enabled', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('launch_at_login', '0');
"#;

pub fn migrate(conn: &Connection) -> Result<()> {
    let current: i64 = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'schema_version'",
            [],
            |row| {
                let v: String = row.get(0)?;
                Ok(v.parse::<i64>().unwrap_or(0))
            },
        )
        .unwrap_or(0);

    if current < SCHEMA_VERSION {
        conn.execute_batch(MIGRATION_V1)?;
    }

    Ok(())
}
