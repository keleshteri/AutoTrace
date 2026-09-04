import { AppStatus } from "../lib/api";

type Props = {
  status: AppStatus | null;
  onPause: () => void;
  onResume: () => void;
};

export function SettingsView({ status, onPause, onResume }: Props) {
  return (
    <div className="page">
      <div className="page-head">
        <h2>Settings</h2>
        {status && (
          <button
            type="button"
            className="btn"
            onClick={status.tracker.status === "running" ? onPause : onResume}
          >
            {status.tracker.status === "running" ? "Pause tracking" : "Resume tracking"}
          </button>
        )}
      </div>

      <div className="kpi-row">
        <div className="card">
          <p className="kicker">Version</p>
          <p className="metric" style={{ fontSize: 20 }}>
            {status?.version ?? "—"}
          </p>
        </div>
        <div className="card">
          <p className="kicker">Platform</p>
          <p className="metric" style={{ fontSize: 20 }}>
            {status?.tracker.platform ?? "—"}
          </p>
        </div>
        <div className="card">
          <p className="kicker">Network</p>
          <p className="metric" style={{ fontSize: 20 }}>
            {status?.network_enabled ? "On" : "Off"}
          </p>
        </div>
      </div>

      <div className="card">
        <p className="kicker">What we track</p>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          App name, window title, browser URL when available, timestamps, and idle
          flags. No screenshots, keylogging, or clipboard capture.
        </p>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">SQLite path</p>
        <p className="path" style={{ marginTop: 8 }}>
          {status?.db_path ?? "—"}
        </p>
        <p className="muted" style={{ marginTop: 10 }}>
          Closing the window hides to the tray. Quit from the tray menu to stop
          tracking.
        </p>
      </div>
    </div>
  );
}
