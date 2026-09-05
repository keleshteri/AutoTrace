//! SQLite schema for AutoTrace local storage.
//!
//! Tables: sessions, apps, clients, projects, tasks, rules, settings.

use rusqlite::Connection;

use super::Result;

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
INSERT OR IGNORE INTO settings (key, value) VALUES ('work_hours_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('work_hours_start', '09:00');
INSERT OR IGNORE INTO settings (key, value) VALUES ('work_hours_end', '18:00');
"#;

const MIGRATION_V2: &str = r#"
INSERT OR IGNORE INTO settings (key, value) VALUES ('work_hours_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('work_hours_start', '09:00');
INSERT OR IGNORE INTO settings (key, value) VALUES ('work_hours_end', '18:00');
UPDATE settings SET value = '2' WHERE key = 'schema_version';
"#;

const MIGRATION_V3: &str = r#"
ALTER TABLE sessions ADD COLUMN confidence REAL;
ALTER TABLE sessions ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS calendar_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at   TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'ics',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('confirm_before_log', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('focus_goal_mins', '360');
INSERT OR IGNORE INTO settings (key, value) VALUES ('calendar_enabled', '0');
UPDATE settings SET value = '3' WHERE key = 'schema_version';
"#;

const MIGRATION_V4: &str = r#"
CREATE TABLE IF NOT EXISTS integrations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL UNIQUE, -- clickup | webhook | local_api
    enabled     INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integration_sync_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id  INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    remote_id       TEXT,
    status          TEXT NOT NULL, -- ok | error
    detail          TEXT,
    synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (integration_id, session_id)
);

CREATE TABLE IF NOT EXISTS integration_mappings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id  INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    local_type      TEXT NOT NULL, -- project | task | client
    local_id        INTEGER NOT NULL,
    remote_id       TEXT NOT NULL,
    UNIQUE (integration_id, local_type, local_id)
);

INSERT OR IGNORE INTO integrations (kind, enabled, config_json) VALUES ('clickup', 0, '{}');
INSERT OR IGNORE INTO integrations (kind, enabled, config_json) VALUES ('webhook', 0, '{}');
INSERT OR IGNORE INTO integrations (kind, enabled, config_json) VALUES ('local_api', 0, '{"port":17890}');
UPDATE settings SET value = '4' WHERE key = 'schema_version';
"#;

const MIGRATION_V5: &str = r#"
CREATE TABLE IF NOT EXISTS focus_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    goal        TEXT,
    client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name    TEXT NOT NULL,
    title       TEXT,
    url         TEXT,
    recorded_at TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_events_recorded ON activity_events(recorded_at);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_started ON focus_sessions(started_at);

ALTER TABLE rules ADD COLUMN action TEXT NOT NULL DEFAULT 'tag';

INSERT OR IGNORE INTO settings (key, value) VALUES ('track_titles', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('url_mode', 'full');
INSERT OR IGNORE INTO settings (key, value) VALUES ('schedule_json', '');
UPDATE settings SET value = '5' WHERE key = 'schema_version';
"#;

pub const SCHEMA_VERSION: i64 = 5;

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

    if current < 1 {
        conn.execute_batch(MIGRATION_V1)?;
    }
    if current < 2 {
        conn.execute_batch(MIGRATION_V2)?;
    }
    if current < 3 {
        let _ = conn.execute_batch(MIGRATION_V3);
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('schema_version', '3')
             ON CONFLICT(key) DO UPDATE SET value = '3'",
            [],
        )?;
    }
    if current < 4 {
        conn.execute_batch(MIGRATION_V4)?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('schema_version', '4')
             ON CONFLICT(key) DO UPDATE SET value = '4'",
            [],
        )?;
    }
    if current < 5 {
        let _ = conn.execute_batch(MIGRATION_V5);
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [SCHEMA_VERSION.to_string()],
        )?;
    }

    Ok(())
}
