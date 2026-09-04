import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type TrackerInfo = {
  status: "idle" | "running" | "paused";
  platform: string;
  capture_ready: boolean;
};

type AppStatus = {
  name: string;
  version: string;
  db_path: string;
  schema_version: number;
  tracker: TrackerInfo;
  network_enabled: boolean;
};

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<AppStatus>("get_app_status")
      .then(setStatus)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  return (
    <div className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Local-only · Phase 0</p>
          <h1>AutoTrace</h1>
        </div>
        {status && (
          <span className="badge" data-ok={!status.network_enabled}>
            {status.network_enabled ? "Network on" : "No network"}
          </span>
        )}
      </header>

      <main className="main">
        <p className="lede">
          Privacy-first automatic time tracking. Activity stays on this machine
          until you explicitly opt into an integration.
        </p>

        {error && <p className="error">Failed to load status: {error}</p>}

        {!status && !error && <p className="muted">Connecting to Rust backend…</p>}

        {status && (
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
                {!status.tracker.capture_ready && " (capture next)"}
              </dd>
            </div>
            <div className="wide">
              <dt>SQLite path</dt>
              <dd className="path">{status.db_path}</dd>
            </div>
          </dl>
        )}

        <section className="next">
          <h2>Next up</h2>
          <ul>
            <li>System tray (show / hide / pause / resume / quit)</li>
            <li>Windows foreground-window capture (~1s poll)</li>
            <li>Day timeline UI + client → project → task manager</li>
          </ul>
          <p className="muted">
            See <code>docs/prd/mvp.md</code> for the full checklist.
          </p>
        </section>
      </main>
    </div>
  );
}

export default App;
