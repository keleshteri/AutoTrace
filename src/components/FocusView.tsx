import { useCallback, useEffect, useState } from "react";
import {
  api,
  FocusDigest,
  SessionRow,
  WeeklyDigest,
  durationLabel,
  formatTime,
  todayLocal,
} from "../lib/api";
import { formatHoursMinutes, shiftDay } from "../lib/time";

type Props = {
  day: string;
  onError: (msg: string | null) => void;
  onOpenDay: (day: string) => void;
};

function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const dow = d.getDay(); // 0 Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function FocusView({ day, onError, onOpenDay }: Props) {
  const [digest, setDigest] = useState<FocusDigest | null>(null);
  const [week, setWeek] = useState<WeeklyDigest | null>(null);
  const [pending, setPending] = useState<SessionRow[]>([]);
  const [distraction, setDistraction] = useState<Awaited<
    ReturnType<typeof api.distractionReport>
  > | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, w, p, dr] = await Promise.all([
        api.getFocusDigest(day),
        api.getWeeklyDigest(mondayOf(day)),
        api.listPendingSessions(),
        api.distractionReport(day),
      ]);
      setDigest(d);
      setWeek(w);
      setPending(p);
      setDistraction(dr);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [day, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function approve(id: number) {
    await api.approveSession(id, true);
    await refresh();
  }

  async function reject(id: number) {
    if (!window.confirm("Reject and delete this suggested session?")) return;
    await api.rejectPendingSession(id);
    await refresh();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Focus & review</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn"
            onClick={() => onOpenDay(shiftDay(day, -1))}
          >
            ‹
          </button>
          <button type="button" className="btn" onClick={() => onOpenDay(todayLocal())}>
            {day}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onOpenDay(shiftDay(day, 1))}
          >
            ›
          </button>
        </div>
      </div>

      {digest && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p className="kicker">Focus score — {digest.day}</p>
          <p className="metric">{Math.round(digest.focus_score)}</p>
          <p className="muted">
            Deep focus {formatHoursMinutes(digest.focus_minutes)} · meetings{" "}
            {formatHoursMinutes(digest.meeting_minutes)} · idle{" "}
            {formatHoursMinutes(digest.idle_minutes)}
          </p>
          <div className="progress" style={{ marginTop: 10 }}>
            <span style={{ width: `${Math.min(100, digest.goal_pct)}%` }} />
          </div>
          <p className="progress-caption">
            {Math.round(digest.goal_pct)}% of{" "}
            {formatHoursMinutes(digest.goal_minutes)} goal
          </p>
          {digest.top_projects.length > 0 && (
            <ul className="tree" style={{ marginTop: 12 }}>
              {digest.top_projects.map((p) => (
                <li
                  key={p.key}
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span>{p.label}</span>
                  <span className="muted">{formatHoursMinutes(p.minutes)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {distraction && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p className="kicker">Context switches & distractions</p>
          <p className="metric">{Math.round(distraction.focus_score)}</p>
          <p className="muted">
            {distraction.context_switches} switches · {distraction.blocked_event_hits}{" "}
            blocked-pattern hits
          </p>
          {distraction.top_distractions.length > 0 && (
            <ul className="tree" style={{ marginTop: 12 }}>
              {distraction.top_distractions.map((p) => (
                <li
                  key={p.key}
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span>{p.label}</span>
                  <span className="muted">{p.sessions} events</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {week && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p className="kicker">Weekly digest · week of {week.week_start}</p>
          <p className="metric">{formatHoursMinutes(week.total_focus_minutes)}</p>
          <p className="muted">
            Avg focus score {Math.round(week.avg_focus_score)}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 6,
              marginTop: 12,
            }}
          >
            {week.days.map((d) => (
              <button
                key={d.day}
                type="button"
                className="btn"
                style={{
                  padding: "8px 4px",
                  background:
                    d.day === day ? "var(--accent, #3b82f6)" : "var(--bg-hover)",
                  fontSize: 11,
                }}
                onClick={() => onOpenDay(d.day)}
                title={d.day}
              >
                <div>{d.day.slice(8)}</div>
                <div>{Math.round(d.focus_score)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <p className="kicker">Pending suggestions ({pending.length})</p>
        <p className="muted" style={{ marginBottom: 10 }}>
          When confirm-before-log is on, new sessions wait here until approved.
        </p>
        {pending.length === 0 && (
          <p className="muted">No pending sessions.</p>
        )}
        <ul className="tree">
          {pending.map((s) => (
            <li
              key={s.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div>
                  {s.project_name || s.title || s.app_name || "Untitled"}
                  {s.confidence != null && (
                    <span className="muted">
                      {" "}
                      · {Math.round(s.confidence * 100)}% conf
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {formatTime(s.started_at)}–{s.ended_at ? formatTime(s.ended_at) : "…"}{" "}
                  · {durationLabel(s.started_at, s.ended_at)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void approve(s.id)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ background: "#7f1d1d" }}
                  onClick={() => void reject(s.id)}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
