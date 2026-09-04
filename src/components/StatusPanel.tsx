import { AppStatus } from "../lib/api";

type Props = {
  status: AppStatus | null;
  onPause: () => void;
  onResume: () => void;
};

export function StatusPanel({ status, onPause, onResume }: Props) {
  if (!status) {
    return <p className="muted">Connecting to Rust backend…</p>;
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Status</h2>
        <div className="btn-row">
          {status.tracker.status === "running" ? (
            <button type="button" onClick={onPause}>
              Pause
            </button>
          ) : (
            <button type="button" onClick={onResume}>
              Resume
            </button>
          )}
        </div>
      </div>

      <dl className="status-grid">
        <div>
          <dt>Version</dt>
          <dd>{status.version}</dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd>v{status.schema_version}</dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd>{status.tracker.platform}</dd>
        </div>
        <div>
          <dt>Tracker</dt>
          <dd>
            {status.tracker.status}
            {!status.tracker.capture_ready && " · capture unavailable"}
          </dd>
        </div>
        <div>
          <dt>Foreground</dt>
          <dd>{status.tracker.current_app ?? "—"}</dd>
        </div>
        <div>
          <dt>Title</dt>
          <dd className="clamp">{status.tracker.current_title ?? "—"}</dd>
        </div>
        <div className="wide">
          <dt>SQLite path</dt>
          <dd className="path">{status.db_path}</dd>
        </div>
      </dl>

      <p className="muted">
        Closing the window hides to the tray. Use Quit from the tray menu to
        stop tracking. On Linux, install <code>xdotool</code> (and optionally{" "}
        <code>xprintidle</code>) for capture while developing.
      </p>
    </section>
  );
}
