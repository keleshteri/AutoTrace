//! Report + routine runners and the background scheduler.
//!
//! Everything runs on-device. Steps that leave the machine (AI, integration push)
//! only happen when the user already enabled them, and are written to the
//! privacy audit log by the code they call.

use std::sync::Arc;
use std::time::Duration;

use crate::store::analytics::{period_range, ReportRun, RoutineRun};
use crate::store::query::{result_to_csv, TimeQuery};
use crate::store::Store;

const REPORT_SYSTEM: &str = "You are AutoTrace report writer. Use ONLY the JSON provided. \
Never invent numbers. Write 3 short markdown bullets: what the time went to, what stood out \
(use the computed insights), and one concrete suggestion. Durations are in seconds in the JSON; \
present them as hours and minutes.";

/// Compute a report run locally, then add an AI summary when the report and AI are enabled.
pub fn run_report(store: &Store, report_id: i64, trigger: &str) -> Result<ReportRun, String> {
    let run = store
        .compute_report_run(report_id, trigger)
        .map_err(|e| e.to_string())?;
    let report = store
        .get_report(report_id)
        .map_err(|e| e.to_string())?
        .ok_or("report not found")?;
    if report.ai_enabled && store.ai_enabled() {
        let payload = serde_json::json!({
            "period": { "from": run.period_from, "to": run.period_to },
            "kpis": run.result.as_ref().and_then(|r| r.get("kpis")),
            "previous": run.result.as_ref().and_then(|r| r.get("previous")),
            "delta_pct": run.result.as_ref().and_then(|r| r.get("delta_pct")),
            "rows": compact_rows(run.result.as_ref()),
            "insights": run.insights,
        });
        let req = crate::ai::AgentRequest {
            agent: "report".into(),
            model: None,
            prompt: format!("Report \"{}\" data:\n{}", report.name, payload),
            system: Some(REPORT_SYSTEM.into()),
            chat_id: None,
            template_slug: None,
            variables: None,
            day: Some(run.period_to.clone()),
        };
        match crate::ai::run_agent(store, req) {
            Ok(r) => {
                let _ = store.set_report_run_ai(run.id, Some(&r.text), None);
            }
            Err(e) => {
                let _ = store.set_report_run_ai(run.id, None, Some(&e));
            }
        }
    }
    store
        .get_report_run(run.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "run not found".into())
}

/// Row labels + totals only (no titles/URLs) — what the AI is allowed to see.
fn compact_rows(result: Option<&serde_json::Value>) -> serde_json::Value {
    let Some(r) = result else { return serde_json::json!([]) };
    let rows = r.get("rows").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let totals = r.get("row_totals").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    serde_json::Value::Array(
        rows.iter()
            .zip(totals.iter())
            .take(25)
            .map(|(row, t)| serde_json::json!({ "label": row.get("label"), "secs": t }))
            .collect(),
    )
}

fn str_field<'a>(v: &'a serde_json::Value, k: &str, default: &'a str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or(default)
}

fn exports_dir(store: &Store) -> std::path::PathBuf {
    store
        .path()
        .parent()
        .map(|p| p.join("exports"))
        .unwrap_or_else(|| std::path::PathBuf::from("exports"))
}

