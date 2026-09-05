import { FormEvent, useEffect, useState } from "react";
import {
  api,
  FocusSession,
  Hierarchy,
  formatElapsed,
} from "../lib/api";

type Props = {
  focus: FocusSession | null;
  hierarchy: Hierarchy | null;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onOpenActivity: () => void;
};

export function TimerView({
  focus,
  hierarchy,
  onChanged,
  onError,
  onOpenActivity,
}: Props) {
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [tick, setTick] = useState(0);
  const [panel, setPanel] = useState<"session" | "timeline">("session");

  useEffect(() => {
    if (!focus || focus.status !== "active") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [focus?.id, focus?.status]);

  const elapsed =
    focus && focus.status === "active"
      ? focus.elapsed_secs + tick
      : focus?.elapsed_secs ?? 0;

  // Ring progress against a soft 50-minute focus block.
  const target = 50 * 60;
  const pct = Math.min(100, (elapsed / target) * 100);
  const r = 108;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - pct / 100);

  async function start(e: FormEvent) {
    e.preventDefault();
    try {
      let clientId: number | null = null;
      const pid = projectId === "" ? null : projectId;
      if (pid != null) {
        for (const cl of hierarchy?.clients ?? []) {
          if (cl.projects.some((p) => p.id === pid)) clientId = cl.id;
        }
      }
      await api.startFocus({
        goal: goal.trim() || undefined,
        clientId,
        projectId: pid,
      });
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function end() {
    try {
      await api.endFocus();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const projects =
    hierarchy?.clients.flatMap((c) =>
      c.projects.map((p) => ({ id: p.id, label: `${c.name} / ${p.name}` })),
    ) ?? [];

  return (
    <div className="timer-layout">
      <div className="timer-stage">
        <div className="timer-ring-wrap">
          <svg className="timer-ring" viewBox="0 0 240 240">
            <circle cx="120" cy="120" r={r} className="timer-ring-bg" />
            <circle
              cx="120"
              cy="120"
              r={r}
              className="timer-ring-fg"
              style={{
                strokeDasharray: c,
                strokeDashoffset: focus?.status === "active" ? dash : c,
              }}
            />
          </svg>
          <div className="timer-readout">
            <div className="timer-time">{formatElapsed(elapsed)}</div>
            <div className="timer-caption">
              {focus?.status === "active"
                ? "Focus time elapsed"
                : "Ready to focus"}
            </div>
          </div>
        </div>

        <div className="timer-controls">
          {focus?.status === "active" ? (
            <>
              <button
                type="button"
                className="timer-ctrl"
                title="Open Activity"
                onClick={onOpenActivity}
              >
                »
              </button>
              <button
                type="button"
                className="timer-ctrl stop"
                title="End Focus"
                onClick={() => void end()}
              >
                ■
              </button>
              <button
                type="button"
                className="timer-ctrl"
                title="Add goal note"
                onClick={() => setPanel("session")}
              >
                +
              </button>
            </>
          ) : (
            <button type="button" className="btn primary-pill" onClick={() => void start({ preventDefault() {} } as FormEvent)}>
              Start Focus
            </button>
          )}
        </div>
      </div>

      <aside className="timer-side">
        <div className="segment" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={panel === "session" ? "active" : undefined}
            onClick={() => setPanel("session")}
          >
            Current Session
          </button>
          <button
            type="button"
            className={panel === "timeline" ? "active" : undefined}
            onClick={() => setPanel("timeline")}
          >
            Timeline
          </button>
        </div>

        {panel === "session" && (
          <form className="card" onSubmit={(e) => void start(e)}>
            <p className="muted" style={{ marginTop: 0 }}>
              Writing down a goal for your session helps you retain focus.
            </p>
            <label className="muted">
              Goal
              <textarea
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Enter a goal for this session…"
                style={{ width: "100%", marginTop: 6, resize: "vertical" }}
                disabled={focus?.status === "active"}
              />
            </label>
            <label className="muted" style={{ display: "block", marginTop: 10 }}>
              Project
              <select
                value={projectId}
                onChange={(e) =>
                  setProjectId(e.target.value ? Number(e.target.value) : "")
                }
                disabled={focus?.status === "active"}
                style={{ width: "100%", marginTop: 6 }}
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {focus?.status === "active" ? (
              <button
                type="button"
                className="btn"
                style={{ marginTop: 12, width: "100%" }}
                onClick={() => void end()}
              >
                End Focus
              </button>
            ) : (
              <button type="submit" className="btn" style={{ marginTop: 12, width: "100%" }}>
                Start Focus
              </button>
            )}
          </form>
        )}

        {panel === "timeline" && (
          <div className="card">
            <p className="kicker">Today</p>
            <p className="muted">
              Focus blocks also appear on Calendar after you end a session.
              Open Activity for the live app event stream.
            </p>
            <button type="button" className="btn" style={{ marginTop: 10 }} onClick={onOpenActivity}>
              Open Activity
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
