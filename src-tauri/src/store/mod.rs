//! Local SQLite persistence for AutoTrace.
//!
//! Data lives under the OS app-data directory. Nothing is synced unless the
//! user later enables an opt-in integration (out of scope for MVP).

mod schema;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use thiserror::Error;

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
        let conn = self.conn.lock().expect("store mutex poisoned");
        let version: String = conn.query_row(
            "SELECT value FROM settings WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )?;
        Ok(version.parse().unwrap_or(0))
    }

    /// Resolve the default DB path under the OS app-data directory.
    pub fn default_db_path(app_data_dir: impl AsRef<Path>) -> PathBuf {
        app_data_dir.as_ref().join("autotrace.db")
    }
}

/// App-managed state wrapper so commands can share the store.
pub struct AppState {
    pub store: Store,
}
