import { FocusSession, formatElapsed } from "../lib/api";

type Props = {
  trackerStatus: string;
  currentApp: string | null;
  focus: FocusSession | null;
  onToggleTracking: () => void;
  onStartFocus: () => void;
  onEndFocus: () => void;
  onOpenTimer: () => void;
};

export function StatusBar({
  trackerStatus,
  currentApp,
  focus,
  onToggleTracking,
  onStartFocus,
  onEndFocus,
  onOpenTimer,
}: Props) {
  const trackingOn = trackerStatus === "running";
  const focusing = focus?.status === "active";

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <button
          type="button"
          className={`power-btn${trackingOn ? " on" : ""}`}
          title={trackingOn ? "Pause auto-tracking" : "Resume auto-tracking"}
          onClick={onToggleTracking}
          aria-label="Toggle tracking"
        >
          ⏻
        </button>
        <div className="status-meta" onClick={onOpenTimer} role="presentation">
          {focusing ? (
            <>
              <span className="focus-ring-mini" />
              <div>
                <div className="status-time">
                  {formatElapsed(focus.elapsed_secs)}
                </div>
                <div className="status-label">Focus time elapsed</div>
              </div>
            </>
          ) : (
            <div>
              <div className="status-time">
                {trackingOn ? "Tracking" : "Paused"}
              </div>
              <div className="status-label">
                {currentApp ?? "Tracking status"}
              </div>
            </div>
          )}
        </div>
        {focusing ? (
          <button type="button" className="end-focus-btn" onClick={onEndFocus}>
            End Focus
          </button>
        ) : (
          <button type="button" className="end-focus-btn" onClick={onStartFocus}>
            Start Focus
          </button>
        )}
      </div>

      <div className="status-bar-right">
        <div className="ambient-player" title="Ambience UI preview — coming soon">
          <div className="ambient-art" aria-hidden>
            <span />
          </div>
          <div className="ambient-meta">
            <div className="ambient-title">Space Ambience</div>
            <div className="ambient-sub">Focus soundscape</div>
          </div>
          <button type="button" className="ambient-btn" aria-label="Play" disabled>
            ▶
          </button>
          <button type="button" className="ambient-btn" aria-label="Volume" disabled>
            ♪
          </button>
        </div>
      </div>
    </footer>
  );
}
