import { invoke } from "@tauri-apps/api/core";

export type TrackerInfo = {
  status: "idle" | "running" | "paused";
  platform: string;
  capture_ready: boolean;
  current_app: string | null;
  current_title: string | null;
  current_url?: string | null;
  distraction_blocked?: string | null;
  live_session_id: number | null;
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
  category: string | null;
  billable: boolean;
};

export const SESSION_CATEGORIES = [
  "Focus",
  "Code",
  "Meeting",
  "Break",
  "Other",
] as const;

export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

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
  hourly_rate: number | null;
  budget_hours: number | null;
  tasks: Task[];
};

export type ClientNode = {
  id: number;
  name: string;
  color: string | null;
  hourly_rate: number | null;
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
    category?: string | null;
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
      category: payload.category ?? null,
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
  listActivityEventsInRange: (
    startedAt: string,
    endedAt: string,
    limit?: number,
  ) =>
    invoke<ActivityEvent[]>("list_activity_events_in_range", {
      startedAt,
      endedAt,
      limit: limit ?? 500,
    }),
  deleteActivityEvent: (id: number) =>
    invoke<void>("delete_activity_event", { id }),
  activityAppBreakdown: (day: string) =>
    invoke<AppUsageBucket[]>("activity_app_breakdown", { day }),
  redactActivityMetadata: () => invoke<number>("redact_activity_metadata"),

  setClientRate: (clientId: number, hourlyRate: number | null) =>
    invoke<void>("set_client_rate", { clientId, hourlyRate }),
  setProjectRate: (
    projectId: number,
    hourlyRate: number | null,
    budgetHours: number | null,
  ) =>
    invoke<void>("set_project_rate", {
      projectId,
      hourlyRate,
      budgetHours,
    }),
  setSessionBillable: (sessionId: number, billable: boolean) =>
    invoke<void>("set_session_billable", { sessionId, billable }),
  getProfitabilityReport: (fromDay: string, toDay: string) =>
    invoke<ProfitabilityReport>("get_profitability_report", { fromDay, toDay }),
  exportClientPdfHtml: (clientId: number, fromDay: string, toDay: string) =>
    invoke<string>("export_client_pdf_html", { clientId, fromDay, toDay }),
  exportClientPdf: (clientId: number, fromDay: string, toDay: string) =>
    invoke<number[]>("export_client_pdf", { clientId, fromDay, toDay }),
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  createWorkspace: (name: string) => invoke<Workspace>("create_workspace", { name }),
  updateWorkspace: (id: number, name: string, icon: string, settingsJson: string) =>
    invoke<Workspace>("update_workspace", { id, name, icon, settingsJson }),
  setActiveWorkspace: (id: number) => invoke<void>("set_active_workspace", { id }),
  setWorkspaceSync: (
    id: number,
    syncUrl: string | null,
    syncToken: string | null,
  ) =>
    invoke<void>("set_workspace_sync", { id, syncUrl, syncToken }),
  exportSyncPack: () => invoke<string>("export_sync_pack"),
  pushSyncPack: (workspaceId: number) =>
    invoke<string>("push_sync_pack", { workspaceId }),
  pullSyncPack: (workspaceId: number) =>
    invoke<number>("pull_sync_pack", { workspaceId }),
  importSyncPack: (json: string) => invoke<number>("import_sync_pack", { json }),
  listBlockRules: () => invoke<BlockRule[]>("list_block_rules"),
  createBlockRule: (pattern: string, matchField: string, mode: string) =>
    invoke<BlockRule>("create_block_rule", { pattern, matchField, mode }),
  deleteBlockRule: (id: number) => invoke<void>("delete_block_rule", { id }),
  setFeatureFlag: (key: string, value: string) =>
    invoke<void>("set_feature_flag", { key, value }),
  getFeatureFlag: (key: string) =>
    invoke<string | null>("get_feature_flag", { key }),
  lockDatabase: (passphrase: string) =>
    invoke<void>("lock_database", { passphrase }),
  unlockDatabase: (passphrase: string) =>
    invoke<void>("unlock_database", { passphrase }),
  vaultStatus: () =>
    invoke<{ vault_exists: boolean; db_encryption: string | null }>("vault_status"),
  oauthAuthorizeUrl: (provider: string, clientId: string, redirectUri: string) =>
    invoke<string>("oauth_authorize_url", { provider, clientId, redirectUri }),
  oauthExchangeCode: (payload: {
    provider: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  }) => invoke<string>("oauth_exchange_code", payload),
  syncGoogleCalendar: (day: string) =>
    invoke<number>("sync_google_calendar", { day }),
  syncOutlookCalendar: (day: string) =>
    invoke<number>("sync_outlook_calendar", { day }),
  pauseFocus: () => invoke<FocusSession | null>("pause_focus"),
  resumeFocus: () => invoke<FocusSession | null>("resume_focus"),
  listPrivacyAudit: (limit?: number) =>
    invoke<PrivacyAuditRow[]>("list_privacy_audit", { limit: limit ?? 100 }),
  distractionReport: (day: string) =>
    invoke<DistractionReport>("distraction_report", { day }),
  openExternalUrl: (url: string) => invoke<void>("open_external_url", { url }),
  macosAccessibilityHint: () => invoke<string>("macos_accessibility_hint"),

  listAiProviders: () => invoke<AiProvider[]>("list_ai_providers"),
  upsertAiProvider: (payload: {
    id?: number | null;
    kind: string;
    label: string;
    baseUrl?: string | null;
    apiKey?: string | null;
    enabled: boolean;
    isDefault: boolean;
    allowedModels: string[];
    maxTokensPerRequest: number;
    temperatureCap: number;
  }) =>
    invoke<AiProvider>("upsert_ai_provider", {
      id: payload.id ?? null,
      kind: payload.kind,
      label: payload.label,
      baseUrl: payload.baseUrl ?? null,
      apiKey: payload.apiKey ?? null,
      enabled: payload.enabled,
      isDefault: payload.isDefault,
      allowedModels: payload.allowedModels,
      maxTokensPerRequest: payload.maxTokensPerRequest,
      temperatureCap: payload.temperatureCap,
    }),
  deleteAiProvider: (id: number) => invoke<void>("delete_ai_provider", { id }),
  testAiProvider: (providerId: number) =>
    invoke<AiRunResult>("test_ai_provider", { providerId }),
  listAiBudgets: () => invoke<AiBudget[]>("list_ai_budgets"),
  setAiBudget: (payload: {
    period: string;
    tokenLimit: number;
    requestLimit: number;
    costUsdLimit?: number | null;
    warnAtPct: number;
  }) =>
    invoke<AiBudget>("set_ai_budget", {
      period: payload.period,
      tokenLimit: payload.tokenLimit,
      requestLimit: payload.requestLimit,
      costUsdLimit: payload.costUsdLimit ?? null,
      warnAtPct: payload.warnAtPct,
    }),
  getAiUsageSummary: () => invoke<AiUsageSummary>("get_ai_usage_summary"),
  listAiTemplates: () => invoke<AiTemplate[]>("list_ai_templates"),
  listAiChats: () => invoke<AiChat[]>("list_ai_chats"),
  createAiChat: (title: string) => invoke<AiChat>("create_ai_chat", { title }),
  listAiMessages: (chatId: number) =>
    invoke<AiMessage[]>("list_ai_messages", { chatId }),
  runAiAgent: (payload: {
    agent: string;
    prompt: string;
    system?: string | null;
    model?: string | null;
    chatId?: number | null;
    templateSlug?: string | null;
    variables?: Record<string, unknown> | null;
    day?: string | null;
  }) =>
    invoke<AiRunResult>("run_ai_agent", {
      agent: payload.agent,
      prompt: payload.prompt,
      system: payload.system ?? null,
      model: payload.model ?? null,
      chatId: payload.chatId ?? null,
      templateSlug: payload.templateSlug ?? null,
      variables: payload.variables ?? null,
      day: payload.day ?? null,
    }),
  aiSidecarStatus: () =>
    invoke<{ url: string; healthy: boolean; ai_enabled: boolean }>(
      "ai_sidecar_status",
    ),
};

