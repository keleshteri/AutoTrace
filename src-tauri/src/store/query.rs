//! Time query engine: pivot tracked sessions by any two dimensions over a date range.
//!
//! Powers Tracked Time, Dashboards, Reports, Routines, chat @mentions and the MCP
//! `query_time` tool. Aggregation happens in Rust over clipped session slices, so
//! dimensions never reach SQL as strings.

use std::collections::HashMap;

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};
use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::{map_session_row, Result, SessionRow, Store, StoreError};

const TS_FMT: &str = "%Y-%m-%dT%H:%M:%S";

/// Dimensions a query can group or filter by.
pub const DIMENSIONS: &[&str] = &[
    "none", "client", "project", "task", "category", "app", "domain", "billable", "status",
    "day", "week", "month", "weekday", "hour",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueryFilter {
    pub dim: String,
    /// Keys to keep (as returned in `QueryHeader.key`). Empty = no-op.
    #[serde(default)]
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimeQuery {
    /// Inclusive start day `YYYY-MM-DD`.
    pub from: String,
    /// Inclusive end day `YYYY-MM-DD`.
    pub to: String,
    #[serde(default = "default_rows")]
    pub rows_by: String,
    #[serde(default = "default_cols")]
    pub cols_by: String,
    #[serde(default)]
    pub filters: Vec<QueryFilter>,
    #[serde(default)]
    pub include_idle: bool,
    #[serde(default)]
    pub compare_previous: bool,
}

fn default_rows() -> String {
    "project".into()
}
fn default_cols() -> String {
    "day".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueryHeader {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct QueryKpis {
    pub total_secs: i64,
    pub entries: i64,
    pub active_days: i64,
    pub daily_avg_secs: i64,
    pub billable_secs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeQueryResult {
    pub query: TimeQuery,
    pub rows: Vec<QueryHeader>,
    pub cols: Vec<QueryHeader>,
    /// `cells[row][col]` in seconds.
    pub cells: Vec<Vec<i64>>,
    pub row_totals: Vec<i64>,
    pub col_totals: Vec<i64>,
    pub kpis: QueryKpis,
    pub previous: Option<QueryKpis>,
    /// Percent change of total vs previous period (None when no previous data).
    pub delta_pct: Option<f64>,
}

/// One clipped piece of a session that falls inside a single day (or hour).
struct Slice<'a> {
    session: &'a SessionRow,
    start: NaiveDateTime,
    secs: i64,
}

fn parse_day(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| StoreError::Msg(format!("invalid day: {s}")))
}

fn validate_dim(d: &str) -> Result<()> {
    if DIMENSIONS.contains(&d) {
        Ok(())
    } else {
        Err(StoreError::Msg(format!("unknown dimension: {d}")))
    }
}

fn is_time_dim(d: &str) -> bool {
    matches!(d, "day" | "week" | "month" | "weekday" | "hour")
}

pub fn url_domain(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let host = rest.split(['/', '?', '#']).next()?.split(':').next()?;
    let host = host.trim_start_matches("www.").to_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

/// (key, label) for a slice along a dimension.
fn dim_value(dim: &str, sl: &Slice<'_>) -> (String, String) {
    let s = sl.session;
    let opt = |id: Option<i64>, name: &Option<String>| match id {
        Some(id) => (id.to_string(), name.clone().unwrap_or_else(|| format!("#{id}"))),
        None => ("none".into(), "No label".into()),
    };
    match dim {
        "client" => opt(s.client_id, &s.client_name),
        "project" => opt(s.project_id, &s.project_name),
        "task" => opt(s.task_id, &s.task_name),
        "category" => {
            let c = s.category.clone().unwrap_or_else(|| "Other".into());
            (c.to_lowercase(), c)
        }
        "app" => {
            let a = s.app_name.clone().unwrap_or_else(|| "Unknown".into());
            (a.to_lowercase(), a)
        }
        "domain" => match s.url.as_deref().and_then(url_domain) {
            Some(d) => (d.clone(), d),
            None => ("none".into(), "No website".into()),
        },
        "billable" => {
            if s.billable {
                ("1".into(), "Billable".into())
            } else {
                ("0".into(), "Non-billable".into())
            }
        }
        "status" => {
            if s.approved {
                ("approved".into(), "Approved".into())
            } else if s.pending {
                ("pending".into(), "Pending".into())
            } else {
                ("auto".into(), "Auto".into())
            }
        }
        "day" => day_header(sl.start.date()),
        "week" => week_header(sl.start.date()),
        "month" => month_header(sl.start.date()),
        "weekday" => {
            let wd = sl.start.weekday();
            (
                wd.num_days_from_monday().to_string(),
                wd.to_string(),
            )
        }
        "hour" => {
            let h = sl.start.hour();
            (format!("{h:02}"), format!("{h:02}:00"))
        }
        _ => ("all".into(), "All".into()),
    }
}

fn day_header(d: NaiveDate) -> (String, String) {
    (d.format("%Y-%m-%d").to_string(), d.format("%a %-d").to_string())
}
fn week_start(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}
fn week_header(d: NaiveDate) -> (String, String) {
    let iso = d.iso_week();
    (
        format!("{}-W{:02}", iso.year(), iso.week()),
        format!("Wk {} · {}", iso.week(), week_start(d).format("%b %-d")),
    )
}
fn month_header(d: NaiveDate) -> (String, String) {
    (d.format("%Y-%m").to_string(), d.format("%b %Y").to_string())
}

/// All headers a time dimension produces over [from, to], in order.
fn time_axis(dim: &str, from: NaiveDate, to: NaiveDate) -> Vec<QueryHeader> {
    let mut out: Vec<QueryHeader> = Vec::new();
    match dim {
        "weekday" => {
            for i in 0..7u32 {
                let wd = chrono::Weekday::try_from(i as u8).unwrap();
                out.push(QueryHeader { key: i.to_string(), label: wd.to_string() });
            }
        }
        "hour" => {
            for h in 0..24 {
                out.push(QueryHeader { key: format!("{h:02}"), label: format!("{h:02}:00") });
            }
        }
        _ => {
            let mut d = from;
            while d <= to {
                let (key, label) = match dim {
                    "week" => week_header(d),
                    "month" => month_header(d),
                    _ => day_header(d),
                };
                if out.last().map(|h| h.key != key).unwrap_or(true) {
                    out.push(QueryHeader { key, label });
                }
                d += Duration::days(1);
            }
        }
    }
    out
}

/// Split sessions into slices clipped to [range_start, range_end), cut at day
/// boundaries (or hour boundaries when `by_hour`).
fn slices<'a>(
    sessions: &'a [SessionRow],
    range_start: NaiveDateTime,
    range_end: NaiveDateTime,
    by_hour: bool,
    include_idle: bool,
) -> Vec<Slice<'a>> {
    let mut out = Vec::new();
    for s in sessions {
        if s.idle && !include_idle {
            continue;
        }
        let Ok(start) = NaiveDateTime::parse_from_str(&s.started_at, TS_FMT) else {
            continue;
        };
        let end = s
            .ended_at
            .as_deref()
            .and_then(|e| NaiveDateTime::parse_from_str(e, TS_FMT).ok())
            .unwrap_or(start);
        let mut cur = start.max(range_start);
        let end = end.min(range_end);
        while cur < end {
            let boundary = if by_hour {
                cur.date().and_hms_opt(cur.hour(), 0, 0).unwrap() + Duration::hours(1)
            } else {
                cur.date().and_hms_opt(0, 0, 0).unwrap() + Duration::days(1)
            };
            let next = boundary.min(end);
            out.push(Slice { session: s, start: cur, secs: (next - cur).num_seconds() });
            cur = next;
        }
    }
    out
}

fn passes_filters(filters: &[QueryFilter], sl: &Slice<'_>) -> bool {
    filters
        .iter()
        .filter(|f| !f.values.is_empty())
        .all(|f| f.values.contains(&dim_value(&f.dim, sl).0))
}

fn kpis(slices: &[&Slice<'_>], days_in_range: i64) -> QueryKpis {
    let mut total = 0;
    let mut billable = 0;
    let mut ids = std::collections::HashSet::new();
    let mut days = std::collections::HashSet::new();
    for sl in slices {
        total += sl.secs;
        if sl.session.billable && !sl.session.idle {
            billable += sl.secs;
        }
        ids.insert(sl.session.id);
        days.insert(sl.start.date());
    }
    let active_days = days.len() as i64;
    let _ = days_in_range;
    QueryKpis {
        total_secs: total,
        entries: ids.len() as i64,
        active_days,
        daily_avg_secs: if active_days > 0 { total / active_days } else { 0 },
        billable_secs: billable,
    }
}

/// Pure aggregation over already-loaded sessions (unit-testable without a DB).
pub fn aggregate(
    q: &TimeQuery,
    sessions: &[SessionRow],
    previous_sessions: Option<&[SessionRow]>,
) -> Result<TimeQueryResult> {
    validate_dim(&q.rows_by)?;
    validate_dim(&q.cols_by)?;
    for f in &q.filters {
        validate_dim(&f.dim)?;
    }
    let from = parse_day(&q.from)?;
    let to = parse_day(&q.to)?;
    if to < from {
        return Err(StoreError::Msg("`to` is before `from`".into()));
    }
    let by_hour = q.rows_by == "hour"
        || q.cols_by == "hour"
        || q.filters.iter().any(|f| f.dim == "hour");
    let range_start = from.and_hms_opt(0, 0, 0).unwrap();
    let range_end = to.and_hms_opt(0, 0, 0).unwrap() + Duration::days(1);
    let days_in_range = (to - from).num_days() + 1;

    let all = slices(sessions, range_start, range_end, by_hour, q.include_idle);
    let kept: Vec<&Slice<'_>> = all.iter().filter(|s| passes_filters(&q.filters, s)).collect();

    // Accumulate per (row, col).
    let mut row_labels: HashMap<String, String> = HashMap::new();
    let mut col_labels: HashMap<String, String> = HashMap::new();
    let mut cell: HashMap<(String, String), i64> = HashMap::new();
    let mut row_sum: HashMap<String, i64> = HashMap::new();
    let mut col_sum: HashMap<String, i64> = HashMap::new();
    for sl in &kept {
        let (rk, rl) = dim_value(&q.rows_by, sl);
        let (ck, cl) = dim_value(&q.cols_by, sl);
        row_labels.entry(rk.clone()).or_insert(rl);
        col_labels.entry(ck.clone()).or_insert(cl);
        *cell.entry((rk.clone(), ck.clone())).or_default() += sl.secs;
        *row_sum.entry(rk).or_default() += sl.secs;
        *col_sum.entry(ck).or_default() += sl.secs;
    }

    let axis = |dim: &str, labels: HashMap<String, String>, sums: &HashMap<String, i64>| {
        if is_time_dim(dim) {
            time_axis(dim, from, to)
        } else {
            let mut v: Vec<QueryHeader> = labels
                .into_iter()
                .map(|(key, label)| QueryHeader { key, label })
                .collect();
            v.sort_by(|a, b| {
                sums.get(&b.key)
                    .cmp(&sums.get(&a.key))
                    .then_with(|| a.label.cmp(&b.label))
            });
            v
        }
    };
    let rows = axis(&q.rows_by, row_labels, &row_sum);
    let cols = axis(&q.cols_by, col_labels, &col_sum);

    let cells: Vec<Vec<i64>> = rows
        .iter()
        .map(|r| {
            cols.iter()
                .map(|c| cell.get(&(r.key.clone(), c.key.clone())).copied().unwrap_or(0))
                .collect()
        })
        .collect();
    let row_totals = rows.iter().map(|r| row_sum.get(&r.key).copied().unwrap_or(0)).collect();
    let col_totals = cols.iter().map(|c| col_sum.get(&c.key).copied().unwrap_or(0)).collect();
    let kpis_now = kpis(&kept, days_in_range);

    let previous = previous_sessions.map(|prev| {
        let p_end = range_start;
        let p_start = range_start - Duration::days(days_in_range);
        let p_all = slices(prev, p_start, p_end, by_hour, q.include_idle);
        let p_kept: Vec<&Slice<'_>> =
            p_all.iter().filter(|s| passes_filters(&q.filters, s)).collect();
        kpis(&p_kept, days_in_range)
    });
    let delta_pct = previous.as_ref().and_then(|p| {
        if p.total_secs > 0 {
            Some(((kpis_now.total_secs - p.total_secs) as f64 / p.total_secs as f64) * 100.0)
        } else {
            None
        }
    });

    Ok(TimeQueryResult {
        query: q.clone(),
        rows,
        cols,
        cells,
        row_totals,
        col_totals,
        kpis: kpis_now,
        previous,
        delta_pct,
    })
}

/// Sessions from the query that land in the given row/col cell (None = any).
pub fn sessions_in_cell(
    q: &TimeQuery,
    sessions: &[SessionRow],
    row_key: Option<&str>,
    col_key: Option<&str>,
) -> Result<Vec<SessionRow>> {
    let from = parse_day(&q.from)?;
    let to = parse_day(&q.to)?;
    let by_hour = q.rows_by == "hour" || q.cols_by == "hour";
    let range_start = from.and_hms_opt(0, 0, 0).unwrap();
    let range_end = to.and_hms_opt(0, 0, 0).unwrap() + Duration::days(1);
    let all = slices(sessions, range_start, range_end, by_hour, q.include_idle);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for sl in all.iter().filter(|s| passes_filters(&q.filters, s)) {
        if row_key.is_some_and(|k| dim_value(&q.rows_by, sl).0 != k) {
            continue;
        }
        if col_key.is_some_and(|k| dim_value(&q.cols_by, sl).0 != k) {
            continue;
        }
        if seen.insert(sl.session.id) {
            out.push(sl.session.clone());
        }
    }
    Ok(out)
}

impl Store {
    /// Sessions overlapping [from 00:00, to+1 00:00).
    pub fn sessions_in_range(&self, from: &str, to: &str) -> Result<Vec<SessionRow>> {
        let start = format!("{}T00:00:00", parse_day(from)?.format("%Y-%m-%d"));
        let end = format!(
            "{}T00:00:00",
            (parse_day(to)? + Duration::days(1)).format("%Y-%m-%d")
        );
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
             WHERE s.started_at < ?2 AND IFNULL(s.ended_at, s.started_at) > ?1
             ORDER BY s.started_at ASC",
        )?;
        let rows = stmt
            .query_map(params![start, end], map_session_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn run_time_query(&self, q: &TimeQuery) -> Result<TimeQueryResult> {
        let sessions = self.sessions_in_range(&q.from, &q.to)?;
        let prev = if q.compare_previous {
            let from = parse_day(&q.from)?;
            let to = parse_day(&q.to)?;
            let len = (to - from).num_days() + 1;
            let p_from = (from - Duration::days(len)).format("%Y-%m-%d").to_string();
            let p_to = (from - Duration::days(1)).format("%Y-%m-%d").to_string();
            Some(self.sessions_in_range(&p_from, &p_to)?)
        } else {
            None
        };
        aggregate(q, &sessions, prev.as_deref())
    }

    pub fn time_query_sessions(
        &self,
        q: &TimeQuery,
        row_key: Option<&str>,
        col_key: Option<&str>,
    ) -> Result<Vec<SessionRow>> {
        let sessions = self.sessions_in_range(&q.from, &q.to)?;
        sessions_in_cell(q, &sessions, row_key, col_key)
    }
}

/// Render a query result as CSV (hours, 2 decimals).
pub fn result_to_csv(r: &TimeQueryResult) -> String {
    let esc = |v: &str| {
        if v.contains([',', '"', '\n']) {
            format!("\"{}\"", v.replace('"', "\"\""))
        } else {
            v.to_string()
        }
    };
    let h = |secs: i64| format!("{:.2}", secs as f64 / 3600.0);
    let mut out = String::from(&esc(&r.query.rows_by));
    for c in &r.cols {
        out.push(',');
        out.push_str(&esc(&c.label));
    }
    out.push_str(",Total\n");
    for (i, row) in r.rows.iter().enumerate() {
        out.push_str(&esc(&row.label));
        for v in &r.cells[i] {
            out.push(',');
            out.push_str(&h(*v));
        }
        out.push(',');
        out.push_str(&h(r.row_totals[i]));
        out.push('\n');
    }
    out.push_str("Total");
    for v in &r.col_totals {
        out.push(',');
        out.push_str(&h(*v));
    }
    out.push(',');
    out.push_str(&h(r.kpis.total_secs));
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sess(id: i64, start: &str, end: &str, project: Option<(i64, &str)>) -> SessionRow {
        SessionRow {
            id,
            app_id: None,
            app_name: Some("Code".into()),
            title: None,
            url: Some("https://www.github.com/x".into()),
            started_at: start.into(),
            ended_at: Some(end.into()),
            idle: false,
            client_id: None,
            project_id: project.map(|p| p.0),
            task_id: None,
            client_name: None,
            project_name: project.map(|p| p.1.to_string()),
            task_name: None,
            approved: false,
            manual: false,
            notes: None,
            confidence: None,
            pending: false,
            category: Some("Code".into()),
            billable: true,
        }
    }

    fn q(from: &str, to: &str, rows: &str, cols: &str) -> TimeQuery {
        TimeQuery {
            from: from.into(),
            to: to.into(),
            rows_by: rows.into(),
            cols_by: cols.into(),
            filters: vec![],
            include_idle: false,
            compare_previous: false,
        }
    }

    #[test]
    fn pivots_project_by_day_and_splits_midnight() {
        let s = vec![
            sess(1, "2026-10-12T23:00:00", "2026-10-13T01:00:00", Some((7, "Alpha"))),
            sess(2, "2026-10-13T09:00:00", "2026-10-13T10:30:00", None),
        ];
        let r = aggregate(&q("2026-10-12", "2026-10-13", "project", "day"), &s, None).unwrap();
        assert_eq!(r.cols.len(), 2);
        assert_eq!(r.rows[0].label, "Alpha");
        let alpha = r.rows.iter().position(|x| x.key == "7").unwrap();
        assert_eq!(r.cells[alpha], vec![3600, 3600]);
        assert_eq!(r.kpis.total_secs, 2 * 3600 + 5400);
        assert_eq!(r.kpis.entries, 2);
    }

    #[test]
    fn clips_to_range_and_filters() {
        let s = vec![
            sess(1, "2026-10-11T23:00:00", "2026-10-12T01:00:00", Some((7, "Alpha"))),
            sess(2, "2026-10-12T09:00:00", "2026-10-12T10:00:00", Some((8, "Beta"))),
        ];
        let mut query = q("2026-10-12", "2026-10-12", "project", "none");
        query.filters = vec![QueryFilter { dim: "project".into(), values: vec!["7".into()] }];
        let r = aggregate(&query, &s, None).unwrap();
        assert_eq!(r.rows.len(), 1);
        assert_eq!(r.kpis.total_secs, 3600);
    }

    #[test]
    fn domain_and_hour_dims() {
        let s = vec![sess(1, "2026-10-12T09:30:00", "2026-10-12T11:00:00", None)];
        let r = aggregate(&q("2026-10-12", "2026-10-12", "domain", "hour"), &s, None).unwrap();
        assert_eq!(r.rows[0].key, "github.com");
        assert_eq!(r.cols.len(), 24);
        assert_eq!(r.cells[0][9], 1800);
        assert_eq!(r.cells[0][10], 3600);
    }

    #[test]
    fn previous_period_delta() {
        let now = vec![sess(1, "2026-10-12T09:00:00", "2026-10-12T11:00:00", None)];
        let prev = vec![sess(2, "2026-10-11T09:00:00", "2026-10-11T10:00:00", None)];
        let r = aggregate(&q("2026-10-12", "2026-10-12", "project", "day"), &now, Some(&prev)).unwrap();
        assert_eq!(r.previous.as_ref().unwrap().total_secs, 3600);
        assert_eq!(r.delta_pct.unwrap().round(), 100.0);
    }

    #[test]
    fn rejects_unknown_dimension() {
        let r = aggregate(&q("2026-10-12", "2026-10-12", "drop table", "day"), &[], None);
        assert!(r.is_err());
    }

    #[test]
    fn cell_drilldown_and_csv() {
        let s = vec![
            sess(1, "2026-10-12T09:00:00", "2026-10-12T10:00:00", Some((7, "Alpha"))),
            sess(2, "2026-10-13T09:00:00", "2026-10-13T10:00:00", Some((7, "Alpha"))),
        ];
        let query = q("2026-10-12", "2026-10-13", "project", "day");
        let hits = sessions_in_cell(&query, &s, Some("7"), Some("2026-10-13")).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, 2);
        let csv = result_to_csv(&aggregate(&query, &s, None).unwrap());
        assert!(csv.contains("Alpha,1.00,1.00,2.00"));
    }

    #[test]
    fn store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("autotrace-query-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(dir.join("q.db")).unwrap();
        let app = store.upsert_app("Code", None).unwrap();
        let id = store
            .start_session(app, Some("main.rs"), None, "2026-10-12T09:00:00", false, None, false, None)
            .unwrap();
        store.end_session(id, "2026-10-12T10:00:00").unwrap();
        let r = store.run_time_query(&q("2026-10-12", "2026-10-12", "app", "day")).unwrap();
        assert_eq!(r.kpis.total_secs, 3600);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
