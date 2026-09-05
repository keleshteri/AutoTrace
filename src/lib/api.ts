import { invoke } from "@tauri-apps/api/core";

export type TrackerInfo = {
  status: "idle" | "running" | "paused";
  platform: string;
  capture_ready: boolean;
  current_app: string | null;
  current_title: string | null;
};

export type TrackerSettings = {
  idle_threshold_secs: number;
  work_hours_enabled: boolean;
  work_hours_start: string;
  work_hours_end: string;
  launch_at_login: boolean;
  confirm_before_log: boolean;
  focus_goal_mins: number;
  calendar_enabled: boolean;
  track_titles: boolean;
  url_mode: "full" | "domain" | "off" | string;
  schedule_json: string;
};

export type AppStatus = {
  name: string;
  version: string;
  db_path: string;
  schema_version: number;
  tracker: TrackerInfo;
  network_enabled: boolean;
  settings: TrackerSettings;
};

export type SessionRow = {
  id: number;
  app_id: number | null;
  app_name: string | null;
  title: string | null;
  url: string | null;
  started_at: string;
  ended_at: string | null;
  idle: boolean;
  client_id: number | null;
  project_id: number | null;
  task_id: number | null;
  client_name: string | null;
  project_name: string | null;
  task_name: string | null;
  approved: boolean;
  manual: boolean;
  notes: string | null;
  confidence: number | null;
  pending: boolean;
};

export type Task = {
  id: number;
  project_id: number;
  name: string;
  archived: boolean;
};

export type ProjectNode = {
  id: number;
  name: string;
  color: string | null;
  tasks: Task[];
};

export type ClientNode = {
  id: number;
  name: string;
  color: string | null;
  projects: ProjectNode[];
};

export type Hierarchy = {
  clients: ClientNode[];
};

export type Rule = {
  id: number;
  name: string;
  pattern: string;
  match_field: string;
  client_id: number | null;
  project_id: number | null;
  task_id: number | null;
  priority: number;
  enabled: boolean;
  action: string;
};

export type AppRow = {
  id: number;
  name: string;
  executable: string | null;
  excluded: boolean;
};

export type ReportBucket = {
  key: string;
  label: string;
  minutes: number;
  sessions: number;
};

export type DayReport = {
  by_project: ReportBucket[];
  by_app: ReportBucket[];
  by_client: ReportBucket[];
  total_minutes: number;
  idle_minutes: number;
};

export type FocusDigest = {
  day: string;
  focus_minutes: number;
  meeting_minutes: number;
  idle_minutes: number;
  focus_score: number;
  goal_minutes: number;
  goal_pct: number;
  top_projects: ReportBucket[];
};

export type WeeklyDigest = {
  week_start: string;
  days: FocusDigest[];
  total_focus_minutes: number;
  avg_focus_score: number;
};

export type CalendarEvent = {
  id: number;
  title: string;
  started_at: string;
  ended_at: string;
  source: string;
};

export type IntegrationRow = {
  id: number;
  kind: string;
  enabled: boolean;
  config_json: string;
  created_at: string;
  updated_at: string;
};

export type ExportEntry = {
  session_id: number;
  started_at: string;
  ended_at: string | null;
  duration_mins: number;
  client_id: number | null;
  project_id: number | null;
  task_id: number | null;
  client_name: string | null;
  project_name: string | null;
  task_name: string | null;
  notes: string | null;
  description: string;
};

export type SyncLogRow = {
  id: number;
  integration_id: number;
  session_id: number;
  remote_id: string | null;
  status: string;
  detail: string | null;
  synced_at: string;
};

export type PushBatchResult = {
  integration_kind: string;
  results: {
    session_id: number;
    ok: boolean;
    remote_id: string | null;
    detail: string;
  }[];
};

export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatTime(iso: string): string {
  const t = iso.includes("T") ? iso.split("T")[1] : iso;
  return t.slice(0, 5);
}