fn execute_routine(store: &Store, kind: &str, action: &serde_json::Value) -> Result<String, String> {
    match kind {
        "digest" => store
            .local_digest(str_field(action, "period", "today"), action.get("focus").and_then(|f| f.as_str()))
            .map_err(|e| e.to_string()),
        "report" => {
            let id = action
                .get("report_id")
                .and_then(|v| v.as_i64())
                .ok_or("routine is missing report_id")?;
            let run = run_report(store, id, "routine")?;
            let mut out = run
                .insights
                .iter()
                .map(|i| format!("- **{}** — {}", i.title, i.detail))
                .collect::<Vec<_>>()
                .join("\n");
            if let Some(s) = run.ai_summary {
                out = format!("{s}\n\n{out}");
            }
            Ok(out)
        }
        "ai_prompt" => {
            let prompt = str_field(action, "prompt", "").trim();
            if prompt.is_empty() {
                return Err("routine prompt is empty".into());
            }
            let period = str_field(action, "period", "today");
            let (from, to) = period_range(period, chrono::Local::now().date_naive());
            let ctx = store
                .run_time_query(&TimeQuery {
                    from: from.clone(),
                    to: to.clone(),
                    rows_by: "project".into(),
                    cols_by: "none".into(),
                    filters: vec![],
                    include_idle: false,
                    compare_previous: true,
                })
                .map_err(|e| e.to_string())?;
            let ctx = serde_json::json!({
                "period": { "from": from, "to": to },
                "kpis": ctx.kpis,
                "delta_pct": ctx.delta_pct,
                "by_project": ctx.rows.iter().zip(ctx.row_totals.iter())
                    .map(|(r, t)| serde_json::json!({"label": r.label, "secs": t})).collect::<Vec<_>>(),
            });
            let r = crate::ai::run_agent(
                store,
                crate::ai::AgentRequest {
                    agent: "routine".into(),
                    model: None,
                    prompt: format!("{prompt}\n\nAutoTrace data (JSON, durations in seconds):\n{ctx}"),
                    system: None,
                    chat_id: None,
                    template_slug: None,
                    variables: None,
                    day: Some(to),
                },
            )?;
            Ok(r.text)
        }
        "export_csv" => {
            let (from, to) = period_range(str_field(action, "period", "last_week"), chrono::Local::now().date_naive());
            let q = TimeQuery {
                from: from.clone(),
                to: to.clone(),
                rows_by: str_field(action, "rows_by", "project").into(),
                cols_by: str_field(action, "cols_by", "day").into(),
                filters: vec![],
                include_idle: false,
                compare_previous: false,
            };
            let r = store.run_time_query(&q).map_err(|e| e.to_string())?;
            let dir = exports_dir(store);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("autotrace-{from}_to_{to}.csv"));
            std::fs::write(&path, result_to_csv(&r)).map_err(|e| e.to_string())?;
            Ok(format!("Saved {} rows to `{}`", r.rows.len(), path.display()))
        }
        "integration_push" => {
            let kind = str_field(action, "kind", "webhook");
            let res = crate::integrations::push_integration(store, kind, None)?;
            Ok(serde_json::to_string(&res).unwrap_or_default())
        }
        other => Err(format!("unknown routine action: {other}")),
    }
}

pub fn run_routine(store: &Store, routine_id: i64, trigger: &str) -> Result<RoutineRun, String> {
    let routine = store
        .get_routine(routine_id)
        .map_err(|e| e.to_string())?
        .ok_or("routine not found")?;
    let run_id = store
        .begin_routine_run(routine_id, trigger)
        .map_err(|e| e.to_string())?;
    let (status, output) = match execute_routine(store, &routine.action_kind, &routine.action) {
        Ok(out) => ("ready", out),
        Err(e) => ("failed", e),
    };
    store
        .finish_routine_run(run_id, status, &output)
        .map_err(|e| e.to_string())?;
    store
        .list_routine_runs(Some(routine_id), 1)
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "run not found".into())
}

/// One scheduler pass: run everything that's due.
pub fn tick(store: &Store) {
    let now = chrono::Local::now().naive_local();
    if let Ok(reports) = store.due_reports(now) {
        for r in reports {
            let _ = run_report(store, r.id, "schedule");
        }
    }
    if let Ok(routines) = store.due_routines(now) {
        for r in routines {
            let _ = run_routine(store, r.id, "schedule");
        }
    }
}

/// Background scheduler thread (30s tick; catches up once after sleep/wake).
pub fn start_scheduler(store: Arc<Store>) {
    let _ = store.reconcile_stale_routine_runs();
    let _ = store.seed_builtin_routines();
    std::thread::Builder::new()
        .name("autotrace-scheduler".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(30));
            tick(&store);
        })
        .ok();
}
