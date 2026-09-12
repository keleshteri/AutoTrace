import { FormEvent, useEffect, useState } from "react";
import {
  api,
  Hierarchy,
  SESSION_CATEGORIES,
  SessionCategory,
  SessionKind,
} from "../lib/api";

const DURATION_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 50, 60, 90, 120];

type Props = {
  kind: SessionKind;
  hierarchy: Hierarchy | null;
  onClose: () => void;
  onStarted: () => void;
  onError: (msg: string | null) => void;
};

const COPY: Record<
  SessionKind,
  { title: string; action: string; hint?: string; showGoal: boolean }
> = {
  focus: {
    title: "Start Focus",
    action: "Start Focus",
    showGoal: true,
  },
  meeting: {
    title: "Start Meeting",
    action: "Start Meeting",
    hint: "Writing down a goal for your meeting helps your team retain focus and stay on target.",
    showGoal: true,
  },
  break: {
    title: "Start Break",
    action: "Start Break",
    hint: "Breaks should be free of obligations like checking email or social media. Engage in mentally restful activities like walking or stretching.",
    showGoal: false,
  },
};

export function StartSessionModal({
  kind,
  hierarchy,
  onClose,
  onStarted,
  onError,
}: Props) {
  const copy = COPY[kind];
  const [tab, setTab] = useState<"session" | "advanced">("session");
  const [goal, setGoal] = useState("");
  const [durationMins, setDurationMins] = useState(kind === "break" ? 5 : 45);
  const [clientId, setClientId] = useState<number | "">("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [taskId, setTaskId] = useState<number | "">("");
  const [categoryOverride, setCategoryOverride] = useState<SessionCategory | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const key =
          kind === "break"
            ? "break_length_mins"
            : kind === "meeting"
              ? "meeting_default_mins"
              : "focus_default_mins";
        const fallback = kind === "break" ? "5" : kind === "meeting" ? "30" : "45";
        const v = Number((await api.getFeatureFlag(key)) || fallback);
        if (!cancelled && Number.isFinite(v) && v > 0) setDurationMins(v);
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const clients = hierarchy?.clients ?? [];
  const projects =
    clientId === ""
      ? clients.flatMap((c) =>
          c.projects.map((p) => ({
            id: p.id,
            clientId: c.id,
            label: `${c.name} / ${p.name}`,
            tasks: p.tasks,
          })),
        )
      : clients
          .filter((c) => c.id === clientId)
          .flatMap((c) =>
            c.projects.map((p) => ({
              id: p.id,
              clientId: c.id,
              label: p.name,
              tasks: p.tasks,
            })),
          );
  const selectedProject = projects.find((p) => p.id === projectId);
  const tasks = selectedProject?.tasks ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const pid = projectId === "" ? null : projectId;
      const resolvedClient =
        kind === "break"
          ? null
          : clientId !== ""
            ? clientId
            : (selectedProject?.clientId ?? null);
      await api.startFocus({
        kind,
        goal: kind === "break" ? undefined : goal.trim() || undefined,
        clientId: resolvedClient,
        projectId: kind === "break" ? null : pid,
        taskId: kind === "break" || taskId === "" ? null : taskId,
        durationMins,
        categoryOverride:
          kind === "focus" && categoryOverride ? categoryOverride : null,
      });
      onError(null);
      onStarted();
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="session-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="session-modal"
        role="dialog"
        aria-label={copy.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="session-modal-head">
          <h2>{copy.title}</h2>
          <button type="button" className="icon-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {kind === "focus" && (
          <div className="segment" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={tab === "session" ? "active" : undefined}
              onClick={() => setTab("session")}
            >
              Session
            </button>
            <button
              type="button"
              className={tab === "advanced" ? "active" : undefined}
              onClick={() => setTab("advanced")}
            >
              Advanced
            </button>
          </div>
        )}

        <form onSubmit={(e) => void submit(e)}>
          {(kind !== "focus" || tab === "session") && (
            <>
              <label className="muted session-field">
                Duration
                <select
                  value={durationMins}
                  onChange={(e) => setDurationMins(Number(e.target.value))}
                >
                  {DURATION_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </label>

              {copy.hint && <p className="muted session-hint">{copy.hint}</p>}

              {copy.showGoal && (
                <label className="muted session-field">
                  Goal
                  <textarea
                    rows={3}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Enter a goal for this session…"
                  />
                </label>
              )}

              {kind !== "break" && (
                <>
                  <label className="muted session-field">
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
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="muted session-field">
                    Project
                    <select
                      value={projectId}
                      onChange={(e) => {
                        setProjectId(e.target.value ? Number(e.target.value) : "");
                        setTaskId("");
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
                  <label className="muted session-field">
                    Task
                    <select
                      value={taskId}
                      onChange={(e) =>
                        setTaskId(e.target.value ? Number(e.target.value) : "")
                      }
                      disabled={!selectedProject}
                    >
                      <option value="">None</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </>
          )}

          {kind === "focus" && tab === "advanced" && (
            <label className="muted session-field">
              Category override
              <span className="session-hint" style={{ display: "block", marginBottom: 6 }}>
                Optionally override so all time in this session is tagged to a specific category.
              </span>
              <select
                value={categoryOverride}
                onChange={(e) =>
                  setCategoryOverride((e.target.value || "") as SessionCategory | "")
                }
              >
                <option value="">Select a category…</option>
                {SESSION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="session-modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn primary-pill" disabled={busy}>
              {copy.action}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