export function durationLabel(start: string, end: string | null): string {
  const a = Date.parse(start.includes("T") ? start : start.replace(" ", "T"));
  const b = Date.parse(
    (end ?? start).includes("T") ? (end ?? start) : (end ?? start).replace(" ", "T"),
  );
  if (Number.isNaN(a) || Number.isNaN(b)) return "—";
  const mins = Math.max(0, Math.round((b - a) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function downloadText(filename: string, content: string, mime = "text/csv") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  getAppStatus: () => invoke<AppStatus>("get_app_status"),
  pauseTracking: () => invoke<void>("pause_tracking"),
  resumeTracking: () => invoke<void>("resume_tracking"),
  listSessionsForDay: (day: string) =>
    invoke<SessionRow[]>("list_sessions_for_day", { day }),
  getHierarchy: () => invoke<Hierarchy>("get_hierarchy"),
  createClient: (name: string, color?: string) =>
    invoke("create_client", { name, color: color ?? null }),
  createProject: (clientId: number, name: string, color?: string) =>
    invoke("create_project", {
      clientId,
      name,
      color: color ?? null,
    }),
  createTask: (projectId: number, name: string) =>
    invoke("create_task", { projectId, name }),
  tagSession: (
    sessionId: number,
    clientId: number | null,
    projectId: number | null,
    taskId: number | null,
  ) =>
    invoke<void>("tag_session", {
      sessionId,
      clientId,
      projectId,
      taskId,
    }),
  listRules: () => invoke<Rule[]>("list_rules"),
  createRule: (payload: {
    name: string;
    pattern: string;
    matchField: string;
    clientId: number | null;
    projectId: number | null;
    taskId: number | null;
    priority: number;
    action?: string;
  }) =>
    invoke<Rule>("create_rule", {
      name: payload.name,
      pattern: payload.pattern,
      matchField: payload.matchField,
      clientId: payload.clientId,
      projectId: payload.projectId,
      taskId: payload.taskId,
      priority: payload.priority,
      action: payload.action ?? "tag",
    }),
  deleteRule: (id: number) => invoke<void>("delete_rule", { id }),
  setRuleEnabled: (id: number, enabled: boolean) =>
    invoke<void>("set_rule_enabled", { id, enabled }),
  listApps: () => invoke<AppRow[]>("list_apps"),
  setAppExcluded: (appId: number, excluded: boolean) =>
    invoke<void>("set_app_excluded", { appId, excluded }),
  getTrackerSettings: () => invoke<TrackerSettings>("get_tracker_settings"),
  updateTrackerSettings: (settings: TrackerSettings) =>
    invoke<void>("update_tracker_settings", { settings }),
  deleteSessionsRange: (start: string, end: string) =>
    invoke<number>("delete_sessions_range", { start, end }),
  createManualSession: (payload: {
    title: string;
    startedAt: string;
    endedAt: string;
    clientId: number | null;
    projectId: number | null;
    taskId: number | null;
    notes?: string;
  }) =>
    invoke<number>("create_manual_session", {
      title: payload.title,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      clientId: payload.clientId,
      projectId: payload.projectId,
      taskId: payload.taskId,
      notes: payload.notes ?? null,
    }),
  approveSession: (sessionId: number, approved: boolean) =>
    invoke<void>("approve_session", { sessionId, approved }),
  updateSession: (payload: {
    sessionId: number;
    title: string | null;
    startedAt: string;
    endedAt: string | null;
    notes: string | null;
    clientId: number | null;
    projectId: number | null;
    taskId: number | null;
  }) =>
    invoke<void>("update_session", {
      sessionId: payload.sessionId,
      title: payload.title,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      notes: payload.notes,
      clientId: payload.clientId,
      projectId: payload.projectId,
      taskId: payload.taskId,
    }),
  deleteSession: (sessionId: number) =>
    invoke<void>("delete_session", { sessionId }),
  mergeSessions: (ids: number[]) => invoke<number>("merge_sessions", { ids }),
  splitSession: (sessionId: number, at: string) =>
    invoke<number>("split_session", { sessionId, at }),
  getDayReport: (day: string) => invoke<DayReport>("get_day_report", { day }),
  exportCsvForDay: (day: string) =>
    invoke<string>("export_csv_for_day", { day }),
  listPendingSessions: () => invoke<SessionRow[]>("list_pending_sessions"),
  rejectPendingSession: (sessionId: number) =>
    invoke<void>("reject_pending_session", { sessionId }),
  getFocusDigest: (day: string) =>
    invoke<FocusDigest>("get_focus_digest", { day }),
  getWeeklyDigest: (weekStart: string) =>
    invoke<WeeklyDigest>("get_weekly_digest", { weekStart }),
  listCalendarEvents: (day: string) =>
    invoke<CalendarEvent[]>("list_calendar_events", { day }),
  importIcs: (ics: string) => invoke<number>("import_ics", { ics }),
  suggestFromCalendar: (day: string) =>
    invoke<number>("suggest_from_calendar", { day }),
  listIntegrations: () => invoke<IntegrationRow[]>("list_integrations"),
  updateIntegration: (kind: string, enabled: boolean, configJson: string) =>
    invoke<IntegrationRow>("update_integration", {
      kind,
      enabled,
      configJson,
    }),
  disconnectIntegration: (kind: string) =>
    invoke<void>("disconnect_integration", { kind }),
  listEligibleExports: (integrationKind?: string) =>
    invoke<ExportEntry[]>("list_eligible_exports", {
      integrationKind: integrationKind ?? null,
    }),
  pushIntegration: (kind: string, sessionIds?: number[]) =>
    invoke<PushBatchResult>("push_integration", {
      kind,
      sessionIds: sessionIds ?? null,
    }),
  listSyncLog: (kind?: string) =>
    invoke<SyncLogRow[]>("list_sync_log", { kind: kind ?? null }),
  setIntegrationMapping: (
    kind: string,
    localType: string,
    localId: number,
    remoteId: string,
  ) =>
    invoke<void>("set_integration_mapping", {
      kind,
      localType,
      localId,
      remoteId,
    }),
  localApiStatus: () => invoke<string>("local_api_status"),
  getActiveFocus: () => invoke<FocusSession | null>("get_active_focus"),
  startFocus: (payload?: {
    goal?: string;
    clientId?: number | null;
    projectId?: number | null;
    taskId?: number | null;
  }) =>
    invoke<FocusSession>("start_focus", {
      goal: payload?.goal ?? null,
      clientId: payload?.clientId ?? null,
      projectId: payload?.projectId ?? null,
      taskId: payload?.taskId ?? null,
    }),
  endFocus: () => invoke<FocusSession | null>("end_focus"),
  listFocusForDay: (day: string) =>
    invoke<FocusSession[]>("list_focus_for_day", { day }),
  listActivityEvents: (day: string, query?: string, limit?: number) =>
    invoke<ActivityEvent[]>("list_activity_events", {
      day,
      query: query ?? null,
      limit: limit ?? 500,
    }),
  deleteActivityEvent: (id: number) =>
    invoke<void>("delete_activity_event", { id }),
  activityAppBreakdown: (day: string) =>
    invoke<AppUsageBucket[]>("activity_app_breakdown", { day }),
  redactActivityMetadata: () => invoke<number>("redact_activity_metadata"),
};

export type FocusSession = {
  id: number;
  goal: string | null;
  client_id: number | null;
  project_id: number | null;
  task_id: number | null;
  client_name: string | null;
  project_name: string | null;
  task_name: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  elapsed_secs: number;
};

export type ActivityEvent = {
  id: number;
  app_name: string;
  title: string | null;
  url: string | null;
  recorded_at: string;
};

export type AppUsageBucket = {
  key: string;
  label: string;
  minutes: number;
  events: number;
};

export function formatElapsed(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}
