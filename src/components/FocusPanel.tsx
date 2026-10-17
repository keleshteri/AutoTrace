import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, BlockRule, todayLocal } from "../lib/api";
import { analyticsApi, FocusOverview, hoursLong } from "../lib/analyticsApi";
import { MiniBars, SERIES } from "./charts";

/** Right-hand Focus overview: today, this week, distractions during focus, quick block list. */
export function FocusPanel({ onError, refreshKey }: { onError: (msg: string | null) => void; refreshKey: unknown }) {
  const [data, setData] = useState<FocusOverview | null>(null);
  const [rules, setRules] = useState<BlockRule[]>([]);
  const [blocking, setBlocking] = useState(false);
  const [pattern, setPattern] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [o, r, b] = await Promise.all([
        analyticsApi.focusOverview(todayLocal()),
        api.listBlockRules(),
        api.getFeatureFlag("distraction_block"),
      ]);
      setData(o);
      setRules(r);
      setBlocking(b === "1");
    } catch (e) {
      onError(String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(id);
  }, [refresh, refreshKey]);

  async function addRule(e: FormEvent) {
    e.preventDefault();
    const p = pattern.trim().toLowerCase();
    if (!p) return;
    const field = p.includes(".") ? "url" : "app";
    try {
      await api.createBlockRule(p, field, "soft");
      setPattern("");
      void refresh();
    } catch (err) {
      onError(String(err));
    }
  }

  async function toggleBlocking(on: boolean) {
    await api.setFeatureFlag("distraction_block", on ? "1" : "0");
    setBlocking(on);
  }

  return (
    <div className="focus-panel">
      <div className="card">
        <p className="kicker">Today's focus</p>
        <p className="metric">{hoursLong(data?.focus_secs ?? 0)}</p>
        <p className="muted">
          {data?.focus_sessions ?? 0} focus session{data?.focus_sessions === 1 ? "" : "s"} · {hoursLong(data?.break_secs ?? 0)} of breaks
        </p>
      </div>

      <div className="card">
        <p className="kicker">This week</p>
        <MiniBars color={SERIES[0]} items={(data?.week ?? []).map(([label, secs]) => ({ label, secs }))} />
        <div className="kv">
          <span className="muted">Total</span>
          <b>{hoursLong(data?.week_total_secs ?? 0)}</b>
        </div>
        <div className="kv">
          <span className="muted">Average focus session</span>
          <b>{hoursLong(data?.week_avg_session_secs ?? 0)}</b>
        </div>
      </div>

      <div className="card">
        <p className="kicker">Top distractions</p>
        <p className="muted">
          <b className={data && data.distraction_secs > 0 ? "warn-text" : undefined}>{hoursLong(data?.distraction_secs ?? 0)}</b> during
          focus sessions today
        </p>
        <ol className="distraction-list">
          {(data?.top_distractions ?? []).map((d) => (
            <li key={d.label}>
              <span className="distraction-bar" style={{ width: `${Math.max(6, d.pct)}%` }} />
              <span className="distraction-label">{d.label}</span>
              <span className="muted">
                {d.pct.toFixed(0)}% · {hoursLong(d.secs)}
              </span>
            </li>
          ))}
        </ol>
        {data && data.top_distractions.length === 0 && <p className="muted">None detected. Nice.</p>}
      </div>

      <div className="card">
        <div className="kv">
          <p className="kicker" style={{ margin: 0 }}>
            Blocked during focus
          </p>
          <label className="switch" title={blocking ? "Blocking on" : "Blocking off"}>
            <input type="checkbox" checked={blocking} aria-label="Distraction blocking" onChange={(e) => void toggleBlocking(e.target.checked)} />
            <span />
          </label>
        </div>
        <ul className="block-list">
          {rules.map((r) => (
            <li key={r.id}>
              <span>{r.pattern}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${r.pattern}`}
                onClick={() => void api.deleteBlockRule(r.id).then(refresh).catch((e) => onError(String(e)))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addRule} className="block-add">
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="slack, youtube.com…" aria-label="App or site to block" />
          <button type="submit" className="btn small" disabled={!pattern.trim()}>
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