export type AiProvider = {
  id: number;
  kind: string;
  label: string;
  base_url: string | null;
  has_api_key: boolean;
  enabled: boolean;
  is_default: boolean;
  allowed_models: string[];
  max_tokens_per_request: number;
  temperature_cap: number;
};

export type AiBudget = {
  id: number;
  period: string;
  token_limit: number;
  request_limit: number;
  cost_usd_limit: number | null;
  warn_at_pct: number;
};

export type AiUsageSummary = {
  day_tokens: number;
  day_requests: number;
  month_tokens: number;
  month_requests: number;
  day_budget: AiBudget | null;
  month_budget: AiBudget | null;
  warn: boolean;
  blocked: boolean;
  recent: {
    id: number;
    provider_id: number | null;
    model: string;
    agent: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number | null;
    status: string;
    created_at: string;
  }[];
};

export type AiTemplate = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  agent: string;
  system_prompt: string;
  user_prompt_template: string;
  output_schema_json: string | null;
  version: number;
};

export type AiChat = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AiMessage = {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  created_at: string;
};

export type AiRunResult = {
  text: string;
  model: string;
  agent: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  warning: string | null;
};

export type ProfitabilityReport = {
  from_day: string;
  to_day: string;
  tracked_minutes: number;
  billable_minutes: number;
  capacity_minutes: number;
  utilization_pct: number;
  revenue: number;
  by_client: {
    key: string;
    label: string;
    minutes: number;
    billable_minutes: number;
    rate: number;
    revenue: number;
  }[];
  by_project: {
    key: string;
    label: string;
    minutes: number;
    billable_minutes: number;
    rate: number;
    revenue: number;
  }[];
};

