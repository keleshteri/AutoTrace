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

type Props = {
  status: AppStatus | null;
  onPause: () => void;
  onResume: () => void;
  onRefreshStatus: () => void;
  onError: (msg: string | null) => void;
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

export function SettingsView({
  status,
  onPause,
  onResume,
  onRefreshStatus,
  onError,
}: Props) {
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
    <div className="page">
      <div className="page-head">
        <h2>Settings & privacy</h2>
        {status && (
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

      <Phase4Extras onError={onError} />
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
