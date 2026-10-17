//! Dashboards, reports, routines and meetings: the analysis/automation layer on top
//! of the time query engine. Insights are computed locally and deterministically;
//! AI (when enabled) only writes prose over the computed JSON.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::query::{TimeQuery, TimeQueryResult};
use super::{Result, SessionRow, Store, StoreError};

const TS_FMT: &str = "%Y-%m-%dT%H:%M:%S";

fn now_local() -> NaiveDateTime {
    chrono::Local::now().naive_local().with_nanosecond(0).unwrap()
}

fn fmt_ts(t: NaiveDateTime) -> String {
    t.format(TS_FMT).to_string()
}

fn fmt_day(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn fmt_dur(secs: i64) -> String {
    let m = secs / 60;
    if m >= 60 {
        format!("{}h {:02}m", m / 60, m % 60)
    } else {
        format!("{m}m")
    }
}

// ───────────────────────────── Schedules ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Schedule {
    /// manual | daily | weekdays | weekly | hourly
    pub kind: String,
    /// `HH:MM` local (daily/weekdays/weekly).
    #[serde(default)]
    pub time: Option<String>,
    /// 0 = Monday … 6 = Sunday (weekly).
    #[serde(default)]
    pub weekday: Option<u32>,
}

impl Schedule {
    pub fn parse(json: &str) -> Schedule {
        serde_json::from_str(json).unwrap_or(Schedule { kind: "manual".into(), ..Default::default() })
    }

    fn hm(&self) -> (u32, u32) {
        let t = self.time.as_deref().unwrap_or("09:00");
        let mut it = t.split(':');
        let h = it.next().and_then(|v| v.parse().ok()).unwrap_or(9).min(23);
        let m = it.next().and_then(|v| v.parse().ok()).unwrap_or(0).min(59);
        (h, m)
    }

    /// Most recent scheduled occurrence at or before `now`.
    pub fn last_occurrence(&self, now: NaiveDateTime) -> Option<NaiveDateTime> {
        let (h, m) = self.hm();
        match self.kind.as_str() {
            "hourly" => Some(now.date().and_hms_opt(now.hour(), 0, 0)?),
            "daily" | "weekdays" | "weekly" => {
                for back in 0..8 {
                    let d = now.date() - Duration::days(back);
                    let at = d.and_hms_opt(h, m, 0)?;
                    if at > now {
                        continue;
                    }
                    let wd = d.weekday().num_days_from_monday();
                    let ok = match self.kind.as_str() {
                        "weekdays" => wd < 5,
                        "weekly" => wd == self.weekday.unwrap_or(0),
                        _ => true,
                    };
                    if ok {
                        return Some(at);
                    }
                }
                None
            }
            _ => None,
        }
    }

    /// Due when an occurrence passed since the last run (catches up once after sleep).
    pub fn is_due(&self, last_run: Option<NaiveDateTime>, now: NaiveDateTime) -> bool {
        match (self.last_occurrence(now), last_run) {
            (Some(occ), Some(last)) => last < occ,
            (Some(_), None) => true,
            _ => false,
        }
    }
}

/// Resolve a relative period name into an inclusive day range.
pub fn period_range(period: &str, today: NaiveDate) -> (String, String) {
    let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    let (from, to) = match period {
        "yesterday" => (today - Duration::days(1), today - Duration::days(1)),
        "week" => (week_start, today),
        "last_week" => (week_start - Duration::days(7), week_start - Duration::days(1)),
        "last_7_days" => (today - Duration::days(6), today),
        "month" => (today.with_day(1).unwrap(), today),
        "last_month" => {
            let first = today.with_day(1).unwrap();
            let prev_last = first - Duration::days(1);
            (prev_last.with_day(1).unwrap(), prev_last)
        }
        "last_30_days" => (today - Duration::days(29), today),
        _ => (today, today),
    };
    (fmt_day(from), fmt_day(to))
}

// ───────────────────────────── Dashboards ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dashboard {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub query: TimeQuery,
    /// Relative period this dashboard tracks (e.g. `week`); `from`/`to` in `query`
    /// are refreshed from it on load. `custom` keeps the stored dates.
    pub period: String,
    pub pinned: bool,
    pub template: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredQuery {
    #[serde(flatten)]
    query: TimeQuery,
    #[serde(default = "default_period")]
    period: String,
}

