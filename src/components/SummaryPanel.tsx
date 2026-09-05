import { useEffect, useState } from "react";
import { FocusDigest, SessionRow, api } from "../lib/api";
import {
  BREAK_COLOR,
  FOCUS_COLOR,
  colorForKey,
  formatHoursMinutes,
  totalMinutes,
} from "../lib/time";

type Props = {
  sessions: SessionRow[];
  digest: FocusDigest | null;
  rangeLabel?: string;
};

type Bucket = { key: string; label: string; minutes: number; color: string };

function sessionMinutes(s: SessionRow): number {
  const a = Date.parse(
    s.started_at.includes("T") ? s.started_at : s.started_at.replace(" ", "T"),
  );
  const b = s.ended_at
    ? Date.parse(
        s.ended_at.includes("T") ? s.ended_at : s.ended_at.replace(" ", "T"),
      )
    : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

function bucketSessions(sessions: SessionRow[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const s of sessions) {
    if (s.idle) continue;
    const mins = sessionMinutes(s);
    const key = String(s.project_id ?? s.client_id ?? s.app_name ?? "other");
    const label = s.project_name || s.client_name || s.app_name || "Untagged";
    const existing = map.get(key);
    if (existing) existing.minutes += mins;
    else
      map.set(key, {
        key,
        label,
        minutes: mins,
        color: colorForKey(key),
      });
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
}

export function SummaryPanel({
  sessions,
  digest,
  rangeLabel = "Day · Today",
}: Props) {
  const [pendingCount, setPendingCount] = useState(0);
  const tracked = totalMinutes(sessions);
  const idleMins =
    digest?.idle_minutes ??
    sessions.filter((s) => s.idle).reduce((acc, s) => acc + sessionMinutes(s), 0);
  const buckets = bucketSessions(sessions);
  const goal = digest?.goal_minutes ?? 6 * 60;
  const focusMins = digest?.focus_minutes ?? Math.max(0, tracked - idleMins);
  const meetingMins = digest?.meeting_minutes ?? 0;
  const otherMins = Math.max(0, tracked - focusMins - meetingMins);
  const pct = Math.min(
    200,
    Math.round(digest?.goal_pct ?? (tracked / goal) * 100),
  );
  const stackTotal = Math.max(1, focusMins + meetingMins + idleMins + otherMins);

  useEffect(() => {
    void api
      .listPendingSessions()
      .then((p) => setPendingCount(p.length))
      .catch(() => setPendingCount(0));
  }, [sessions]);

  return (
    <aside className="summary">
      <div className="summary-head">
        <h2>Summary · {rangeLabel}</h2>
      </div>

      <div className="card">
        <p className="kicker">Work hours</p>
        <p className="metric">{formatHoursMinutes(tracked)}</p>
        <p className="trend">
          {pendingCount > 0
            ? `${pendingCount} min pending`
            : `${sessions.filter((s) => !s.idle).length} entries`}
        </p>
        <div className="progress">
          <span style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className="progress-caption">
          {pct}% of {formatHoursMinutes(goal)} target
        </p>
      </div>

      <div className="card">
        <p className="kicker">Tasks</p>
        <p className="muted">
          {sessions.some((s) => s.task_id)
            ? `${new Set(sessions.filter((s) => s.task_id).map((s) => s.task_id)).size} tasks tracked`
            : "No tasks tracked"}
        </p>
      </div>

      <div className="card">
        <p className="kicker">Projects</p>
        {buckets.length === 0 ? (
          <p className="muted">No projects tracked</p>
        ) : (
          <ul className="legend" style={{ marginTop: 8 }}>
            {buckets.map((b) => (
              <li key={b.key}>
                <span className="swatch" style={{ background: b.color }} />
                <span className="name">{b.label}</span>
                <span>{formatHoursMinutes(b.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p className="kicker">Productivity metrics</p>
        <div className="stack-bar">
          <span
            style={{
              width: `${(focusMins / stackTotal) * 100}%`,
              background: FOCUS_COLOR,
            }}
          />
          <span
            style={{
              width: `${(meetingMins / stackTotal) * 100}%`,
              background: "#e879f9",
            }}
          />
          <span
            style={{
              width: `${(idleMins / stackTotal) * 100}%`,
              background: BREAK_COLOR,
            }}
          />
          <span
            style={{
              width: `${(otherMins / stackTotal) * 100}%`,
              background: "#52525b",
            }}
          />
        </div>
        <div className="stack-legend rize-prod">
          <span>
            <i style={{ background: FOCUS_COLOR }} /> Focus{" "}
            <b>{formatHoursMinutes(focusMins)}</b>
          </span>
          <span>
            <i style={{ background: "#e879f9" }} /> Meetings{" "}
            <b>{formatHoursMinutes(meetingMins)}</b>
          </span>
          <span>
            <i style={{ background: BREAK_COLOR }} /> Breaks{" "}
            <b>{formatHoursMinutes(idleMins)}</b>
          </span>
          <span>
            <i style={{ background: "#52525b" }} /> Other{" "}
            <b>
              {otherMins < 1 ? "< 1 min" : formatHoursMinutes(otherMins)}
            </b>
          </span>
        </div>
      </div>
    </aside>
  );
}
