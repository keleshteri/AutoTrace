import type { CSSProperties, MouseEvent } from "react";
import { SessionRow, durationLabel, formatTime } from "../lib/api";
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  HOUR_HEIGHT,
  blockGeometry,
  colorForKey,
} from "../lib/time";

type Props = {
  sessions: SessionRow[];
  selectedIds: number[];
  onSelect: (session: SessionRow, additive: boolean) => void;
  isToday: boolean;
};

export function DayCalendar({
  sessions,
  selectedIds,
  onSelect,
  isToday,
}: Props) {
  const hours = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
    (_, i) => DAY_START_HOUR + i,
  );
  const totalHeight = hours.length * HOUR_HEIGHT;

  const nowTop = (() => {
    if (!isToday) return null;
    const localMins = new Date().getHours() * 60 + new Date().getMinutes();
    return ((localMins - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
  })();

  function handleClick(e: MouseEvent, session: SessionRow) {
    onSelect(session, e.metaKey || e.ctrlKey || e.shiftKey);
  }

  return (
    <div className="timeline-scroll">
      <div
        className="day-grid"
        style={
          {
            "--hours": totalHeight,
            minHeight: totalHeight,
          } as CSSProperties
        }
      >
        <div className="hour-labels" style={{ height: totalHeight }}>
          {hours.map((h) => (
            <div
              key={h}
              className="hour-label"
              style={{ top: (h - DAY_START_HOUR) * HOUR_HEIGHT }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        <div className="hour-track" style={{ height: totalHeight }}>
          {hours.map((h) => (
            <div
              key={h}
              className="hour-line"
              style={{ top: (h - DAY_START_HOUR) * HOUR_HEIGHT }}
            />
          ))}

          {nowTop != null && nowTop >= 0 && nowTop <= totalHeight && (
            <div className="now-line" style={{ top: nowTop }} />
          )}

          {sessions.length === 0 && (
            <p className="empty-hint">
              No sessions yet — keep AutoTrace running in the tray.
            </p>
          )}

          {sessions.map((s) => {
            const { top, height } = blockGeometry(s.started_at, s.ended_at);
            const color = s.idle
              ? "#3f3f46"
              : colorForKey(s.client_id ?? s.project_id ?? s.app_name ?? s.id);
            const title =
              s.task_name ||
              s.project_name ||
              s.client_name ||
              s.title ||
              s.app_name ||
              "Untitled";
            const selected = selectedIds.includes(s.id);

            return (
              <button
                key={s.id}
                type="button"
                className={`session-block${s.idle ? " idle" : ""}${s.pending ? " pending" : ""}${selected ? " selected" : ""}`}
                style={{ top, height, background: color }}
                onClick={(e) => handleClick(e, s)}
              >
                <div className="sb-title">
                  {s.pending ? "◯ " : ""}
                  {title}
                  {s.confidence != null && height > 36
                    ? ` · ${Math.round(s.confidence * 100)}%`
                    : ""}
                </div>
                {height > 40 && (
                  <div className="sb-meta">
                    <span>
                      {formatTime(s.started_at)} –{" "}
                      {s.ended_at ? formatTime(s.ended_at) : "now"}
                    </span>
                    <span>{durationLabel(s.started_at, s.ended_at)}</span>
                  </div>
                )}
                {height > 58 && s.app_name && (
                  <div className="sb-meta">
                    <span>{s.app_name}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
