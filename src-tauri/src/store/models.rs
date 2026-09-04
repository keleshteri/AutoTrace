//! Domain models shared between store, tracker, and IPC.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Client {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub client_id: i64,
    pub name: String,
    pub color: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: i64,
    pub app_id: Option<i64>,
    pub app_name: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub idle: bool,
    pub client_id: Option<i64>,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub client_name: Option<String>,
    pub project_name: Option<String>,
    pub task_name: Option<String>,
    pub approved: bool,
    pub manual: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hierarchy {
    pub clients: Vec<ClientNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientNode {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub projects: Vec<ProjectNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectNode {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub tasks: Vec<Task>,
}
