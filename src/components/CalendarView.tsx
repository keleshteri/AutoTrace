import {
  CSSProperties,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  FocusSession,
  SessionRow,
  api,
  durationLabel,
  formatTime,
  todayLocal,
} from "../lib/api";
import { activityDisplayLabel, friendlyAppName } from "../lib/displayNames";
import {
  coalesceSpans,
  layoutBlocks,
  blockStyle,
  TimedSpan,
} from "../lib/calendarLayout";
import {
  ACTIVITY_COLOR,
  BREAK_COLOR,
  DAY_END_HOUR,
  DAY_START_HOUR,
  FOCUS_COLOR,
  HOUR_HEIGHT,
  formatDayHeading,
  formatHourLabel,
  formatHoursMinutes,
  formatShortDay,
  mondayOf,
  monthGrid,
  monthLabel,
  parseLocalDateTime,
  shiftDay,
  shiftMonth,
  elapsedMinutes,
  totalMinutes,
  weekDays,
  weekNumber,
} from "../lib/time";

export type CalRange = "day" | "week" | "month";
export type CalLane =
  | "activity"
  | "entries"
  | "tasks"
  | "projects"
  | "clients"
  | "sessions";

type Props = {
  day: string;
  onDayChange: (day: string) => void;
  sessions: SessionRow[];
  selectedIds: number[];
  onSelect: (session: SessionRow, additive: boolean) => void;
  onOpenManual: () => void;
  onMerge: () => void;
  onRangeLabelChange?: (label: string) => void;
  liveSessionId?: number | null;
  error: string | null;
};

type DayBundle = {
  day: string;
  sessions: SessionRow[];
  focus: FocusSession[];
};

function focusMinutes(list: FocusSession[]): number {
  return list.reduce((acc, f) => {
    const a = parseLocalDateTime(f.started_at).getTime();
    const b = f.ended_at
      ? parseLocalDateTime(f.ended_at).getTime()
      : Date.now();
    if (Number.isNaN(a) || Number.isNaN(b)) return acc;
    return acc + Math.max(0, Math.round((b - a) / 60000));
  }, 0);
}

function isFocusSession(s: SessionRow): boolean {
  return (
    s.notes === "Focus session" ||
    (s.manual && (s.title ?? "").toLowerCase() === "focus")
  );
}

function activityLabel(s: SessionRow): string {
  if (s.idle) return "Break";
  if (s.app_name) {
    return (
      activityDisplayLabel(s.app_name, s.url) || friendlyAppName(s.app_name)
    );
  }
  return s.title || s.project_name || "Activity";
}

