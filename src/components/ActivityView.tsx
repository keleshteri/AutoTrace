import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityEvent,
  api,
  todayLocal,
} from "../lib/api";
import {
  activityDisplayLabel,
  appInitials,
  formatTimeAmPm,
  friendlyAppName,
} from "../lib/displayNames";
import {
  colorForKey,
  formatDayHeading,
  formatHoursMinutes,
  minutesSinceMidnight,
  parseLocalDateTime,
  shiftDay,
} from "../lib/time";

type Props = {
  day: string;
  onDayChange: (day: string) => void;
  onError: (msg: string | null) => void;
  trackingStatus: string;
};

type UsageRow = {
  key: string;
  label: string;
  minutes: number;
  events: number;
  color: string;
};

type TimelineSeg = {
  key: string;
  label: string;
  startMin: number;
  endMin: number;
  color: string;
};

const DAY_VIEW_START = 8 * 60; // 8 AM
const DAY_VIEW_END = 18 * 60; // 6 PM
const DAY_SPAN = DAY_VIEW_END - DAY_VIEW_START;

function buildUsage(events: ActivityEvent[]): UsageRow[] {
  if (events.length === 0) return [];
  const chronological = [...events].sort((a, b) =>
    a.recorded_at.localeCompare(b.recorded_at),
  );

  const map = new Map<string, UsageRow>();
  const now = Date.now();

  for (let i = 0; i < chronological.length; i++) {
    const e = chronological[i];
    const label = activityDisplayLabel(e.app_name, e.url);
    const key = label.toLowerCase();
    const start = parseLocalDateTime(e.recorded_at).getTime();
    const end =
      i + 1 < chronological.length
        ? parseLocalDateTime(chronological[i + 1].recorded_at).getTime()
        : now;
    const secs = Math.min(300, Math.max(0, (end - start) / 1000));
    const mins = Math.round(secs / 60);
    const existing = map.get(key);
    if (existing) {
      existing.minutes += mins;
      existing.events += 1;
    } else {
      map.set(key, {
        key,
        label,
        minutes: mins,
        events: 1,
        color: colorForKey(key),
      });
    }
  }

  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

function buildTimelineSegs(events: ActivityEvent[]): TimelineSeg[] {
  if (events.length === 0) return [];
  const chronological = [...events].sort((a, b) =>
    a.recorded_at.localeCompare(b.recorded_at),
  );
  const segs: TimelineSeg[] = [];
  const nowMin =
    new Date().getHours() * 60 +
    new Date().getMinutes();

  for (let i = 0; i < chronological.length; i++) {
    const e = chronological[i];
    const label = activityDisplayLabel(e.app_name, e.url);
    const startMin = minutesSinceMidnight(e.recorded_at);
    let endMin =
      i + 1 < chronological.length
        ? minutesSinceMidnight(chronological[i + 1].recorded_at)
        : Math.max(startMin + 1, nowMin);
    // Cap long idle gaps visually at 20 minutes for the strip
    if (endMin - startMin > 20) endMin = startMin + 20;
    if (endMin <= startMin) endMin = startMin + 1;
    segs.push({
      key: `${e.id}`,
      label,
      startMin,
      endMin,
      color: colorForKey(label),
    });
  }
  return segs;
}

function pctLeft(min: number): number {
  return ((min - DAY_VIEW_START) / DAY_SPAN) * 100;
}

function pctWidth(start: number, end: number): number {
  const s = Math.max(start, DAY_VIEW_START);
  const e = Math.min(end, DAY_VIEW_END);
  if (e <= s) return 0;
  return ((e - s) / DAY_SPAN) * 100;
}

export function ActivityView({
  day,
  onDayChange,
  onError,
  trackingStatus,
}: Props) {
  const [tab, setTab] = useState<"timeline" | "log">("timeline");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ActivityEvent | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Always load full day for timeline; filter client-side for search.
      const ev = await api.listActivityEvents(day, undefined, 2000);
      setEvents(ev);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [day, onError]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const usage = useMemo(() => buildUsage(events), [events]);
  const segs = useMemo(() => buildTimelineSegs(events), [events]);
  const totalMins = usage.reduce((a, b) => a + b.minutes, 0);
  const denom = totalMins || 1;

  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const label = activityDisplayLabel(e.app_name, e.url).toLowerCase();
      return (
        label.includes(q) ||
        e.app_name.toLowerCase().includes(q) ||
        (e.title ?? "").toLowerCase().includes(q) ||
        (e.url ?? "").toLowerCase().includes(q)
      );
    });
  }, [events, query]);

  const donut = useMemo(() => {
    if (usage.length === 0) return "conic-gradient(#2a2a32 0 100%)";
    let cursor = 0;
    const parts: string[] = [];
    for (const row of usage.slice(0, 8)) {
      const slice = (row.minutes / denom) * 100;
      parts.push(`${row.color} ${cursor}% ${cursor + slice}%`);
      cursor += slice;
    }
    if (cursor < 100) parts.push(`#2a2a32 ${cursor}% 100%`);
    return `conic-gradient(${parts.join(", ")})`;
  }, [usage, denom]);

  const hourLabels = [9, 10, 11, 12, 13, 14, 15, 16];

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
      <div className="activity-header">
        <div className="topbar-date">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onDayChange(shiftDay(day, -1))}
            aria-label="Previous day"
          >
            ‹
          </button>
          <h2>Activity / {formatDayHeading(day)}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onDayChange(shiftDay(day, 1))}
            aria-label="Next day"
          >
            ›
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onDayChange(todayLocal())}
            title="Today"
          >
            ●
          </button>
        </div>
        <div className="segment" role="group" aria-label="Range">
          <button type="button" className="active">
            Day
          </button>
          <button type="button" disabled title="Coming next">
            Week
          </button>
          <button type="button" disabled title="Coming next">
            Month
          </button>
        </div>
      </div>

      <div className="activity-tabs">
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
        <span className="activity-tracking-status">
          Tracking status:{" "}
          <span
            className={
              trackingStatus === "running" ? "on" : "off"
            }
          >
            ● {trackingStatus === "running" ? "Enabled" : "Paused"}
          </span>
        </span>
      </div>

      {tab === "timeline" && (
        <div className="activity-timeline-view">
          <section className="activity-day-strip card">
            <div className="day-strip-track">
              {segs.map((s) => {
                const left = pctLeft(s.startMin);
                const width = pctWidth(s.startMin, s.endMin);
                if (width <= 0 || left > 100 || left + width < 0) return null;
                return (
                  <div
                    key={s.key}
                    className="day-strip-block"
                    title={`${s.label}`}
                    style={{
                      left: `${Math.max(0, left)}%`,
                      width: `${Math.max(0.4, width)}%`,
                      background: s.color,
                    }}
                  />
                );
              })}
            </div>
            <div className="day-strip-hours">
              {hourLabels.map((h) => (
                <span key={h} style={{ left: `${pctLeft(h * 60)}%` }}>
                  {h > 12 ? `${h - 12} PM` : h === 12 ? "12 PM" : `${h} AM`}
                </span>
              ))}
            </div>
            {segs.length === 0 && (
              <p className="empty-hint">
                No activity blocks yet — keep AutoTrace running in the tray.
              </p>
            )}
          </section>

          <div className="activity-analytics">
            <section className="card activity-pie-card">
              <p className="kicker">Pie Chart</p>
              <div className="activity-pie-wrap">
                <div
                  className="activity-pie"
                  style={{ background: donut }}
                  aria-hidden
                />
                <div className="activity-pie-center">
                  <div className="metric">
                    {formatHoursMinutes(totalMins)}
                  </div>
                </div>
              </div>
            </section>

            <section className="card activity-apps-card">
              <p className="kicker">Apps & Websites</p>
              <ul className="rize-app-list">
                {usage.length === 0 && (
                  <li className="muted">No apps tracked yet today.</li>
                )}
                {usage.map((row) => {
                  const pct = Math.round((row.minutes / denom) * 100);
                  return (
                    <li key={row.key}>
                      <span className="pct">{pct}%</span>
                      <span className="mini-bar" title={`${pct}%`}>
                        <i
                          style={{
                            width: `${Math.max(4, pct)}%`,
                            background: row.color,
                          }}
                        />
                      </span>
                      <span
                        className="app-avatar"
                        style={{ background: row.color }}
                      >
                        {appInitials(row.label)}
                      </span>
                      <span className="name">{row.label}</span>
                      <span className="mins">
                        {row.minutes < 1
                          ? "< 1 min"
                          : formatHoursMinutes(row.minutes)}
                      </span>
                      <button
                        type="button"
                        className="icon-btn edit-app"
                        title="Create exclude rule"
                        onClick={() =>
                          void api
                            .createRule({
                              name: `Exclude ${row.label}`,
                              pattern: row.label,
                              matchField: row.label.includes(".")
                                ? "url"
                                : "app",
                              clientId: null,
                              projectId: null,
                              taskId: null,
                              priority: 90,
                              action: "exclude",
                            })
                            .then(() =>
                              window.alert(`Exclude rule for ${row.label}`),
                            )
                        }
                      >
                        ✎
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </div>
      )}

      {tab === "log" && (
        <div className={`activity-log-layout${selected ? " with-detail" : ""}`}>
          <div className="activity-log-main">
            <div className="search-wrap">
              <span className="search-icon" aria-hidden>
                ⌕
              </span>
              <input
                className="search-input"
                placeholder="Search activity…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <p className="activity-tracking-status log-status">
              Tracking status:{" "}
              <span className={trackingStatus === "running" ? "on" : "off"}>
                ● {trackingStatus === "running" ? "Enabled" : "Paused"}
              </span>
            </p>

            <div className="event-date-rule">
              <span>{formatDayHeading(day).toUpperCase()}</span>
            </div>

            <ul className="event-list rize-event-list">
              {filteredEvents.map((ev) => {
                const label = activityDisplayLabel(ev.app_name, ev.url);
                const detail = ev.title || ev.url || "";
                return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      className={`event-row rize-event-row${selected?.id === ev.id ? " selected" : ""}`}
                      onClick={() => setSelected(ev)}
                    >
                      <span
                        className="app-avatar"
                        style={{ background: colorForKey(label) }}
                      >
                        {appInitials(label)}
                      </span>
                      <span className="event-main">
                        <span className="event-app">{label}</span>
                        {detail ? (
                          <span className="event-title"> — {detail}</span>
                        ) : null}
                      </span>
                      <span className="event-time">
                        {formatTimeAmPm(ev.recorded_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filteredEvents.length === 0 && (
                <li className="muted" style={{ padding: 16 }}>
                  No events for this day.
                </li>
              )}
            </ul>
          </div>

          {selected && (
            <aside className="event-detail card">
              <header>
                <div className="event-detail-title">
                  <span
                    className="app-avatar lg"
                    style={{
                      background: colorForKey(
                        activityDisplayLabel(selected.app_name, selected.url),
                      ),
                    }}
                  >
                    {appInitials(
                      activityDisplayLabel(selected.app_name, selected.url),
                    )}
                  </span>
                  <div>
                    <strong>
                      {activityDisplayLabel(selected.app_name, selected.url)}
                    </strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {friendlyAppName(selected.app_name)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setSelected(null)}
                >
                  ✕
                </button>
              </header>
              <p className="muted">
                Time · {formatTimeAmPm(selected.recorded_at)}
              </p>
              <p className="kicker">Title</p>
              <p className="desc-box">{selected.title || "—"}</p>
              {selected.url && (
                <>
                  <p className="kicker">URL</p>
                  <p className="path">{selected.url}</p>
                </>
              )}
              <div className="event-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void createKeyword(selected, "app")}
                >
                  Create app keyword ›
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void createKeyword(selected, "title")}
                >
                  Create title keyword ›
                </button>
                {selected.url && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void createKeyword(selected, "url")}
                  >
                    Create URL keyword ›
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() => void excludeFromEvent(selected)}
                >
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
