import { useCallback, useEffect, useState } from "react";
import {
  ActivityEvent,
  AppUsageBucket,
  api,
  formatTime,
  todayLocal,
} from "../lib/api";
import { formatDayHeading, formatHoursMinutes, shiftDay } from "../lib/time";

type Props = {
  day: string;
  onDayChange: (day: string) => void;
  onError: (msg: string | null) => void;
  trackingStatus: string;
};

export function ActivityView({
  day,
  onDayChange,
  onError,
  trackingStatus,
}: Props) {
  const [tab, setTab] = useState<"timeline" | "log">("timeline");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [apps, setApps] = useState<AppUsageBucket[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ActivityEvent | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ev, br] = await Promise.all([
        api.listActivityEvents(day, query || undefined),
        api.activityAppBreakdown(day),
      ]);
      setEvents(ev);
      setApps(br);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [day, query, onError]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const totalMins = apps.reduce((a, b) => a + b.minutes, 0) || 1;

  async function excludeFromEvent(ev: ActivityEvent) {
    const field = ev.url ? "url" : "app";
    const pattern = ev.url
      ? ev.url.replace(/^https?:\/\//, "").split("/")[0]
      : ev.app_name;
    await api.createRule({
      name: `Exclude ${pattern}`,
      pattern,
      matchField: field,
      clientId: null,
      projectId: null,
      taskId: null,
      priority: 100,
      action: "exclude",
    });
    onError(null);
    window.alert(`Exclude rule added for ${pattern}`);
  }

  async function createKeyword(ev: ActivityEvent, matchField: string) {
    const pattern =
      matchField === "url"
        ? (ev.url ?? "").replace(/^https?:\/\//, "").split("/")[0]
        : matchField === "app"
          ? ev.app_name
          : (ev.title ?? ev.app_name);
    if (!pattern) return;
    await api.createRule({
      name: `${pattern} keyword`,
      pattern,
      matchField,
      clientId: null,
      projectId: null,
      taskId: null,
      priority: 20,
      action: "tag",
    });
    window.alert(`Rule created from ${matchField}: ${pattern}`);
  }

  return (
    <div className="page activity-page">
      <div className="page-head">
        <div className="topbar-date">
          <button type="button" className="icon-btn" onClick={() => onDayChange(shiftDay(day, -1))}>
            ‹
          </button>
          <h2>Activity / {formatDayHeading(day)}</h2>
          <button type="button" className="icon-btn" onClick={() => onDayChange(shiftDay(day, 1))}>
            ›
          </button>
          <button type="button" className="icon-btn" onClick={() => onDayChange(todayLocal())}>
            ●
          </button>
        </div>
      </div>

      <div className="lane-tabs">
        <button
          type="button"
          className={tab === "timeline" ? "active" : undefined}
          onClick={() => setTab("timeline")}
        >
          Timeline
        </button>
        <button
          type="button"
          className={tab === "log" ? "active" : undefined}
          onClick={() => setTab("log")}
        >
          Event Log
        </button>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
          Tracking status:{" "}
          <span style={{ color: trackingStatus === "running" ? "var(--success)" : "var(--warning)" }}>
            ● {trackingStatus === "running" ? "Enabled" : "Paused"}
          </span>
        </span>
      </div>

      {tab === "timeline" && (
        <div className="activity-timeline card">
          <div className="activity-donut-row">
            <div className="activity-total">
              <div className="metric">{formatHoursMinutes(apps.reduce((a, b) => a + b.minutes, 0))}</div>
              <div className="muted">Apps & websites</div>
            </div>
            <ul className="activity-app-list">
              {apps.length === 0 && (
                <li className="muted">No activity yet — keep AutoTrace running.</li>
              )}
              {apps.map((a) => {
                const pct = Math.round((a.minutes / totalMins) * 100);
                return (
                  <li key={a.key}>
                    <span className="name">{a.label}</span>
                    <span className="pct">{pct}%</span>
                    <span className="bar">
                      <i style={{ width: `${pct}%` }} />
                    </span>
                    <span className="mins">{formatHoursMinutes(a.minutes)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {tab === "log" && (
        <div className={`activity-log-layout${selected ? " with-detail" : ""}`}>
          <div className="activity-log-main">
            <input
              className="search-input"
              placeholder="Search activity…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="event-date-head">{formatDayHeading(day).toUpperCase()}</div>
            <ul className="event-list">
              {events.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    className={`event-row${selected?.id === ev.id ? " selected" : ""}`}
                    onClick={() => setSelected(ev)}
                  >
                    <span className="event-app">{ev.app_name}</span>
                    <span className="event-title muted">
                      {ev.title || ev.url || "—"}
                    </span>
                    <span className="event-time">{formatTime(ev.recorded_at)}</span>
                  </button>
                </li>
              ))}
              {events.length === 0 && (
                <li className="muted" style={{ padding: 16 }}>
                  No events for this day.
                </li>
              )}
            </ul>
          </div>

          {selected && (
            <aside className="event-detail card">
              <header>
                <strong>{selected.app_name}</strong>
                <button type="button" className="icon-btn" onClick={() => setSelected(null)}>
                  ✕
                </button>
              </header>
              <p className="muted">Time · {formatTime(selected.recorded_at)}</p>
              <p className="desc-box">{selected.title || "No title"}</p>
              {selected.url && <p className="path">{selected.url}</p>}
              <div className="event-actions">
                <button type="button" className="btn" onClick={() => void createKeyword(selected, "app")}>
                  Create app keyword ›
                </button>
                <button type="button" className="btn" onClick={() => void createKeyword(selected, "title")}>
                  Create title keyword ›
                </button>
                {selected.url && (
                  <button type="button" className="btn" onClick={() => void createKeyword(selected, "url")}>
                    Create URL keyword ›
                  </button>
                )}
                <button type="button" className="btn" onClick={() => void excludeFromEvent(selected)}>
                  Exclude from tracking ›
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ color: "var(--danger)" }}
                  onClick={() =>
                    void api.deleteActivityEvent(selected.id).then(() => {
                      setSelected(null);
                      void refresh();
                    })
                  }
                >
                  Delete event
                </button>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
