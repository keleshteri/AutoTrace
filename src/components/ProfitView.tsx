import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  ProfitabilityReport,
  downloadText,
  todayLocal,
} from "../lib/api";
import { formatHoursMinutes, shiftDay } from "../lib/time";

type Props = { onError: (msg: string | null) => void };

export function ProfitView({ onError }: Props) {
  const [from, setFrom] = useState(() => shiftDay(todayLocal(), -6));
  const [to, setTo] = useState(todayLocal);
  const [report, setReport] = useState<ProfitabilityReport | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReport(await api.getProfitabilityReport(from, to));
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [from, to, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function exportPdf(clientId: number) {
    const bytes = await api.exportClientPdf(clientId, from, to);
    const arr = Uint8Array.from(bytes);
    const blob = new Blob([arr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autotrace-client-${clientId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Utilization &amp; profitability</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="kpi-row">
        <div className="card">
          <p className="kicker">Tracked</p>
          <p className="metric" style={{ fontSize: 22 }}>
            {formatHoursMinutes(report?.tracked_minutes ?? 0)}
          </p>
        </div>
        <div className="card">
          <p className="kicker">Billable</p>
          <p className="metric" style={{ fontSize: 22 }}>
            {formatHoursMinutes(report?.billable_minutes ?? 0)}
          </p>
        </div>
        <div className="card">
          <p className="kicker">Utilization</p>
          <p className="metric" style={{ fontSize: 22 }}>
            {(report?.utilization_pct ?? 0).toFixed(1)}%
          </p>
        </div>
        <div className="card">
          <p className="kicker">Revenue</p>
          <p className="metric" style={{ fontSize: 22 }}>
            ${(report?.revenue ?? 0).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">By client</p>
        <ul className="legend">
          {(report?.by_client ?? []).map((r) => (
            <li key={r.key}>
              <span className="name">{r.label}</span>
              <span>{formatHoursMinutes(r.billable_minutes)}</span>
              <span>${r.revenue.toFixed(2)}</span>
              {/^\d+$/.test(r.key) && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void exportPdf(Number(r.key))}
                >
                  PDF
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="kicker">By project</p>
        <ul className="legend">
          {(report?.by_project ?? []).map((r) => (
            <li key={r.key}>
              <span className="name">{r.label}</span>
              <span>{formatHoursMinutes(r.billable_minutes)}</span>
              <span>${r.revenue.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TeamsView({ onError }: Props) {
  const [workspaces, setWorkspaces] = useState<
    Awaited<ReturnType<typeof api.listWorkspaces>>
  >([]);
  const [name, setName] = useState("");
  const [syncUrl, setSyncUrl] = useState("");
  const [syncToken, setSyncToken] = useState("");

  const refresh = useCallback(async () => {
    try {
      setWorkspaces(await api.listWorkspaces());
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createWorkspace(name.trim());
    setName("");
    await refresh();
  }

  const active = workspaces.find((w) => w.is_active) ?? workspaces[0];

  return (
    <div className="page">
      <div className="page-head">
        <h2>Teams &amp; sync</h2>
      </div>
      <p className="muted" style={{ padding: "0 20px" }}>
        Local workspaces stay on this device. Optional sync pushes an encrypted-friendly
        JSON pack to your own sync server (see <code>sync-server/</code>).
      </p>

      <form onSubmit={(e) => void add(e)} className="mini-form" style={{ margin: 20 }}>
        <label>
          New workspace
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agency" />
        </label>
        <button type="submit" className="primary">
          Create
        </button>
      </form>

      <div className="card" style={{ margin: 20 }}>
        <ul className="legend">
          {workspaces.map((w) => (
            <li key={w.id}>
              <span className="name">
                {w.name} {w.is_active ? "(active)" : ""}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => void api.setActiveWorkspace(w.id).then(refresh)}
              >
                Activate
              </button>
            </li>
          ))}
        </ul>
      </div>

      {active && (
        <div className="card" style={{ margin: 20 }}>
          <p className="kicker">Sync for {active.name}</p>
          <label className="muted">
            Sync URL
            <input
              style={{ width: "100%", marginTop: 4 }}
              value={syncUrl || active.sync_url || ""}
              onChange={(e) => setSyncUrl(e.target.value)}
              placeholder="https://your-sync.up.railway.app"
            />
          </label>
          <label className="muted" style={{ display: "block", marginTop: 8 }}>
            Sync token
            <input
              style={{ width: "100%", marginTop: 4 }}
              value={syncToken}
              onChange={(e) => setSyncToken(e.target.value)}
              placeholder="optional bearer"
            />
          </label>
          <div className="detail-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void api
                  .setWorkspaceSync(active.id, syncUrl || active.sync_url, syncToken || null)
                  .then(refresh)
              }
            >
              Save sync
            </button>
            <button
              type="button"
              className="primary"
              onClick={() =>
                void api
                  .pushSyncPack(active.id)
                  .then((r) => onError(`Synced: ${r}`))
                  .catch((e) => onError(String(e)))
              }
            >
              Push pack
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void api
                  .pullSyncPack(active.id)
                  .then((n) => onError(`Pulled / merged ${n} items`))
                  .catch((e) => onError(String(e)))
              }
            >
              Pull & merge
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void api.exportSyncPack().then((j) => downloadText("autotrace-sync.json", j))
              }
            >
              Export JSON
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
