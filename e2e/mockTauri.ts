/**
 * In-memory Tauri IPC mock for Playwright (Vite UI without the Rust backend).
 * Injected via page.addInitScript before the app loads.
 */
export function mockTauriInitScript(): string {
  return `(() => {
  const flags = {
    focus_default_mins: "50",
    break_reminders: "0",
    break_every_mins: "45",
    break_length_mins: "5",
    break_snooze_mins: "5",
    break_max_mins: "30",
    break_fullscreen: "0",
    planned_auto_start: "0",
    urge_surfing: "0",
  };

  let focus = null;
  let sinceBreakSecs = 506; // 8:26
  let lastBreakAt = new Date(Date.now() - sinceBreakSecs * 1000)
    .toISOString()
    .slice(0, 19);
  let planned = [];
  let nextId = 1;

  function nowIso() {
    return new Date().toISOString().slice(0, 19);
  }

  function status() {
    return {
      name: "AutoTrace",
      version: "0.1.1",
      db_path: "/tmp/autotrace-e2e.db",
      schema_version: 13,
      tracker: {
        status: "running",
        platform: "linux",
        capture_ready: true,
        current_app: null,
        current_title: null,
        current_url: null,
        distraction_blocked: null,
        live_session_id: null,
      },
      network_enabled: false,
      settings: {
        idle_threshold_secs: 120,
        work_hours_enabled: false,
        work_hours_start: "09:00",
        work_hours_end: "17:00",
        launch_at_login: false,
        confirm_before_log: false,
        focus_goal_mins: 50,
        calendar_enabled: true,
        track_titles: true,
        url_mode: "domain",
        schedule_json: "[]",
      },
    };
  }

  function digest(day) {
    return {
      day,
      focus_minutes: 0,
      meeting_minutes: 0,
      break_minutes: 0,
      other_minutes: 0,
      deep_work_minutes: 0,
      context_switches: 0,
    };
  }

  async function invoke(cmd, args = {}) {
    switch (cmd) {
      case "get_app_status":
        return status();
      case "get_active_focus":
        return focus;
      case "get_time_since_last_break":
        return { secs: sinceBreakSecs, last_break_at: lastBreakAt };
      case "get_feature_flag":
        return flags[args.key] ?? null;
      case "set_feature_flag":
        flags[args.key] = String(args.value);
        return null;
      case "list_workspaces":
        return [{ id: 1, name: "Personal", icon: null, is_active: true, settings_json: "{}" }];
      case "list_sessions_for_day":
        return [];
      case "get_hierarchy":
        return { clients: [] };
      case "get_focus_digest":
        return digest(args.day);
      case "list_planned_for_day":
        return planned.filter((p) => p.started_at.startsWith(String(args.day).slice(0, 10)));
      case "list_calendar_events":
        return [];
      case "next_due_planned":
        return null;
      case "maybe_auto_detect_sessions":
        return null;
      case "list_pending_sessions":
        return [];
      case "vault_status":
        return { vault_exists: false, db_encryption: null };
      case "start_focus": {
        const kind = (args.kind || "focus").toLowerCase();
        const mins = args.durationMins ?? (kind === "break" ? 5 : 50);
        focus = {
          id: nextId++,
          goal: args.goal,
          client_id: args.clientId ?? null,
          project_id: args.projectId ?? null,
          task_id: args.taskId ?? null,
          client_name: null,
          project_name: null,
          task_name: null,
          started_at: nowIso(),
          ended_at: null,
          status: "active",
          elapsed_secs: 0,
          kind,
          planned_secs: mins ? mins * 60 : null,
          category_override: args.categoryOverride ?? null,
        };
        return focus;
      }
      case "pause_focus":
        if (focus && focus.status === "active") focus = { ...focus, status: "paused" };
        return focus;
      case "resume_focus":
        if (focus && focus.status === "paused") focus = { ...focus, status: "active" };
        return focus;
      case "end_focus": {
        const ended = focus ? { ...focus, status: "ended", ended_at: nowIso() } : null;
        if (ended && ended.kind === "break") {
          sinceBreakSecs = 0;
          lastBreakAt = nowIso();
        }
        focus = null;
        return ended;
      }
      case "extend_focus":
        if (!focus) return null;
        {
          const extra = Math.max(60, (args.extraMins ?? 5) * 60);
          const base = focus.planned_secs ?? Math.max(0, focus.elapsed_secs);
          focus = { ...focus, planned_secs: base + extra };
        }
        return focus;
      case "mark_break_ended":
        lastBreakAt = args.at || nowIso();
        sinceBreakSecs = 0;
        return null;
      case "plan_pomodoro": {
        planned = [
          {
            id: nextId++,
            kind: "focus",
            title: "Focus Session",
            started_at: args.startAt || (args.day + "T10:00:00"),
            ended_at: args.day + "T10:25:00",
            duration_secs: 25 * 60,
            status: "planned",
            goal: null,
            client_id: null,
            project_id: null,
            task_id: null,
          },
        ];
        return planned;
      }
      case "clear_planned_for_day":
        planned = [];
        return 0;
      case "pause_tracking":
      case "resume_tracking":
        return null;
      default: {
        // Prefer empty collections so list UIs do not crash on .map.
        if (
          cmd.startsWith("list_") ||
          cmd.endsWith("_for_day") ||
          cmd.includes("report") ||
          cmd.includes("breakdown")
        ) {
          return [];
        }
        console.warn("[e2e mock] unhandled command", cmd, args);
        return null;
      }
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback, _once) {
      const cbId = nextId++;
      window["_" + cbId] = callback;
      return cbId;
    },
    unregisterCallback() {},
    convertFileSrc(path) {
      return path;
    },
  };
  window.__AUTOTRACE_E2E__ = { getFocus: () => focus, getSince: () => sinceBreakSecs };
})();`;
}
