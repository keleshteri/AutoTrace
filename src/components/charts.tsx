import { useEffect, useMemo, useRef, useState } from "react";
import { hoursCompact, hoursLong, TimeQueryResult } from "../lib/analyticsApi";

/** Categorical palette (dark), validated against --bg-panel #121214. Fixed order, never cycled. */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
export const OTHER_COLOR = "#5c5c68";

type Tip = { x: number; y: number; title: string; lines: { color: string; label: string; value: string }[] };

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="viz-tip-title">{tip.title}</div>
      {tip.lines.map((l) => (
        <div key={l.label} className="viz-tip-line">
          <span className="viz-swatch" style={{ background: l.color }} />
          <span className="viz-tip-label">{l.label}</span>
          <span className="viz-tip-value">{l.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Axis max (seconds) on a 4-tick grid with round hour steps. */
function niceMax(v: number): number {
  if (v <= 0) return 3600;
  const h = v / 3600;
  const steps = [0.25, 0.5, 1, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100, 150, 200, 250, 500, 1000];
  const step = steps.find((s) => s * 4 >= h) ?? Math.ceil(h / 4);
  return step * 4 * 3600;
}

/** Track a container's pixel width so SVG text stays at its real size. */
function useWidth(min: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w];
}

/** Stacked bars: one bar per column, segments = top rows (+ Other). */
export function StackedBars({ result }: { result: TimeQueryResult }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [wrapRef, wrapW] = useWidth(result.cols.length * 28 + 60);
  const series = useMemo(() => {
    const top = result.rows.slice(0, SERIES.length).map((r, i) => ({
      key: r.key,
      label: r.label,
      color: SERIES[i],
      values: result.cells[i],
    }));
    if (result.rows.length > SERIES.length) {
      const other = result.cols.map((_, c) =>
        result.cells.slice(SERIES.length).reduce((acc, row) => acc + row[c], 0),
      );
      top.push({ key: "__other", label: `Other (${result.rows.length - SERIES.length})`, color: OTHER_COLOR, values: other });
    }
    return top;
  }, [result]);

  if (result.cols.length === 0 || result.kpis.total_secs === 0) {
    return <p className="muted tt-empty">No tracked time to chart.</p>;
  }

  const W = wrapW;
  const H = 280;
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(...result.col_totals));
  const slot = plotW / result.cols.length;
  const barW = Math.max(6, Math.min(40, slot * 0.62));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(result.cols.length / 16);

  return (
    <div className="viz">
      <div className="viz-legend">
        {series.map((s) => (
          <span key={s.key} className="viz-legend-item">
            <span className="viz-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="viz-scroll" ref={wrapRef} onMouseLeave={() => setTip(null)}>
        <svg width={W} height={H} role="img" aria-label="Tracked time by column, stacked by row">
          {ticks.map((t) => {
            const y = pad.t + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="viz-grid" />
                <text x={pad.l - 8} y={y + 4} className="viz-axis" textAnchor="end">
                  {t === 0 ? "0" : `${+(t / 3600).toFixed(1)}h`}
                </text>
              </g>
            );
          })}
          {result.cols.map((c, ci) => {
            const x = pad.l + ci * slot + (slot - barW) / 2;
            let yCursor = pad.t + plotH;
            const segs = series
              .map((s) => ({ s, v: s.values[ci] }))
              .filter((x) => x.v > 0);
            return (
              <g
                key={c.key}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({
                    x: e.clientX - box.left + 14,
                    y: e.clientY - box.top + 8,
                    title: `${c.label} · ${hoursLong(result.col_totals[ci])}`,
                    lines: segs.map(({ s, v }) => ({ color: s.color, label: s.label, value: hoursCompact(v) })),
                  });
                }}
              >
                <rect x={pad.l + ci * slot} y={pad.t} width={slot} height={plotH} fill="transparent" />
                {segs.map(({ s, v }, si) => {
                  const h = (v / max) * plotH;
                  yCursor -= h;
                  const isTop = si === segs.length - 1;
                  // 2px surface gap between stacked segments.
                  const gap = si > 0 ? 2 : 0;
                  return isTop ? (
                    <path
                      key={s.key}
                      d={roundedTop(x, yCursor, barW, Math.max(0, h - gap), Math.min(4, h / 2))}
                      fill={s.color}
                    />
                  ) : (
                    <rect key={s.key} x={x} y={yCursor} width={barW} height={Math.max(0, h - gap)} fill={s.color} />
                  );
                })}
                {ci % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H - pad.b + 16} className="viz-axis" textAnchor="middle">
                    {c.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} className="viz-baseline" />
        </svg>
        <Tooltip tip={tip} />
      </div>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export type LineSeries = { key: string; label: string; color: string; values: number[]; dashed?: boolean };

/** Multi-line chart with crosshair tooltip. Values in seconds. */
export function LineChart({ labels, series, height = 240 }: { labels: string[]; series: LineSeries[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useWidth(320);
  if (labels.length === 0) return <p className="muted">No data.</p>;
  const H = height;
  const pad = { l: 52, r: 16, t: 12, b: 28 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => pad.l + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(labels.length / 8);

  return (
    <div className="viz">
      <div className="viz-legend">
        {series.map((s) => (
          <span key={s.key} className="viz-legend-item">
            <span className={`viz-swatch line${s.dashed ? " dashed" : ""}`} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="viz-scroll" ref={wrapRef}>
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={series.map((s) => s.label).join(", ")}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - box.left;
            const i = Math.round(((px - pad.l) / plotW) * (labels.length - 1));
            setHover(Math.max(0, Math.min(labels.length - 1, i)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={pad.l - 8} y={y(t) + 4} className="viz-axis" textAnchor="end">
                {t === 0 ? "0" : `${Math.round(t / 3600).toLocaleString()}h`}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <text key={l + i} x={x(i)} y={H - 8} className="viz-axis" textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
          {series.map((s) => (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            />
          ))}
          {series.map((s) => (
            <circle
              key={`${s.key}-end`}
              cx={x(s.values.length - 1)}
              cy={y(s.values[s.values.length - 1] ?? 0)}
              r={4}
              fill={s.color}
              stroke="var(--bg-panel)"
              strokeWidth={2}
            />
          ))}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} className="viz-crosshair" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="var(--bg-panel)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hover != null && (
          <div
            className="viz-tip"
            style={{ left: x(hover), top: 8, transform: hover > labels.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
          >
            <div className="viz-tip-title">{labels[hover]}</div>
            {series.map((s) => (
              <div key={s.key} className="viz-tip-line">
                <span className="viz-swatch" style={{ background: s.color }} />
                <span className="viz-tip-label">{s.label}</span>
                <span className="viz-tip-value">{hoursLong(s.values[hover] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple single-series column bars (e.g. this week's focus). */
export function MiniBars({ items, color = SERIES[0] }: { items: { label: string; secs: number }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.secs));
  return (
    <div className="mini-bars" role="img" aria-label="Daily totals">
      {items.map((i) => (
        <div key={i.label} className="mini-bar" title={`${i.label}: ${hoursLong(i.secs)}`}>
          <div className="mini-bar-track">
            <div className="mini-bar-fill" style={{ height: `${(i.secs / max) * 100}%`, background: color }} />
          </div>
          <span>{i.label}</span>
        </div>
      ))}
    </div>
  );
}
