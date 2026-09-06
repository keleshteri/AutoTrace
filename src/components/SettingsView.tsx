import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  AppRow,
  AppStatus,
  CalendarEvent,
  TrackerSettings,
  formatTime,
  todayLocal,
} from "../lib/api";
import { UpdatePanel } from "./UpdatePanel";

type Props = {
  status: AppStatus | null;
  onPause: () => void;
  onResume: () => void;
  onRefreshStatus: () => void;
  onError: (msg: string | null) => void;
  onOpenWorkspaceSettings?: () => void;
};

const WEEKDAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;

type DaySched = { enabled: boolean; start: string; end: string };

function defaultSchedule(): Record<string, DaySched> {
  const out: Record<string, DaySched> = {};
  for (const [k] of WEEKDAYS) {
    out[k] = {
      enabled: k !== "sat" && k !== "sun",
      start: "09:00",
      end: "18:00",
    };
  }
  return out;
}

function parseSchedule(json: string): Record<string, DaySched> | null {
  if (!json.trim()) return null;
  try {
    const v = JSON.parse(json) as Record<string, DaySched>;
    if (!v || typeof v !== "object") return null;
    return { ...defaultSchedule(), ...v };
  } catch {
    return null;
  }
}

function ScheduleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const parsed = parseSchedule(value);
  const enabled = parsed != null;
  const schedule = parsed ?? defaultSchedule();

  return (
    <div style={{ marginTop: 8 }}>
      <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(e.target.checked ? JSON.stringify(defaultSchedule()) : "")
          }
        />
        Per-weekday tracking schedule (overrides simple work hours when set)
      </label>
      {enabled && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {WEEKDAYS.map(([key, label]) => {
            const day = schedule[key];
            return (
              <div
                key={key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px auto 1fr 1fr",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => {
                    const next = {
                      ...schedule,
                      [key]: { ...day, enabled: e.target.checked },
                    };
                    onChange(JSON.stringify(next));
                  }}
                />
                <input
                  type="time"
                  value={day.start}
                  disabled={!day.enabled}
                  onChange={(e) => {
                    const next = {
                      ...schedule,
                      [key]: { ...day, start: e.target.value },
                    };
                    onChange(JSON.stringify(next));
                  }}
                />
                <input
                  type="time"
                  value={day.end}
                  disabled={!day.enabled}
                  onChange={(e) => {
                    const next = {
                      ...schedule,
                      [key]: { ...day, end: e.target.value },
                    };
                    onChange(JSON.stringify(next));
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CalendarImportCard({
  day,
  onError,
}: {
  day: string;
  onError: (msg: string | null) => void;
}) {
  const [ics, setIcs] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEvents(await api.listCalendarEvents(day));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [day, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function importIcs() {
    if (!ics.trim()) return;
    try {
      const n = await api.importIcs(ics);
      setMsg(`Imported ${n} event(s).`);
      setIcs("");
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function suggest() {
    try {
      const n = await api.suggestFromCalendar(day);
      setMsg(`Created ${n} suggested session(s) for ${day}.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <p className="kicker">Calendar (ICS)</p>
      <p className="muted">
        Paste an .ics export. Events stay local. Suggest turns today&apos;s events
        into sessions on the timeline.
      </p>
      <textarea
        value={ics}
        onChange={(e) => setIcs(e.target.value)}
        rows={5}
        placeholder="BEGIN:VCALENDAR…"
        style={{ width: "100%", marginTop: 10, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => void importIcs()}>
          Import ICS
        </button>
        <button type="button" className="btn" onClick={() => void suggest()}>
          Suggest sessions for today
        </button>
      </div>
      {msg && (
        <p className="muted" style={{ marginTop: 8 }}>
          {msg}
        </p>
      )}
      <ul className="tree" style={{ marginTop: 10 }}>
        {events.map((ev) => (
          <li key={ev.id}>
            {ev.title}{" "}
            <span className="muted">
              {formatTime(ev.started_at)}–{formatTime(ev.ended_at)} · {ev.source}
            </span>
          </li>
        ))}
        {events.length === 0 && (
          <li className="muted">No calendar events overlapping today.</li>
        )}
      </ul>
    </div>
  );
}

type SettingsSection =
  | "account"
  | "notifications"
  | "billing"
  | "usage"
  | "privacy"
  | "theme"
  | "coach"
  | "focus"
  | "blocker"
  | "activity"
  | "breaks"
  | "meetings"
  | "time_entries"
  | "labels"
  | "rules"
  | "agent"
  | "ws_settings"
  | "members"
  | "planning"
  | "teams"
  | "calendars"
  | "integrations"
  | "api"
  | "export"
  | "mcp";

const SETTINGS_NAV: { section: string; items: { id: SettingsSection; label: string }[] }[] = [
  {
    section: "Account",
    items: [
      { id: "account", label: "Account" },
      { id: "notifications", label: "Notifications" },
      { id: "billing", label: "Billing" },
      { id: "usage", label: "Usage & Credits" },
      { id: "privacy", label: "Privacy" },
      { id: "theme", label: "Theme" },
    ],
  },
  {
    section: "Productivity",
    items: [
      { id: "coach", label: "Coach" },
      { id: "focus", label: "Focus" },
      { id: "blocker", label: "Distraction Blocker" },
    ],
  },
  {
    section: "Tracking",
    items: [
      { id: "activity", label: "Activity" },
      { id: "breaks", label: "Breaks" },
      { id: "meetings", label: "Meetings" },
      { id: "time_entries", label: "Time Entries" },
    ],
  },
  {
    section: "Automation",
    items: [
      { id: "labels", label: "Labels" },
      { id: "rules", label: "App & Website Rules" },
      { id: "agent", label: "Agent" },
    ],
  },
  {
    section: "Workspace",
    items: [
      { id: "ws_settings", label: "Settings" },
      { id: "members", label: "Members" },
      { id: "planning", label: "Planning" },
      { id: "teams", label: "Teams" },
    ],
  },
  {
    section: "Connections & Data",
    items: [
      { id: "calendars", label: "Calendars" },
      { id: "integrations", label: "Integrations" },
      { id: "api", label: "API" },
      { id: "export", label: "Data Export" },
      { id: "mcp", label: "MCP" },
    ],
  },
];

function SettingsShell({
  title,
  blurb,
  rows,
}: {
  title: string;
  blurb: string;
  rows?: { label: string; value: string; hint?: string }[];
}) {
  return (
    <div className="settings-shell-card">
      <h2>{title}</h2>
      <p className="muted">{blurb}</p>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        UI shell — not connected to cloud accounts. AutoTrace stays local-first.
      </p>
      <div style={{ marginTop: 18 }}>
        {(rows ?? [
          { label: "Status", value: "Coming soon", hint: "Placeholder for Rory-parity layout" },
        ]).map((r) => (
          <div key={r.label} className="settings-shell-row">
            <div>
              <div>{r.label}</div>
              {r.hint && <div className="muted">{r.hint}</div>}
            </div>
            <button type="button" className="btn" disabled>
              {r.value}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsView({
  status,
  onPause,
  onResume,
  onRefreshStatus,
  onError,
  onOpenWorkspaceSettings,
}: Props) {
  const [section, setSection] = useState<SettingsSection>("privacy");
  const [settings, setSettings] = useState<TrackerSettings | null>(
    status?.settings ?? null,
  );
  const [apps, setApps] = useState<AppRow[]>([]);
  const [deleteFrom, setDeleteFrom] = useState(todayLocal());
  const [deleteTo, setDeleteTo] = useState(todayLocal());
  const [saved, setSaved] = useState(false);

  const refreshApps = useCallback(async () => {
    try {
      setApps(await api.listApps());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    if (status?.settings) setSettings(status.settings);
  }, [status]);

  useEffect(() => {
    void refreshApps();
  }, [refreshApps]);

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const payload = {
      ...settings,
      track_titles: settings.track_titles ?? true,
      url_mode: settings.url_mode || "full",
      schedule_json: settings.schedule_json ?? "",
    };
    await api.updateTrackerSettings(payload);
    setSaved(true);
    onRefreshStatus();
    window.setTimeout(() => setSaved(false), 1500);
  }

  async function redact() {
    const start = `${deleteFrom}T00:00:00`;
    const end = `${deleteTo}T23:59:59`;
    if (
      !window.confirm(
        `Permanently delete all sessions from ${deleteFrom} to ${deleteTo}?`,
      )
    ) {
      return;
    }
    const n = await api.deleteSessionsRange(start, end);
    window.alert(`Deleted ${n} session(s).`);
  }

  return (
    <div className="settings-hub">
      <aside className="settings-nav">
        <button type="button" className="settings-nav-back" disabled title="Use sidebar Settings">
          ← Back
        </button>
        {SETTINGS_NAV.map((group) => (
          <div key={group.section}>
            <div className="settings-nav-sec">{group.section}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`item${section === item.id ? " active" : ""}`}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="settings-pane">
        {section === "account" && (
          <>
            <UpdatePanel />
            <div style={{ height: 16 }} />
            <SettingsShell
              title="Account"
              blurb="Profile and sign-in options. AutoTrace has no cloud account — this layout matches Rory for familiarity."
              rows={[
                { label: "Display name", value: "Local user", hint: "Stored on this device only" },
                { label: "Email", value: "Not set", hint: "No cloud login" },
                { label: "Password", value: "N/A" },
              ]}
            />
          </>
        )}
        {section === "notifications" && (
          <SettingsShell
            title="Notifications"
            blurb="Desktop and in-app alerts."
            rows={[
              { label: "Break reminders", value: "See Breaks", hint: "Configured under Tracking → Breaks" },
              { label: "Session alerts", value: "Off" },
              { label: "Email digests", value: "Off", hint: "Cloud-only in Rory; unused here" },
            ]}
          />
        )}
        {section === "billing" && (
          <SettingsShell
            title="Billing"
            blurb="Subscription and invoices. AutoTrace is local software — no SaaS billing."
            rows={[
              { label: "Plan", value: "Local", hint: "No subscription required" },
              { label: "Payment method", value: "—" },
              { label: "Invoices", value: "—" },
            ]}
          />
        )}
        {section === "usage" && (
          <SettingsShell
            title="Usage & Credits"
            blurb="AI usage budgets live with your local providers (Agent settings)."
            rows={[
              { label: "AI credits", value: "Local budgets", hint: "Open Agent → Providers in the app" },
              { label: "API calls today", value: "See AI usage" },
            ]}
          />
        )}
        {section === "theme" && (
          <SettingsShell
            title="Theme"
            blurb="Appearance preferences."
            rows={[
              { label: "Color mode", value: "Dark", hint: "Dark is the default AutoTrace theme" },
              { label: "Accent", value: "Lavender" },
            ]}
          />
        )}
        {section === "coach" && (
          <SettingsShell
            title="Coach"
            blurb="Productivity coach nudges during Focus (break reminders)."
            rows={[
              {
                label: "Break coach popup",
                value: "With Breaks",
                hint: "Configure under Tracking → Breaks",
              },
            ]}
          />
        )}
        {section === "focus" && <FocusSettingsPanel onError={onError} />}
        {section === "labels" && (
          <SettingsShell
            title="Labels"
            blurb="Label prompts for tagging (shell). Use Projects / Clients for real labels today."
          />
        )}
        {section === "rules" && (
          <SettingsShell
            title="App & Website Rules"
            blurb="Mapping rules live under Rules in the main sidebar. Distraction block rules are under Distraction Blocker."
            rows={[{ label: "Open Rules", value: "Sidebar → Rules" }]}
          />
        )}
        {section === "agent" && (
          <SettingsShell
            title="Agent"
            blurb="Customize how the AutoTrace agent works. Use Home → Agent for Chat History, MCP, and Prompts."
            rows={[
              { label: "Prompts & skills", value: "Agent → Prompts" },
              { label: "Providers & limits", value: "Local AI settings" },
              { label: "Feature flag", value: "AI on/off in Agent top bar" },
            ]}
          />
        )}
        {section === "ws_settings" && (
          <div className="settings-shell-card">
            <h2>Workspace Settings</h2>
            <p className="muted">
              Name, features, invoicing, and logo live on the workspace — not in app Settings.
            </p>
            <button
              type="button"
              className="primary"
              style={{ marginTop: 16 }}
              onClick={() => onOpenWorkspaceSettings?.()}
            >
              Open Workspace Settings
            </button>
          </div>
        )}
        {section === "members" && (
          <SettingsShell title="Members" blurb="Team members (shell). Local-only installs have one user." />
        )}
        {section === "planning" && (
          <SettingsShell title="Planning" blurb="Planning preferences (shell)." />
        )}
        {section === "teams" && (
          <div className="settings-shell-card">
            <h2>Teams</h2>
            <p className="muted">
              Create and switch workspaces from the sidebar switcher or Your Teams. Sync packs stay
              under Admin → Teams.
            </p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 12 }}
              onClick={() => onOpenWorkspaceSettings?.()}
            >
              Workspace Settings
            </button>
          </div>
        )}
        {section === "integrations" && (
          <SettingsShell
            title="Integrations"
            blurb="Open Integrations in the main sidebar for real connectors."
            rows={[{ label: "Manage", value: "Sidebar → Integrations" }]}
          />
        )}
        {section === "api" && (
          <SettingsShell
            title="API"
            blurb="Local HTTP API for MCP and scripts. Enable under Integrations / Phase 4 extras below when on Privacy."
            rows={[
              { label: "Endpoint", value: "127.0.0.1:17890" },
              { label: "Auth", value: "Bearer token" },
            ]}
          />
        )}
        {section === "export" && (
          <SettingsShell
            title="Data Export"
            blurb="Export reports from Reports, or use PDF / CSV tools in the app."
            rows={[{ label: "Reports", value: "Sidebar → Reports" }]}
          />
        )}
        {section === "mcp" && (
          <SettingsShell
            title="MCP"
            blurb="Model Context Protocol — connect Claude, ChatGPT, or Cursor to local AutoTrace."
            rows={[
              { label: "URL", value: "http://127.0.0.1:17890/v1/mcp" },
              { label: "Setup", value: "Agent → MCP", hint: "Open the Agent view for the connect panel" },
            ]}
          />
        )}
        {section === "meetings" && (
          <SettingsShell
            title="Meetings"
            blurb="Meeting detection preferences (shell). Calendar events import under Calendars."
          />
        )}

        {(section === "privacy" ||
          section === "activity" ||
          section === "time_entries" ||
          section === "calendars" ||
          section === "breaks" ||
          section === "blocker") && (
          <div className="page" style={{ padding: 0 }}>
            <div className="page-head">
              <h2>
                {section === "privacy"
                  ? "Privacy"
                  : section === "activity"
                    ? "Activity"
                    : section === "time_entries"
                      ? "Time Entries"
                      : section === "calendars"
                        ? "Calendars"
                        : section === "breaks"
                          ? "Breaks"
                          : "Distraction Blocker"}
              </h2>
              {status && (section === "privacy" || section === "activity") && (
                <button
                  type="button"
                  className="btn"
                  onClick={status.tracker.status === "running" ? onPause : onResume}
                >
                  {status.tracker.status === "running"
                    ? "Pause tracking"
                    : "Resume tracking"}
                </button>
              )}
            </div>

            {(section === "privacy" ||
              section === "activity" ||
              section === "time_entries") && (
              <>
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="kicker">Privacy — what we track</p>
        <ul className="muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          <li>App name, window/document title, browser URL when available</li>
          <li>Timestamps and idle flags</li>
          <li>Stored only in local SQLite on this device</li>
        </ul>
        <p className="kicker" style={{ marginTop: 14 }}>
          What never exists
        </p>
        <ul className="muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          <li>No screenshots</li>
          <li>No keystroke logging</li>
          <li>No clipboard or webcam/mic capture</li>
          <li>No network sync unless you later enable an opt-in integration</li>
        </ul>
      </div>

      {settings && (
        <form className="card" style={{ marginBottom: 12 }} onSubmit={(e) => void saveSettings(e)}>
          <p className="kicker">Tracking preferences</p>
          <div className="forms" style={{ marginTop: 10 }}>
            <label className="muted">
              Idle threshold (seconds)
              <input
                type="number"
                min={60}
                max={3600}
                value={settings.idle_threshold_secs}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    idle_threshold_secs: Number(e.target.value) || 180,
                  })
                }
              />
            </label>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.work_hours_enabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    work_hours_enabled: e.target.checked,
                  })
                }
              />
              Only track during work hours
            </label>
            <div className="mini-form" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
              <label>
                Start
                <input
                  type="time"
                  value={settings.work_hours_start}
                  onChange={(e) =>
                    setSettings({ ...settings, work_hours_start: e.target.value })
                  }
                />
              </label>
              <label>
                End
                <input
                  type="time"
                  value={settings.work_hours_end}
                  onChange={(e) =>
                    setSettings({ ...settings, work_hours_end: e.target.value })
                  }
                />
              </label>
              <div />
            </div>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.launch_at_login}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    launch_at_login: e.target.checked,
                  })
                }
              />
              Launch at login
            </label>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.confirm_before_log}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    confirm_before_log: e.target.checked,
                  })
                }
              />
              Confirm before log (sessions stay pending until approved)
            </label>
            <label className="muted">
              Daily focus goal (minutes)
              <input
                type="number"
                min={30}
                max={1440}
                value={settings.focus_goal_mins}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    focus_goal_mins: Number(e.target.value) || 360,
                  })
                }
              />
            </label>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.calendar_enabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    calendar_enabled: e.target.checked,
                  })
                }
              />
              Calendar opt-in (ICS import → suggested sessions)
            </label>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.track_titles ?? true}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    track_titles: e.target.checked,
                  })
                }
              />
              Track window titles
            </label>
            <label className="muted">
              URL tracking
              <select
                value={settings.url_mode || "full"}
                onChange={(e) =>
                  setSettings({ ...settings, url_mode: e.target.value })
                }
              >
                <option value="full">Full URL</option>
                <option value="domain">Domain only</option>
                <option value="off">Off</option>
              </select>
            </label>
            <ScheduleEditor
              value={settings.schedule_json || ""}
              onChange={(schedule_json) =>
                setSettings({ ...settings, schedule_json })
              }
            />
            <button type="submit" className="btn">
              {saved ? "Saved" : "Save preferences"}
            </button>
          </div>
        </form>
      )}

      {settings?.calendar_enabled && (
        <CalendarImportCard day={todayLocal()} onError={onError} />
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="kicker">Excluded apps</p>
        <p className="muted">Excluded apps are ignored by the capture loop.</p>
        <ul className="tree" style={{ marginTop: 10 }}>
          {apps.map((a) => (
            <li
              key={a.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <span>{a.name}</span>
              <button
                type="button"
                className="btn"
                style={{
                  background: a.excluded ? "var(--danger)" : "var(--bg-hover)",
                }}
                onClick={() =>
                  void api
                    .setAppExcluded(a.id, !a.excluded)
                    .then(refreshApps)
                }
              >
                {a.excluded ? "Excluded" : "Exclude"}
              </button>
            </li>
          ))}
          {apps.length === 0 && (
            <li className="muted">No apps recorded yet — use the app for a bit.</li>
          )}
        </ul>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="kicker">Delete / redact a date range</p>
        <div className="mini-form" style={{ marginTop: 10 }}>
          <label>
            From
            <input
              type="date"
              value={deleteFrom}
              onChange={(e) => setDeleteFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={deleteTo}
              onChange={(e) => setDeleteTo(e.target.value)}
            />
          </label>
          <button type="button" className="btn" style={{ background: "#7f1d1d" }} onClick={() => void redact()}>
            Delete
          </button>
        </div>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() =>
            void api.redactActivityMetadata().then((n) => {
              window.alert(`Redacted titles/URLs on ${n} row(s). Higher-level time structure kept.`);
            })
          }
        >
          Redact tracked titles & URLs
        </button>
      </div>

      <div className="card">
        <p className="kicker">Local database</p>
        <p className="path" style={{ marginTop: 8 }}>
          {status?.db_path ?? "—"}
        </p>
        <p className="muted" style={{ marginTop: 10 }}>
          Version {status?.version ?? "—"} · schema v{status?.schema_version ?? "—"} ·{" "}
          {status?.tracker.platform ?? "—"} · network{" "}
          {status?.network_enabled ? "on" : "off"}
        </p>
      </div>

      {section === "privacy" && <Phase4Extras onError={onError} />}
              </>
            )}

            {section === "calendars" && (
              <CalendarImportCard day={todayLocal()} onError={onError} />
            )}

            {section === "breaks" && (
              <div className="card">
                <p className="kicker">Break reminders</p>
                <BreakReminders onError={onError} />
              </div>
            )}

            {section === "blocker" && <Phase4Extras onError={onError} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Phase4Extras({ onError }: { onError: (msg: string | null) => void }) {
  const [pass, setPass] = useState("");
  const [blockPat, setBlockPat] = useState("");
  const [rules, setRules] = useState<Awaited<ReturnType<typeof api.listBlockRules>>>([]);
  const [blockOn, setBlockOn] = useState(false);
  const [mlOn, setMlOn] = useState(true);
  const [vault, setVault] = useState<{ vault_exists: boolean } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRules(await api.listBlockRules());
        setBlockOn((await api.getFeatureFlag("distraction_block")) === "1");
        setMlOn((await api.getFeatureFlag("ml_tagging")) !== "0");
        setVault(await api.vaultStatus());
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [onError]);

  return (
    <>
      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">Distraction blocker</p>
        <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={blockOn}
            onChange={(e) => {
              const v = e.target.checked;
              setBlockOn(v);
              void api.setFeatureFlag("distraction_block", v ? "1" : "0");
            }}
          />
          Soft-block matching apps (skip tracking). Hard mode also logs to the privacy audit.
        </label>
        <div className="mini-form" style={{ marginTop: 10 }}>
          <input
            value={blockPat}
            onChange={(e) => setBlockPat(e.target.value)}
            placeholder="youtube / twitter / game"
          />
          <button
            type="button"
            className="btn"
            onClick={() =>
              void api
                .createBlockRule(blockPat.trim(), "app", "soft")
                .then(() => api.listBlockRules())
                .then(setRules)
                .then(() => setBlockPat(""))
            }
          >
            Add soft
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void api
                .createBlockRule(blockPat.trim(), "app", "hard")
                .then(() => api.listBlockRules())
                .then(setRules)
                .then(() => setBlockPat(""))
            }
          >
            Add hard
          </button>
        </div>
        <ul className="tree" style={{ marginTop: 8 }}>
          {rules.map((r) => (
            <li key={r.id}>
              {r.pattern} ({r.mode})
              <button
                type="button"
                className="btn"
                style={{ marginLeft: 8 }}
                onClick={() =>
                  void api.deleteBlockRule(r.id).then(() => api.listBlockRules()).then(setRules)
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">On-device tagging</p>
        <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={mlOn}
            onChange={(e) => {
              const v = e.target.checked;
              setMlOn(v);
              void api.setFeatureFlag("ml_tagging", v ? "1" : "0");
            }}
          />
          Local keyword model (no cloud AI)
        </label>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">Break reminders</p>
        <BreakReminders onError={onError} />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">macOS Accessibility</p>
        <MacOsHint />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">Database encryption (opt-in)</p>
        <p className="muted">
          Encrypts the SQLite file at rest (AES-256-GCM + Argon2). Locking removes the
          plaintext DB (+ WAL/SHM). Unlock before the next launch.
          {vault?.vault_exists ? " Vault file present." : ""}
        </p>
        <div className="mini-form" style={{ marginTop: 10 }}>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Passphrase (8+ chars)"
          />
          <button
            type="button"
            className="btn"
            onClick={() =>
              void api
                .lockDatabase(pass)
                .then(() =>
                  window.alert(
                    "Database encrypted at rest. Unlock with the same passphrase before relaunching.",
                  ),
                )
                .catch((e) => onError(String(e)))
            }
          >
            Lock / encrypt at rest
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void api
                .unlockDatabase(pass)
                .then(() => window.alert("Unlocked to DB path — relaunch if needed"))
                .catch((e) => onError(String(e)))
            }
          >
            Unlock
          </button>
        </div>
      </div>
    </>
  );
}

function FocusSettingsPanel({ onError }: { onError: (m: string | null) => void }) {
  const [defaultMins, setDefaultMins] = useState("50");
  const [autoBreak, setAutoBreak] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setDefaultMins((await api.getFeatureFlag("focus_default_mins")) || "50");
        setAutoBreak((await api.getFeatureFlag("break_reminders")) === "1");
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [onError]);

  return (
    <div className="settings-shell-card">
      <h2>Focus</h2>
      <p className="muted">
        Start Focus from the bottom status bar or Timer. Break coach pops up after sustained work.
      </p>
      <div className="settings-shell-row">
        <div>
          <div>Default focus length (min)</div>
          <div className="muted">Soft target shown on the Timer ring</div>
        </div>
        <input
          type="number"
          min={10}
          max={180}
          style={{ width: 80 }}
          value={defaultMins}
          onChange={(e) => {
            setDefaultMins(e.target.value);
            void api.setFeatureFlag("focus_default_mins", e.target.value);
          }}
        />
      </div>
      <div className="settings-shell-row">
        <div>
          <div>Break coach during Focus</div>
          <div className="muted">Same as Tracking → Breaks reminders</div>
        </div>
        <button
          type="button"
          className={`ws-toggle${autoBreak ? " on" : ""}`}
          onClick={() => {
            const next = !autoBreak;
            setAutoBreak(next);
            void api.setFeatureFlag("break_reminders", next ? "1" : "0");
          }}
        >
          {autoBreak ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}

function BreakReminders({ onError }: { onError: (m: string | null) => void }) {
  const [on, setOn] = useState(false);
  const [every, setEvery] = useState("50");
  const [len, setLen] = useState("5");
  useEffect(() => {
    void (async () => {
      try {
        setOn((await api.getFeatureFlag("break_reminders")) === "1");
        setEvery((await api.getFeatureFlag("break_every_mins")) || "50");
        setLen((await api.getFeatureFlag("break_length_mins")) || "5");
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [onError]);
  return (
    <>
      <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            void api.setFeatureFlag("break_reminders", v ? "1" : "0");
          }}
        />
        Remind me to take breaks during Focus
      </label>
      <div className="mini-form" style={{ marginTop: 10 }}>
        <label className="muted">
          Every (min)
          <input value={every} onChange={(e) => setEvery(e.target.value)} />
        </label>
        <label className="muted">
          Break length (min)
          <input value={len} onChange={(e) => setLen(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void api.setFeatureFlag("break_every_mins", every);
            void api.setFeatureFlag("break_length_mins", len);
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function MacOsHint() {
  const [hint, setHint] = useState("");
  useEffect(() => {
    void api.macosAccessibilityHint().then(setHint);
  }, []);
  if (!hint) {
    return (
      <p className="muted">
        Not required on this platform. On macOS, grant Accessibility so AutoTrace can
        read the frontmost app and window title.
      </p>
    );
  }
  return (
    <>
      <p className="muted">{hint}</p>
      <button
        type="button"
        className="btn"
        onClick={() =>
          void api.openExternalUrl(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          )
        }
      >
        Open Accessibility settings
      </button>
    </>
  );
}
