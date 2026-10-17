import { useCallback, useEffect, useState } from "react";
import type { Hierarchy } from "../lib/api";
import { analyticsApi, Meeting } from "../lib/analyticsApi";
import { formatDayHeading, shiftDay } from "../lib/time";
import { todayLocal } from "../lib/api";
import { Markdown } from "./ui";

type Props = { hierarchy: Hierarchy | null; onError: (msg: string | null) => void; onLogged: () => void };

function hm(ts: string) {
  return ts.slice(11, 16);
}

function durMins(m: Meeting) {
  return Math.max(0, Math.round((Date.parse(m.ended_at) - Date.parse(m.started_at)) / 60000));
}

export function MeetingsView({ hierarchy, onError, onLogged }: Props) {
  const [day, setDay] = useState(todayLocal);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [paste, setPaste] = useState("");

  const refresh = useCallback(async () => {
    try {
      const m = await analyticsApi.listMeetings(day, day);
      setMeetings(m);
      setSelectedId((id) => (id && m.some((x) => x.id === id) ? id : (m[0]?.id ?? null)));
      onError(null);
    } catch (e) {
      onError(String(e));
    }
  }, [day, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const m = meetings.find((x) => x.id === selectedId) ?? null;
  const now = new Date();
  const nowIso = `${todayLocal()}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  async function act<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(null);
    }
  }

  function setTags(projectId: number | null) {
    if (!m) return;
    const client = hierarchy?.clients.find((c) => c.projects.some((p) => p.id === projectId));
    void act("tag", () =>
      analyticsApi.updateMeeting({ id: m.id, clientId: client?.id ?? null, projectId }),
    );
  }

  async function loadFile(file: File) {
    if (!m) return;
    const text = await file.text();
    await act("transcript", () => analyticsApi.attachMeetingTranscript(m.id, text));
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Meetings</h2>
          <p className="muted tt-sub">
            From your synced calendar. No bot joins your call — attach a transcript export and AutoTrace tags the
            meeting to the right client on this device.
          </p>
        </div>
        <div className="tt-head-actions">
          <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => setDay((d) => shiftDay(d, -1))}>
            ‹
          </button>
          <span className="day-label">{formatDayHeading(day)}</span>
          <button type="button" className="icon-btn" aria-label="Next day" onClick={() => setDay((d) => shiftDay(d, 1))}>
            ›
          </button>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            + New meeting
          </button>
        </div>
      </div>

      <div className="meetings-layout">
        <aside className="meetings-list">
          {meetings.length === 0 && (
            <div className="muted meetings-empty">
              No meetings on this day. Connect Google/Outlook under Integrations or import an .ics file, or add one
              manually.
            </div>
          )}
          {meetings.map((x, i) => {
            const showNow =
              day === todayLocal() && x.started_at > nowIso && (i === 0 || meetings[i - 1].started_at <= nowIso);
            return (
              <div key={x.id}>
                {showNow && <div className="meet-now">Now {nowIso.slice(11)}</div>}
                <button
                  type="button"
                  className={`meetings-item${x.id === selectedId ? " active" : ""}${x.attendance === "skip" ? " skipped" : ""}`}
                  onClick={() => setSelectedId(x.id)}
                >
                  <span className="meetings-item-title">{x.title}</span>
                  <span className="muted">
                    {hm(x.started_at)} · {durMins(x)}m{x.project_name ? ` · ${x.project_name}` : ""}
                  </span>
                  <span className="meetings-badges">
                    {x.has_transcript && <span className="badge">Transcript</span>}
                    {x.session_id && <span className="badge ok">Logged</span>}
                    {x.attendance === "skip" && <span className="badge">Not attending</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </aside>

        {m && (
          <section className="card meeting-detail">
            <h3>{m.title}</h3>
            <p className="muted">
              {hm(m.started_at)}–{hm(m.ended_at)} · {durMins(m)} min
              {m.attendees.length > 0 && ` · ${m.attendees.join(", ")}`}
            </p>

            {!m.session_id && (
              <div className="callout">
                <p>
                  {m.started_at > nowIso
                    ? "When this meeting ends, log it as a time entry tagged to the client below."
                    : "Log this meeting as a tagged time entry."}
                </p>
                <div className="seg" role="group" aria-label="Attendance">
                  <button
                    type="button"
                    className={m.attendance === "attend" ? "active" : undefined}
                    onClick={() => void act("att", () => analyticsApi.updateMeeting({ id: m.id, attendance: "attend", clientId: m.client_id, projectId: m.project_id }))}
                  >
                    I will attend
                  </button>
                  <button
                    type="button"
                    className={m.attendance === "skip" ? "active" : undefined}
                    onClick={() => void act("att", () => analyticsApi.updateMeeting({ id: m.id, attendance: "skip", clientId: m.client_id, projectId: m.project_id }))}
                  >
                    I won't attend
                  </button>
                </div>
              </div>
            )}

            <label className="field">
              <span>Client / project</span>
              <select value={m.project_id ?? ""} onChange={(e) => setTags(e.target.value ? Number(e.target.value) : null)}>
                <option value="">No label</option>
                {hierarchy?.clients.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <div className="meeting-actions">
              <button
                type="button"
                className="btn"
                disabled={!!m.session_id || m.attendance === "skip" || busy === "log"}
                onClick={() =>
                  void act("log", async () => {
                    await analyticsApi.logMeetingSession(m.id);
                    onLogged();
                  })
                }
              >
                {m.session_id ? "✓ Logged to calendar" : "Log as time entry"}
              </button>
              <label className="btn ghost file-btn">
                Attach transcript (.vtt / .srt / .txt)
                <input type="file" accept=".vtt,.srt,.txt,text/plain" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
              </label>
              <button
                type="button"
                className="btn ghost"
                disabled={!m.has_transcript || busy === "sum"}
                title={m.has_transcript ? "Uses your AI provider" : "Attach a transcript first"}
                onClick={() => void act("sum", () => analyticsApi.summarizeMeeting(m.id))}
              >
                {busy === "sum" ? "Summarizing…" : "✦ Summarize"}
              </button>
            </div>

            {!m.has_transcript && (
              <div className="field">
                <span>…or paste transcript text</span>
                <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste from Zoom, Meet or Teams" />
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={!paste.trim()}
                  onClick={() =>
                    void act("transcript", async () => {
                      await analyticsApi.attachMeetingTranscript(m.id, paste);
                      setPaste("");
                    })
                  }
                >
                  Attach
                </button>
              </div>
            )}

            {m.summary && (
              <div className="card run-section">
                <p className="kicker">✦ Summary</p>
                <Markdown text={m.summary} />
              </div>
            )}
            {m.transcript && (
              <details className="transcript">
                <summary>Transcript ({m.transcript.split("\n").length} lines)</summary>
                <pre>{m.transcript}</pre>
              </details>
            )}
          </section>
        )}
      </div>

      {creating && (
        <NewMeetingModal
          day={day}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelectedId(id);
            void refresh();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function NewMeetingModal({
  day,
  onClose,
  onCreated,
  onError,
}: {
  day: string;
  onClose: () => void;
  onCreated: (id: number) => void;
  onError: (msg: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("10:30");
  const [attendees, setAttendees] = useState("");
  return (
    <div className="modal-backdrop" role="dialog" aria-label="New meeting" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>New meeting · {day}</h3>
        <div className="form-stack">
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <div className="row-2">
            <label className="field">
              <span>Start</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span>End</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Attendees</span>
            <input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="Comma-separated, optional" />
          </label>
        </div>
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!title.trim()}
            onClick={() =>
              void analyticsApi
                .createMeeting(title, `${day}T${start}:00`, `${day}T${end}:00`, attendees || undefined)
                .then((m) => onCreated(m.id))
                .catch((e) => onError(String(e)))
            }
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
