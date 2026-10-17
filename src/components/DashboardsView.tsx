import { useCallback, useEffect, useState } from "react";
import { analyticsApi, Dashboard, DashboardTemplate, dimLabel, periodLabel } from "../lib/analyticsApi";

type Props = {
  onError: (msg: string | null) => void;
  onOpen: (d: Dashboard) => void;
  onNewFromScratch: () => void;
  onChanged: () => void;
};

export function DashboardsView({ onError, onOpen, onNewFromScratch, onChanged }: Props) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [templates, setTemplates] = useState<DashboardTemplate[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([analyticsApi.listDashboards(), analyticsApi.listDashboardTemplates()]);
      setDashboards(d);
      setTemplates(t);
      onError(null);
    } catch (e) {
      onError(String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function useTemplate(slug: string) {
    try {
      const d = await analyticsApi.createDashboardFromTemplate(slug);
      onChanged();
      onOpen(d);
    } catch (e) {
      onError(String(e));
    }
  }

  async function togglePin(d: Dashboard) {
    await analyticsApi.setDashboardPinned(d.id, !d.pinned);
    onChanged();
    void refresh();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Dashboards</h2>
          <p className="muted tt-sub">Save the views you check every week. Reports, chat @mentions and MCP can all use them.</p>
        </div>
        <button type="button" className="btn" onClick={onNewFromScratch}>
          + New dashboard
        </button>
      </div>

      <p className="section-label">Your dashboards · {dashboards.length}</p>
      {dashboards.length === 0 ? (
        <div className="card empty-card">
          <p>No dashboards yet.</p>
          <p className="muted">Start from a template below, or open Tracked Time and choose “Save as dashboard”.</p>
        </div>
      ) : (
        <div className="dash-grid">
          {dashboards.map((d) => (
            <div key={d.id} className="card dash-card">
              <button type="button" className="dash-card-main" onClick={() => onOpen(d)}>
                <span className="dash-card-name">{d.name}</span>
                {d.description && <span className="muted">{d.description}</span>}
                <span className="dash-card-meta">
                  {dimLabel(d.query.rows_by)} × {dimLabel(d.query.cols_by)} · {periodLabel(d.period)}
                  {d.query.filters.length > 0 && ` · ${d.query.filters.length} filter${d.query.filters.length > 1 ? "s" : ""}`}
                </span>
              </button>
              <button
                type="button"
                className={`pin-btn${d.pinned ? " on" : ""}`}
                aria-pressed={d.pinned}
                title={d.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                onClick={() => void togglePin(d)}
              >
                {d.pinned ? "★" : "☆"}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="section-label">Templates · {templates.length}</p>
      <div className="dash-grid">
        {templates.map((t) => (
          <div key={t.slug} className="card dash-card template">
            <div className="dash-card-main static">
              <span className="dash-card-name">{t.name}</span>
              <span className="muted">{t.description}</span>
              <span className="dash-card-meta">
                {dimLabel(t.rows_by)} × {dimLabel(t.cols_by)} · {periodLabel(t.period)}
              </span>
            </div>
            <button type="button" className="btn ghost small" onClick={() => void useTemplate(t.slug)}>
              Use →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