export type Workspace = {
  id: number;
  name: string;
  role: string;
  sync_url: string | null;
  is_active: boolean;
  icon?: string;
  settings_json?: string;
};

export type WorkspaceFeatures = {
  profitability: boolean;
  invoicing: boolean;
  billable_hours: boolean;
  tasks: boolean;
  projects: boolean;
  clients: boolean;
  client_tagging: boolean;
  labels: boolean;
  team_creation_admin_only: boolean;
};

export type WorkspaceInvoicing = {
  company_name: string;
  company_address: string;
  payment_instructions: string;
  default_payment_terms: string;
};

export type WorkspaceSettings = {
  features: WorkspaceFeatures;
  invoicing: WorkspaceInvoicing;
  logo_data_url: string | null;
};

export function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    features: {
      profitability: true,
      invoicing: true,
      billable_hours: true,
      tasks: true,
      projects: true,
      clients: true,
      client_tagging: true,
      labels: true,
      team_creation_admin_only: false,
    },
    invoicing: {
      company_name: "",
      company_address: "",
      payment_instructions: "",
      default_payment_terms: "Net 30",
    },
    logo_data_url: null,
  };
}

export function parseWorkspaceSettings(json?: string | null): WorkspaceSettings {
  const base = defaultWorkspaceSettings();
  if (!json || json === "{}") return base;
  try {
    const v = JSON.parse(json) as Partial<WorkspaceSettings>;
    return {
      features: { ...base.features, ...(v.features ?? {}) },
      invoicing: { ...base.invoicing, ...(v.invoicing ?? {}) },
      logo_data_url: v.logo_data_url ?? null,
    };
  } catch {
    return base;
  }
}

export type BlockRule = {
  id: number;
  pattern: string;
  match_field: string;
  mode: string;
  enabled: boolean;
};

export type PrivacyAuditRow = {
  id: number;
  kind: string;
  detail: string | null;
  created_at: string;
};

export type DistractionReport = {
  day: string;
  context_switches: number;
  blocked_event_hits: number;
  focus_score: number;
  top_distractions: { key: string; label: string; minutes: number; sessions: number }[];
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
