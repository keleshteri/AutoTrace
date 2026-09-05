import { FormEvent, useEffect, useState } from "react";
import {
  Hierarchy,
  SessionRow,
  durationLabel,
  formatTime,
} from "../lib/api";

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
  }) => Promise<void>;
  onSplit: (at: string) => Promise<void>;
  onDelete: () => Promise<void>;
};

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
  const [title, setTitle] = useState(session.title ?? "");
  const [notes, setNotes] = useState(session.notes ?? "");
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

  useEffect(() => {
    setTitle(session.title ?? "");
    setNotes(session.notes ?? "");
    setDay(toDatePart(session.started_at));
    setStart(toTimeInput(session.started_at));
    setEnd(session.ended_at ? toTimeInput(session.ended_at) : "");
    setClientId(session.client_id ?? "");
    setProjectId(session.project_id ?? "");
    setTaskId(session.task_id ?? "");
    setErr(null);
  }, [session]);

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
        className="detail-card"
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
          </span>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>

        {err && <p className="error-banner">{err}</p>}

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
              disabled={!session.ended_at && end === ""}
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

        <label className="muted" style={{ display: "block", margin: "8px 0" }}>
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ width: "100%", marginTop: 4, resize: "vertical" }}
            placeholder="Optional notes"
          />
        </label>

        <div className="desc-box" style={{ marginBottom: 10 }}>
          {session.app_name ? `App: ${session.app_name}` : "No app metadata"}
          {session.url ? `\nURL: ${session.url}` : ""}
        </div>

        <div className="tag-row">
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value ? Number(e.target.value) : "");
              setProjectId("");
              setTaskId("");
            }}
            aria-label="Client"
          >
            <option value="">Client</option>
            {(hierarchy?.clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={projectId}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              setProjectId(id);
              setTaskId("");
              if (id !== "") {
                const p = projects.find((x) => x.id === id);
                if (p) setClientId(p.clientId);
              }
            }}
            aria-label="Project"
          >
            <option value="">Project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={taskId}
            onChange={(e) =>
              setTaskId(e.target.value ? Number(e.target.value) : "")
            }
            aria-label="Task"
          >
            <option value="">Task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {session.ended_at && (
          <div
            className="mini-form"
            style={{ marginTop: 10, gridTemplateColumns: "1fr auto" }}
          >
            <label>
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
              style={{ background: "var(--bg-hover)" }}
              disabled={!splitAt || busy}
              onClick={() => void split()}
            >
              Split
            </button>
          </div>
        )}

        <div className="detail-actions" style={{ marginTop: 12 }}>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onApprove(true);
            }}
          >
            {session.approved ? "Approved" : "Approve"}
          </button>
          <button
            type="button"
            disabled={busy}
            style={{ color: "var(--danger)" }}
            onClick={() => {
              if (window.confirm("Delete this session?")) {
                void onDelete().then(onClose);
              }
            }}
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}
