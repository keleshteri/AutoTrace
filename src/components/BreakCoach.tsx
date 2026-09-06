import { formatElapsed } from "../lib/api";

type Props = {
  visible: boolean;
  everyMins: number;
  breakMins: number;
  snoozeMins: number;
  onStartBreak: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
};

export function BreakCoach({
  visible,
  everyMins,
  breakMins,
  snoozeMins,
  onStartBreak,
  onSnooze,
  onDismiss,
}: Props) {
  if (!visible) return null;

  return (
    <div className="break-coach" role="dialog" aria-label="Productivity coach">
      <div className="break-coach-head">
        <span className="break-coach-brand">AUTOTRACE · PRODUCTIVITY COACH</span>
        <div className="break-coach-tools">
          <button type="button" className="icon-ghost" title="Snooze" onClick={onSnooze}>
            ⏱
          </button>
          <button type="button" className="icon-ghost" title="Dismiss" onClick={onDismiss}>
            ✕
          </button>
        </div>
      </div>
      <h3>Ready to take a break?</h3>
      <p className="muted">
        More than {everyMins} minutes passed since you started working.
      </p>
      <div className="break-coach-actions">
        <button type="button" className="break-coach-primary" onClick={onStartBreak}>
          Start Break ({breakMins} min)
        </button>
        <button type="button" className="break-coach-secondary" onClick={onSnooze}>
          Snooze ({snoozeMins} min)
        </button>
      </div>
      <div className="break-coach-bar" aria-hidden />
    </div>
  );
}

type BreakBannerProps = {
  remainingSecs: number;
  onEnd: () => void;
};

export function BreakBanner({ remainingSecs, onEnd }: BreakBannerProps) {
  return (
    <div className="break-banner">
      <span>On break · {formatElapsed(Math.max(0, remainingSecs))} left</span>
      <button type="button" className="btn" onClick={onEnd}>
        End Break
      </button>
    </div>
  );
}