export function CalendarView({
  day,
  onDayChange,
  sessions,
  selectedIds,
  onSelect,
  onOpenManual,
  onMerge,
  onRangeLabelChange,
  liveSessionId = null,
  error,
}: Props) {
  const [range, setRange] = useState<CalRange>("day");
  const [lane, setLane] = useState<CalLane>("entries");
  const [focusList, setFocusList] = useState<FocusSession[]>([]);
  const [weekData, setWeekData] = useState<DayBundle[]>([]);
  const [monthData, setMonthData] = useState<DayBundle[]>([]);

  useEffect(() => {
    if (!onRangeLabelChange) return;
    const isToday = day === todayLocal();
    if (range === "week") onRangeLabelChange("Week");
    else if (range === "month") onRangeLabelChange("Month");
    else onRangeLabelChange(isToday ? "Day · Today" : "Day");
  }, [range, day, onRangeLabelChange]);

  const refreshFocus = useCallback(async () => {
    try {
      setFocusList(await api.listFocusForDay(day));
    } catch {
      setFocusList([]);
    }
  }, [day]);

  useEffect(() => {
    void refreshFocus();
  }, [refreshFocus, sessions]);

  useEffect(() => {
    if (range !== "week") return;
    const days = weekDays(day);
    let cancelled = false;
    void (async () => {
      const bundles = await Promise.all(
        days.map(async (d) => {
          const [s, f] = await Promise.all([
            api.listSessionsForDay(d),
            api.listFocusForDay(d),
          ]);
          return { day: d, sessions: s, focus: f };
        }),
      );
      if (!cancelled) setWeekData(bundles);
    })();
    return () => {
      cancelled = true;
    };
  }, [range, day]);

  useEffect(() => {
    if (range !== "month") return;
    const days = monthGrid(day);
    const [y, m] = day.split("-");
    const inMonth = days.filter((d) => d.startsWith(`${y}-${m}`));
    let cancelled = false;
    void (async () => {
      const bundles = await Promise.all(
        inMonth.map(async (d) => {
          const [s, f] = await Promise.all([
            api.listSessionsForDay(d),
            api.listFocusForDay(d),
          ]);
          return { day: d, sessions: s, focus: f };
        }),
      );
      if (!cancelled) setMonthData(bundles);
    })();
    return () => {
      cancelled = true;
    };
  }, [range, day]);

  const heading = useMemo(() => {
    if (range === "week") {
      const mon = mondayOf(day);
      return `Week ${weekNumber(day)} — ${formatDayHeading(mon).replace(/,.*$/, "")}`;
    }
    if (range === "month") return monthLabel(day);
    return formatDayHeading(day);
  }, [range, day]);

  function shift(delta: number) {
    if (range === "month") onDayChange(shiftMonth(day, delta));
    else if (range === "week") onDayChange(shiftDay(day, delta * 7));
    else onDayChange(shiftDay(day, delta));
  }

  const activitySource = useMemo(() => {
    let list = sessions.filter((s) => !s.idle && !isFocusSession(s));
    if (lane === "tasks") list = list.filter((s) => s.task_id != null);
    else if (lane === "projects")
      list = list.filter((s) => s.project_id != null);
    else if (lane === "clients")
      list = list.filter((s) => s.client_id != null);
    else if (lane === "sessions") list = [];
    return list;
  }, [sessions, lane]);

  const showActivityCol = lane !== "sessions";
  const showFocusCol =
    lane === "sessions" || lane === "entries" || lane === "activity";

  return (
    <div className="calendar-view">
      <header className="topbar">
        <div className="topbar-date">
          <button type="button" className="icon-btn" onClick={() => shift(-1)}>
            ‹
          </button>
          <h1>{heading}</h1>
          <button type="button" className="icon-btn" onClick={() => shift(1)}>
            ›
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Today"
            onClick={() => onDayChange(todayLocal())}
          >
            ●
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn" onClick={onOpenManual}>
            + Manual
          </button>
          <div className="segment" role="group" aria-label="Range">
            {(["day", "week", "month"] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={range === r ? "active" : undefined}
                onClick={() => setRange(r)}
              >
                {r[0].toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="lane-tabs">
        {(
          [
            ["activity", "Activity"],
            ["entries", "Time Entries"],
            ["tasks", "Tasks"],
            ["projects", "Projects"],
            ["clients", "Clients"],
            ["sessions", "Sessions"],
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
        <div className="lane-tabs-end">
          {selectedIds.length >= 2 ? (
            <button type="button" className="btn" onClick={onMerge}>
              Merge {selectedIds.length}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              ⌘/Ctrl+click to multi-select
            </span>
          )}
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {range === "day" && (
        <DayDualCalendar
          activitySessions={showActivityCol ? activitySource : []}
          focusSessions={showFocusCol ? focusList : []}
          breakSessions={showFocusCol ? sessions.filter((s) => s.idle) : []}
          allSessions={sessions}
          selectedIds={selectedIds}
          onSelect={onSelect}
          isToday={day === todayLocal()}
          showActivity={showActivityCol}
          showFocus={showFocusCol}
          liveSessionId={liveSessionId}
        />
      )}

      {range === "week" && (
        <WeekCalendar
          day={day}
          bundles={weekData}
          onPickDay={(d) => {
            onDayChange(d);
            setRange("day");
          }}
        />
      )}

      {range === "month" && (
        <MonthCalendar
          day={day}
          bundles={monthData}
          onPickDay={(d) => {
            onDayChange(d);
            setRange("day");
          }}
        />
      )}
    </div>
  );
}

function DayDualCalendar({
  activitySessions,
  focusSessions,
  breakSessions,
  allSessions,
  selectedIds,
  onSelect,
  isToday,
  showActivity,
  showFocus,
  liveSessionId,
}: {
  activitySessions: SessionRow[];
  focusSessions: FocusSession[];
  breakSessions: SessionRow[];
  allSessions: SessionRow[];
  selectedIds: number[];
  onSelect: (session: SessionRow, additive: boolean) => void;
  isToday: boolean;
  showActivity: boolean;
  showFocus: boolean;
  liveSessionId: number | null;
}) {
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

  function pickSession(sessionId: number | undefined, e: MouseEvent) {
    if (sessionId == null) return;
    const session = allSessions.find((s) => s.id === sessionId);
    if (!session) return;
    onSelect(session, e.metaKey || e.ctrlKey || e.shiftKey);
  }

  const liveSession = useMemo(
    () =>
      liveSessionId != null
        ? (allSessions.find((s) => s.id === liveSessionId) ?? null)
        : null,
    [allSessions, liveSessionId],
  );

  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    if (!liveSessionId) return;
    const id = window.setInterval(() => setLiveTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [liveSessionId]);

  const activityBlocks = useMemo(() => {
    const spans: TimedSpan[] = activitySessions
      .filter((s) => s.id !== liveSessionId)
      .map((s) => ({
        id: `a-${s.id}`,
        started_at: s.started_at,
        ended_at: s.ended_at,
        label: activityLabel(s),
        color: ACTIVITY_COLOR,
        sessionId: s.id,
        pending: s.pending,
      }));
    const merged = coalesceSpans(spans, (s) => s.label.toLowerCase());
    return layoutBlocks(merged, DAY_START_HOUR, HOUR_HEIGHT);
  }, [activitySessions, liveSessionId]);

  const trackingBlock = useMemo(() => {
    if (!liveSession || liveSession.idle) return null;
    const span: TimedSpan = {
      id: `live-${liveSession.id}`,
      started_at: liveSession.started_at,
      ended_at: null,
      label: "Tracking…",
      color: ACTIVITY_COLOR,
      sessionId: liveSession.id,
      pending: liveSession.pending,
    };
    return layoutBlocks([span], DAY_START_HOUR, HOUR_HEIGHT)[0] ?? null;
  }, [liveSession, liveTick]);

  const sessionBlocks = useMemo(() => {
    const focusSpans: TimedSpan[] = focusSessions.map((f) => ({
      id: `f-${f.id}`,
      started_at: f.started_at,
      ended_at: f.ended_at,
      label: f.goal?.trim() || "Focus",
      color: FOCUS_COLOR,
    }));
    const breakSpans: TimedSpan[] = breakSessions
      .filter((s) => s.id !== liveSessionId)
      .map((s) => ({
        id: `b-${s.id}`,
        started_at: s.started_at,
        ended_at: s.ended_at,
        label: "Break",
        color: BREAK_COLOR,
        sessionId: s.id,
        idle: true,
      }));
    const mergedFocus = coalesceSpans(focusSpans, () => "focus");
    const mergedBreaks = coalesceSpans(breakSpans, () => "break");
    return layoutBlocks(
      [...mergedFocus, ...mergedBreaks],
      DAY_START_HOUR,
      HOUR_HEIGHT,
    );
  }, [focusSessions, breakSessions, liveSessionId]);

  const cols = (showActivity ? 1 : 0) + (showFocus ? 1 : 0) || 1;

  return (
    <div className="timeline-scroll">
      <div
        className="day-grid dual"
        style={
          {
            "--hours": totalHeight,
            minHeight: totalHeight,
            "--cal-cols": cols,
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
              {formatHourLabel(h)}
            </div>
          ))}
        </div>

        <div className="day-columns" style={{ height: totalHeight }}>
          {showActivity && (
            <div className="day-col">
              <div className="day-col-head">Activity</div>
              <div className="hour-track" style={{ height: totalHeight }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="hour-line"
                    style={{ top: (h - DAY_START_HOUR) * HOUR_HEIGHT }}
                  />
                ))}
                {nowTop != null && nowTop >= 0 && nowTop <= totalHeight && (
                  <div className="now-line" style={{ top: nowTop }}>
                    <span className="now-tag">
                      {new Date().toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
                {activityBlocks.length === 0 && !trackingBlock && (
                  <p className="empty-hint">No activity yet</p>
                )}
                {activityBlocks.map((b) => {
                  const selected =
                    b.sessionId != null && selectedIds.includes(b.sessionId);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`session-block activity${b.pending ? " pending" : ""}${selected ? " selected" : ""}`}
                      style={blockStyle(b)}
                      title={`${b.label} · ${formatTime(b.started_at)} – ${b.ended_at ? formatTime(b.ended_at) : "now"}`}
                      onClick={(e) => pickSession(b.sessionId, e)}
                    >
                      <div className="sb-title">{b.label}</div>
                      {b.height > 34 && (
                        <div className="sb-meta">
                          {formatTime(b.started_at)} –{" "}
                          {b.ended_at ? formatTime(b.ended_at) : "now"}
                        </div>
                      )}
                    </button>
                  );
                })}
                {trackingBlock && (
                  <button
                    type="button"
                    className={`session-block activity tracking${selectedIds.includes(trackingBlock.sessionId!) ? " selected" : ""}`}
                    style={blockStyle(trackingBlock)}
                    title="Tracking… Click to review"
                    onClick={(e) => pickSession(trackingBlock.sessionId, e)}
                  >
                    <div className="sb-title">Tracking…</div>
                    <div className="sb-meta">
                      {activityLabel(liveSession!)} · click to review
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}

          {showFocus && (
            <div className="day-col">
              <div className="day-col-head">Sessions</div>
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
                {sessionBlocks.length === 0 && (
                  <p className="empty-hint">No focus sessions</p>
                )}
                {sessionBlocks.map((b) => {
                  const selected =
                    b.sessionId != null && selectedIds.includes(b.sessionId);
                  const isBreak = Boolean(b.idle);
                  if (b.sessionId != null) {
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className={`session-block ${isBreak ? "break" : "focus"}${selected ? " selected" : ""}`}
                        style={blockStyle(b)}
                        title={`${b.label} · ${formatTime(b.started_at)} – ${b.ended_at ? formatTime(b.ended_at) : "now"}`}
                        onClick={(e) => pickSession(b.sessionId, e)}
                      >
                        <div className="sb-title">{b.label}</div>
                        {b.height > 34 && (
                          <div className="sb-meta">
                            {isBreak
                              ? durationLabel(b.started_at, b.ended_at)
                              : `${formatTime(b.started_at)} – ${b.ended_at ? formatTime(b.ended_at) : "now"}`}
                          </div>
                        )}
                      </button>
                    );
                  }
                  return (
                    <div
                      key={b.id}
                      className={`session-block ${isBreak ? "break" : "focus"}`}
                      style={blockStyle(b)}
                      title={`${b.label} · ${formatTime(b.started_at)} – ${b.ended_at ? formatTime(b.ended_at) : "now"}`}
                    >
                      <div className="sb-title">{b.label}</div>
                      {b.height > 34 && (
                        <div className="sb-meta">
                          {formatTime(b.started_at)} –{" "}
                          {b.ended_at ? formatTime(b.ended_at) : "now"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekCalendar({
  day,
  bundles,
  onPickDay,
}: {
  day: string;
  bundles: DayBundle[];
  onPickDay: (d: string) => void;
}) {
  const days = weekDays(day);
  const hours = [8, 10, 12, 14, 16, 18, 20];
  const today = todayLocal();
  const byDay = new Map(bundles.map((b) => [b.day, b]));

  return (
    <div className="week-cal">
      <div className="week-head">
        <div className="week-corner" />
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className={`week-day-head${d === today ? " today" : ""}${d === day ? " active" : ""}`}
            onClick={() => onPickDay(d)}
          >
            {formatShortDay(d)}
          </button>
        ))}
      </div>
      <div className="week-body">
        <div className="week-hours">
          {hours.map((h) => (
            <div key={h}>{formatHourLabel(h)}</div>
          ))}
        </div>
        <div className="week-cols">
          {days.map((d) => {
            const bundle = byDay.get(d);
            const mins = totalMinutes(bundle?.sessions ?? []);
            const focusMins = focusMinutes(bundle?.focus ?? []);
            return (
              <button
                key={d}
                type="button"
                className={`week-col${d === today ? " today" : ""}`}
                onClick={() => onPickDay(d)}
              >
                {mins > 0 && (
                  <div
                    className="week-bar activity"
                    style={{
                      top: "18%",
                      height: `${Math.min(60, 8 + mins / 2)}%`,
                    }}
                    title={`${formatHoursMinutes(mins)} activity`}
                  />
                )}
                {focusMins > 0 && (
                  <div
                    className="week-bar focus"
                    style={{
                      top: "20%",
                      height: `${Math.min(55, 8 + focusMins / 2)}%`,
                      left: "55%",
                    }}
                    title={`Focus ${formatHoursMinutes(focusMins)}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({
  day,
  bundles,
  onPickDay,
}: {
  day: string;
  bundles: DayBundle[];
  onPickDay: (d: string) => void;
}) {
  const cells = monthGrid(day);
  const [y, m] = day.split("-");
  const prefix = `${y}-${m}`;
  const today = todayLocal();
  const byDay = new Map(bundles.map((b) => [b.day, b]));
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="month-cal">
      <div className="month-weekdays">
        {weekdays.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="month-grid">
        {cells.map((d) => {
          const inMonth = d.startsWith(prefix);
          const bundle = byDay.get(d);
          const focusMins = focusMinutes(bundle?.focus ?? []);
          const breakMins = elapsedMinutes(
            (bundle?.sessions ?? []).filter((s) => s.idle),
          );
          const hasAny =
            focusMins > 0 ||
            breakMins > 0 ||
            (bundle?.sessions.some((s) => !s.idle) ?? false);
          const dayNum = Number(d.slice(8));

          return (
            <button
              key={d}
              type="button"
              className={`month-cell${inMonth ? "" : " out"}${d === today ? " today" : ""}${d === day ? " active" : ""}`}
              onClick={() => onPickDay(d)}
            >
              <span className={`month-date${hasAny ? " dot" : ""}`}>
                {dayNum}
              </span>
              <div className="month-pills">
                {focusMins > 0 && (
                  <span className="pill focus">
                    Focus {formatHoursMinutes(focusMins)}
                  </span>
                )}
                {breakMins > 0 && (
                  <span className="pill break">
                    Break {formatHoursMinutes(breakMins)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
