import { useCallback, useEffect, useState } from "react";
import { Sidebar, NavId } from "./components/Sidebar";
import { DayCalendar } from "./components/DayCalendar";
import { SummaryPanel } from "./components/SummaryPanel";
import { SessionDetail } from "./components/SessionDetail";
import { WorkView } from "./components/WorkView";
import { SettingsView } from "./components/SettingsView";
import {
  api,
  AppStatus,
  Hierarchy,
  SessionRow,
  todayLocal,
} from "./lib/api";
import { formatDayHeading, shiftDay } from "./lib/time";
import "./App.css";

function App() {
  const [nav, setNav] = useState<NavId>("calendar");
  const [day, setDay] = useState(todayLocal);
  const [lane, setLane] = useState<"entries" | "tasks" | "projects">("entries");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.getAppStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshDay = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        api.listSessionsForDay(day),
        api.getHierarchy(),
      ]);
      setSessions(s);
      setHierarchy(h);
      setError(null);
      setSelected((prev) =>
        prev ? (s.find((x) => x.id === prev.id) ?? null) : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [day]);

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 2000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    void refreshDay();
    const id = window.setInterval(() => void refreshDay(), 4000);
    return () => window.clearInterval(id);
  }, [refreshDay]);

  async function applyTag(value: string) {
    if (!selected) return;
    if (!value) {
      await api.tagSession(selected.id, null, null, null);
    } else {
      const [kind, idStr] = value.split(":");
      const id = Number(idStr);
      if (kind === "client") {
        await api.tagSession(selected.id, id, null, null);
      } else if (kind === "project") {
        const client = hierarchy?.clients.find((c) =>
          c.projects.some((p) => p.id === id),
        );
        await api.tagSession(selected.id, client?.id ?? null, id, null);
      } else if (kind === "task") {
        let clientId: number | null = null;
        let projectId: number | null = null;
        for (const c of hierarchy?.clients ?? []) {
          for (const p of c.projects) {
            if (p.tasks.some((t) => t.id === id)) {
              clientId = c.id;
              projectId = p.id;
            }
          }
        }
        await api.tagSession(selected.id, clientId, projectId, id);
      }
    }
    await refreshDay();
  }

  const showSummary = nav === "calendar";

  return (
    <div className={`app${showSummary ? "" : " no-summary"}`}>
      <Sidebar
        active={nav}
        onNavigate={setNav}
        trackerStatus={status?.tracker.status ?? "…"}
        currentApp={status?.tracker.current_app ?? null}
      />

      <div className="main-col" style={{ position: "relative" }}>
        {nav === "calendar" && (
          <>
            <header className="topbar">
              <div className="topbar-date">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDay((d) => shiftDay(d, -1))}
                  aria-label="Previous day"
                >
                  ‹
                </button>
                <h1>{formatDayHeading(day)}</h1>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDay((d) => shiftDay(d, 1))}
                  aria-label="Next day"
                >
                  ›
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDay(todayLocal())}
                  title="Today"
                >
                  ●
                </button>
              </div>
              <div className="segment" role="group" aria-label="Range">
                <button type="button" className="active">
                  Day
                </button>
                <button type="button" disabled title="Coming soon">
                  Week
                </button>
                <button type="button" disabled title="Coming soon">
                  Month
                </button>
                <button type="button" disabled title="Coming soon">
                  Year
                </button>
              </div>
            </header>

            <div className="lane-tabs">
              {(
                [
                  ["entries", "Time entries"],
                  ["tasks", "Tasks"],
                  ["projects", "Projects"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={lane === id ? "active" : undefined}
                  onClick={() => setLane(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {error && <p className="error-banner">{error}</p>}

            <DayCalendar
              sessions={
                lane === "entries"
                  ? sessions
                  : sessions.filter((s) =>
                      lane === "tasks" ? s.task_id != null : s.project_id != null,
                    )
              }
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              isToday={day === todayLocal()}
            />

            {selected && (
              <SessionDetail
                session={selected}
                hierarchy={hierarchy}
                onClose={() => setSelected(null)}
                onTag={(v) => void applyTag(v)}
              />
            )}
          </>
        )}

        {(nav === "projects" || nav === "clients" || nav === "tasks") && (
          <WorkView mode={nav} onError={setError} />
        )}

        {nav === "reports" && (
          <div className="page">
            <div className="page-head">
              <h2>Reports</h2>
            </div>
            <div className="kpi-row">
              <div className="card">
                <p className="kicker">Today tracked</p>
                <p className="metric" style={{ fontSize: 22 }}>
                  {sessions.filter((s) => !s.idle).length} sessions
                </p>
              </div>
              <div className="card">
                <p className="kicker">Tagged</p>
                <p className="metric" style={{ fontSize: 22 }}>
                  {sessions.filter((s) => s.client_id || s.project_id).length}
                </p>
              </div>
              <div className="card">
                <p className="kicker">Export</p>
                <p className="muted" style={{ marginTop: 8 }}>
                  CSV export lands next in MVP.
                </p>
              </div>
            </div>
          </div>
        )}

        {nav === "settings" && (
          <SettingsView
            status={status}
            onPause={() => void api.pauseTracking().then(refreshStatus)}
            onResume={() => void api.resumeTracking().then(refreshStatus)}
          />
        )}
      </div>

      {showSummary && <SummaryPanel sessions={sessions} />}
    </div>
  );
}

export default App;
