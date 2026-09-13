import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  FocusSession,
  Hierarchy,
  PlannedSession,
  SessionKind,
  formatElapsed,
  todayLocal,
} from "../lib/api";
import { StartSessionModal } from "./StartSessionModal";
import { PlanScheduleModal } from "./PlanScheduleModal";
import { displaySecs, sessionCaption } from "../lib/timerDisplay";

type Props = {
  focus: FocusSession | null;
  hierarchy: Hierarchy | null;
  sinceBreakSecs?: number;
  focusDefaultMins?: number;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onOpenActivity: () => void;
};

function fmtClock(iso: string): string {
  const t = iso.includes("T") ? iso.slice(11, 16) : iso;
  const [hh, mm] = t.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return t;
  const am = hh < 12;
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

function planLabel(s: PlannedSession): string {
  if (s.title?.trim()) return s.title;
  const k = (s.kind || "focus").toLowerCase();
  if (k === "meeting") return "Meeting";
  if (k === "break") return s.title?.includes("Long") ? "Long Break" : "Break";
  return "Focus Session";
}

export function TimerView({
  focus,
  hierarchy,
  sinceBreakSecs = 0,
  focusDefaultMins = 50,
  onChanged,
  onError,
  onOpenActivity,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [boltOpen, setBoltOpen] = useState(false);
  const [modalKind, setModalKind] = useState<SessionKind | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planned, setPlanned] = useState<PlannedSession[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const boltRef = useRef<HTMLDivElement>(null);
  const day = todayLocal();

  const focusing =
    focus?.status === "active" || focus?.status === "paused";
  const kind = (focus?.kind || "focus").toLowerCase();
  const isBreak = kind === "break";
  const shown = displaySecs(focus, sinceBreakSecs);

  const targetSecs =
    focus?.planned_secs && focus.planned_secs > 0
      ? focus.planned_secs
      : Math.max(1, focusDefaultMins) * 60;
  const progressBase =
    isBreak && focus?.planned_secs
      ? focus.planned_secs - shown
      : shown;
  const pct = Math.min(100, (progressBase / targetSecs) * 100);
  const r = 108;
  const c = 2 * Math.PI * r;
  const ringActive = focusing ? focus?.status === "active" : true;
  const dash = c * (1 - pct / 100);

  const refreshPlanned = useCallback(async () => {
    try {
      setPlanned(await api.listPlannedForDay(day));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [day, onError]);

  useEffect(() => {
    void refreshPlanned();
    const id = window.setInterval(() => void refreshPlanned(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshPlanned]);

  useEffect(() => {
    if (!menuOpen && !boltOpen) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (menuOpen && !menuRef.current?.contains(t)) setMenuOpen(false);
      if (boltOpen && !boltRef.current?.contains(t)) setBoltOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, boltOpen]);

  const upcoming = planned.filter((p) => p.status === "planned");
  const nextUp = upcoming[0] ?? null;

  async function end() {
    try {
      await api.endFocus();
      onChanged();
      await refreshPlanned();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function pause() {
    try {
      await api.pauseFocus();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function resume() {
    try {
      await api.resumeFocus();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function extend() {
    try {
      await api.extendFocus();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  function openModal(k: SessionKind) {
    setMenuOpen(false);
    setModalKind(k);
  }

  async function runPomodoro() {
    setBoltOpen(false);
    try {
      await api.planPomodoro({ day });
      onError(null);
      await refreshPlanned();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function clearSchedule() {
    setBoltOpen(false);
    try {
      await api.clearPlannedForDay(day);
      await refreshPlanned();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startPlanned(id: number) {
    try {
      await api.startFromPlanned(id);
      onChanged();
      await refreshPlanned();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function skipPlanned(id: number) {
    try {
      await api.setPlannedStatus(id, "skipped");
      await refreshPlanned();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const endLabel =
    kind === "meeting" ? "End Meeting" : kind === "break" ? "End Break" : "End Focus";

  return (
    <div className="timer-layout">
      <div className="timer-stage">
        <div className="timer-ring-wrap">
          <svg className="timer-ring" viewBox="0 0 240 240">
            <circle cx="120" cy="120" r={r} className="timer-ring-bg" />
            <circle
              cx="120"
              cy="120"
              r={r}
              className={`timer-ring-fg${isBreak ? " break" : kind === "meeting" ? " meeting" : ""}`}
              style={{
                strokeDasharray: c,
                strokeDashoffset: ringActive ? dash : c,
              }}
            />
          </svg>
          <div className="timer-readout">
            <div className="timer-time">{formatElapsed(shown)}</div>
            <div className="timer-caption">
              {sessionCaption(focus, !focusing)}
            </div>
          </div>
        </div>

        <div className="timer-controls">
          {focus?.status === "active" ? (
            <>
              <button
                type="button"
                className="timer-ctrl"
                title="Open Activity"
                onClick={onOpenActivity}
              >
                »
              </button>
              <button
                type="button"
                className="timer-ctrl"
                title="Pause"
                onClick={() => void pause()}
              >
                ❚❚
              </button>
              <button
                type="button"
                className="timer-ctrl"
                title="Extend session"
                onClick={() => void extend()}
              >
                +
              </button>
              <button
                type="button"
                className="timer-ctrl stop"
                title={endLabel}
                onClick={() => void end()}
              >
                ■
              </button>
            </>
          ) : focus?.status === "paused" ? (
            <>
              <button
                type="button"
                className="timer-ctrl"
                title="Resume"
                onClick={() => void resume()}
              >
                ▶
              </button>
              <button
                type="button"
                className="timer-ctrl"
                title="Extend session"
                onClick={() => void extend()}
              >
                +
              </button>
              <button
                type="button"
                className="timer-ctrl stop"
                title={endLabel}
                onClick={() => void end()}
              >
                ■
              </button>
            </>
          ) : (
            <>
              <div className="timer-start-wrap" ref={menuRef}>
                <button
                  type="button"
                  className="timer-ctrl play"
                  title="Start a session"
                  onClick={() => {
                    setBoltOpen(false);
                    setMenuOpen((v) => !v);
                  }}
                >
                  ▶
                </button>
                {menuOpen && (
                  <div className="timer-start-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => openModal("focus")}>
                      Start Focus
                    </button>
                    <button type="button" role="menuitem" onClick={() => openModal("meeting")}>
                      Start Meeting
                    </button>
                    <button type="button" role="menuitem" onClick={() => openModal("break")}>
                      Start Break
                    </button>
                  </div>
                )}
              </div>
              <div className="timer-start-wrap" ref={boltRef}>
                <button
                  type="button"
                  className="timer-ctrl"
                  title="Schedule planned sessions"
                  onClick={() => {
                    setMenuOpen(false);
                    setBoltOpen((v) => !v);
                  }}
                >
                  ⚡
                </button>
                {boltOpen && (
                  <div className="timer-start-menu bolt-menu" role="menu">
                    <div className="bolt-menu-head">Classic Pomodoro Timer</div>
                    <p className="muted bolt-menu-desc">
                      25-min focus sessions followed by 5-min breaks with a 15-min break after four
                      sessions.
                    </p>
                    <button type="button" role="menuitem" onClick={() => void runPomodoro()}>
                      Classic Pomodoro
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setBoltOpen(false);
                        setPlanOpen(true);
                      }}
                    >
                      Plan Schedule
                    </button>
                    <button type="button" role="menuitem" onClick={() => void refreshPlanned()}>
                      Refresh Schedule
                    </button>
                    <button type="button" role="menuitem" onClick={() => void clearSchedule()}>
                      Clear Schedule
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {nextUp && !focusing && (
          <div className={`next-session-card kind-${(nextUp.kind || "focus").toLowerCase()}`}>
            <div>
              <div className="next-session-title">Next: {planLabel(nextUp)}</div>
              <div className="next-session-meta">
                {fmtClock(nextUp.started_at)} – {fmtClock(nextUp.ended_at)} ·{" "}
                {Math.round(nextUp.duration_secs / 60)} min
              </div>
            </div>
            <div className="next-session-actions">
              <button
                type="button"
                className="timer-ctrl play"
                title="Start now"
                onClick={() => void startPlanned(nextUp.id)}
              >
                ▶
              </button>
              <button
                type="button"
                className="timer-ctrl"
                title="Skip"
                onClick={() => void skipPlanned(nextUp.id)}
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="timer-side">
        <div className="segment" style={{ marginBottom: 12 }}>
          <button type="button" className="active">
            Timeline
          </button>
          <button type="button" onClick={onOpenActivity}>
            Sessions
          </button>
        </div>

        <div className="planned-timeline">
          {planned.length === 0 ? (
            <div className="card">
              <p className="kicker">No planned sessions</p>
              <p className="muted">
                Use ⚡ to add a Classic Pomodoro or Plan Schedule for today.
              </p>
            </div>
          ) : (
            planned.map((p) => (
              <div
                key={p.id}
                className={`planned-block kind-${(p.kind || "focus").toLowerCase()} status-${p.status}`}
              >
                <div className="planned-block-time">
                  {fmtClock(p.started_at)} – {fmtClock(p.ended_at)}
                </div>
                <div className="planned-block-title">{planLabel(p)}</div>
                <div className="planned-block-meta">
                  {Math.round(p.duration_secs / 60)} min · {p.status}
                </div>
                {p.status === "planned" && (
                  <div className="planned-block-actions">
                    <button type="button" className="btn" onClick={() => void startPlanned(p.id)}>
                      Start
                    </button>
                    <button type="button" className="btn" onClick={() => void skipPlanned(p.id)}>
                      Skip
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {modalKind && (
        <StartSessionModal
          kind={modalKind}
          hierarchy={hierarchy}
          onClose={() => setModalKind(null)}
          onStarted={() => {
            onChanged();
            void refreshPlanned();
          }}
          onError={onError}
        />
      )}
      {planOpen && (
        <PlanScheduleModal
          day={day}
          onClose={() => setPlanOpen(false)}
          onPlanned={() => void refreshPlanned()}
          onError={onError}
        />
      )}
    </div>
  );
}
