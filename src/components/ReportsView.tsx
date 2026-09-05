import { useCallback, useEffect, useState } from "react";
import { api, DayReport, downloadText, todayLocal } from "../lib/api";
import { formatHoursMinutes, shiftDay } from "../lib/time";

type Props = { onError: (msg: string | null) => void };

export function ReportsView({ onError }: Props) {
  const [day, setDay] = useState(todayLocal);
  const [report, setReport] = useState<DayReport | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReport(await api.getDayReport(day));
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [day, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function exportCsv() {
    const csv = await api.exportCsvForDay(day);
    downloadText(`autotrace-${day}.csv`, csv);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Reports</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="icon-btn" onClick={() => setDay((d) => shiftDay(d, -1))}>
            ‹
          </button>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <button type="button" className="icon-btn" onClick={() => setDay((d) => shiftDay(d, 1))}>
            ›
          </button>
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="card">
          <p className="kicker">Tracked</p>
          <p className="metric" style={{ fontSize: 22 }}>
            {formatHoursMinutes(report?.total_minutes ?? 0)}
          </p>
        </div>
        <div className="card">
          <p className="kicker">Idle</p>
          <p className="metric" style={{ fontSize: 22 }}>
            {formatHoursMinutes(report?.idle_minutes ?? 0)}
          </p>
        </div>
        <div className="card">
          <p className="kicker">Projects</p>
          <p className="metric" style={{ fontSize: 22 }}>
            {report?.by_project.length ?? 0}
          </p>
        </div>
      </div>

      <Section title="By project" rows={report?.by_project ?? []} />
      <Section title="By app" rows={report?.by_app ?? []} />
      <Section title="By client" rows={report?.by_client ?? []} />
    </div>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; minutes: number; sessions: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <p className="kicker">{title}</p>
      {rows.length === 0 && <p className="muted">No data for this day.</p>}
      <ul className="legend" style={{ marginTop: 10 }}>
        {rows.map((r) => (
          <li key={r.label} style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="name">{r.label}</span>
              <span>
                {formatHoursMinutes(r.minutes)} · {r.sessions} sess
              </span>
            </div>
            <div className="progress">
              <span style={{ width: `${(r.minutes / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
