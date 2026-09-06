import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "../lib/api";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up_to_date"; current: string; latest: string }
  | {
      kind: "available";
      current: string;
      latest: string;
      notes: string;
      releaseUrl: string;
      canAutoInstall: boolean;
    }
  | { kind: "downloading"; progress: string }
  | { kind: "error"; message: string };

export function UpdatePanel() {
  const [installed, setInstalled] = useState("…");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    void api
      .getAppStatus()
      .then((s) => setInstalled(s.version))
      .catch(() => setInstalled("unknown"));
  }, []);

  async function checkUpdates() {
    setStatus({ kind: "checking" });
    try {
      try {
        const update = await check();
        if (update) {
          setStatus({
            kind: "available",
            current: update.currentVersion,
            latest: update.version,
            notes: update.body ?? "",
            releaseUrl: `https://github.com/keleshteri/AutoTrace/releases/tag/v${update.version}`,
            canAutoInstall: true,
          });
          return;
        }
      } catch {
        // Fall through to GitHub release metadata (manual download).
      }

      const gh = await api.checkGithubUpdate();
      setInstalled(gh.current_version);
      if (gh.update_available) {
        setStatus({
          kind: "available",
          current: gh.current_version,
          latest: gh.latest_version,
          notes: gh.release_notes,
          releaseUrl: gh.release_url,
          canAutoInstall: false,
        });
      } else {
        setStatus({
          kind: "up_to_date",
          current: gh.current_version,
          latest: gh.latest_version || gh.current_version,
        });
      }
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function installUpdate() {
    setStatus({ kind: "downloading", progress: "Downloading…" });
    try {
      const update = await check();
      if (!update) {
        setStatus({ kind: "error", message: "No signed update package found." });
        return;
      }
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          setStatus({ kind: "downloading", progress: "Starting download…" });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct =
            contentLength > 0
              ? Math.min(100, Math.round((downloaded / contentLength) * 100))
              : null;
          setStatus({
            kind: "downloading",
            progress: pct != null ? `Downloading ${pct}%` : "Downloading…",
          });
        } else if (event.event === "Finished") {
          setStatus({ kind: "downloading", progress: "Installing… restarting" });
        }
      });
      await relaunch();
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const shownVersion =
    status.kind === "available" || status.kind === "up_to_date"
      ? status.current
      : installed;

  return (
    <div className="settings-shell-card">
      <h2>Updates</h2>
      <p className="muted">
        Check GitHub for a newer release. When signed updater packages are published, you can
        install in-app and restart.
      </p>

      <div className="settings-shell-row">
        <div>
          <div>Installed version</div>
          <div className="muted">This build</div>
        </div>
        <code>v{shownVersion}</code>
      </div>

      {status.kind === "idle" && (
        <p className="muted" style={{ marginTop: 8 }}>
          Click check to see if a newer version is available.
        </p>
      )}
      {status.kind === "checking" && <p className="muted">Checking for updates…</p>}
      {status.kind === "up_to_date" && (
        <p style={{ marginTop: 10 }}>
          You&apos;re on the latest version (<b>v{status.current}</b>).
        </p>
      )}
      {status.kind === "available" && (
        <div style={{ marginTop: 12 }}>
          <p>
            Update available: <b>v{status.current}</b> → <b>v{status.latest}</b>
          </p>
          {status.notes && (
            <pre
              className="muted"
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 12,
                maxHeight: 160,
                overflow: "auto",
                marginTop: 8,
              }}
            >
              {status.notes}
            </pre>
          )}
          <div className="detail-actions" style={{ marginTop: 12 }}>
            {status.canAutoInstall ? (
              <button type="button" className="primary" onClick={() => void installUpdate()}>
                Download &amp; install
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => void api.openExternalUrl(status.releaseUrl)}
              >
                Open download page
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void api.openExternalUrl(status.releaseUrl)}
            >
              View release
            </button>
          </div>
          {!status.canAutoInstall && (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Signed in-app install isn&apos;t available for this release yet — download the
              installer for your OS from GitHub Releases.
            </p>
          )}
        </div>
      )}
      {status.kind === "downloading" && <p>{status.progress}</p>}
      {status.kind === "error" && (
        <p style={{ color: "#f87171", marginTop: 8 }}>{status.message}</p>
      )}

      <div className="detail-actions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn"
          disabled={status.kind === "checking" || status.kind === "downloading"}
          onClick={() => void checkUpdates()}
        >
          Check for updates
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            void api.openExternalUrl("https://github.com/keleshteri/AutoTrace/releases")
          }
        >
          All releases
        </button>
      </div>
    </div>
  );
}
