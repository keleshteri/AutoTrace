import { Fragment, type ReactNode } from "react";
import type { Schedule } from "../lib/analyticsApi";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const timed = ["daily", "weekdays", "weekly"].includes(value.kind);
  return (
    <div className="schedule-editor">
      <select
        value={value.kind}
        aria-label="Repeat"
        onChange={(e) =>
          onChange({
            kind: e.target.value,
            time: value.time ?? "09:00",
            weekday: e.target.value === "weekly" ? (value.weekday ?? 0) : null,
          })
        }
      >
        <option value="manual">On demand</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Weekdays</option>
        <option value="weekly">Weekly</option>
        <option value="hourly">Every hour</option>
      </select>
      {value.kind === "weekly" && (
        <select
          value={value.weekday ?? 0}
          aria-label="Weekday"
          onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}
        >
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      )}
      {timed && (
        <input
          type="time"
          aria-label="Time"
          value={value.time ?? "09:00"}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
        />
      )}
    </div>
  );
}

/** Inline **bold** / `code` → React nodes (no HTML injection). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <b key={i++}>{tok.slice(2, -2)}</b> : <code key={i++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal, safe markdown: headings, bullets, numbered lists, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•★⚠]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      flushPara();
      flushList();
      blocks.push(<h4 key={blocks.length}>{inline(head[2])}</h4>);
    } else if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}

export function relTime(ts: string | null): string {
  if (!ts) return "never";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return ts;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function StatusDot({ status }: { status: string | null }) {
  const label = status === "ready" ? "Ready" : status === "failed" ? "Failed" : status === "running" ? "Running" : "Not run yet";
  return (
    <span className={`status-dot ${status ?? "none"}`}>
      <span aria-hidden="true">{status === "running" ? "◌" : status === "failed" ? "✕" : "●"}</span> {label}
    </span>
  );
}
