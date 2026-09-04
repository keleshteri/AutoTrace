import { useCallback, useEffect, useState } from "react";
import { Timeline } from "./components/Timeline";
import { Projects } from "./components/Projects";
import { StatusPanel } from "./components/StatusPanel";
import { api, AppStatus } from "./lib/api";
import "./App.css";

type Tab = "timeline" | "projects" | "status";

function App() {
  const [tab, setTab] = useState<Tab>("timeline");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.getAppStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 2000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  return (
    <div className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Local-only</p>
          <h1>AutoTrace</h1>
        </div>
        <div className="header-meta">
          {status && (
            <span
              className="badge"
              data-ok={status.tracker.status === "running"}
            >
              {status.tracker.status}
              {status.tracker.current_app
                ? ` · ${status.tracker.current_app}`
                : ""}
            </span>
          )}
          {status && (
            <span className="badge" data-ok={!status.network_enabled}>
              {status.network_enabled ? "Network on" : "No network"}
            </span>
          )}
        </div>
      </header>

      <nav className="tabs" aria-label="Main">
        {(
          [
            ["timeline", "Timeline"],
            ["projects", "Projects"],
            ["status", "Status"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="error">Error: {error}</p>}

      <main className="main">
        {tab === "timeline" && <Timeline onError={setError} />}
        {tab === "projects" && <Projects onError={setError} />}
        {tab === "status" && (
          <StatusPanel
            status={status}
            onPause={() => void api.pauseTracking().then(refreshStatus)}
            onResume={() => void api.resumeTracking().then(refreshStatus)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
