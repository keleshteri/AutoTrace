import { useCallback, useEffect, useState } from "react";
import { api, todayLocal } from "../lib/api";
import { analyticsApi, CapacityReport, hoursLong } from "../lib/analyticsApi";
import { shiftMonth } from "../lib/time";
import { LineChart, SERIES } from "./charts";

type Props = { onError: (msg: string | null) => void; onOpenTimer: () => void };

function monthRange(anchor: string): [string, string] {
  const [y, m] = anchor.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`];
}

export function CapacityView({ onError, onOpenTimer }: Props) {
  const [anchor, setAnchor] = useState(todayLocal);
  const [report, setReport] = useState<CapacityReport | null>(null);
  const [capHours, setCapHours] = useState("40");
  const [capDays, setCapDays] = useState("5");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [from, to] = monthRange(anchor);

  const refresh = useCallback(async () => {
    try {
      setReport(await analyticsApi.capacityReport(from, to));
      onError(null);
    } catch (e) {
      onError(String(e));
    }
  }, [from, to, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void Promise.all([api.getFeatureFlag("capacity_hours_week"), api.getFeatureFlag("capacity_days_week")]).then(
      ([h, d]) => {
        if (h) setCapHours(h);
        if (d) setCapDays(d);
      },
    );
  }, []);

  async function saveCapacity() {
    const h = Number(capHours);
    const d = Number(capDays);
    if (!(h > 0 && h <= 168) || !(d >= 1 && d <= 7)) {
      onError("Capacity must be 1–168 hours over 1–7 days.");
      return;
    }
    await api.setFeatureFlag("capacity_hours_week", String(h));
    await api.setFeatureFlag("capacity_days_week", String(d));
    setSettingsOpen(false);
    void refresh();
  }

  const monthName = new Date(`${from}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const util = report?.utilization_pct ?? 0;
  const dots = 20;
  const filled = Math.min(dots, Math.round((util / 100) * dots));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Resourcing</h2>
          <p className="muted tt-sub">Planned vs tracked against your capacity — see overbooked weeks before they start.</p>
        </div>
        <div className="tt-head-actions">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setAnchor((a) => shiftMonth(a, -1))}>
            ‹
          </button>
          <span className="day-label">{monthName}</span>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setAnchor((a) => shiftMonth(a, 1))}>
            ›
          </button>
          <button type="button" className="btn ghost" onClick={() => setSettingsOpen((v) => !v)}>
            Settings
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="card capacity-settings">
          <label className="field">
            <span>Hours per week</span>
            <input type="number" min={1} max={168} value={capHours} onChange={(e) => setCapHours(e.target.value)} />
          </label>
          <label className="field">
            <span>Working days per week</span>
            <input type="number" min={1} max={7} value={capDays} onChange={(e) => setCapDays(e.target.value)} />
          </label>
          <button type="button" className="btn" onClick={() => void saveCapacity()}>
            Save
          </button>
        </div>
      )}

      <div className="tt-kpis">
        <div className="card tt-kpi">
          <p className="kicker">
            <span className="viz-swatch" style={{ background: SERIES[6] }} /> Tracked
          </p>
          <p className="metric">{hoursLong(report?.tracked_secs ?? 0)}</p>
          <p className="muted">{monthName}</p>
        </div>
        <div className="card tt-kpi">
          <p className="kicker">
            <span className="viz-swatch" style={{ background: SERIES[2] }} /> Planned
          </p>
          <p className="metric">{hoursLong(report?.planned_secs ?? 0)}</p>
          <button type="button" className="link-btn" onClick={onOpenTimer}>
            Plan sessions →
          </button>
        </div>
        <div className="card tt-kpi">
          <p className="kicker">
            <span className="viz-swatch" style={{ background: "#8b8b96" }} /> Capacity
          </p>
          <p className="metric">{hoursLong(report?.capacity_secs ?? 0)}</p>
          <p className="muted">{report?.weekly_capacity_hours ?? 40} h / week</p>
        </div>
        <div className="card tt-kpi">
          <p className="kicker">Utilization</p>
          <p className="metric">{util.toFixed(0)}%</p>
          <div className="util-dots" role="img" aria-label={`${util.toFixed(0)}% of capacity tracked`}>
            {Array.from({ length: dots }, (_, i) => (
              <span key={i} className={i < filled ? "on" : undefined} />
            ))}
          </div>
        </div>
      </div>

      {report && (
        <div className="card">
          <p className="kicker">Tracked vs planned · cumulative</p>
          <LineChart
            labels={report.days.map((d) => new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}
            series={[
              { key: "tracked", label: "Tracked", color: SERIES[6], values: report.days.map((d) => d.cum_tracked_secs) },
              { key: "planned", label: "Planned", color: SERIES[2], values: report.days.map((d) => d.cum_planned_secs) },
              { key: "capacity", label: "Capacity", color: "#8b8b96", values: report.days.map((d) => d.cum_capacity_secs), dashed: true },
            ]}
          />
        </div>
      )}

      {report && (
        <div className="card table-card" style={{ marginTop: 12 }}>
          <p className="kicker" style={{ padding: "0 4px" }}>
            Load by week
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Planned</th>
                <th>Tracked</th>
                <th>Capacity</th>
                <th>Load</th>
              </tr>
            </thead>
            <tbody>
              {report.weeks.map((w) => {
                const over = w.load_pct > 100;
                return (
                  <tr key={w.key}>
                    <td>{w.label}</td>
                    <td>{hoursLong(w.planned_secs)}</td>
                    <td>{hoursLong(w.tracked_secs)}</td>
                    <td className="muted">{hoursLong(w.capacity_secs)}</td>
                    <td>
                      <div className={`load-bar${over ? " over" : ""}`}>
                        <span style={{ width: `${Math.min(100, w.load_pct)}%` }} />
                        <b>
                          {over && (
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="load-warn">
                              <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />
                            </svg>
                          )}
                          {w.load_pct.toFixed(0)}%{over ? " · overbooked" : ""}
                        </b>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