fn default_period() -> String {
    "week".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardTemplate {
    pub slug: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub period: &'static str,
    pub rows_by: &'static str,
    pub cols_by: &'static str,
    pub filters: Vec<super::query::QueryFilter>,
}

pub fn dashboard_templates() -> Vec<DashboardTemplate> {
    use super::query::QueryFilter;
    vec![
        DashboardTemplate {
            slug: "timesheet",
            name: "Weekly timesheet",
            description: "Hours per project for each day of the week",
            period: "week",
            rows_by: "project",
            cols_by: "day",
            filters: vec![],
        },
        DashboardTemplate {
            slug: "client_breakdown",
            name: "Client breakdown",
            description: "Where client hours went this month, by week",
            period: "month",
            rows_by: "client",
            cols_by: "week",
            filters: vec![],
        },
        DashboardTemplate {
            slug: "category_mix",
            name: "Category mix",
            description: "Focus, meetings, code and more per day",
            period: "week",
            rows_by: "category",
            cols_by: "day",
            filters: vec![],
        },
        DashboardTemplate {
            slug: "billable",
            name: "Billable vs non-billable",
            description: "Billable share by client this month",
            period: "month",
            rows_by: "client",
            cols_by: "billable",
            filters: vec![],
        },
        DashboardTemplate {
            slug: "apps_hours",
            name: "Apps by hour of day",
            description: "Which apps you use at which hour",
            period: "last_7_days",
            rows_by: "app",
            cols_by: "hour",
            filters: vec![],
        },
        DashboardTemplate {
            slug: "websites",
            name: "Websites this week",
            description: "Time per website domain per day",
            period: "week",
            rows_by: "domain",
            cols_by: "day",
            filters: vec![QueryFilter { dim: "app".into(), values: vec![] }],
        },
    ]
}

fn map_dashboard(row: &rusqlite::Row<'_>) -> rusqlite::Result<Dashboard> {
    let raw: String = row.get(3)?;
    let stored: StoredQuery = serde_json::from_str(&raw).unwrap_or(StoredQuery {
        query: TimeQuery {
            from: fmt_day(now_local().date()),
            to: fmt_day(now_local().date()),
            rows_by: "project".into(),
            cols_by: "day".into(),
            filters: vec![],
            include_idle: false,
            compare_previous: true,
        },
        period: "week".into(),
    });
    let mut query = stored.query;
    if stored.period != "custom" {
        let (f, t) = period_range(&stored.period, now_local().date());
        query.from = f;
        query.to = t;
    }
    Ok(Dashboard {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        query,
        period: stored.period,
        pinned: row.get::<_, i64>(4)? != 0,
        template: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const DASH_COLS: &str = "id, name, description, query_json, pinned, template, created_at, updated_at";

// ───────────────────────────── Reports ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Report {
    pub id: i64,
    pub name: String,
    pub dashboard_id: Option<i64>,
    pub dashboard_name: Option<String>,
    pub period: String,
    pub schedule: Schedule,
    pub ai_enabled: bool,
    pub enabled: bool,
    pub last_run_at: Option<String>,
    pub run_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Insight {
    /// highlight | anomaly | info
    pub kind: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportRun {
    pub id: i64,
    pub report_id: i64,
    pub period_from: String,
    pub period_to: String,
    pub trigger: String,
    pub status: String,
    pub result: Option<serde_json::Value>,
    pub insights: Vec<Insight>,
    pub ai_summary: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}

/// Deterministic insights over a query result + the sessions behind it.
pub fn compute_insights(r: &TimeQueryResult, sessions: &[SessionRow]) -> Vec<Insight> {
    let mut out = Vec::new();
    let total = r.kpis.total_secs;
    if total == 0 {
        out.push(Insight {
            kind: "anomaly".into(),
            title: "No tracked time in this period".into(),
            detail: format!("Nothing was tracked between {} and {}.", r.query.from, r.query.to),
        });
        return out;
    }

    // Best uninterrupted block.
    let best = sessions
        .iter()
        .filter(|s| !s.idle)
        .filter_map(|s| {
            let a = NaiveDateTime::parse_from_str(&s.started_at, TS_FMT).ok()?;
            let b = NaiveDateTime::parse_from_str(s.ended_at.as_deref()?, TS_FMT).ok()?;
            Some((s, a, (b - a).num_seconds()))
        })
        .max_by_key(|x| x.2);
    if let Some((s, a, secs)) = best {
        if secs >= 15 * 60 {
            // Never window titles: insights can be sent to an AI provider.
            let what = s
                .project_name
                .clone()
                .or_else(|| s.app_name.clone())
                .unwrap_or_else(|| "Work".into());
            out.push(Insight {
                kind: "highlight".into(),
                title: format!("Best block: {what}"),
                detail: format!(
                    "{} uninterrupted, starting {}.",
                    fmt_dur(secs),
                    a.format("%a %H:%M")
                ),
            });
        }
    }

    // Biggest row.
    if let (Some(row), Some(&secs)) = (r.rows.first(), r.row_totals.first()) {
        if r.rows.len() > 1 && r.query.rows_by != "none" {
            out.push(Insight {
                kind: "highlight".into(),
                title: format!("Most time: {}", row.label),
                detail: format!(
                    "{} — {:.0}% of the total.",
                    fmt_dur(secs),
                    secs as f64 * 100.0 / total as f64
                ),
            });
        }
    }

    // Change vs previous period.
    if let (Some(prev), Some(delta)) = (&r.previous, r.delta_pct) {
        if delta.abs() >= 25.0 {
            out.push(Insight {
                kind: "anomaly".into(),
                title: format!(
                    "Tracked time is {:.0}% {} the previous period",
                    delta.abs(),
                    if delta < 0.0 { "below" } else { "above" }
                ),
                detail: format!(
                    "{} now vs {} before.",
                    fmt_dur(total),
                    fmt_dur(prev.total_secs)
                ),
            });
        }
    }

    // Untagged share.
    let untagged: i64 = sessions
        .iter()
        .filter(|s| !s.idle && s.project_id.is_none() && s.client_id.is_none())
        .map(|s| session_secs_in(s, &r.query.from, &r.query.to))
        .sum();
    let share = untagged as f64 * 100.0 / total as f64;
    if share >= 25.0 {
        out.push(Insight {
            kind: "anomaly".into(),
            title: format!("{share:.0}% of time has no client or project"),
            detail: format!("{} untagged — add a rule or review on the Calendar.", fmt_dur(untagged)),
        });
    }

    let pending = sessions.iter().filter(|s| s.pending).count();
    if pending > 0 {
        out.push(Insight {
            kind: "info".into(),
            title: format!("{pending} entries waiting for review"),
            detail: "Pending entries aren't confirmed yet.".into(),
        });
    }

    let billable = r.kpis.billable_secs;
    if billable < total {
        out.push(Insight {
            kind: "info".into(),
            title: format!("{:.0}% billable", billable as f64 * 100.0 / total as f64),
            detail: format!("{} billable of {} tracked.", fmt_dur(billable), fmt_dur(total)),
        });
    }
    out
}

fn session_secs_in(s: &SessionRow, from: &str, to: &str) -> i64 {
    let Ok(a) = NaiveDateTime::parse_from_str(&s.started_at, TS_FMT) else {
        return 0;
    };
    let b = s
        .ended_at
        .as_deref()
        .and_then(|e| NaiveDateTime::parse_from_str(e, TS_FMT).ok())
        .unwrap_or(a);
    let lo = NaiveDate::parse_from_str(from, "%Y-%m-%d")
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
        .unwrap_or(a);
    let hi = NaiveDate::parse_from_str(to, "%Y-%m-%d")
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap() + Duration::days(1))
        .unwrap_or(b);
    (b.min(hi) - a.max(lo)).num_seconds().max(0)
}

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReportRun> {
    let result: Option<String> = row.get(6)?;
    let insights: Option<String> = row.get(7)?;
    Ok(ReportRun {
        id: row.get(0)?,
        report_id: row.get(1)?,
        period_from: row.get(2)?,
        period_to: row.get(3)?,
        trigger: row.get(4)?,
        status: row.get(5)?,
        result: result.and_then(|r| serde_json::from_str(&r).ok()),
        insights: insights.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default(),
        ai_summary: row.get(8)?,
        error: row.get(9)?,
        created_at: row.get(10)?,
    })
}

const RUN_COLS: &str = "id, report_id, period_from, period_to, trigger, status, result_json, insights_json, ai_summary, error, created_at";

// ───────────────────────────── Routines ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Routine {
    pub id: i64,
    pub name: String,
    pub schedule: Schedule,
    /// digest | report | ai_prompt | export_csv | integration_push
    pub action_kind: String,
    pub action: serde_json::Value,
    pub enabled: bool,
    pub builtin: Option<String>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineRun {
    pub id: i64,
    pub routine_id: i64,
    pub routine_name: Option<String>,
    pub trigger: String,
    pub status: String,
    pub output: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

const ROUTINE_COLS: &str = "r.id, r.name, r.schedule_json, r.action_kind, r.action_json, r.enabled, r.builtin, r.last_run_at,
     (SELECT status FROM routine_runs rr WHERE rr.routine_id = r.id ORDER BY rr.id DESC LIMIT 1)";

fn map_routine(row: &rusqlite::Row<'_>) -> rusqlite::Result<Routine> {
    let sched: String = row.get(2)?;
    let action: String = row.get(4)?;
    Ok(Routine {
        id: row.get(0)?,
        name: row.get(1)?,
        schedule: Schedule::parse(&sched),
        action_kind: row.get(3)?,
        action: serde_json::from_str(&action).unwrap_or(serde_json::json!({})),
        enabled: row.get::<_, i64>(5)? != 0,
        builtin: row.get(6)?,
        last_run_at: row.get(7)?,
        last_status: row.get(8)?,
    })
}

pub const ROUTINE_ACTIONS: &[&str] = &["digest", "report", "ai_prompt", "export_csv", "integration_push"];

// ───────────────────────────── Meetings ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: i64,
    pub calendar_event_id: Option<i64>,
    pub title: String,
    pub started_at: String,
    pub ended_at: String,
    pub attendees: Vec<String>,
    /// unknown | attend | skip
    pub attendance: String,
    pub client_id: Option<i64>,
    pub project_id: Option<i64>,
    pub client_name: Option<String>,
    pub project_name: Option<String>,
    pub has_transcript: bool,
    pub transcript: Option<String>,
    pub summary: Option<String>,
    pub session_id: Option<i64>,
}

const MEETING_COLS: &str = "m.id, m.calendar_event_id, m.title, m.started_at, m.ended_at, m.attendees, m.attendance,
     m.client_id, m.project_id, c.name, p.name, m.transcript, m.summary, m.session_id";

fn map_meeting(row: &rusqlite::Row<'_>) -> rusqlite::Result<Meeting> {
    let attendees: Option<String> = row.get(5)?;
    let transcript: Option<String> = row.get(11)?;
    Ok(Meeting {
        id: row.get(0)?,
        calendar_event_id: row.get(1)?,
        title: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        attendees: attendees
            .map(|a| a.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default(),
        attendance: row.get(6)?,
        client_id: row.get(7)?,
        project_id: row.get(8)?,
        client_name: row.get(9)?,
        project_name: row.get(10)?,
        has_transcript: transcript.as_ref().map(|t| !t.trim().is_empty()).unwrap_or(false),
        transcript,
        summary: row.get(12)?,
        session_id: row.get(13)?,
    })
}

/// Strip WebVTT / SRT cue numbers and timing lines; keep spoken text.
pub fn clean_transcript(raw: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for line in raw.lines() {
        let l = line.trim();
        if l.is_empty()
            || l == "WEBVTT"
            || l.starts_with("NOTE")
            || l.contains("-->")
            || l.chars().all(|c| c.is_ascii_digit())
        {
            continue;
        }
        // Drop VTT voice tags like <v Alice>.
        let mut text = l.to_string();
        if let Some(rest) = text.strip_prefix("<v ") {
            if let Some(idx) = rest.find('>') {
                text = format!("{}: {}", &rest[..idx], &rest[idx + 1..]);
            }
        }
        let text = text.replace("</v>", "");
        if out.last() != Some(&text) {
            out.push(text);
        }
    }
    out.join("\n")
}

// ───────────────────────────── Store impl ─────────────────────────────

impl Store {
    // Dashboards

    pub fn list_dashboards(&self) -> Result<Vec<Dashboard>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(&format!(
            "SELECT {DASH_COLS} FROM dashboards ORDER BY pinned DESC, name COLLATE NOCASE"
        ))?;
        let rows = stmt.query_map([], map_dashboard)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_dashboard(&self, id: i64) -> Result<Option<Dashboard>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        Ok(conn
            .query_row(
                &format!("SELECT {DASH_COLS} FROM dashboards WHERE id = ?1"),
                params![id],
                map_dashboard,
            )
            .optional()?)
    }

    fn validate_query(q: &TimeQuery) -> Result<()> {
        // Run against no data to validate dimensions/dates.
        super::query::aggregate(q, &[], None).map(|_| ())
    }

    pub fn save_dashboard(
        &self,
        id: Option<i64>,
        name: &str,
        description: Option<&str>,
        query: &TimeQuery,
        period: &str,
        pinned: bool,
        template: Option<&str>,
    ) -> Result<Dashboard> {
        let name = name.trim();
        if name.is_empty() {
            return Err(StoreError::Msg("dashboard name required".into()));
        }
        Self::validate_query(query)?;
        let json = serde_json::to_string(&StoredQuery {
            query: query.clone(),
            period: period.to_string(),
        })
        .map_err(|e| StoreError::Msg(e.to_string()))?;
        let id = {
            let conn = self.conn.lock().expect("store mutex poisoned");
            match id {
                Some(id) => {
                    conn.execute(
                        "UPDATE dashboards SET name = ?1, description = ?2, query_json = ?3, pinned = ?4,
                         updated_at = datetime('now') WHERE id = ?5",
                        params![name, description, json, pinned as i64, id],
                    )?;
                    id
                }
                None => {
                    conn.execute(
                        "INSERT INTO dashboards (name, description, query_json, pinned, template)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![name, description, json, pinned as i64, template],
                    )?;
                    conn.last_insert_rowid()
                }
            }
        };
        self.get_dashboard(id)?
            .ok_or_else(|| StoreError::Msg("dashboard not found".into()))
    }

    pub fn create_dashboard_from_template(&self, slug: &str) -> Result<Dashboard> {
        let t = dashboard_templates()
            .into_iter()
            .find(|t| t.slug == slug)
            .ok_or_else(|| StoreError::Msg(format!("unknown template {slug}")))?;
        let (from, to) = period_range(t.period, now_local().date());
        let q = TimeQuery {
            from,
            to,
            rows_by: t.rows_by.into(),
            cols_by: t.cols_by.into(),
            filters: t.filters.into_iter().filter(|f| !f.values.is_empty()).collect(),
            include_idle: false,
            compare_previous: true,
        };
        self.save_dashboard(None, t.name, Some(t.description), &q, t.period, true, Some(t.slug))
    }

    pub fn set_dashboard_pinned(&self, id: i64, pinned: bool) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE dashboards SET pinned = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![pinned as i64, id],
        )?;
        Ok(())
    }

    pub fn delete_dashboard(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM dashboards WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Reports

    pub fn list_reports(&self) -> Result<Vec<Report>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT r.id, r.name, r.dashboard_id, d.name, r.period, r.schedule_json, r.ai_enabled,
                    r.enabled, r.last_run_at,
                    (SELECT COUNT(*) FROM report_runs rr WHERE rr.report_id = r.id)
             FROM reports r LEFT JOIN dashboards d ON d.id = r.dashboard_id
             ORDER BY r.name COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |row| {
                let sched: String = row.get(5)?;
                Ok(Report {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    dashboard_id: row.get(2)?,
                    dashboard_name: row.get(3)?,
                    period: row.get(4)?,
                    schedule: Schedule::parse(&sched),
                    ai_enabled: row.get::<_, i64>(6)? != 0,
                    enabled: row.get::<_, i64>(7)? != 0,
                    last_run_at: row.get(8)?,
                    run_count: row.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_report(&self, id: i64) -> Result<Option<Report>> {
        Ok(self.list_reports()?.into_iter().find(|r| r.id == id))
    }

    pub fn save_report(
        &self,
        id: Option<i64>,
        name: &str,
        dashboard_id: Option<i64>,
        period: &str,
        schedule: &Schedule,
        ai_enabled: bool,
        enabled: bool,
    ) -> Result<Report> {
        if name.trim().is_empty() {
            return Err(StoreError::Msg("report name required".into()));
        }
        let sched = serde_json::to_string(schedule).map_err(|e| StoreError::Msg(e.to_string()))?;
        let now = fmt_ts(now_local());
        let id = {
            let conn = self.conn.lock().expect("store mutex poisoned");
            match id {
                Some(id) => {
                    conn.execute(
                        "UPDATE reports SET name = ?1, dashboard_id = ?2, period = ?3, schedule_json = ?4,
                         ai_enabled = ?5, enabled = ?6 WHERE id = ?7",
                        params![name.trim(), dashboard_id, period, sched, ai_enabled as i64, enabled as i64, id],
                    )?;
                    id
                }
                None => {
                    // last_run_at = now so a schedule whose time already passed today
                    // doesn't fire immediately on creation.
                    conn.execute(
                        "INSERT INTO reports (name, dashboard_id, period, schedule_json, ai_enabled, enabled, last_run_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![name.trim(), dashboard_id, period, sched, ai_enabled as i64, enabled as i64, now],
                    )?;
                    conn.last_insert_rowid()
                }
            }
        };
        self.get_report(id)?.ok_or_else(|| StoreError::Msg("report not found".into()))
    }

    pub fn delete_report(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM reports WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Compute a report run (query + insights) and store it. AI summary is added later.
    pub fn compute_report_run(&self, report_id: i64, trigger: &str) -> Result<ReportRun> {
        let report = self
            .get_report(report_id)?
            .ok_or_else(|| StoreError::Msg("report not found".into()))?;
        let (from, to) = period_range(&report.period, now_local().date());
        let mut q = match report.dashboard_id.and_then(|d| self.get_dashboard(d).ok().flatten()) {
            Some(d) => d.query,
            None => TimeQuery {
                from: from.clone(),
                to: to.clone(),
                rows_by: "project".into(),
                cols_by: "day".into(),
                filters: vec![],
                include_idle: false,
                compare_previous: true,
            },
        };
        q.from = from.clone();
        q.to = to.clone();
        q.compare_previous = true;
        let result = self.run_time_query(&q)?;
        let sessions = self.sessions_in_range(&from, &to)?;
        let insights = compute_insights(&result, &sessions);
        let now = fmt_ts(now_local());
        let id = {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "INSERT INTO report_runs (report_id, period_from, period_to, trigger, status, result_json, insights_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7)",
                params![
                    report_id,
                    from,
                    to,
                    trigger,
                    serde_json::to_string(&result).unwrap_or_default(),
                    serde_json::to_string(&insights).unwrap_or_default(),
                    now
                ],
            )?;
            let id = conn.last_insert_rowid();
            conn.execute("UPDATE reports SET last_run_at = ?1 WHERE id = ?2", params![now, report_id])?;
            id
        };
        self.get_report_run(id)?.ok_or_else(|| StoreError::Msg("run not found".into()))
    }

    pub fn set_report_run_ai(&self, run_id: i64, summary: Option<&str>, error: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE report_runs SET ai_summary = ?1, error = ?2 WHERE id = ?3",
            params![summary, error, run_id],
        )?;
        Ok(())
    }

    pub fn get_report_run(&self, id: i64) -> Result<Option<ReportRun>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        Ok(conn
            .query_row(&format!("SELECT {RUN_COLS} FROM report_runs WHERE id = ?1"), params![id], map_run)
            .optional()?)
    }

    pub fn list_report_runs(&self, report_id: i64) -> Result<Vec<ReportRun>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(&format!(
            "SELECT {RUN_COLS} FROM report_runs WHERE report_id = ?1 ORDER BY id DESC LIMIT 100"
        ))?;
        let rows = stmt.query_map(params![report_id], map_run)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn due_reports(&self, now: NaiveDateTime) -> Result<Vec<Report>> {
        Ok(self
            .list_reports()?
            .into_iter()
            .filter(|r| r.enabled)
            .filter(|r| {
                let last = r
                    .last_run_at
                    .as_deref()
                    .and_then(|t| NaiveDateTime::parse_from_str(t, TS_FMT).ok());
                r.schedule.is_due(last, now)
            })
            .collect())
    }

    // Routines

    /// Seed built-in routines once (local digests on; exports off).
    pub fn seed_builtin_routines(&self) -> Result<()> {
        if self.get_setting("routines_seeded")?.as_deref() == Some("1") {
            return Ok(());
        }
        let now = fmt_ts(now_local());
        let builtins = [
            ("start_of_day", "Start of day", r#"{"kind":"weekdays","time":"08:30"}"#, "digest", r#"{"period":"yesterday"}"#, 1),
            ("midday", "Midday check-in", r#"{"kind":"weekdays","time":"12:30"}"#, "digest", r#"{"period":"today"}"#, 0),
            ("end_of_day", "End of day", r#"{"kind":"weekdays","time":"17:00"}"#, "digest", r#"{"period":"today"}"#, 1),
            ("weekly_timesheet", "Weekly timesheet export", r#"{"kind":"weekly","weekday":0,"time":"09:00"}"#, "export_csv", r#"{"period":"last_week","rows_by":"project","cols_by":"day"}"#, 0),
            ("config_review", "Untagged cleanup", r#"{"kind":"weekly","weekday":4,"time":"16:00"}"#, "digest", r#"{"period":"week","focus":"untagged"}"#, 0),
        ];
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            for (slug, name, sched, kind, action, enabled) in builtins {
                conn.execute(
                    "INSERT INTO routines (name, schedule_json, action_kind, action_json, enabled, builtin, last_run_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![name, sched, kind, action, enabled, slug, now],
                )?;
            }
        }
        self.set_setting("routines_seeded", "1")
    }

    pub fn list_routines(&self) -> Result<Vec<Routine>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(&format!("SELECT {ROUTINE_COLS} FROM routines r ORDER BY r.id"))?;
        let rows = stmt.query_map([], map_routine)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_routine(&self, id: i64) -> Result<Option<Routine>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        Ok(conn
            .query_row(
                &format!("SELECT {ROUTINE_COLS} FROM routines r WHERE r.id = ?1"),
                params![id],
                map_routine,
            )
            .optional()?)
    }

    pub fn save_routine(
        &self,
        id: Option<i64>,
        name: &str,
        schedule: &Schedule,
        action_kind: &str,
        action: &serde_json::Value,
        enabled: bool,
    ) -> Result<Routine> {
        if name.trim().is_empty() {
            return Err(StoreError::Msg("routine name required".into()));
        }
        if !ROUTINE_ACTIONS.contains(&action_kind) {
            return Err(StoreError::Msg(format!("unknown routine action: {action_kind}")));
        }
        let sched = serde_json::to_string(schedule).map_err(|e| StoreError::Msg(e.to_string()))?;
        let action = action.to_string();
        let now = fmt_ts(now_local());
        let id = {
            let conn = self.conn.lock().expect("store mutex poisoned");
            match id {
                Some(id) => {
                    conn.execute(
                        "UPDATE routines SET name = ?1, schedule_json = ?2, action_kind = ?3, action_json = ?4, enabled = ?5
                         WHERE id = ?6",
                        params![name.trim(), sched, action_kind, action, enabled as i64, id],
                    )?;
                    id
                }
                None => {
                    conn.execute(
                        "INSERT INTO routines (name, schedule_json, action_kind, action_json, enabled, last_run_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![name.trim(), sched, action_kind, action, enabled as i64, now],
                    )?;
                    conn.last_insert_rowid()
                }
            }
        };
        self.get_routine(id)?.ok_or_else(|| StoreError::Msg("routine not found".into()))
    }

    pub fn set_routine_enabled(&self, id: i64, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        // Re-arm from now so enabling doesn't fire a stale occurrence.
        conn.execute(
            "UPDATE routines SET enabled = ?1, last_run_at = CASE WHEN ?1 = 1 THEN ?2 ELSE last_run_at END WHERE id = ?3",
            params![enabled as i64, fmt_ts(now_local()), id],
        )?;
        Ok(())
    }

    pub fn delete_routine(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM routines WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn due_routines(&self, now: NaiveDateTime) -> Result<Vec<Routine>> {
        Ok(self
            .list_routines()?
            .into_iter()
            .filter(|r| r.enabled)
            .filter(|r| {
                let last = r
                    .last_run_at
                    .as_deref()
                    .and_then(|t| NaiveDateTime::parse_from_str(t, TS_FMT).ok());
                r.schedule.is_due(last, now)
            })
            .collect())
    }

    /// Insert a running row and stamp `last_run_at` (so the scheduler won't double-fire).
    pub fn begin_routine_run(&self, routine_id: i64, trigger: &str) -> Result<i64> {
        let now = fmt_ts(now_local());
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO routine_runs (routine_id, trigger, status, started_at) VALUES (?1, ?2, 'running', ?3)",
            params![routine_id, trigger, now],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute("UPDATE routines SET last_run_at = ?1 WHERE id = ?2", params![now, routine_id])?;
        Ok(id)
    }

    pub fn finish_routine_run(&self, run_id: i64, status: &str, output: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE routine_runs SET status = ?1, output = ?2, ended_at = ?3 WHERE id = ?4",
            params![status, output, fmt_ts(now_local()), run_id],
        )?;
        Ok(())
    }

    pub fn list_routine_runs(&self, routine_id: Option<i64>, limit: i64) -> Result<Vec<RoutineRun>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT rr.id, rr.routine_id, r.name, rr.trigger, rr.status, rr.output, rr.started_at, rr.ended_at
             FROM routine_runs rr LEFT JOIN routines r ON r.id = rr.routine_id
             WHERE (?1 IS NULL OR rr.routine_id = ?1)
             ORDER BY rr.id DESC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![routine_id, limit], |row| {
                Ok(RoutineRun {
                    id: row.get(0)?,
                    routine_id: row.get(1)?,
                    routine_name: row.get(2)?,
                    trigger: row.get(3)?,
                    status: row.get(4)?,
                    output: row.get(5)?,
                    started_at: row.get(6)?,
                    ended_at: row.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Mark runs left `running` by a crash/quit as failed.
    pub fn reconcile_stale_routine_runs(&self) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "UPDATE routine_runs SET status = 'failed', output = IFNULL(output, 'Interrupted (app closed)'),
             ended_at = IFNULL(ended_at, started_at) WHERE status = 'running'",
            [],
        )?;
        Ok(())
    }

    /// Local markdown digest of a period — no AI, no network.
    pub fn local_digest(&self, period: &str, focus: Option<&str>) -> Result<String> {
        let (from, to) = period_range(period, now_local().date());
        let q = TimeQuery {
            from: from.clone(),
            to: to.clone(),
            rows_by: "project".into(),
            cols_by: "none".into(),
            filters: vec![],
            include_idle: false,
            compare_previous: true,
        };
        let r = self.run_time_query(&q)?;
        let sessions = self.sessions_in_range(&from, &to)?;
        let insights = compute_insights(&r, &sessions);
        let range = if from == to { from.clone() } else { format!("{from} → {to}") };
        let mut md = format!("**{range}** · {} tracked", fmt_dur(r.kpis.total_secs));
        if let Some(d) = r.delta_pct {
            md.push_str(&format!(" ({:+.0}% vs previous)", d));
        }
        md.push_str("\n\n");
        if focus != Some("untagged") {
            for (i, row) in r.rows.iter().take(5).enumerate() {
                md.push_str(&format!("- {} — {}\n", row.label, fmt_dur(r.row_totals[i])));
            }
            md.push('\n');
        }
        for ins in insights {
            if focus == Some("untagged") && ins.kind == "highlight" {
                continue;
            }
            let icon = match ins.kind.as_str() {
                "highlight" => "★",
                "anomaly" => "⚠",
                _ => "•",
            };
            md.push_str(&format!("{icon} **{}** — {}\n", ins.title, ins.detail));
        }
        Ok(md)
    }

    // Meetings

    /// Create meeting rows for calendar events in range that don't have one yet.
    pub fn sync_meetings_from_calendar(&self, from: &str, to: &str) -> Result<i64> {
        let start = format!("{from}T00:00:00");
        let end = format!("{to}T23:59:59");
        let conn = self.conn.lock().expect("store mutex poisoned");
        let n = conn.execute(
            "INSERT OR IGNORE INTO meetings (calendar_event_id, title, started_at, ended_at)
             SELECT id, title, started_at, ended_at FROM calendar_events
             WHERE started_at >= ?1 AND started_at <= ?2",
            params![start, end],
        )?;
        Ok(n as i64)
    }

    pub fn list_meetings(&self, from: &str, to: &str) -> Result<Vec<Meeting>> {
        let start = format!("{from}T00:00:00");
        let end = format!("{to}T23:59:59");
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(&format!(
            "SELECT {MEETING_COLS} FROM meetings m
             LEFT JOIN clients c ON c.id = m.client_id
             LEFT JOIN projects p ON p.id = m.project_id
             WHERE m.started_at >= ?1 AND m.started_at <= ?2
             ORDER BY m.started_at"
        ))?;
        let rows = stmt
            .query_map(params![start, end], map_meeting)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_meeting(&self, id: i64) -> Result<Option<Meeting>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {MEETING_COLS} FROM meetings m
                     LEFT JOIN clients c ON c.id = m.client_id
                     LEFT JOIN projects p ON p.id = m.project_id
                     WHERE m.id = ?1"
                ),
                params![id],
                map_meeting,
            )
            .optional()?)
    }

    pub fn create_meeting(&self, title: &str, started_at: &str, ended_at: &str, attendees: Option<&str>) -> Result<Meeting> {
        let a = NaiveDateTime::parse_from_str(started_at, TS_FMT)
            .map_err(|_| StoreError::Msg("invalid start time".into()))?;
        let b = NaiveDateTime::parse_from_str(ended_at, TS_FMT)
            .map_err(|_| StoreError::Msg("invalid end time".into()))?;
        if b <= a {
            return Err(StoreError::Msg("meeting must end after it starts".into()));
        }
        let id = {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "INSERT INTO meetings (title, started_at, ended_at, attendees) VALUES (?1, ?2, ?3, ?4)",
                params![title.trim(), started_at, ended_at, attendees],
            )?;
            conn.last_insert_rowid()
        };
        self.get_meeting(id)?.ok_or_else(|| StoreError::Msg("meeting not found".into()))
    }

    pub fn update_meeting(
        &self,
        id: i64,
        attendance: Option<&str>,
        client_id: Option<i64>,
        project_id: Option<i64>,
        attendees: Option<&str>,
    ) -> Result<Meeting> {
        if let Some(a) = attendance {
            if !matches!(a, "unknown" | "attend" | "skip") {
                return Err(StoreError::Msg("attendance must be unknown|attend|skip".into()));
            }
        }
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "UPDATE meetings SET attendance = IFNULL(?1, attendance), client_id = ?2, project_id = ?3,
                 attendees = IFNULL(?4, attendees) WHERE id = ?5",
                params![attendance, client_id, project_id, attendees, id],
            )?;
        }
        self.get_meeting(id)?.ok_or_else(|| StoreError::Msg("meeting not found".into()))
    }

    /// Attach a transcript (VTT/SRT/plain) and auto-match client/project by name mentions.
    pub fn attach_meeting_transcript(&self, id: i64, raw: &str) -> Result<Meeting> {
        let text = clean_transcript(raw);
        let meeting = self.get_meeting(id)?.ok_or_else(|| StoreError::Msg("meeting not found".into()))?;
        let (client_id, project_id) = if meeting.client_id.is_none() && meeting.project_id.is_none() {
            self.match_hierarchy(&format!("{}\n{}", meeting.title, text))?
        } else {
            (meeting.client_id, meeting.project_id)
        };
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "UPDATE meetings SET transcript = ?1, client_id = ?2, project_id = ?3 WHERE id = ?4",
                params![text, client_id, project_id, id],
            )?;
        }
        self.get_meeting(id)?.ok_or_else(|| StoreError::Msg("meeting not found".into()))
    }

    pub fn set_meeting_summary(&self, id: i64, summary: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("UPDATE meetings SET summary = ?1 WHERE id = ?2", params![summary, id])?;
        Ok(())
    }

    /// Most-mentioned project (else client) name in `text`, case-insensitive.
    pub fn match_hierarchy(&self, text: &str) -> Result<(Option<i64>, Option<i64>)> {
        let blob = text.to_lowercase();
        let h = self.hierarchy()?;
        let count = |name: &str| -> usize {
            let n = name.trim().to_lowercase();
            if n.len() < 3 {
                0
            } else {
                blob.matches(&n).count()
            }
        };
        let mut best: Option<(usize, Option<i64>, Option<i64>)> = None;
        for c in &h.clients {
            let cn = count(&c.name);
            if cn > 0 && best.as_ref().map(|b| cn > b.0).unwrap_or(true) {
                best = Some((cn, Some(c.id), None));
            }
            for p in &c.projects {
                let pn = count(&p.name);
                if pn > 0 && best.as_ref().map(|b| pn >= b.0).unwrap_or(true) {
                    best = Some((pn, Some(c.id), Some(p.id)));
                }
            }
        }
        Ok(best.map(|b| (b.1, b.2)).unwrap_or((None, None)))
    }

    /// Log the meeting as a tagged Meeting session (idempotent).
    pub fn log_meeting_session(&self, id: i64) -> Result<Meeting> {
        let m = self.get_meeting(id)?.ok_or_else(|| StoreError::Msg("meeting not found".into()))?;
        if m.session_id.is_some() {
            return Ok(m);
        }
        let sid = self.create_manual_session(
            &m.title,
            &m.started_at,
            &m.ended_at,
            m.client_id,
            m.project_id,
            None,
            m.summary.as_deref().or(Some("Meeting")),
            Some("Meeting"),
        )?;
        {
            let conn = self.conn.lock().expect("store mutex poisoned");
            conn.execute(
                "UPDATE meetings SET session_id = ?1, attendance = 'attend' WHERE id = ?2",
                params![sid, id],
            )?;
        }
        self.get_meeting(id)?.ok_or_else(|| StoreError::Msg("meeting not found".into()))
    }

    pub fn delete_meeting(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM meetings WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Capacity

    /// Planned vs tracked vs capacity for a range, with weekly load rows.
    pub fn capacity_report(&self, from: &str, to: &str) -> Result<CapacityReport> {
        let f = NaiveDate::parse_from_str(from, "%Y-%m-%d").map_err(|_| StoreError::Msg("invalid from".into()))?;
        let t = NaiveDate::parse_from_str(to, "%Y-%m-%d").map_err(|_| StoreError::Msg("invalid to".into()))?;
        let weekly_cap_h: f64 = self
            .get_setting("capacity_hours_week")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(40.0);
        let work_days: f64 = self
            .get_setting("capacity_days_week")?
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(5.0)
            .clamp(1.0, 7.0);
        let daily_cap_secs = (weekly_cap_h * 3600.0 / work_days) as i64;

        let tracked = self.run_time_query(&TimeQuery {
            from: from.into(),
            to: to.into(),
            rows_by: "none".into(),
            cols_by: "day".into(),
            filters: vec![],
            include_idle: false,
            compare_previous: false,
        })?;

        let planned_by_day: std::collections::HashMap<String, i64> = {
            let conn = self.conn.lock().expect("store mutex poisoned");
            let mut stmt = conn.prepare(
                "SELECT substr(started_at, 1, 10), SUM(duration_secs) FROM planned_sessions
                 WHERE started_at >= ?1 AND started_at <= ?2 AND kind != 'break' AND status != 'skipped'
                 GROUP BY 1",
            )?;
            let rows = stmt
                .query_map(params![format!("{from}T00:00:00"), format!("{to}T23:59:59")], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows.into_iter().collect()
        };

        let mut days = Vec::new();
        let mut d = f;
        let (mut cum_t, mut cum_p, mut cum_c) = (0i64, 0i64, 0i64);
        while d <= t {
            let key = fmt_day(d);
            let idx = tracked.cols.iter().position(|c| c.key == key);
            let tr = idx.map(|i| tracked.col_totals[i]).unwrap_or(0);
            let pl = planned_by_day.get(&key).copied().unwrap_or(0);
            let cap = if (d.weekday().num_days_from_monday() as f64) < work_days { daily_cap_secs } else { 0 };
            cum_t += tr;
            cum_p += pl;
            cum_c += cap;
            days.push(CapacityDay {
                day: key,
                tracked_secs: tr,
                planned_secs: pl,
                capacity_secs: cap,
                cum_tracked_secs: cum_t,
                cum_planned_secs: cum_p,
                cum_capacity_secs: cum_c,
            });
            d += Duration::days(1);
        }

        let mut weeks: Vec<CapacityWeek> = Vec::new();
        for day in &days {
            let dd = NaiveDate::parse_from_str(&day.day, "%Y-%m-%d").unwrap();
            let iso = dd.iso_week();
            let key = format!("{}-W{:02}", iso.year(), iso.week());
            if weeks.last().map(|w| w.key != key).unwrap_or(true) {
                weeks.push(CapacityWeek {
                    key: key.clone(),
                    label: format!("Wk {}", iso.week()),
                    ..Default::default()
                });
            }
            let w = weeks.last_mut().unwrap();
            w.tracked_secs += day.tracked_secs;
            w.planned_secs += day.planned_secs;
            w.capacity_secs += day.capacity_secs;
        }
        for w in &mut weeks {
            let load = w.planned_secs.max(w.tracked_secs);
            w.load_pct = if w.capacity_secs > 0 { load as f64 * 100.0 / w.capacity_secs as f64 } else { 0.0 };
        }

        Ok(CapacityReport {
            from: from.into(),
            to: to.into(),
            tracked_secs: cum_t,
            planned_secs: cum_p,
            capacity_secs: cum_c,
            utilization_pct: if cum_c > 0 { cum_t as f64 * 100.0 / cum_c as f64 } else { 0.0 },
            weekly_capacity_hours: weekly_cap_h,
            days,
            weeks,
        })
    }
}

// ───────────────────────────── Focus overview ─────────────────────────────

/// Apps/sites treated as distractions during focus even without a block rule.
const DEFAULT_DISTRACTIONS: &[&str] = &[
    "slack", "discord", "teams", "mail", "outlook", "superhuman", "whatsapp", "telegram",
    "messenger", "youtube", "reddit", "twitter", "x.com", "facebook", "instagram", "tiktok",
    "netflix", "twitch", "news",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistractionItem {
    pub label: String,
    pub secs: i64,
    pub pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusOverview {
    pub day: String,
    pub focus_secs: i64,
    pub focus_sessions: i64,
    pub break_secs: i64,
    /// Mon..Sun of the week containing `day`.
    pub week: Vec<(String, i64)>,
    pub week_total_secs: i64,
    pub week_avg_session_secs: i64,
    pub distraction_secs: i64,
    pub top_distractions: Vec<DistractionItem>,
}

impl Store {
    pub fn focus_overview(&self, day: &str) -> Result<FocusOverview> {
        let d = NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| StoreError::Msg("invalid day".into()))?;
        let monday = d - Duration::days(d.weekday().num_days_from_monday() as i64);
        let mut week = Vec::new();
        let (mut week_total, mut week_sessions) = (0i64, 0i64);
        let (mut focus_secs, mut focus_n, mut break_secs) = (0i64, 0i64, 0i64);
        let mut windows: Vec<(NaiveDateTime, NaiveDateTime)> = Vec::new();
        let now = now_local();
        for i in 0..7 {
            let wd = monday + Duration::days(i);
            let key = fmt_day(wd);
            let sessions = self.list_focus_for_day(&key)?;
            let mut day_focus = 0;
            for f in &sessions {
                let kind = f.kind.to_lowercase();
                if kind == "focus" {
                    day_focus += f.elapsed_secs;
                    week_sessions += 1;
                } else if kind == "break" && wd == d {
                    break_secs += f.elapsed_secs;
                }
                if kind == "focus" && wd == d {
                    focus_n += 1;
                    if let Ok(a) = NaiveDateTime::parse_from_str(&f.started_at, TS_FMT) {
                        let b = f
                            .ended_at
                            .as_deref()
                            .and_then(|e| NaiveDateTime::parse_from_str(e, TS_FMT).ok())
                            .unwrap_or(now);
                        windows.push((a, b));
                    }
                }
            }
            if wd == d {
                focus_secs = day_focus;
            }
            week_total += day_focus;
            week.push((wd.format("%a").to_string(), day_focus));
        }

        // Tracked time inside focus windows that matches a block rule or a common distraction.
        let rules: Vec<String> = self
            .list_block_rules()?
            .into_iter()
            .filter(|r| r.enabled && !r.pattern.trim().is_empty())
            .map(|r| r.pattern.to_lowercase())
            .collect();
        let tracked = self.sessions_in_range(day, day)?;
        let mut by_label: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        let mut inside_total = 0i64;
        for s in tracked.iter().filter(|s| !s.idle) {
            let Ok(a) = NaiveDateTime::parse_from_str(&s.started_at, TS_FMT) else { continue };
            let b = s
                .ended_at
                .as_deref()
                .and_then(|e| NaiveDateTime::parse_from_str(e, TS_FMT).ok())
                .unwrap_or(a);
            let overlap: i64 = windows
                .iter()
                .map(|(wa, wb)| (b.min(*wb) - a.max(*wa)).num_seconds().max(0))
                .sum();
            if overlap == 0 {
                continue;
            }
            inside_total += overlap;
            let domain = s.url.as_deref().and_then(super::query::url_domain);
            let app = s.app_name.clone().unwrap_or_default();
            let hay = format!(
                "{} {} {}",
                app.to_lowercase(),
                domain.clone().unwrap_or_default(),
                s.title.clone().unwrap_or_default().to_lowercase()
            );
            let hit = rules.iter().any(|r| hay.contains(r.as_str()))
                || DEFAULT_DISTRACTIONS.iter().any(|k| hay.contains(k));
            if hit {
                let label = domain.unwrap_or(app);
                *by_label.entry(label).or_default() += overlap;
            }
        }
        let distraction_secs: i64 = by_label.values().sum();
        let mut top: Vec<DistractionItem> = by_label
            .into_iter()
            .map(|(label, secs)| DistractionItem {
                label,
                secs,
                pct: if distraction_secs > 0 { secs as f64 * 100.0 / distraction_secs as f64 } else { 0.0 },
            })
            .collect();
        top.sort_by(|a, b| b.secs.cmp(&a.secs));
        top.truncate(5);
        let _ = inside_total;

        Ok(FocusOverview {
            day: day.into(),
            focus_secs,
            focus_sessions: focus_n,
            break_secs,
            week,
            week_total_secs: week_total,
            week_avg_session_secs: if week_sessions > 0 { week_total / week_sessions } else { 0 },
            distraction_secs,
            top_distractions: top,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapacityDay {
    pub day: String,
    pub tracked_secs: i64,
    pub planned_secs: i64,
    pub capacity_secs: i64,
    pub cum_tracked_secs: i64,
    pub cum_planned_secs: i64,
    pub cum_capacity_secs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CapacityWeek {
    pub key: String,
    pub label: String,
    pub tracked_secs: i64,
    pub planned_secs: i64,
    pub capacity_secs: i64,
    pub load_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapacityReport {
    pub from: String,
    pub to: String,
    pub tracked_secs: i64,
    pub planned_secs: i64,
    pub capacity_secs: i64,
    pub utilization_pct: f64,
    pub weekly_capacity_hours: f64,
    pub days: Vec<CapacityDay>,
    pub weeks: Vec<CapacityWeek>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, TS_FMT).unwrap()
    }

    fn temp_store(label: &str) -> (std::path::PathBuf, Store) {
        let dir = std::env::temp_dir().join(format!(
            "autotrace-analytics-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(dir.join("a.db")).unwrap();
        (dir, store)
    }

    #[test]
    fn schedule_daily_due_once_per_occurrence() {
        let s = Schedule { kind: "daily".into(), time: Some("17:00".into()), weekday: None };
        let now = dt("2026-10-16T17:05:00");
        assert!(s.is_due(Some(dt("2026-10-16T09:00:00")), now));
        assert!(!s.is_due(Some(dt("2026-10-16T17:01:00")), now));
        // Before 17:00 the last occurrence is yesterday's.
        assert!(!s.is_due(Some(dt("2026-10-15T17:30:00")), dt("2026-10-16T16:00:00")));
    }

    #[test]
    fn schedule_weekdays_and_weekly() {
        let wd = Schedule { kind: "weekdays".into(), time: Some("08:30".into()), weekday: None };
        // Sunday 2026-10-18 → last occurrence is Friday 10-16.
        assert_eq!(wd.last_occurrence(dt("2026-10-18T10:00:00")), Some(dt("2026-10-16T08:30:00")));
        let wk = Schedule { kind: "weekly".into(), time: Some("09:00".into()), weekday: Some(0) };
        assert_eq!(wk.last_occurrence(dt("2026-10-17T10:00:00")), Some(dt("2026-10-12T09:00:00")));
        let manual = Schedule { kind: "manual".into(), ..Default::default() };
        assert!(!manual.is_due(None, dt("2026-10-17T10:00:00")));
    }

    #[test]
    fn periods() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 17).unwrap(); // Saturday
        assert_eq!(period_range("week", today), ("2026-10-12".into(), "2026-10-17".into()));
        assert_eq!(period_range("last_week", today), ("2026-10-05".into(), "2026-10-11".into()));
        assert_eq!(period_range("last_month", today), ("2026-09-01".into(), "2026-09-30".into()));
        assert_eq!(period_range("yesterday", today), ("2026-10-16".into(), "2026-10-16".into()));
    }

    #[test]
    fn transcript_cleanup() {
        let vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Alice>Hello Acme team</v>\n\n2\n00:00:03.000 --> 00:00:05.000\nNext item";
        assert_eq!(clean_transcript(vtt), "Alice: Hello Acme team\nNext item");
    }

    #[test]
    fn dashboard_report_and_routine_roundtrip() {
        let (dir, store) = temp_store("roundtrip");
        let d = store.create_dashboard_from_template("timesheet").unwrap();
        assert_eq!(d.query.rows_by, "project");
        assert_eq!(store.list_dashboards().unwrap().len(), 1);

        let today = fmt_day(now_local().date());
        store
            .create_manual_session("Deep work", &format!("{today}T00:10:00"), &format!("{today}T00:50:00"), None, None, None, None, None)
            .unwrap();
        let rep = store
            .save_report(None, "Daily", Some(d.id), "today", &Schedule { kind: "manual".into(), ..Default::default() }, false, true)
            .unwrap();
        let run = store.compute_report_run(rep.id, "manual").unwrap();
        assert_eq!(run.period_from, today);
        assert!(run.insights.iter().any(|i| i.title.contains("Best block")));
        assert_eq!(store.list_report_runs(rep.id).unwrap().len(), 1);

        store.seed_builtin_routines().unwrap();
        store.seed_builtin_routines().unwrap();
        let routines = store.list_routines().unwrap();
        assert_eq!(routines.len(), 5);
        let rid = routines[0].id;
        let run_id = store.begin_routine_run(rid, "manual").unwrap();
        store.finish_routine_run(run_id, "ready", "ok").unwrap();
        assert_eq!(store.get_routine(rid).unwrap().unwrap().last_status.as_deref(), Some("ready"));
        assert!(store.save_routine(None, "x", &Schedule::default(), "rm -rf", &serde_json::json!({}), true).is_err());

        let md = store.local_digest("today", None).unwrap();
        assert!(md.contains("40m"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn meeting_transcript_matches_project_and_logs_session() {
        let (dir, store) = temp_store("meeting");
        let c = store.create_client("Northstar Labs", None).unwrap();
        let p = store.create_project(c.id, "Billing revamp", None).unwrap();
        let m = store
            .create_meeting("Weekly sync", "2026-10-16T10:00:00", "2026-10-16T10:30:00", Some("a@x.io, b@y.io"))
            .unwrap();
        assert_eq!(m.attendees.len(), 2);
        let m = store
            .attach_meeting_transcript(m.id, "1\n00:00 --> 00:01\nLet's review the billing revamp for Northstar Labs")
            .unwrap();
        assert_eq!(m.project_id, Some(p.id));
        let m = store.log_meeting_session(m.id).unwrap();
        let sid = m.session_id.unwrap();
        assert_eq!(store.log_meeting_session(m.id).unwrap().session_id, Some(sid));
        let s = store.get_session(sid).unwrap().unwrap();
        assert_eq!(s.category.as_deref(), Some("Meeting"));
        assert_eq!(s.project_id, Some(p.id));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn focus_overview_counts_distractions_inside_focus() {
        let (dir, store) = temp_store("focus");
        let f = store.start_focus(None, None, None, None).unwrap();
        // Backdate the focus window 20 minutes (same day) so a past session overlaps it.
        let now = now_local();
        let begin = (now - Duration::minutes(20)).max(now.date().and_hms_opt(0, 0, 0).unwrap());
        store
            .conn
            .lock()
            .unwrap()
            .execute("UPDATE focus_sessions SET started_at = ?1 WHERE id = ?2", params![fmt_ts(begin), f.id])
            .unwrap();
        let day = fmt_day(now.date());
        let app = store.upsert_app("Slack", None).unwrap();
        let start = fmt_ts(begin);
        let sid = store.start_session(app, Some("general"), None, &start, false, None, false, None).unwrap();
        let end = fmt_ts(begin + Duration::seconds(90).min(now - begin));
        store.end_session(sid, &end).unwrap();
        let o = store.focus_overview(&day).unwrap();
        assert_eq!(o.focus_sessions, 1);
        assert_eq!(o.week.len(), 7);
        assert!(o.top_distractions.iter().any(|d| d.label == "Slack"), "{:?}", o.top_distractions);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn capacity_counts_tracked_and_planned() {
        let (dir, store) = temp_store("capacity");
        store.set_setting("capacity_hours_week", "40").unwrap();
        store
            .create_manual_session("Work", "2026-10-12T09:00:00", "2026-10-12T13:00:00", None, None, None, None, None)
            .unwrap();
        let r = store.capacity_report("2026-10-12", "2026-10-18").unwrap();
        assert_eq!(r.tracked_secs, 4 * 3600);
        assert_eq!(r.capacity_secs, 40 * 3600);
        assert_eq!(r.weeks.len(), 1);
        assert!((r.utilization_pct - 10.0).abs() < 0.01);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
