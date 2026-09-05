import { FormEvent, useCallback, useEffect, useState } from "react";
import { Sidebar, NavId } from "./components/Sidebar";
import { CalendarView } from "./components/CalendarView";
import { SummaryPanel } from "./components/SummaryPanel";
import { SessionDetail } from "./components/SessionDetail";
import { WorkView } from "./components/WorkView";
import { SettingsView } from "./components/SettingsView";
import { RulesView } from "./components/RulesView";
import { ReportsView } from "./components/ReportsView";
import { ProfitView, TeamsView } from "./components/ProfitView";
import { FocusView } from "./components/FocusView";
import { IntegrationsView } from "./components/IntegrationsView";
import { TimerView } from "./components/TimerView";
import { ActivityView } from "./components/ActivityView";
import { StatusBar } from "./components/StatusBar";
import {
  api,
  AppStatus,
  FocusDigest,
  FocusSession,
  Hierarchy,
  SessionRow,
  todayLocal,
} from "./lib/api";
import "./App.css";

function App() {
  const [nav, setNav] = useState<NavId>("calendar");
  const [day, setDay] = useState(todayLocal);
  const [calRangeLabel, setCalRangeLabel] = useState("Day · Today");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [focusDigest, setFocusDigest] = useState<FocusDigest | null>(null);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        api.getAppStatus(),
        api.getActiveFocus(),
      ]);
      setStatus(s);
      setFocus(f);
      setFocusTick(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const [breakReminder, setBreakReminder] = useState<string | null>(null);

  const refreshDay = useCallback(async () => {
    try {
      const [s, h, dig] = await Promise.all([
        api.listSessionsForDay(day),
        api.getHierarchy(),
        api.getFocusDigest(day),
      ]);
      setSessions(s);
      setHierarchy(h);
      setFocusDigest(dig);
      setError(null);
      setSelectedIds((prev) =>
        prev.filter((id) => s.some((x) => x.id === id)),
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

  useEffect(() => {
    if (!focus || focus.status !== "active") return;
    const id = window.setInterval(() => setFocusTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [focus?.id, focus?.status]);

  // focusTick forces a re-render each second while active.
  void focusTick;
  const liveFocus = focus
    ? {
        ...focus,
        elapsed_secs:
          focus.status === "active"
            ? focus.elapsed_secs + focusTick
            : focus.elapsed_secs,
      }
    : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const on = (await api.getFeatureFlag("break_reminders")) === "1";
        if (!on || cancelled) {
          setBreakReminder(null);
          return;
        }
        const every = Number((await api.getFeatureFlag("break_every_mins")) || "50");
        const len = Number((await api.getFeatureFlag("break_length_mins")) || "5");
        const elapsed = liveFocus?.elapsed_secs ?? 0;
        if (
          liveFocus &&
          (liveFocus.status === "active" || liveFocus.status === "paused")
        ) {
          const mins = Math.floor(elapsed / 60);
          if (mins > 0 && every > 0 && mins % every === 0) {
            setBreakReminder(`Break time — take ${len} min`);
            return;
          }
        }
        setBreakReminder(null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveFocus?.elapsed_secs, liveFocus?.status, liveFocus?.id]);

  function selectSession(session: SessionRow, additive: boolean) {
    setSelectedIds((prev) => {
      if (additive) {
        return prev.includes(session.id)
          ? prev.filter((id) => id !== session.id)
          : [...prev, session.id];
      }
      return [session.id];
    });
  }

  const selected =
    selectedIds.length === 1
      ? (sessions.find((s) => s.id === selectedIds[0]) ?? null)
      : null;

  async function mergeSelected() {
    if (selectedIds.length < 2) return;
    try {
      const keepId = await api.mergeSessions(selectedIds);
      await refreshDay();
      setSelectedIds([keepId]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function approveSelectedOrPending() {
    try {
      if (selected?.pending) {
        await api.approveSession(selected.id, true);
        await refreshDay();
        return;
      }
      const pending = await api.listPendingSessions();
      if (pending.length === 0) return;
      const next = pending[0];
      await api.approveSession(next.id, true);
      await refreshDay();
      setSelectedIds([next.id]);
      setNav("calendar");
      setDay(next.started_at.slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function jumpNextPending() {
    try {
      const pending = await api.listPendingSessions();
      if (pending.length === 0) {
        setSelectedIds([]);
        return;
      }
      const current = selectedIds[0];
      const idx = pending.findIndex((p) => p.id === current);
      const next = pending[(idx + 1) % pending.length] ?? pending[0];
      setNav("calendar");
      setDay(next.started_at.slice(0, 10));
      setSelectedIds([next.id]);
      await refreshDay();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape" && selectedIds.length) {
        setSelectedIds([]);
        return;
      }
      if (nav !== "calendar" && nav !== "focus") return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void approveSelectedOrPending();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void jumpNextPending();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, selectedIds, selected]);

  const showSummary = nav === "calendar";

  return (
    <div className="app-shell">
      <div className={`app${showSummary ? "" : " no-summary"}`}>
        <Sidebar
          active={nav}
          onNavigate={setNav}
          trackerStatus={status?.tracker.status ?? "…"}
          currentApp={status?.tracker.current_app ?? null}
        />

        <div className="main-col" style={{ position: "relative" }}>
          {nav === "timer" && (
            <TimerView
              focus={liveFocus}
              hierarchy={hierarchy}
              onChanged={() => {
                setFocusTick(0);
                void refreshStatus();
                void refreshDay();
              }}
              onError={setError}
              onOpenActivity={() => setNav("activity")}
            />
          )}

          {nav === "activity" && (
            <ActivityView
              day={day}
              onDayChange={setDay}
              onError={setError}
              trackingStatus={status?.tracker.status ?? "…"}
            />
          )}

          {nav === "focus" && (
            <FocusView
              day={day}
              onError={setError}
              onOpenDay={(d) => {
                setDay(d);
                setNav("calendar");
              }}
            />
          )}

          {nav === "calendar" && (
            <>
              <CalendarView
                day={day}
                onDayChange={setDay}
                sessions={sessions}
                selectedIds={selectedIds}
                onSelect={selectSession}
                onOpenManual={() => setShowManual(true)}
                onMerge={() => void mergeSelected()}
                onRangeLabelChange={setCalRangeLabel}
                liveSessionId={status?.tracker.live_session_id ?? null}
                error={error}
              />

              {selected && (
                <SessionDetail
                  session={selected}
                  hierarchy={hierarchy}
                  onClose={() => setSelectedIds([])}
                  onSaved={() => void refreshDay()}
                  onApprove={(approved) =>
                    void api
                      .approveSession(selected.id, approved)
                      .then(refreshDay)
                  }
                  onUpdate={(payload) =>
                    api.updateSession({
                      sessionId: selected.id,
                      title: payload.title,
                      startedAt: payload.startedAt,
                      endedAt: payload.endedAt,
                      notes: payload.notes,
                      clientId: payload.clientId,
                      projectId: payload.projectId,
                      taskId: payload.taskId,
                      category: payload.category,
                    })
                  }
                  onSplit={(at) =>
                    api.splitSession(selected.id, at).then(() => undefined)
                  }
                  onDelete={() => api.deleteSession(selected.id)}
                />
              )}

              {showManual && (
                <ManualEntryModal
                  day={day}
                  hierarchy={hierarchy}
                  onClose={() => setShowManual(false)}
                  onSaved={() => {
                    setShowManual(false);
                    void refreshDay();
                  }}
                />
              )}
            </>
          )}

          {(nav === "projects" || nav === "clients" || nav === "tasks") && (
            <WorkView mode={nav} onError={setError} />
          )}

          {nav === "rules" && <RulesView onError={setError} />}
          {nav === "reports" && <ReportsView onError={setError} />}
          {nav === "profit" && <ProfitView onError={setError} />}
          {nav === "teams" && <TeamsView onError={setError} />}
          {nav === "integrations" && <IntegrationsView onError={setError} />}

          {nav === "settings" && (
            <SettingsView
              status={status}
              onPause={() => void api.pauseTracking().then(refreshStatus)}
              onResume={() => void api.resumeTracking().then(refreshStatus)}
              onRefreshStatus={() => void refreshStatus()}
              onError={setError}
            />
          )}
        </div>

        {showSummary && (
          <SummaryPanel
            sessions={sessions}
            digest={focusDigest}
            rangeLabel={calRangeLabel}
          />
        )}
      </div>

      <StatusBar
        trackerStatus={status?.tracker.status ?? "…"}
        currentApp={status?.tracker.current_app ?? null}
        distractionBlocked={status?.tracker.distraction_blocked ?? null}
        breakReminder={breakReminder}
        focus={liveFocus}
        onToggleTracking={() => {
          if (status?.tracker.status === "running") {
            void api.pauseTracking().then(refreshStatus);
          } else {
            void api.resumeTracking().then(refreshStatus);
          }
        }}
        onStartFocus={() => {
          void api
            .startFocus()
            .then(() => {
              setFocusTick(0);
              setNav("timer");
              return refreshStatus();
            })
            .catch((e) =>
              setError(e instanceof Error ? e.message : String(e)),
            );
        }}
        onPauseFocus={() => {
          void api
            .pauseFocus()
            .then(() => refreshStatus())
            .catch((e) =>
              setError(e instanceof Error ? e.message : String(e)),
            );
        }}
        onResumeFocus={() => {
          void api
            .resumeFocus()
            .then(() => {
              setFocusTick(0);
              return refreshStatus();
            })
            .catch((e) =>
              setError(e instanceof Error ? e.message : String(e)),
            );
        }}
        onEndFocus={() => {
          void api
            .endFocus()
            .then(() => {
              setFocusTick(0);
              return Promise.all([refreshStatus(), refreshDay()]);
            })
            .catch((e) =>
              setError(e instanceof Error ? e.message : String(e)),
            );
        }}
        onOpenTimer={() => setNav("timer")}
      />
    </div>
  );
}

function ManualEntryModal({
  day,
  hierarchy,
  onClose,
  onSaved,
}: {
  day: string;
  hierarchy: Hierarchy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [projectId, setProjectId] = useState<number | "">("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    let clientId: number | null = null;
    let pid: number | null = projectId === "" ? null : projectId;
    if (pid != null) {
      for (const c of hierarchy?.clients ?? []) {
        if (c.projects.some((p) => p.id === pid)) clientId = c.id;
      }
    }
    await api.createManualSession({
      title: title.trim(),
      startedAt: `${day}T${start}:00`,
      endedAt: `${day}T${end}:00`,
      clientId,
      projectId: pid,
      taskId: null,
    });
    onSaved();
  }

  const projects =
    hierarchy?.clients.flatMap((c) =>
      c.projects.map((p) => ({ id: p.id, label: `${c.name} / ${p.name}` })),
    ) ?? [];

  return (
    <div className="detail-overlay" onClick={onClose}>
      <form
        className="detail-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <header>
          <span className="muted">Manual time entry</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>
        <label className="muted">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Client call"
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>
        <div className="tag-row" style={{ marginTop: 10 }}>
          <label className="muted">
            Start
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="muted">
            End
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="muted">
            Project
            <select
              value={projectId}
              onChange={(e) =>
                setProjectId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="detail-actions" style={{ marginTop: 12 }}>
          <button type="submit" className="primary">
            Add entry
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
