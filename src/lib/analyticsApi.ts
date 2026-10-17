import { invoke } from "@tauri-apps/api/core";
import type { AiRunResult, SessionRow } from "./api";

export const DIMENSIONS = [
  { id: "none", label: "None" },
  { id: "project", label: "Projects" },
  { id: "client", label: "Clients" },
  { id: "task", label: "Tasks" },
  { id: "category", label: "Categories" },
  { id: "app", label: "Apps" },
  { id: "domain", label: "Websites" },
  { id: "billable", label: "Billable" },
  { id: "status", label: "Review status" },
  { id: "day", label: "Date · Day" },
  { id: "week", label: "Date · Week" },
  { id: "month", label: "Date · Month" },
  { id: "weekday", label: "Weekday" },
  { id: "hour", label: "Hour of day" },
] as const;

export type Dimension = (typeof DIMENSIONS)[number]["id"];

export const PERIODS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "last_7_days", label: "Last 7 days" },
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "custom", label: "Custom range" },
] as const;

export function dimLabel(id: string): string {
  return DIMENSIONS.find((d) => d.id === id)?.label ?? id;
}

export function periodLabel(id: string): string {
  return PERIODS.find((p) => p.id === id)?.label ?? id;
}

export type QueryFilter = { dim: string; values: string[] };

export type TimeQuery = {
  from: string;
  to: string;
  rows_by: string;
  cols_by: string;
  filters: QueryFilter[];
  include_idle: boolean;
  compare_previous: boolean;
};

export type QueryHeader = { key: string; label: string };

export type QueryKpis = {
  total_secs: number;
  entries: number;
  active_days: number;
  daily_avg_secs: number;
  billable_secs: number;
};

export type TimeQueryResult = {
  query: TimeQuery;
  rows: QueryHeader[];
  cols: QueryHeader[];
  cells: number[][];
  row_totals: number[];
  col_totals: number[];
  kpis: QueryKpis;
  previous: QueryKpis | null;
  delta_pct: number | null;
};

export type Dashboard = {
  id: number;
  name: string;
  description: string | null;
  query: TimeQuery;
  period: string;
  pinned: boolean;
  template: string | null;
  created_at: string;
  updated_at: string;
};

export type DashboardTemplate = {
  slug: string;
  name: string;
  description: string;
  period: string;
  rows_by: string;
  cols_by: string;
};

export type Schedule = {
  kind: "manual" | "daily" | "weekdays" | "weekly" | "hourly" | string;
  time?: string | null;
  weekday?: number | null;
};

export type Report = {
  id: number;
  name: string;
  dashboard_id: number | null;
  dashboard_name: string | null;
  period: string;
  schedule: Schedule;
  ai_enabled: boolean;
  enabled: boolean;
  last_run_at: string | null;
  run_count: number;
};

export type Insight = { kind: "highlight" | "anomaly" | "info" | string; title: string; detail: string };

export type ReportRun = {
  id: number;
  report_id: number;
  period_from: string;
  period_to: string;
  trigger: string;
  status: string;
  result: TimeQueryResult | null;
  insights: Insight[];
  ai_summary: string | null;
  error: string | null;
  created_at: string;
};

export type RoutineAction = "digest" | "report" | "ai_prompt" | "export_csv" | "integration_push";

export type Routine = {
  id: number;
  name: string;
  schedule: Schedule;
  action_kind: RoutineAction | string;
  action: Record<string, unknown>;
  enabled: boolean;
  builtin: string | null;
  last_run_at: string | null;
  last_status: string | null;
};

export type RoutineRun = {
  id: number;
  routine_id: number;
  routine_name: string | null;
  trigger: string;
  status: string;
  output: string | null;
  started_at: string;
  ended_at: string | null;
};

export type Meeting = {
  id: number;
  calendar_event_id: number | null;
  title: string;
  started_at: string;
  ended_at: string;
  attendees: string[];
  attendance: "unknown" | "attend" | "skip" | string;
  client_id: number | null;
  project_id: number | null;
  client_name: string | null;
  project_name: string | null;
  has_transcript: boolean;
  transcript: string | null;
  summary: string | null;
  session_id: number | null;
};

export type CapacityDay = {
  day: string;
  tracked_secs: number;
  planned_secs: number;
  capacity_secs: number;
  cum_tracked_secs: number;
  cum_planned_secs: number;
  cum_capacity_secs: number;
};

export type CapacityWeek = {
  key: string;
  label: string;
  tracked_secs: number;
  planned_secs: number;
  capacity_secs: number;
  load_pct: number;
};

export type CapacityReport = {
  from: string;
  to: string;
  tracked_secs: number;
  planned_secs: number;
  capacity_secs: number;
  utilization_pct: number;
  weekly_capacity_hours: number;
  days: CapacityDay[];
  weeks: CapacityWeek[];
};

export type MentionItem = {
  kind: "client" | "project" | "task" | "dashboard" | "app" | string;
  id: string;
  label: string;
  sub: string | null;
};

