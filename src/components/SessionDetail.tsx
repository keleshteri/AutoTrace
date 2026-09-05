import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ActivityEvent,
  Hierarchy,
  SESSION_CATEGORIES,
  SessionRow,
  api,
  durationLabel,
  formatTime,
} from "../lib/api";
import {
  activityDisplayLabel,
  friendlyAppName,
  formatTimeAmPm,
} from "../lib/displayNames";

type Props = {
  session: SessionRow;
  hierarchy: Hierarchy | null;
  onClose: () => void;
  onSaved: () => void;
  onApprove: (approved: boolean) => void;
  onUpdate: (payload: {
    title: string | null;
    startedAt: string;
    endedAt: string | null;
    notes: string | null;
    clientId: number | null;
    projectId: number | null;
    taskId: number | null;
    category: string | null;
  }) => Promise<void>;
  onSplit: (at: string) => Promise<void>;
  onDelete: () => Promise<void>;
};

type Tab = "details" | "apps" | "titles" | "events";

function toTimeInput(iso: string): string {
  return formatTime(iso);
}

function toDatePart(iso: string): string {
  return iso.slice(0, 10);
}

export function SessionDetail({
  session,
  hierarchy,
  onClose,
  onSaved,
  onApprove,
  onUpdate,
  onSplit,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<Tab>("details");
  const [title, setTitle] = useState(session.title ?? "");
  const [notes, setNotes] = useState(session.notes ?? "");
  const [category, setCategory] = useState(session.category ?? "Other");
  const [day, setDay] = useState(toDatePart(session.started_at));
  const [start, setStart] = useState(toTimeInput(session.started_at));
  const [end, setEnd] = useState(
    session.ended_at ? toTimeInput(session.ended_at) : "",
  );
  const [clientId, setClientId] = useState<number | "">(session.client_id ?? "");
  const [projectId, setProjectId] = useState<number | "">(
    session.project_id ?? "",
  );
  const [taskId, setTaskId] = useState<number | "">(session.task_id ?? "");
  const [splitAt, setSplitAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    setTitle(session.title ?? "");
    setNotes(session.notes ?? "");
    setCategory(session.category ?? "Other");
    setDay(toDatePart(session.started_at));
    setStart(toTimeInput(session.started_at));
    setEnd(session.ended_at ? toTimeInput(session.ended_at) : "");
    setClientId(session.client_id ?? "");
    setProjectId(session.project_id ?? "");
    setTaskId(session.task_id ?? "");
    setErr(null);
    setTab("details");
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    const endIso =
      session.ended_at ??
      new Date().toISOString().slice(0, 19).replace("T", "T");
    // Prefer wall-clock local format used by store
    const ended =
      session.ended_at ??
      (() => {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      })();
    void api
      .listActivityEventsInRange(session.started_at, ended, 500)
      .then((ev) => {
        if (!cancelled) setEvents(ev);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    void endIso;
    return () => {
      cancelled = true;
    };
  }, [session.id, session.started_at, session.ended_at]);

  const appBuckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      const key = friendlyAppName(e.app_name);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const titleBuckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      const key =
        activityDisplayLabel(e.app_name, e.url) ||
        e.title ||
        friendlyAppName(e.app_name);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [events]);

  const projects =
    clientId === ""
      ? (hierarchy?.clients ?? []).flatMap((c) =>
          c.projects.map((p) => ({
            id: p.id,
            label: `${c.name} / ${p.name}`,
            clientId: c.id,
            tasks: p.tasks,
          })),
        )
      : (hierarchy?.clients ?? [])
          .filter((c) => c.id === clientId)
          .flatMap((c) =>
            c.projects.map((p) => ({
              id: p.id,
              label: p.name,
              clientId: c.id,
              tasks: p.tasks,
            })),
          );

  const tasks =
    projectId === ""
      ? []
      : (projects.find((p) => p.id === projectId)?.tasks ?? []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const startedAt = `${day}T${start}:00`;
      const endedAt = end ? `${day}T${end}:00` : null;
      let cid = clientId === "" ? null : clientId;
      const pid = projectId === "" ? null : projectId;
      const tid = taskId === "" ? null : taskId;
      if (pid != null && cid == null) {
        for (const c of hierarchy?.clients ?? []) {
          if (c.projects.some((p) => p.id === pid)) cid = c.id;
        }
      }
      await onUpdate({
        title: title.trim() || null,
        startedAt,
        endedAt,
        notes: notes.trim() || null,
        clientId: cid,
        projectId: pid,
        taskId: tid,
        category: category || null,
      });
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function split() {
    if (!splitAt || !session.ended_at) return;
    setBusy(true);
    setErr(null);
    try {
      await onSplit(`${day}T${splitAt}:00`);
      onSaved();
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-overlay" onClick={onClose}>
      <form
        className="detail-card wide"
        role="dialog"
        aria-label="Review time entry"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void save(e)}
      >
        <header>
          <span className="muted">
            Review · {durationLabel(session.started_at, session.ended_at)}
            {session.manual ? " · manual" : ""}
            {session.pending ? " · pending" : ""}
            {session.approved ? " · approved" : ""}
            {session.confidence != null
              ? ` · ${Math.round(session.confidence * 100)}% conf`
              : ""}
            <span className="kbd-hint"> · A approve · N next · Esc close</span>
          </span>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="detail-tabs">
          {(
            [
              ["details", "Details"],
              ["apps", "Apps"],
              ["titles", "Titles"],
              ["events", "Event log"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {err && <p className="error-banner">{err}</p>}

        {tab === "details" && (
          <>
            <label className="muted" style={{ display: "block", marginBottom: 8 }}>
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={session.app_name ?? "Session title"}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>

            <div className="tag-row">
              <label className="muted">
                Category
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {SESSION_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted">
                Start
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="muted">
                End
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label className="muted">
                Day
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
            </div>

            <label className="muted" style={{ display: "block", marginTop: 8 }}>
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>

            {(session.app_name || session.url) && (
              <div className="meta-box" style={{ marginTop: 10 }}>
                <div>
                  <span className="muted">App</span>{" "}
                  {session.app_name
                    ? friendlyAppName(session.app_name)
                    : "—"}
                </div>
                {session.url && (
                  <div>
                    <span className="muted">URL</span> {session.url}
                  </div>
                )}
              </div>
            )}

            <div className="tag-row" style={{ marginTop: 10 }}>
              <label className="muted">
                Client
                <select
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value ? Number(e.target.value) : "");
                    setProjectId("");
                    setTaskId("");
                  }}
                >
                  <option value="">None</option>
                  {(hierarchy?.clients ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted">
                Project
                <select
                  value={projectId}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : "";
                    setProjectId(v);
                    setTaskId("");
                    if (v !== "" && clientId === "") {
                      const p = projects.find((x) => x.id === v);
                      if (p) setClientId(p.clientId);
                    }
                  }}
                >
                  <option value="">None</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted">
                Task
                <select
                  value={taskId}
                  onChange={(e) =>
                    setTaskId(e.target.value ? Number(e.target.value) : "")
                  }
                  disabled={projectId === ""}
                >
                  <option value="">None</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {session.ended_at && (
              <div className="tag-row" style={{ marginTop: 10 }}>
                <label className="muted">
                  Split at
                  <input
                    type="time"
                    value={splitAt}
                    onChange={(e) => setSplitAt(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={!splitAt || busy}
                  onClick={() => void split()}
                >
                  Split
                </button>
              </div>
            )}
          </>
        )}

        {tab === "apps" && (
          <div className="detail-list">
            {appBuckets.length === 0 ? (
              <p className="muted">No activity events in this window</p>
            ) : (
              <ul>
                {appBuckets.map(([name, count]) => (
                  <li key={name}>
                    <span>{name}</span>
                    <span className="muted">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "titles" && (
          <div className="detail-list">
            {titleBuckets.length === 0 ? (
              <p className="muted">No titles captured</p>
            ) : (
              <ul>
                {titleBuckets.map(([name, count]) => (
                  <li key={name}>
                    <span title={name}>{name}</span>
                    <span className="muted">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "events" && (
          <div className="detail-list event-log-mini">
            {events.length === 0 ? (
              <p className="muted">No events in this range</p>
            ) : (
              <ul>
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="muted">
                      {formatTimeAmPm(e.recorded_at)}
                    </span>
                    <span>
                      {activityDisplayLabel(e.app_name, e.url) ||
                        e.title ||
                        friendlyAppName(e.app_name)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="detail-actions" style={{ marginTop: 14 }}>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
          {session.pending && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => onApprove(true)}
            >
              Approve
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void onDelete().then(onClose);
            }}
          >
            Delete
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}
