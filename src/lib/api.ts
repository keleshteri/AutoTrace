import { invoke } from "@tauri-apps/api/core";

export type TrackerInfo = {
  status: "idle" | "running" | "paused";
  platform: string;
  capture_ready: boolean;
  current_app: string | null;
  current_title: string | null;
};

export type AppStatus = {
  name: string;
  version: string;
  db_path: string;
  schema_version: number;
  tracker: TrackerInfo;
  network_enabled: boolean;
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
};
