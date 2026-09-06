//! Domain models shared between store, tracker, and IPC.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Client {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub archived: bool,
    pub hourly_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub client_id: i64,
    pub name: String,
    pub color: Option<String>,
    pub archived: bool,
    pub hourly_rate: Option<f64>,
    pub budget_hours: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: i64,
    pub name: String,
    pub pattern: String,
    pub match_field: String,
    pub client_id: Option<i64>,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub priority: i64,
    pub enabled: bool,
    /// tag | exclude
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppRow {
    pub id: i64,
    pub name: String,
    pub executable: Option<String>,
    pub excluded: bool,
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
    pub confidence: Option<f32>,
    pub pending: bool,
    /// Focus | Code | Meeting | Break | Other
    pub category: Option<String>,
    pub billable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: i64,
    pub title: String,
    pub started_at: String,
    pub ended_at: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusDigest {
    pub day: String,
    pub focus_minutes: i64,
    pub meeting_minutes: i64,
    pub idle_minutes: i64,
    pub focus_score: f32,
    pub goal_minutes: i64,
    pub goal_pct: f32,
    pub top_projects: Vec<ReportBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeeklyDigest {
    pub week_start: String,
    pub days: Vec<FocusDigest>,
    pub total_focus_minutes: i64,
    pub avg_focus_score: f32,
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
    pub hourly_rate: Option<f64>,
    pub projects: Vec<ProjectNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectNode {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub hourly_rate: Option<f64>,
    pub budget_hours: Option<f64>,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportBucket {
    pub key: String,
    pub label: String,
    pub minutes: i64,
    pub sessions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayReport {
    pub by_project: Vec<ReportBucket>,
    pub by_app: Vec<ReportBucket>,
    pub by_client: Vec<ReportBucket>,
    pub total_minutes: i64,
    pub idle_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfitRow {
    pub key: String,
    pub label: String,
    pub minutes: i64,
    pub billable_minutes: i64,
    pub rate: f64,
    pub revenue: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfitabilityReport {
    pub from_day: String,
    pub to_day: String,
    pub tracked_minutes: i64,
    pub billable_minutes: i64,
    pub capacity_minutes: i64,
    pub utilization_pct: f32,
    pub revenue: f64,
    pub by_client: Vec<ProfitRow>,
    pub by_project: Vec<ProfitRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub sync_url: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockRule {
    pub id: i64,
    pub pattern: String,
    pub match_field: String,
    pub mode: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerSettings {
    pub idle_threshold_secs: u64,
    pub work_hours_enabled: bool,
    pub work_hours_start: String,
    pub work_hours_end: String,
    pub launch_at_login: bool,
    pub confirm_before_log: bool,
    pub focus_goal_mins: u64,
    pub calendar_enabled: bool,
    /// Store window titles when capturing.
    pub track_titles: bool,
    /// full | domain | off
    pub url_mode: String,
    /// JSON map of weekday → {enabled,start,end}. Empty = use work_hours_* only.
    pub schedule_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusSession {
    pub id: i64,
    pub goal: Option<String>,
    pub client_id: Option<i64>,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub client_name: Option<String>,
    pub project_name: Option<String>,
    pub task_name: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    pub elapsed_secs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: i64,
    pub app_name: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsageBucket {
    pub key: String,
    pub label: String,
    pub minutes: i64,
    pub events: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationRow {
    pub id: i64,
    pub kind: String,
    pub enabled: bool,
    /// Secrets redacted in list responses when `config_json` is sanitized by the API layer.
    pub config_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncLogRow {
    pub id: i64,
    pub integration_id: i64,
    pub session_id: i64,
    pub remote_id: Option<String>,
    pub status: String,
    pub detail: Option<String>,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyAuditRow {
    pub id: i64,
    pub kind: String,
    pub detail: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistractionReport {
    pub day: String,
    pub context_switches: i64,
    pub blocked_event_hits: i64,
    pub focus_score: f32,
    pub top_distractions: Vec<ReportBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProvider {
    pub id: i64,
    pub kind: String,
    pub label: String,
    pub base_url: Option<String>,
    pub has_api_key: bool,
    pub enabled: bool,
    pub is_default: bool,
    pub allowed_models: Vec<String>,
    pub max_tokens_per_request: i64,
    pub temperature_cap: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiBudget {
    pub id: i64,
    pub period: String,
    pub token_limit: i64,
    pub request_limit: i64,
    pub cost_usd_limit: Option<f64>,
    pub warn_at_pct: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiUsageRow {
    pub id: i64,
    pub provider_id: Option<i64>,
    pub model: String,
    pub agent: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub estimated_cost_usd: Option<f64>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiUsageSummary {
    pub day_tokens: i64,
    pub day_requests: i64,
    pub month_tokens: i64,
    pub month_requests: i64,
    pub day_budget: Option<AiBudget>,
    pub month_budget: Option<AiBudget>,
    pub warn: bool,
    pub blocked: bool,
    pub recent: Vec<AiUsageRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTemplate {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub agent: String,
    pub system_prompt: String,
    pub user_prompt_template: String,
    pub output_schema_json: Option<String>,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiChat {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub id: i64,
    pub chat_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRunResult {
    pub text: String,
    pub model: String,
    pub agent: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub warning: Option<String>,
}

/// Approved, tagged session summary safe to leave the device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportEntry {
    pub session_id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_mins: i64,
    pub client_id: Option<i64>,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub client_name: Option<String>,
    pub project_name: Option<String>,
    pub task_name: Option<String>,
    pub notes: Option<String>,
    /// Never includes raw window title/URL unless explicitly requested by scope.
    pub description: String,
}
