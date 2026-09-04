import { Hierarchy, SessionRow, durationLabel, formatTime } from "../lib/api";

type Props = {
  session: SessionRow;
  hierarchy: Hierarchy | null;
  onClose: () => void;
  onTag: (value: string) => void;
};

export function SessionDetail({ session, hierarchy, onClose, onTag }: Props) {
  const tagValue = session.task_id
    ? `task:${session.task_id}`
    : session.project_id
      ? `project:${session.project_id}`
      : session.client_id
        ? `client:${session.client_id}`
        : "";

  const title =
    session.task_name ||
    session.project_name ||
    session.title ||
    session.app_name ||
    "Untitled session";

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div
        className="detail-card"
        role="dialog"
        aria-label="Time entry"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span className="muted">Time entry</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="time-row">
          <strong>
            {formatTime(session.started_at)} –{" "}
            {session.ended_at ? formatTime(session.ended_at) : "now"}
          </strong>
          <span className="muted">
            {durationLabel(session.started_at, session.ended_at)}
          </span>
        </div>

        <div className="title-box">{title}</div>
        <div className="desc-box">
          {session.app_name ? `App: ${session.app_name}` : "No app metadata"}
          {session.title ? `\nWindow: ${session.title}` : ""}
          {session.url ? `\nURL: ${session.url}` : ""}
          {session.idle ? "\nMarked idle" : ""}
        </div>

        <div className="tag-row">
          <select
            value={tagValue.startsWith("client:") ? tagValue : ""}
            onChange={(e) => onTag(e.target.value || "")}
            aria-label="Client"
          >
            <option value="">Client</option>
            {(hierarchy?.clients ?? []).map((c) => (
              <option key={c.id} value={`client:${c.id}`}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={
              tagValue.startsWith("project:") || tagValue.startsWith("task:")
                ? `project:${session.project_id ?? ""}`
                : ""
            }
            onChange={(e) => onTag(e.target.value || "")}
            aria-label="Project"
          >
            <option value="">Project</option>
            {(hierarchy?.clients ?? []).flatMap((c) =>
              c.projects.map((p) => (
                <option key={p.id} value={`project:${p.id}`}>
                  {c.name} / {p.name}
                </option>
              )),
            )}
          </select>

          <select
            value={tagValue.startsWith("task:") ? tagValue : ""}
            onChange={(e) => onTag(e.target.value || "")}
            aria-label="Task"
          >
            <option value="">Task</option>
            {(hierarchy?.clients ?? []).flatMap((c) =>
              c.projects.flatMap((p) =>
                p.tasks.map((t) => (
                  <option key={t.id} value={`task:${t.id}`}>
                    {p.name} / {t.name}
                  </option>
                )),
              ),
            )}
          </select>
        </div>

        <div className="detail-actions">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
          <button type="button" onClick={() => onTag("")}>
            Clear tag
          </button>
        </div>
      </div>
    </div>
  );
}
