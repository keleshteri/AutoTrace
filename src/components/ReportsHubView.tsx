import { useCallback, useEffect, useState } from "react";
import {
  analyticsApi,
  Dashboard,
  hoursLong,
  PERIODS,
  periodLabel,
  Report,
  ReportRun,
  Schedule,
  scheduleLabel,
} from "../lib/analyticsApi";
import { Markdown, relTime, ScheduleEditor, StatusDot } from "./ui";

type Props = { onError: (msg: string | null) => void; onOpenDashboard: (id: number) => void };

export function ReportsHubView({ onError, onOpenDashboard }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [tab, setTab] = useState<"runs" | "settings">("runs");
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([analyticsApi.listReports(), analyticsApi.listDashboards()]);
      setReports(r);
      setDashboards(d);
      setSelectedId((id) => id ?? r[0]?.id ?? null);
      onError(null);
    } catch (e) {
      onError(String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadRuns = useCallback(async () => {
    if (selectedId == null) return setRuns([]);
    const r = await analyticsApi.listReportRuns(selectedId);
    setRuns(r);
    setRunId((cur) => (cur && r.some((x) => x.id === cur) ? cur : (r[0]?.id ?? null)));
  }, [selectedId]);

  useEffect(() => {
    void loadRuns().catch((e) => onError(String(e)));
  }, [loadRuns, onError]);

  const report = reports.find((r) => r.id === selectedId) ?? null;
  const run = runs.find((r) => r.id === runId) ?? null;

  async function runNow() {
    if (!report) return;
    setRunning(true);
    try {
      const r = await analyticsApi.runReport(report.id);
      await loadRuns();
      setRunId(r.id);
      void refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page reports-page">
      <div className="page-head">
        <div>
          <h2>
            Reports
            {report && <span className="crumb-sep"> › {report.name}</span>}
          </h2>
          {report && (
            <p className="muted tt-sub">
              {scheduleLabel(report.schedule)} · {periodLabel(report.period)}
              {report.dashboard_name ? ` · on “${report.dashboard_name}”` : " · default view"}
            </p>
          )}
        </div>
        <div className="tt-head-actions">
          <button type="button" className="btn ghost" onClick={() => setCreating(true)}>
            + New report
          </button>
          {report && (
            <button type="button" className="btn" disabled={running} onClick={() => void runNow()}>
              {running ? "Running…" : "▷ Run now"}
            </button>
          )}
        </div>
      </div>

      {reports.length === 0 && !creating ? (
        <div className="card empty-card">
          <p>No reports yet.</p>
          <p className="muted">
            A report runs an analysis over a dashboard, on demand or on a schedule. Highlights and anomalies are
            computed on this device; an AI summary is added only if you enabled an AI provider.
          </p>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            Create your first report
          </button>
        </div>
      ) : (
        <div className="reports-layout">
          <aside className="reports-list">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`reports-item${r.id === selectedId ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(r.id);
                  setTab("runs");
                }}
              >
                <span className="reports-item-name">{r.name}</span>
                <span className="muted">
                  {scheduleLabel(r.schedule)} · {r.run_count} run{r.run_count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </aside>

          {report && (
            <section className="reports-main">
              <div className="tt-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "runs"} className={tab === "runs" ? "active" : undefined} onClick={() => setTab("runs")}>
                  Runs <span className="count">{runs.length}</span>
                </button>
                <button type="button" role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "active" : undefined} onClick={() => setTab("settings")}>
                  Settings
                </button>
              </div>

              {tab === "settings" && (
                <ReportForm
                  report={report}
                  dashboards={dashboards}
                  onError={onError}
                  onSaved={() => void refresh()}
                  onDeleted={() => {
                    setSelectedId(null);
                    void refresh();
                  }}
                />
              )}

              {tab === "runs" && (
                <div className="runs-layout">
                  <div className="runs-list">
                    {runs.length === 0 && <p className="muted">No runs yet. Click “Run now”.</p>}
                    {runs.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`runs-item${r.id === runId ? " active" : ""}`}
                        onClick={() => setRunId(r.id)}
                      >
                        <StatusDot status={r.error && !r.insights.length ? "failed" : r.status} />
                        <span className="muted">
                          {relTime(r.created_at)} · {r.trigger === "schedule" ? "Scheduled" : r.trigger === "routine" ? "Routine" : "On demand"}
                        </span>
                      </button>
                    ))}
                  </div>
                  {run && (
                    <div className="run-detail">
                      <div className="run-meta">
                        {report.dashboard_id ? (
                          <span>
                            Dashboard{" "}
                            <button type="button" className="link-btn" onClick={() => onOpenDashboard(report.dashboard_id!)}>
                              {report.dashboard_name}
                            </button>
                          </span>
                        ) : (
                          <span>Default view (projects by day)</span>
                        )}
                        <span>
                          Period <b>{run.period_from === run.period_to ? run.period_from : `${run.period_from} → ${run.period_to}`}</b>
                        </span>
                        <span>
                          Total <b>{hoursLong(run.result?.kpis.total_secs ?? 0)}</b>
                        </span>
                      </div>

                      <div className="card run-section">
                        <p className="kicker">✦ AI Summary</p>
                        {run.ai_summary ? (
                          <Markdown text={run.ai_summary} />
                        ) : (
                          <p className="muted">
                            {run.error
                              ? `Not generated: ${run.error}`
                              : report.ai_enabled
                                ? "Not generated — enable AI and add a provider under Agent to get a written summary."
                                : "AI summary is off for this report. The analysis below is computed locally."}
                          </p>
                        )}
                        <p className="muted run-foot">Generated {relTime(run.created_at)}. Data may have changed since this report ran.</p>
                      </div>

                      <p className="section-label">Analysis</p>
                      <div className="insight-grid">
                        {run.insights.map((i, idx) => (
                          <div key={idx} className={`card insight ${i.kind}`}>
                            <p className="insight-kind">
                              <span aria-hidden="true">{i.kind === "highlight" ? "☆" : i.kind === "anomaly" ? "⚠" : "ⓘ"}</span>{" "}
                              {i.kind === "highlight" ? "Highlight" : i.kind === "anomaly" ? "Anomaly" : "Note"}
                            </p>
                            <p className="insight-title">{i.title}</p>
                            <p className="muted">{i.detail}</p>
                          </div>
                        ))}
                      </div>

                      <button type="button" className="link-btn" onClick={() => setShowJson((v) => !v)}>
                        {showJson ? "Hide JSON" : "View JSON"}
                      </button>
                      {showJson && (
                        <pre className="json-view">{JSON.stringify({ insights: run.insights, result: run.result }, null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {creating && (
        <div className="modal-backdrop" role="dialog" aria-label="New report" onClick={() => setCreating(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>New report</h3>
            <ReportForm
              report={null}
              dashboards={dashboards}
              onError={onError}
              onSaved={(r) => {
                setCreating(false);
                setSelectedId(r.id);
                void refresh();
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ReportForm({
  report,
  dashboards,
  onSaved,
  onDeleted,
  onCancel,
  onError,
}: {
  report: Report | null;
  dashboards: Dashboard[];
  onSaved: (r: Report) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(report?.name ?? "Daily summary");
  const [dashboardId, setDashboardId] = useState<number | null>(report?.dashboard_id ?? dashboards[0]?.id ?? null);
  const [period, setPeriod] = useState(report?.period ?? "today");
  const [schedule, setSchedule] = useState<Schedule>(report?.schedule ?? { kind: "daily", time: "17:00" });
  const [ai, setAi] = useState(report?.ai_enabled ?? true);
  const [enabled, setEnabled] = useState(report?.enabled ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!report) return;
    setName(report.name);
    setDashboardId(report.dashboard_id);
    setPeriod(report.period);
    setSchedule(report.schedule);
    setAi(report.ai_enabled);
    setEnabled(report.enabled);
  }, [report?.id]);

  async function save() {
    try {
      onSaved(
        await analyticsApi.saveReport({ id: report?.id, name, dashboardId, period, schedule, aiEnabled: ai, enabled }),
      );
    } catch (e) {
      onError(String(e));
    }
  }

  return (
    <div className="form-stack">
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Dashboard</span>
        <select value={dashboardId ?? ""} onChange={(e) => setDashboardId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Default view (projects by day)</option>
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Period each run covers</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.filter((p) => p.id !== "custom").map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>Schedule</span>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
      </div>
      <label className="tt-check">
        <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
        Add an AI summary (uses your configured provider; sends totals + insights only, never titles)
      </label>
      <label className="tt-check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Schedule active
      </label>
      <div className="modal-actions">
        {report &&
          (confirmDelete ? (
            <button
              type="button"
              className="btn danger"
              onClick={() => void analyticsApi.deleteReport(report.id).then(() => onDeleted?.()).catch((e) => onError(String(e)))}
            >
              Confirm delete
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          ))}
        <span style={{ flex: 1 }} />
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn" disabled={!name.trim()} onClick={() => void save()}>
          {report ? "Save changes" : "Create report"}
        </button>
      </div>
    </div>
  );
}
