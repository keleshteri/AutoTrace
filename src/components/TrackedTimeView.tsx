import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadText, SessionRow } from "../lib/api";
import {
  analyticsApi,
  Dashboard,
  dimLabel,
  DIMENSIONS,
  hoursCompact,
  hoursLong,
  PERIODS,
  QueryFilter,
  TimeQuery,
  TimeQueryResult,
} from "../lib/analyticsApi";
import { shiftDay } from "../lib/time";
import { StackedBars } from "./charts";

type Tab = "tables" | "charts" | "log";

type Props = {
  onError: (msg: string | null) => void;
  /** When set, the view edits/saves this dashboard instead of the scratch query. */
  dashboard?: Dashboard | null;
  onDashboardSaved?: (d: Dashboard) => void;
  onDashboardDeleted?: () => void;
};

const SCRATCH_KEY = "autotrace.trackedTime.v1";

function loadScratch(): { query: Partial<TimeQuery>; period: string } | null {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000) + 1;
}

/** Sub-dimension used when expanding a row. */
function drillDim(rowsBy: string): string {
  if (rowsBy === "client") return "project";
  if (rowsBy === "project") return "task";
  if (rowsBy === "app") return "domain";
  return rowsBy === "category" ? "app" : "project";
}

export function TrackedTimeView({ onError, dashboard, onDashboardSaved, onDashboardDeleted }: Props) {
  const scratch = dashboard ? null : loadScratch();
  const [period, setPeriod] = useState<string>(dashboard?.period ?? scratch?.period ?? "week");
  const [query, setQuery] = useState<TimeQuery>(() => ({
    from: "",
    to: "",
    rows_by: "project",
    cols_by: "day",
    filters: [],
    include_idle: false,
    compare_previous: true,
    ...(scratch?.query ?? {}),
    ...(dashboard?.query ?? {}),
  }));
  const [result, setResult] = useState<TimeQueryResult | null>(null);
  const [tab, setTab] = useState<Tab>("tables");
  const [pct, setPct] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, TimeQueryResult | null>>({});
  const [logCell, setLogCell] = useState<{ row?: string; col?: string; label: string } | null>(null);
  const [log, setLog] = useState<SessionRow[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reset when switching dashboards.
  useEffect(() => {
    if (!dashboard) return;
    setPeriod(dashboard.period);
    setQuery({ ...dashboard.query });
    setExpanded({});
    setLogCell(null);
  }, [dashboard?.id, dashboard?.updated_at]);

  // Resolve relative periods into dates.
  useEffect(() => {
    if (period === "custom") return;
    let cancelled = false;
    void analyticsApi.resolvePeriod(period).then(([from, to]) => {
      if (!cancelled) setQuery((q) => (q.from === from && q.to === to ? q : { ...q, from, to }));
    });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const refresh = useCallback(async () => {
    if (!query.from || !query.to) return;
    setLoading(true);
    try {
      setResult(await analyticsApi.runTimeQuery(query));
      setExpanded({});
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (dashboard) return;
    try {
      localStorage.setItem(SCRATCH_KEY, JSON.stringify({ query, period }));
    } catch {
      /* per-viewer convenience only */
    }
  }, [query, period, dashboard]);

  useEffect(() => {
    if (tab !== "log" || !query.from) return;
    void analyticsApi
      .timeQuerySessions(query, logCell?.row, logCell?.col)
      .then(setLog)
      .catch((e) => onError(String(e)));
  }, [tab, query, logCell, onError]);

  function shiftRange(dir: -1 | 1) {
    const n = daysBetween(query.from, query.to);
    setPeriod("custom");
    setQuery((q) => ({ ...q, from: shiftDay(q.from, dir * n), to: shiftDay(q.to, dir * n) }));
  }

  async function toggleRow(key: string) {
    if (key in expanded) {
      setExpanded((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
      return;
    }
    setExpanded((e) => ({ ...e, [key]: null }));
    try {
      const sub = await analyticsApi.runTimeQuery({
        ...query,
        rows_by: drillDim(query.rows_by),
        filters: [...query.filters, { dim: query.rows_by, values: [key] }],
        compare_previous: false,
      });
      setExpanded((e) => (key in e ? { ...e, [key]: sub } : e));
    } catch (e) {
      onError(String(e));
    }
  }

  async function exportCsv() {
    const csv = await analyticsApi.exportTimeQueryCsv(query);
    downloadText(`autotrace-${query.rows_by}-${query.from}_to_${query.to}.csv`, csv);
  }

  const visibleRows = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    return result.rows
      .map((r, i) => ({ ...r, i }))
      .filter((r) => !q || r.label.toLowerCase().includes(q));
  }, [result, search]);

  const maxCell = useMemo(() => {
    if (!result) return 1;
    let m = 1;
    for (const row of result.cells) for (const v of row) m = Math.max(m, v);
    return m;
  }, [result]);

  const total = result?.kpis.total_secs ?? 0;
  const fmt = (secs: number) =>
    pct ? (secs > 0 && total > 0 ? `${((secs / total) * 100).toFixed(1)}%` : "–") : hoursCompact(secs);

  const title = dashboard?.name ?? "Tracked Time";

  return (
    <div className="page tt-page">
      <div className="page-head tt-head">
        <div>
          {dashboard && <p className="tt-crumb">Dashboards /</p>}
          <h2>{title}</h2>
          {dashboard?.description && <p className="muted tt-sub">{dashboard.description}</p>}
        </div>
        <div className="tt-head-actions">
          <button type="button" className="icon-btn" aria-label="Previous period" onClick={() => shiftRange(-1)}>
            ‹
          </button>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {period === "custom" && (
            <>
              <input
                type="date"
                value={query.from}
                aria-label="From"
                onChange={(e) => setQuery((q) => ({ ...q, from: e.target.value }))}
              />
              <input
                type="date"
                value={query.to}
                aria-label="To"
                onChange={(e) => setQuery((q) => ({ ...q, to: e.target.value }))}
              />
            </>
          )}
          <button type="button" className="icon-btn" aria-label="Next period" onClick={() => shiftRange(1)}>
            ›
          </button>
          <button type="button" className="btn" onClick={() => setSaveOpen(true)}>
            {dashboard ? "Save" : "Save as dashboard"}
          </button>
          <button type="button" className="btn ghost" onClick={() => void exportCsv()}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="tt-kpis">
        <Kpi
          label="Time spent"
          value={hoursLong(total)}
          delta={result?.delta_pct ?? null}
          deltaNote={result?.previous ? "vs previous period" : undefined}
        />
        <Kpi label="Entries logged" value={String(result?.kpis.entries ?? 0)} />
        <Kpi label="Active days" value={`${result?.kpis.active_days ?? 0} / ${query.from ? daysBetween(query.from, query.to) : 0}`} />
        <Kpi label="Daily average" value={hoursLong(result?.kpis.daily_avg_secs ?? 0)} />
        <Kpi
          label="Billable"
          value={total > 0 ? `${Math.round(((result?.kpis.billable_secs ?? 0) / total) * 100)}%` : "–"}
        />
      </div>

      <div className="card tt-card">
        <div className="tt-tabs" role="tablist">
          {(["tables", "charts", "log"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "active" : undefined}
              onClick={() => setTab(t)}
            >
              {t === "tables" ? "Tables" : t === "charts" ? "Charts" : "Log"}
            </button>
          ))}
          {loading && <span className="muted tt-loading">Updating…</span>}
        </div>

        <div className="tt-toolbar">
          <label className="tt-pick">
            <span>Rows by</span>
            <select
              value={query.rows_by}
              onChange={(e) => setQuery((q) => ({ ...q, rows_by: e.target.value }))}
            >
              {DIMENSIONS.filter((d) => d.id !== "none").map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tt-pick">
            <span>Columns by</span>
            <select
              value={query.cols_by}
              onChange={(e) => setQuery((q) => ({ ...q, cols_by: e.target.value }))}
            >
              {DIMENSIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <input
            className="tt-search"
            type="search"
            placeholder="Search rows"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className={`chip-btn${query.filters.length ? " on" : ""}`}
            onClick={() => setFilterOpen((v) => !v)}
          >
            Filter{query.filters.length ? ` · ${query.filters.length}` : ""}
          </button>
          <label className="tt-check">
            <input
              type="checkbox"
              checked={query.include_idle}
              onChange={(e) => setQuery((q) => ({ ...q, include_idle: e.target.checked }))}
            />
            Include idle
          </label>
          <div className="seg" role="group" aria-label="Units">
            <button type="button" className={!pct ? "active" : undefined} onClick={() => setPct(false)}>
              h
            </button>
            <button type="button" className={pct ? "active" : undefined} onClick={() => setPct(true)}>
              %
            </button>
          </div>
        </div>

        {filterOpen && (
          <FilterEditor
            query={query}
            onChange={(filters) => setQuery((q) => ({ ...q, filters }))}
            onError={onError}
          />
        )}

        {tab === "tables" && result && (
          <div className="tt-table-wrap">
            <table className="tt-table">
              <thead>
                <tr>
                  <th className="tt-rowhead">{dimLabel(query.rows_by)}</th>
                  {result.cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th className="tt-total">Σ Total</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={result.cols.length + 2} className="muted tt-empty">
                      No tracked time for this selection.
                    </td>
                  </tr>
                )}
                {visibleRows.map((r) => (
                  <RowGroup
                    key={r.key}
                    label={r.label}
                    cells={result.cells[r.i]}
                    total={result.row_totals[r.i]}
                    cols={result.cols}
                    maxCell={maxCell}
                    fmt={fmt}
                    expanded={r.key in expanded}
                    sub={expanded[r.key]}
                    onToggle={() => void toggleRow(r.key)}
                    onCell={(col, colLabel) => {
                      setLogCell({
                        row: r.key,
                        col: query.cols_by === "none" ? undefined : col,
                        label: query.cols_by === "none" ? r.label : `${r.label} · ${colLabel}`,
                      });
                      setTab("log");
                    }}
                  />
                ))}
              </tbody>
              {visibleRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td className="tt-rowhead">Total</td>
                    {result.col_totals.map((v, i) => (
                      <td key={result.cols[i].key}>{fmt(v)}</td>
                    ))}
                    <td className="tt-total">{fmt(total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {tab === "charts" && result && <StackedBars result={result} />}

        {tab === "log" && (
          <div className="tt-log">
            {logCell && (
              <div className="tt-log-filter">
                <span>
                  Showing <b>{logCell.label}</b>
                </span>
                <button type="button" className="chip-btn" onClick={() => setLogCell(null)}>
                  Clear ✕
                </button>
              </div>
            )}
            <div className="tt-table-wrap">
              <table className="tt-table tt-log-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Duration</th>
                    <th>App</th>
                    <th>Title</th>
                    <th>Project</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {log.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted tt-empty">
                        No entries.
                      </td>
                    </tr>
                  )}
                  {log.slice(0, 500).map((s) => (
                    <tr key={s.id}>
                      <td>{s.started_at.slice(0, 10)}</td>
                      <td>
                        {s.started_at.slice(11, 16)}–{(s.ended_at ?? "").slice(11, 16)}
                      </td>
                      <td>{hoursCompact(sessionSecs(s))}</td>
                      <td>{s.app_name ?? "–"}</td>
                      <td className="tt-ellipsis" title={s.title ?? ""}>
                        {s.title ?? "–"}
                      </td>
                      <td>{s.project_name ?? <span className="muted">No label</span>}</td>
                      <td>{s.category ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {log.length > 500 && <p className="muted">Showing first 500 of {log.length} entries.</p>}
          </div>
        )}
      </div>

      {saveOpen && (
        <SaveDashboardModal
          dashboard={dashboard ?? null}
          query={query}
          period={period}
          onClose={() => setSaveOpen(false)}
          onSaved={(d) => {
            setSaveOpen(false);
            onDashboardSaved?.(d);
          }}
          onDeleted={() => {
            setSaveOpen(false);
            onDashboardDeleted?.();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function sessionSecs(s: SessionRow): number {
  const a = Date.parse(s.started_at);
  const b = Date.parse(s.ended_at ?? s.started_at);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / 1000) : 0;
}

function Kpi({
  label,
  value,
  delta,
  deltaNote,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaNote?: string;
}) {
  return (
    <div className="card tt-kpi">
      <p className="kicker">{label}</p>
      <p className="metric">{value}</p>
      {delta != null ? (
        <p className={`tt-delta ${Math.round(delta) === 0 ? "flat" : delta < 0 ? "down" : "up"}`}>
          {Math.round(delta) === 0 ? "→" : delta < 0 ? "↓" : "↑"} {Math.abs(delta).toFixed(0)}%{" "}
          <span className="muted">{deltaNote}</span>
        </p>
      ) : (
        deltaNote && <p className="tt-delta muted">No previous data</p>
      )}
    </div>
  );
}

function RowGroup({
  label,
  cells,
  total,
  cols,
  maxCell,
  fmt,
  expanded,
  sub,
  onToggle,
  onCell,
}: {
  label: string;
  cells: number[];
  total: number;
  cols: { key: string; label: string }[];
  maxCell: number;
  fmt: (s: number) => string;
  expanded: boolean;
  sub: TimeQueryResult | null | undefined;
  onToggle: () => void;
  onCell: (colKey: string, colLabel: string) => void;
}) {
  return (
    <>
      <tr>
        <td className="tt-rowhead">
          <button type="button" className="tt-expand" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? "▾" : "›"}
          </button>
          <span className="tt-row-label" title={label}>
            {label}
          </span>
        </td>
        {cells.map((v, i) => (
          <td
            key={cols[i].key}
            className={v > 0 ? "tt-cell" : "tt-cell empty"}
            style={v > 0 ? { background: heat(v / maxCell) } : undefined}
            title={v > 0 ? `${label} · ${cols[i].label}: ${hoursLong(v)}` : undefined}
          >
            {v > 0 ? (
              <button type="button" onClick={() => onCell(cols[i].key, cols[i].label)}>
                {fmt(v)}
              </button>
            ) : (
              "–"
            )}
          </td>
        ))}
        <td className="tt-total">{fmt(total)}</td>
      </tr>
      {expanded && sub === null && (
        <tr className="tt-subrow">
          <td colSpan={cells.length + 2} className="muted">
            Loading…
          </td>
        </tr>
      )}
      {expanded &&
        sub &&
        sub.rows.map((r, i) => (
          <tr key={r.key} className="tt-subrow">
            <td className="tt-rowhead">
              <span className="tt-row-label" title={r.label}>
                {r.label}
              </span>
            </td>
            {sub.cells[i].map((v, j) => (
              <td key={sub.cols[j].key} className={v > 0 ? "tt-cell" : "tt-cell empty"}>
                {fmt(v)}
              </td>
            ))}
            <td className="tt-total">{fmt(sub.row_totals[i])}</td>
          </tr>
        ))}
    </>
  );
}

/** Single-hue (accent) sequential shading for busy cells. */
function heat(t: number): string {
  const a = 0.08 + Math.min(1, Math.max(0, t)) * 0.42;
  return `rgba(124, 92, 250, ${a.toFixed(3)})`;
}

function FilterEditor({
  query,
  onChange,
  onError,
}: {
  query: TimeQuery;
  onChange: (f: QueryFilter[]) => void;
  onError: (msg: string | null) => void;
}) {
  const [dim, setDim] = useState("project");
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);

  useEffect(() => {
    if (!query.from) return;
    void analyticsApi
      .runTimeQuery({ ...query, rows_by: dim, cols_by: "none", filters: [], compare_previous: false })
      .then((r) => setOptions(r.rows))
      .catch((e) => onError(String(e)));
  }, [dim, query.from, query.to, query.include_idle]);

  const current = query.filters.find((f) => f.dim === dim)?.values ?? [];

  function toggle(key: string) {
    const values = current.includes(key) ? current.filter((v) => v !== key) : [...current, key];
    const others = query.filters.filter((f) => f.dim !== dim);
    onChange(values.length ? [...others, { dim, values }] : others);
  }

  return (
    <div className="tt-filter">
      <div className="tt-filter-head">
        <select value={dim} onChange={(e) => setDim(e.target.value)} aria-label="Filter dimension">
          {DIMENSIONS.filter((d) => !["none", "day", "week", "month", "hour"].includes(d.id)).map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        {query.filters.map((f) => (
          <span key={f.dim} className="tt-filter-chip">
            {dimLabel(f.dim)}: {f.values.length}
            <button
              type="button"
              aria-label={`Remove ${dimLabel(f.dim)} filter`}
              onClick={() => onChange(query.filters.filter((x) => x.dim !== f.dim))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="tt-filter-options">
        {options.length === 0 && <span className="muted">No values in this range.</span>}
        {options.map((o) => (
          <label key={o.key} className="tt-check">
            <input type="checkbox" checked={current.includes(o.key)} onChange={() => toggle(o.key)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function SaveDashboardModal({
  dashboard,
  query,
  period,
  onClose,
  onSaved,
  onDeleted,
  onError,
}: {
  dashboard: Dashboard | null;
  query: TimeQuery;
  period: string;
  onClose: () => void;
  onSaved: (d: Dashboard) => void;
  onDeleted: () => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(dashboard?.name ?? `${dimLabel(query.rows_by)} by ${dimLabel(query.cols_by)}`);
  const [description, setDescription] = useState(dashboard?.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(asNew: boolean) {
    try {
      const d = await analyticsApi.saveDashboard({
        id: asNew ? null : dashboard?.id,
        name,
        description: description || null,
        query,
        period,
        pinned: dashboard?.pinned ?? true,
      });
      onSaved(d);
    } catch (e) {
      onError(String(e));
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-label="Save dashboard" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{dashboard ? "Save dashboard" : "Save as dashboard"}</h3>
        <p className="muted">
          Saves rows, columns, filters and the period ({PERIODS.find((p) => p.id === period)?.label}). Pinned
          dashboards appear under Analyze in the sidebar and are available to Reports, chat @mentions and MCP.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </label>
        <div className="modal-actions">
          {dashboard &&
            (confirmDelete ? (
              <button
                type="button"
                className="btn danger"
                onClick={() =>
                  void analyticsApi
                    .deleteDashboard(dashboard.id)
                    .then(onDeleted)
                    .catch((e) => onError(String(e)))
                }
              >
                Confirm delete
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          {dashboard && (
            <button type="button" className="btn ghost" onClick={() => void save(true)}>
              Save as new
            </button>
          )}
          <button type="button" className="btn" disabled={!name.trim()} onClick={() => void save(false)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
