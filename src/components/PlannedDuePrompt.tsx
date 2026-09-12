import { PlannedSession, formatElapsed } from "../lib/api";

type Props = {
  session: PlannedSession;
  autoStart: boolean;
  onStartNow: () => void;
  onSkip: () => void;
  onDismiss: () => void;
};

function label(s: PlannedSession): string {
  if (s.title?.trim()) return s.title;
  const k = (s.kind || "focus").toLowerCase();
  if (k === "meeting") return "Meeting";
  if (k === "break") return "Break";
  return "Focus Session";
}

function fmtRange(start: string, end: string): string {
  const a = start.includes("T") ? start.slice(11, 16) : start;
  const b = end.includes("T") ? end.slice(11, 16) : end;
  return `${a} – ${b}`;
}

export function PlannedDuePrompt({
  session,
  autoStart,
  onStartNow,
  onSkip,
  onDismiss,
}: Props) {
  return (
    <div className="planned-due" role="dialog" aria-label="Upcoming planned session">
      <div className="planned-due-head">Your next session starts soon.</div>
      <div className={`planned-due-card kind-${(session.kind || "focus").toLowerCase()}`}>
        <div className="planned-due-title">{label(session)}</div>
        <div className="planned-due-meta">
          {fmtRange(session.started_at, session.ended_at)} ·{" "}
          {formatElapsed(session.duration_secs)}
        </div>
      </div>
      <p className="muted planned-due-note">
        {autoStart
          ? "Sessions start automatically because auto-advance for planned sessions is enabled."
          : "Auto-start is off — start manually or enable it in Settings → Planning."}
      </p>
      <div className="planned-due-actions">
        <button type="button" className="btn" onClick={onDismiss}>
          Dismiss
        </button>
        <button type="button" className="btn" onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="btn primary-pill" onClick={onStartNow}>
          Start Now
        </button>
      </div>
    </div>
  );
}
