import { useCallback, useEffect, useState } from "react";
import {
  analyticsApi,
  PERIODS,
  periodLabel,
  Report,
  Routine,
  RoutineRun,
  Schedule,
  scheduleLabel,
} from "../lib/analyticsApi";
import { Markdown, relTime, ScheduleEditor, StatusDot } from "./ui";

type Props = { onError: (msg: string | null) => void };

const ACTIONS: { id: string; label: string; hint: string }[] = [
  { id: "digest", label: "Local digest", hint: "Summary of a period computed on this device. No AI, no network." },
  { id: "report", label: "Run a report", hint: "Runs one of your Reports and stores the result." },
  { id: "ai_prompt", label: "AI prompt", hint: "Asks your AI provider a question with this period's totals." },
  { id: "export_csv", label: "Export CSV", hint: "Writes a pivot CSV into the app's exports folder." },
  { id: "integration_push", label: "Push to integration", hint: "Sends approved entries to an enabled integration." },
];

function actionLabel(kind: string) {
  return ACTIONS.find((a) => a.id === kind)?.label ?? kind;
}

export function RoutinesView({ onError }: Props) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [tab, setTab] = useState<"routines" | "runs">("routines");
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [openRun, setOpenRun] = useState<RoutineRun | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<Routine | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([analyticsApi.listRoutines(), analyticsApi.listRoutineRuns(historyFor?.id ?? null, 100)]);
      setRoutines(r);
      setRuns(h);
      onError(null);
    } catch (e) {
      onError(String(e));
    }
  }, [onError, historyFor?.id]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function runNow(r: Routine) {
    setBusy(r.id);
    try {
      const run = await analyticsApi.runRoutine(r.id);
      setOpenRun(run);
      await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Routines</h2>
          <p className="muted tt-sub">Scheduled tasks that run on this device while AutoTrace is open. Missed runs catch up once on wake.</p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing("new")}>
          + New routine
        </button>
      </div>

      <div className="tt-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "routines"} className={tab === "routines" ? "active" : undefined} onClick={() => setTab("routines")}>
          Routines <span className="count">{routines.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "runs"}
          className={tab === "runs" ? "active" : undefined}
          onClick={() => {
            setHistoryFor(null);
            setTab("runs");
          }}
        >
          Runs
        </button>
      </div>

      {tab === "routines" && (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Routine</th>
                <th>Does</th>
                <th>Schedule</th>
                <th>Delivery</th>
                <th>Last run</th>
                <th>Active</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {routines.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="link-btn strong" onClick={() => setEditing(r)}>
                      {r.name}
                    </button>
                  </td>
                  <td className="muted">
                    {actionLabel(r.action_kind)}
                    {typeof r.action.period === "string" && ` · ${periodLabel(r.action.period)}`}
                  </td>
                  <td>{scheduleLabel(r.schedule)}</td>
                  <td className="muted">{r.action_kind === "export_csv" ? "File" : "In-app"}</td>
                  <td>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setHistoryFor(r);
                        setTab("runs");
                      }}
                    >
                      <StatusDot status={busy === r.id ? "running" : r.last_status} />
                    </button>
                  </td>
                  <td>
                    <label className="switch" title={r.enabled ? "Active" : "Paused"}>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        aria-label={`${r.name} active`}
                        onChange={(e) =>
                          void analyticsApi.setRoutineEnabled(r.id, e.target.checked).then(refresh).catch((err) => onError(String(err)))
                        }
                      />
                      <span />
                    </label>
                  </td>
                  <td>
                    <button type="button" className="icon-btn" title="Run now" aria-label={`Run ${r.name} now`} disabled={busy === r.id} onClick={() => void runNow(r)}>
                      ▷
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "runs" && (
        <div className="card table-card">
          {historyFor && (
            <div className="tt-log-filter">
              <span>
                History for <b>{historyFor.name}</b>
              </span>
              <button type="button" className="chip-btn" onClick={() => setHistoryFor(null)}>
                All routines ✕
              </button>
            </div>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Routine</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Started</th>
                <th aria-label="Output" />
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted tt-empty">
                    No runs yet.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.routine_name ?? `#${r.routine_id}`}</td>
                  <td>
                    <StatusDot status={r.status} />
                  </td>
                  <td className="muted">{r.trigger === "schedule" ? "Scheduled" : "Manual"}</td>
                  <td className="muted">{relTime(r.started_at)}</td>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setOpenRun(r)}>
                      View output
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openRun && (
        <div className="modal-backdrop" role="dialog" aria-label="Run output" onClick={() => setOpenRun(null)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <h3>
              {openRun.routine_name ?? "Routine"} <StatusDot status={openRun.status} />
            </h3>
            <p className="muted">{openRun.started_at.replace("T", " ")}</p>
            {openRun.output ? <Markdown text={openRun.output} /> : <p className="muted">No output.</p>}
            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              <button type="button" className="btn" onClick={() => setOpenRun(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <RoutineEditor
          routine={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function RoutineEditor({
  routine,
  onClose,
  onSaved,
  onError,
}: {
  routine: Routine | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(routine?.name ?? "");
  const [schedule, setSchedule] = useState<Schedule>(routine?.schedule ?? { kind: "weekdays", time: "09:00" });
  const [kind, setKind] = useState(routine?.action_kind ?? "digest");
  const [action, setAction] = useState<Record<string, unknown>>(routine?.action ?? { period: "today" });
  const [reports, setReports] = useState<Report[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void analyticsApi.listReports().then(setReports).catch(() => undefined);
  }, []);

  const set = (k: string, v: unknown) => setAction((a) => ({ ...a, [k]: v }));
  const str = (k: string, d = "") => (typeof action[k] === "string" ? (action[k] as string) : d);

  async function save() {
    try {
      await analyticsApi.saveRoutine({ id: routine?.id, name, schedule, actionKind: kind, action, enabled: routine?.enabled ?? true });
      onSaved();
    } catch (e) {
      onError(String(e));
    }
  }

  const needsPeriod = ["digest", "ai_prompt", "export_csv"].includes(kind);

  return (
    <div className="modal-backdrop" role="dialog" aria-label="Routine" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{routine ? "Edit routine" : "New routine"}</h3>
        <div className="form-stack">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monday standup" autoFocus />
          </label>
          <div className="field">
            <span>When</span>
            <ScheduleEditor value={schedule} onChange={setSchedule} />
          </div>
          <label className="field">
            <span>Action</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <small className="muted">{ACTIONS.find((a) => a.id === kind)?.hint}</small>
          </label>
          {needsPeriod && (
            <label className="field">
              <span>Period</span>
              <select value={str("period", "today")} onChange={(e) => set("period", e.target.value)}>
                {PERIODS.filter((p) => p.id !== "custom").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "report" && (
            <label className="field">
              <span>Report</span>
              <select value={String(action.report_id ?? "")} onChange={(e) => set("report_id", Number(e.target.value))}>
                <option value="">Choose a report…</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "ai_prompt" && (
            <label className="field">
              <span>Prompt</span>
              <textarea rows={4} value={str("prompt")} onChange={(e) => set("prompt", e.target.value)} placeholder="Write my Monday standup: what I did last week and what's next." />
            </label>
          )}
          {kind === "integration_push" && (
            <label className="field">
              <span>Integration</span>
              <select value={str("kind", "webhook")} onChange={(e) => set("kind", e.target.value)}>
                <option value="webhook">Webhook</option>
                <option value="clickup">ClickUp</option>
              </select>
            </label>
          )}
          {kind === "export_csv" && (
            <div className="row-2">
              <label className="field">
                <span>Rows</span>
                <select value={str("rows_by", "project")} onChange={(e) => set("rows_by", e.target.value)}>
                  <option value="project">Projects</option>
                  <option value="client">Clients</option>
                  <option value="task">Tasks</option>
                  <option value="category">Categories</option>
                </select>
              </label>
              <label className="field">
                <span>Columns</span>
                <select value={str("cols_by", "day")} onChange={(e) => set("cols_by", e.target.value)}>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="none">Total only</option>
                </select>
              </label>
            </div>
          )}
        </div>
        <div className="modal-actions">
          {routine &&
            (confirmDelete ? (
              <button
                type="button"
                className="btn danger"
                onClick={() => void analyticsApi.deleteRoutine(routine.id).then(onSaved).catch((e) => onError(String(e)))}
              >
                Confirm delete
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!name.trim() || (kind === "report" && !action.report_id) || (kind === "ai_prompt" && !str("prompt").trim())}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
