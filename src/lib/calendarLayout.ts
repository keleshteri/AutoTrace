import type { CSSProperties } from "react";
import { parseLocalDateTime } from "./time";

export type TimedSpan = {
  id: string;
  started_at: string;
  ended_at: string | null;
  label: string;
  color: string;
  /** Primary session id for selection (if any) */
  sessionId?: number;
  pending?: boolean;
  idle?: boolean;
};

export type LaidOutBlock = TimedSpan & {
  top: number;
  height: number;
  col: number;
  colCount: number;
};

const GAP_MS = 90_000;

function startMs(iso: string): number {
  return parseLocalDateTime(iso).getTime();
}

function endMs(iso: string | null, now = Date.now()): number {
  if (!iso) return now;
  return parseLocalDateTime(iso).getTime();
}

/** Merge adjacent/overlapping spans that share the same coalesce key. */
export function coalesceSpans(
  spans: TimedSpan[],
  keyOf: (s: TimedSpan) => string,
): TimedSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort(
    (a, b) => startMs(a.started_at) - startMs(b.started_at),
  );
  const out: TimedSpan[] = [];
  let cur: TimedSpan | null = null;
  let curKey = "";

  for (const s of sorted) {
    const key = keyOf(s);
    if (!cur) {
      cur = { ...s };
      curKey = key;
      continue;
    }
    const curEnd = endMs(cur.ended_at);
    const nextStart = startMs(s.started_at);
    if (key === curKey && nextStart <= curEnd + GAP_MS) {
      const nextEnd = endMs(s.ended_at);
      if (nextEnd > curEnd) {
        cur = {
          ...cur,
          ended_at: s.ended_at,
          pending: Boolean(cur.pending || s.pending),
        };
      }
    } else {
      out.push(cur);
      cur = { ...s };
      curKey = key;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Pack overlapping blocks into side-by-side columns (calendar-style).
 */
export function layoutBlocks(
  spans: TimedSpan[],
  dayStartHour: number,
  hourHeight: number,
  now = new Date(),
): LaidOutBlock[] {
  const dayStart = dayStartHour * 60;
  const nowMs = now.getTime();

  type Internal = TimedSpan & {
    startMin: number;
    endMin: number;
    top: number;
    height: number;
  };

  const items: Internal[] = spans.map((s) => {
    const a = startMs(s.started_at);
    const b = s.ended_at ? endMs(s.ended_at) : nowMs;
    const startDate = new Date(a);
    const endDate = new Date(b);
    const startMin =
      startDate.getHours() * 60 +
      startDate.getMinutes() +
      startDate.getSeconds() / 60;
    const endMin =
      endDate.getHours() * 60 +
      endDate.getMinutes() +
      endDate.getSeconds() / 60;
    const safeEnd = Math.max(endMin, startMin + 1);
    const top = ((startMin - dayStart) / 60) * hourHeight;
    const rawHeight = ((safeEnd - startMin) / 60) * hourHeight;
    return {
      ...s,
      startMin,
      endMin: safeEnd,
      top: Math.max(0, top),
      height: Math.max(28, rawHeight),
    };
  });

  items.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const colEnds: number[] = [];
  const assigned: { item: Internal; col: number }[] = [];

  for (const item of items) {
    let col = colEnds.findIndex((end) => item.startMin >= end - 0.5);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(item.endMin);
    } else {
      colEnds[col] = item.endMin;
    }
    assigned.push({ item, col });
  }

  const result: LaidOutBlock[] = [];
  const used = new Set<number>();

  for (let i = 0; i < assigned.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < assigned.length; j++) {
        if (used.has(j)) continue;
        const a = assigned[j].item;
        const overlaps = group.some((gi) => {
          const b = assigned[gi].item;
          return a.startMin < b.endMin && b.startMin < a.endMin;
        });
        if (overlaps) {
          group.push(j);
          used.add(j);
          changed = true;
        }
      }
    }
    const maxCol = Math.max(...group.map((gi) => assigned[gi].col)) + 1;
    for (const gi of group) {
      const { item, col } = assigned[gi];
      result.push({
        id: item.id,
        started_at: item.started_at,
        ended_at: item.ended_at,
        label: item.label,
        color: item.color,
        sessionId: item.sessionId,
        pending: item.pending,
        idle: item.idle,
        top: item.top,
        height: item.height,
        col,
        colCount: maxCol,
      });
    }
  }

  return result;
}

export function blockStyle(block: LaidOutBlock): CSSProperties {
  const gap = 3;
  const widthPct = 100 / block.colCount;
  return {
    top: block.top,
    height: block.height,
    left: `calc(${block.col * widthPct}% + ${gap}px)`,
    width: `calc(${widthPct}% - ${gap * 2}px)`,
    right: "auto",
    background: block.color,
  };
}
