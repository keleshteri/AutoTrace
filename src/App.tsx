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
import { AiView } from "./components/AiView";
import { TimerView } from "./components/TimerView";
import { ActivityView } from "./components/ActivityView";
import { StatusBar } from "./components/StatusBar";
import { BreakBanner, BreakCoach } from "./components/BreakCoach";
import { StartSessionModal } from "./components/StartSessionModal";
import { PlannedDuePrompt } from "./components/PlannedDuePrompt";
import { WorkspaceSettingsView } from "./components/WorkspaceSettingsView";
import {
  api,
  AppStatus,
  FocusDigest,
  FocusSession,
  Hierarchy,
  PlannedSession,
  SessionRow,
  Workspace,
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
  const [sinceBreakSecs, setSinceBreakSecs] = useState(0);
  const [sinceBreakTick, setSinceBreakTick] = useState(0);
  const [focusDefaultMins, setFocusDefaultMins] = useState(50);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const [breakCoachOpen, setBreakCoachOpen] = useState(false);
  const [breakEvery, setBreakEvery] = useState(45);
  const [breakLen, setBreakLen] = useState(5);
  const [breakSnooze, setBreakSnooze] = useState(5);
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const [lastCoachBucket, setLastCoachBucket] = useState(-1);
  const [statusStartMenu, setStatusStartMenu] = useState(false);
  const [statusModalKind, setStatusModalKind] = useState<"focus" | "meeting" | "break" | null>(
    null,
  );
  const [duePlanned, setDuePlanned] = useState<PlannedSession | null>(null);
  const [plannedAutoStart, setPlannedAutoStart] = useState(false);
  const [dismissedDueId, setDismissedDueId] = useState<number | null>(null);
  const [breakFullscreen, setBreakFullscreen] = useState(false);
  const [urgeUntil, setUrgeUntil] = useState(0);

  const refreshStatus = useCallback(async () => {
    try {
      const [s, f, since, defaultMins] = await Promise.all([
        api.getAppStatus(),
        api.getActiveFocus(),
        api.getTimeSinceLastBreak(),
        api.getFeatureFlag("focus_default_mins"),
      ]);
      setStatus(s);
      setFocus(f);
      setFocusTick(0);
      setSinceBreakSecs(since.secs);
      setSinceBreakTick(0);
      const mins = Number(defaultMins || "50");
      if (Number.isFinite(mins) && mins > 0) setFocusDefaultMins(mins);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    try {
      setWorkspaces(await api.listWorkspaces());
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
    void refreshWorkspaces();
    const id = window.setInterval(() => void refreshStatus(), 2000);
    return () => window.clearInterval(id);
  }, [refreshStatus, refreshWorkspaces]);

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

  useEffect(() => {
    // Tick "time since last break" only when no intentional session is open.
    if (focus?.status === "active" || focus?.status === "paused") return;
    const id = window.setInterval(() => setSinceBreakTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [focus?.status]);

  void focusTick;
  void sinceBreakTick;
  const liveFocus = focus
    ? {
        ...focus,
        kind: focus.kind || "focus",
        elapsed_secs:
          focus.status === "active"
            ? focus.elapsed_secs + focusTick
            : focus.elapsed_secs,
      }
    : null;
  const liveSinceBreak = sinceBreakSecs + sinceBreakTick;

  const sessionKind = (liveFocus?.kind || "focus").toLowerCase();
  const onBreak =
    !!liveFocus &&
    sessionKind === "break" &&
    (liveFocus.status === "active" || liveFocus.status === "paused");
  const breakRemaining =
    onBreak && liveFocus?.planned_secs
      ? Math.max(0, liveFocus.planned_secs - liveFocus.elapsed_secs)
      : 0;

  // Auto-end break when countdown hits zero.
  useEffect(() => {
    if (!onBreak || liveFocus?.status !== "active") return;
    if (!liveFocus.planned_secs || breakRemaining > 0) return;
    void api
      .endFocus()
      .then(() => {
        setFocusTick(0);
        setSnoozeUntil(Date.now() + 60_000);
        return Promise.all([refreshStatus(), refreshDay()]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [
    onBreak,
    breakRemaining,
    liveFocus?.status,
    liveFocus?.planned_secs,
    refreshStatus,
    refreshDay,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const on = (await api.getFeatureFlag("break_reminders")) === "1";
        const every = Number((await api.getFeatureFlag("break_every_mins")) || "45");
        const len = Number((await api.getFeatureFlag("break_length_mins")) || "5");
        const snooze = Number((await api.getFeatureFlag("break_snooze_mins")) || "5");
        if (cancelled) return;
        setBreakEvery(every);
        setBreakLen(len);
        setBreakSnooze(snooze);

        if (!on || onBreak || Date.now() < snoozeUntil) {
          if (!onBreak) setBreakReminder(null);
          if (!on || onBreak || Date.now() < snoozeUntil) setBreakCoachOpen(false);
          return;
        }

        const elapsed = liveSinceBreak;
        if (elapsed > 0 && every > 0) {
          const mins = Math.floor(elapsed / 60);
          if (mins >= every) {
            const bucket = Math.floor(mins / every);
            setBreakReminder(`Break time — take ${len} min`);
            if (bucket !== lastCoachBucket) {
              setLastCoachBucket(bucket);
              setBreakCoachOpen(true);
            }
            return;
          }
        }
        setBreakReminder(null);
        setBreakCoachOpen(false);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveSinceBreak, onBreak, snoozeUntil, lastCoachBucket]);

  async function startBreak() {
    setBreakCoachOpen(false);
    try {
      const max = Number((await api.getFeatureFlag("break_max_mins")) || "30");
      const mins = Math.min(breakLen, Number.isFinite(max) && max > 0 ? max : breakLen);
      await api.startFocus({ kind: "break", durationMins: mins });
      setFocusTick(0);
      setLastCoachBucket(-1);
      setBreakFullscreen((await api.getFeatureFlag("break_fullscreen")) === "1");
      await refreshStatus();
      setNav("timer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function snoozeBreak() {
    setBreakCoachOpen(false);
    setSnoozeUntil(Date.now() + breakSnooze * 60_000);
    setBreakReminder(null);
  }

  function endBreak() {
    setBreakReminder(null);
    setSnoozeUntil(Date.now() + 60_000);
    void api
      .endFocus()
      .then(() => Promise.all([refreshStatus(), refreshDay()]))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  // Planned session auto-start / due prompt (Rize-style).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [auto, due, fullscreen] = await Promise.all([
          api.getFeatureFlag("planned_auto_start"),
          api.nextDuePlanned(),
          api.getFeatureFlag("break_fullscreen"),
        ]);
        if (cancelled) return;
        const autoOn = auto === "1";
        setPlannedAutoStart(autoOn);
        setBreakFullscreen(fullscreen === "1");
        if (!due || due.id === dismissedDueId) {
          if (!due) setDuePlanned(null);
          return;
        }
        // Only prompt when no live session is running.
        if (focus?.status === "active" || focus?.status === "paused") {
          setDuePlanned(null);
          return;
        }
        if (autoOn) {
          await api.startFromPlanned(due.id);
          setDuePlanned(null);
          setDismissedDueId(due.id);
          setFocusTick(0);
          await refreshStatus();
          return;
        }
        setDuePlanned(due);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [focus?.status, dismissedDueId, refreshStatus]);

  // Optional auto Focus / Break detection.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (focus?.status === "active" || focus?.status === "paused") return;
      void api
        .maybeAutoDetectSessions()
        .then((s) => {
          if (s) {
            setFocusTick(0);
            return refreshStatus();
          }
        })
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [focus?.status, refreshStatus]);

  // Urge surfing lock when distraction blocker fires.
  useEffect(() => {
    const blocked = status?.tracker.distraction_blocked;
    if (!blocked) return;
    void api.getFeatureFlag("urge_surfing").then((v) => {
      if (v === "1") setUrgeUntil(Date.now() + 10_000);
    });
  }, [status?.tracker.distraction_blocked]);

  const [, setUrgeTick] = useState(0);
  const urgeLocked = urgeUntil > Date.now();

  useEffect(() => {
    if (urgeUntil <= Date.now()) return;
    const id = window.setInterval(() => setUrgeTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [urgeUntil]);

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
  const activeWorkspace = workspaces.find((w) => w.is_active) ?? workspaces[0];

  return (
    <div className="app-shell">
      <div className={`app${showSummary ? "" : " no-summary"}`}>
        <Sidebar
          active={nav}
          onNavigate={setNav}
          trackerStatus={status?.tracker.status ?? "…"}
          currentApp={status?.tracker.current_app ?? null}
          workspaces={workspaces}
          onSwitchWorkspace={(id) =>
            void api.setActiveWorkspace(id).then(refreshWorkspaces)
          }
          onCreateWorkspace={(name) =>
            void api
              .createWorkspace(name)
              .then((w) => api.setActiveWorkspace(w.id))
              .then(refreshWorkspaces)
          }
        />

        <div className="main-col" style={{ position: "relative" }}>
          {onBreak && (
            <BreakBanner remainingSecs={breakRemaining} onEnd={endBreak} />
          )}
          {onBreak && breakFullscreen && (
            <div className="break-fullscreen" role="dialog" aria-label="Break">
              <div className="break-fullscreen-card">
                <p className="kicker">On break</p>
                <div className="timer-time" style={{ fontSize: 48 }}>
                  {formatElapsedSafe(breakRemaining)}
                </div>
                <p className="muted">Step away from the screen. Stretch or walk.</p>
                <button type="button" className="btn primary-pill" onClick={endBreak}>
                  End Break
                </button>
              </div>
            </div>
          )}
          {urgeLocked && status?.tracker.distraction_blocked && (
            <div className="urge-surf" role="alertdialog" aria-label="Urge surfing">
              <div className="urge-surf-card">
                <h3>Stay with the urge</h3>
                <p className="muted">
                  Blocked: {status.tracker.distraction_blocked}. Wait a few seconds before
                  continuing.
                </p>
                <p className="timer-time" style={{ fontSize: 28 }}>
                  {formatElapsedSafe(Math.max(0, Math.ceil((urgeUntil - Date.now()) / 1000)))}
                </p>
              </div>
            </div>
          )}
          <BreakCoach
            visible={breakCoachOpen && !onBreak}
            everyMins={breakEvery}
            breakMins={breakLen}
            snoozeMins={breakSnooze}
            onStartBreak={() => void startBreak()}
            onSnooze={snoozeBreak}
            onDismiss={() => setBreakCoachOpen(false)}
          />

          {duePlanned && !onBreak && !(liveFocus?.status === "active") && (
            <PlannedDuePrompt
              session={duePlanned}
              autoStart={plannedAutoStart}
              onStartNow={() => {
                const id = duePlanned.id;
                void api
                  .startFromPlanned(id)
                  .then(() => {
                    setDuePlanned(null);
                    setDismissedDueId(id);
                    setFocusTick(0);
                    setNav("timer");
                    return refreshStatus();
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}
              onSkip={() => {
                const id = duePlanned.id;
                void api
                  .setPlannedStatus(id, "skipped")
                  .then(() => {
                    setDuePlanned(null);
                    setDismissedDueId(id);
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}
              onDismiss={() => {
                setDismissedDueId(duePlanned.id);
                setDuePlanned(null);
              }}
            />
          )}

          {nav === "timer" && (
            <TimerView
              focus={liveFocus}
              hierarchy={hierarchy}
              sinceBreakSecs={liveSinceBreak}
              focusDefaultMins={focusDefaultMins}
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
          {nav === "ai" && <AiView onError={setError} />}

          {nav === "workspace" && (
            <WorkspaceSettingsView
              workspaceId={activeWorkspace?.id}
              onError={setError}
              onWorkspacesChanged={() => void refreshWorkspaces()}
            />
          )}

          {(nav === "ws_overview" || nav === "ws_dashboards") && (
            <div className="page">
              <div className="page-head">
                <h2>
                  {nav === "ws_overview" ? "Workspace Overview" : "Dashboards"}
                </h2>
              </div>
              <div className="card">
                <p className="muted">
                  Phase 1 shell for <b>{activeWorkspace?.name ?? "workspace"}</b>.
                  Open Workspace Settings to rename, toggle features, and configure
                  invoicing. App-wide privacy and tracking stay under Admin → Settings.
                </p>
                <button
                  type="button"
                  className="primary"
                  style={{ marginTop: 12 }}
                  onClick={() => setNav("workspace")}
                >
                  Workspace Settings
                </button>
              </div>
            </div>
          )}

          {nav === "settings" && (
            <SettingsView
              status={status}
              onPause={() => void api.pauseTracking().then(refreshStatus)}
              onResume={() => void api.resumeTracking().then(refreshStatus)}
              onRefreshStatus={() => void refreshStatus()}
              onError={setError}
              onOpenWorkspaceSettings={() => setNav("workspace")}
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
        breakReminder={onBreak ? `Break · ${formatElapsedSafe(breakRemaining)}` : breakReminder}
        focus={liveFocus}
        sinceBreakSecs={liveSinceBreak}
        onBreak={onBreak}
        breakRemainingSecs={breakRemaining}
        onEndBreak={endBreak}
        startMenuOpen={statusStartMenu}
        onToggleStartMenu={() => setStatusStartMenu((v) => !v)}
        onPickStartKind={(kind) => {
          setStatusStartMenu(false);
          setStatusModalKind(kind);
          setNav("timer");
        }}
        onToggleTracking={() => {
          if (status?.tracker.status === "running") {
            void api.pauseTracking().then(refreshStatus);
          } else {
            void api.resumeTracking().then(refreshStatus);
          }
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

      {statusModalKind && (
        <StartSessionModal
          kind={statusModalKind}
          hierarchy={hierarchy}
          onClose={() => setStatusModalKind(null)}
          onStarted={() => {
            setFocusTick(0);
            setLastCoachBucket(-1);
            void refreshStatus();
            void refreshDay();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function formatElapsedSafe(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
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