export type FocusOverview = {
  day: string;
  focus_secs: number;
  focus_sessions: number;
  break_secs: number;
  week: [string, number][];
  week_total_secs: number;
  week_avg_session_secs: number;
  distraction_secs: number;
  top_distractions: { label: string; secs: number; pct: number }[];
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function scheduleLabel(s: Schedule): string {
  const t = s.time ? formatClock(s.time) : "";
  switch (s.kind) {
    case "daily":
      return `Daily at ${t}`;
    case "weekdays":
      return `Weekdays at ${t}`;
    case "weekly":
      return `${WEEKDAYS[s.weekday ?? 0]}days at ${t}`;
    case "hourly":
      return "Every hour";
    default:
      return "On demand";
  }
}

export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

/** Seconds → "3.5h" style compact hours for grid cells. */
export function hoursCompact(secs: number): string {
  if (secs <= 0) return "–";
  const h = secs / 3600;
  if (h < 0.1) return `${Math.max(1, Math.round(secs / 60))}m`;
  return `${h.toFixed(1)}h`;
}

/** Seconds → "274 hr" / "3 hr 55 min" for KPI tiles. */
export function hoursLong(secs: number): string {
  const mins = Math.round(secs / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (h >= 100 || m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export const analyticsApi = {
  runTimeQuery: (query: TimeQuery) => invoke<TimeQueryResult>("run_time_query", { query }),
  timeQuerySessions: (query: TimeQuery, rowKey?: string | null, colKey?: string | null) =>
    invoke<SessionRow[]>("time_query_sessions", {
      query,
      rowKey: rowKey ?? null,
      colKey: colKey ?? null,
    }),
  exportTimeQueryCsv: (query: TimeQuery) => invoke<string>("export_time_query_csv", { query }),
  resolvePeriod: (period: string) => invoke<[string, string]>("resolve_period", { period }),

  listDashboards: () => invoke<Dashboard[]>("list_dashboards"),
  listDashboardTemplates: () => invoke<DashboardTemplate[]>("list_dashboard_templates"),
  saveDashboard: (args: {
    id?: number | null;
    name: string;
    description?: string | null;
    query: TimeQuery;
    period: string;
    pinned?: boolean;
  }) =>
    invoke<Dashboard>("save_dashboard", {
      id: args.id ?? null,
      name: args.name,
      description: args.description ?? null,
      query: args.query,
      period: args.period,
      pinned: args.pinned ?? true,
    }),
  createDashboardFromTemplate: (slug: string) =>
    invoke<Dashboard>("create_dashboard_from_template", { slug }),
  setDashboardPinned: (id: number, pinned: boolean) =>
    invoke<void>("set_dashboard_pinned", { id, pinned }),
  deleteDashboard: (id: number) => invoke<void>("delete_dashboard", { id }),

  listReports: () => invoke<Report[]>("list_reports"),
  saveReport: (args: {
    id?: number | null;
    name: string;
    dashboardId: number | null;
    period: string;
    schedule: Schedule;
    aiEnabled: boolean;
    enabled?: boolean;
  }) =>
    invoke<Report>("save_report", {
      id: args.id ?? null,
      name: args.name,
      dashboardId: args.dashboardId,
      period: args.period,
      schedule: args.schedule,
      aiEnabled: args.aiEnabled,
      enabled: args.enabled ?? true,
    }),
  deleteReport: (id: number) => invoke<void>("delete_report", { id }),
  runReport: (id: number) => invoke<ReportRun>("run_report", { id }),
  listReportRuns: (reportId: number) => invoke<ReportRun[]>("list_report_runs", { reportId }),

  listRoutines: () => invoke<Routine[]>("list_routines"),
  saveRoutine: (args: {
    id?: number | null;
    name: string;
    schedule: Schedule;
    actionKind: string;
    action: Record<string, unknown>;
    enabled?: boolean;
  }) =>
    invoke<Routine>("save_routine", {
      id: args.id ?? null,
      name: args.name,
      schedule: args.schedule,
      actionKind: args.actionKind,
      action: args.action,
      enabled: args.enabled ?? true,
    }),
  setRoutineEnabled: (id: number, enabled: boolean) =>
    invoke<void>("set_routine_enabled", { id, enabled }),
  deleteRoutine: (id: number) => invoke<void>("delete_routine", { id }),
  runRoutine: (id: number) => invoke<RoutineRun>("run_routine", { id }),
  listRoutineRuns: (routineId?: number | null, limit?: number) =>
    invoke<RoutineRun[]>("list_routine_runs", { routineId: routineId ?? null, limit: limit ?? 50 }),

  listMeetings: (from: string, to: string) => invoke<Meeting[]>("list_meetings", { from, to }),
  createMeeting: (title: string, startedAt: string, endedAt: string, attendees?: string) =>
    invoke<Meeting>("create_meeting", { title, startedAt, endedAt, attendees: attendees ?? null }),
  updateMeeting: (args: {
    id: number;
    attendance?: string | null;
    clientId: number | null;
    projectId: number | null;
    attendees?: string | null;
  }) =>
    invoke<Meeting>("update_meeting", {
      id: args.id,
      attendance: args.attendance ?? null,
      clientId: args.clientId,
      projectId: args.projectId,
      attendees: args.attendees ?? null,
    }),
  attachMeetingTranscript: (id: number, transcript: string) =>
    invoke<Meeting>("attach_meeting_transcript", { id, transcript }),
  summarizeMeeting: (id: number) => invoke<Meeting>("summarize_meeting", { id }),
  logMeetingSession: (id: number) => invoke<Meeting>("log_meeting_session", { id }),
  deleteMeeting: (id: number) => invoke<void>("delete_meeting", { id }),

  focusOverview: (day: string) => invoke<FocusOverview>("focus_overview", { day }),

  capacityReport: (from: string, to: string) =>
    invoke<CapacityReport>("capacity_report", { from, to }),

  mentionSearch: (q: string) => invoke<MentionItem[]>("mention_search", { q }),
  mentionContext: (mentions: MentionItem[], period?: string) =>
    invoke<Record<string, unknown>>("mention_context", { mentions, period: period ?? null }),
  runAiChatWithContext: (args: {
    prompt: string;
    context: Record<string, unknown>;
    chatId?: number | null;
    model?: string | null;
    day?: string | null;
  }) =>
    invoke<AiRunResult>("run_ai_chat_with_context", {
      prompt: args.prompt,
      context: args.context,
      chatId: args.chatId ?? null,
      model: args.model ?? null,
      day: args.day ?? null,
    }),
};
