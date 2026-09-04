import { SessionRow } from "../lib/api";
import {
  colorForKey,
  formatHoursMinutes,
  totalMinutes,
} from "../lib/time";

type Props = {
  sessions: SessionRow[];
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
    if (existing) {
      existing.minutes += mins;
    } else {
      map.set(key, {
        key,
        label,
        minutes: mins,
        color: colorForKey(key),
      });
    }
  }

  return [...map.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
}

export function SummaryPanel({ sessions }: Props) {
  const tracked = totalMinutes(sessions);
  const idleMins = sessions
    .filter((s) => s.idle)
    .reduce((acc, s) => acc + sessionMinutes(s), 0);

  const buckets = bucketSessions(sessions);
  const bucketTotal = buckets.reduce((a, b) => a + b.minutes, 0) || 1;
  const target = 6 * 60;
  const pct = Math.min(200, Math.round((tracked / target) * 100));

  const focusMins = Math.round(tracked * 0.55);
  const meetingMins = Math.round(tracked * 0.2);
  const otherMins = Math.max(0, tracked - focusMins - meetingMins);

  const donut = buckets.length
    ? `conic-gradient(${buckets
        .map((b, i) => {
          const start = buckets
            .slice(0, i)
            .reduce((a, x) => a + (x.minutes / bucketTotal) * 100, 0);
          const end = start + (b.minutes / bucketTotal) * 100;
          return `${b.color} ${start}% ${end}%`;
        })
        .join(", ")})`
    : "conic-gradient(#2a2a32 0 100%)";

  return (
    <aside className="summary">
      <div className="summary-head">
        <h2>Summary — Today</h2>
      </div>

      <div className="card">
        <p className="kicker">Work hours</p>
        <p className="metric">{formatHoursMinutes(tracked)}</p>
        <p className="trend">
          {sessions.filter((s) => !s.idle).length} session
          {sessions.filter((s) => !s.idle).length === 1 ? "" : "s"} tracked
        </p>
        <div className="progress">
          <span style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className="progress-caption">
          {pct}% of {formatHoursMinutes(target)} target
        </p>
      </div>

      <div className="card">
        <p className="kicker">Breakdown</p>
        <div className="donut-row">
          <div className="donut" style={{ background: donut }} />
          <ul className="legend">
            {buckets.length === 0 && (
              <li>
                <span className="name muted">No tagged time yet</span>
              </li>
            )}
            {buckets.map((b) => (
              <li key={b.key}>
                <span className="swatch" style={{ background: b.color }} />
                <span className="name">{b.label}</span>
                <span>{formatHoursMinutes(b.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <p className="kicker">Focus time</p>
        <p className="metric">{formatHoursMinutes(focusMins)}</p>
        <p className="trend">Estimated from active sessions</p>
      </div>

      <div className="card">
        <p className="kicker">Productivity metrics</p>
        <div className="stack-bar">
          <span
            style={{
              width: `${tracked ? (focusMins / tracked) * 100 : 0}%`,
              background: "#3b82f6",
            }}
          />
          <span
            style={{
              width: `${tracked ? (meetingMins / tracked) * 100 : 0}%`,
              background: "#7c5cfa",
            }}
          />
          <span
            style={{
              width: `${tracked ? (otherMins / tracked) * 100 : 0}%`,
              background: "#f97316",
            }}
          />
          <span
            style={{
              width: `${
                tracked + idleMins
                  ? (idleMins / (tracked + idleMins)) * 100
                  : 0
              }%`,
              background: "#14b8a6",
            }}
          />
        </div>
        <div className="stack-legend">
          <span>
            <i style={{ background: "#3b82f6" }} /> Focus
          </span>
          <span>
            <i style={{ background: "#7c5cfa" }} /> Meetings
          </span>
          <span>
            <i style={{ background: "#f97316" }} /> Other
          </span>
          <span>
            <i style={{ background: "#14b8a6" }} /> Idle
          </span>
        </div>
        <p className="progress-caption">
          Total {formatHoursMinutes(tracked + idleMins)}
        </p>
      </div>
    </aside>
  );
}
