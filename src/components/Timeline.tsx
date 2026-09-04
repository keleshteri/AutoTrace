import { useCallback, useEffect, useState } from "react";
import {
  api,
  durationLabel,
  formatTime,
  Hierarchy,
  SessionRow,
  todayLocal,
} from "../lib/api";

type Props = {
  onError: (msg: string | null) => void;
};

type TagOption = { value: string; label: string };

function buildTagOptions(hierarchy: Hierarchy | null): TagOption[] {
  const opts: TagOption[] = [];
  for (const c of hierarchy?.clients ?? []) {
    opts.push({ value: `client:${c.id}`, label: `${c.name} (client)` });
    for (const p of c.projects) {
      opts.push({
        value: `project:${p.id}`,
        label: `${c.name} / ${p.name}`,
      });
      for (const t of p.tasks) {
        opts.push({
          value: `task:${t.id}`,
          label: `${c.name} / ${p.name} / ${t.name}`,
        });
      }
    }
  }
  return opts;
}

export function Timeline({ onError }: Props) {
  const [day, setDay] = useState(todayLocal);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        api.listSessionsForDay(day),
        api.getHierarchy(),
      ]);
      setSessions(s);
      setHierarchy(h);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [day, onError]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function onTag(sessionId: number, value: string) {
    if (!value) {
      await api.tagSession(sessionId, null, null, null);
      await refresh();
      return;
    }
    const [kind, idStr] = value.split(":");
    const id = Number(idStr);
    if (kind === "client") {
      await api.tagSession(sessionId, id, null, null);
    } else if (kind === "project") {
      const client = hierarchy?.clients.find((c) =>
        c.projects.some((p) => p.id === id),
      );
      await api.tagSession(sessionId, client?.id ?? null, id, null);
    } else if (kind === "task") {
      let clientId: number | null = null;
      let projectId: number | null = null;
      for (const c of hierarchy?.clients ?? []) {
        for (const p of c.projects) {
          if (p.tasks.some((t) => t.id === id)) {
            clientId = c.id;
            projectId = p.id;
          }
        }
      }
      await api.tagSession(sessionId, clientId, projectId, id);
    }
    await refresh();
  }

  const tagOptions = buildTagOptions(hierarchy);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Day timeline</h2>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="Select day"
        />
      </div>

      {loading && sessions.length === 0 && (
        <p className="muted">Loading sessions…</p>
      )}

      {!loading && sessions.length === 0 && (
        <p className="muted">
          No sessions yet for this day. Keep the app running in the tray while
          you work — capture polls about once a second.
        </p>
      )}

      <ul className="session-list">
        {sessions.map((s) => {
          const tagValue = s.task_id
            ? `task:${s.task_id}`
            : s.project_id
              ? `project:${s.project_id}`
              : s.client_id
                ? `client:${s.client_id}`
                : "";

          return (
            <li key={s.id} className={s.idle ? "idle" : undefined}>
              <div className="session-time">
                <span>
                  {formatTime(s.started_at)}
                  {" – "}
                  {s.ended_at ? formatTime(s.ended_at) : "now"}
                </span>
                <span className="dur">
                  {durationLabel(s.started_at, s.ended_at)}
                </span>
              </div>
              <div className="session-body">
                <strong>{s.app_name ?? "Unknown"}</strong>
                <span className="title">{s.title ?? "—"}</span>
              </div>
              <div className="session-tag">
                <select
                  value={tagValue}
                  onChange={(e) => void onTag(s.id, e.target.value)}
                  aria-label={`Tag session ${s.id}`}
                >
                  <option value="">Untagged</option>
                  {tagOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
