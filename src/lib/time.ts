/** Shared layout helpers for the Rize-style day grid. */

export const HOUR_HEIGHT = 64;
export const DAY_START_HOUR = 4;
export const DAY_END_HOUR = 23;

export const BLOCK_COLORS = [
  "#7c5cfa",
  "#22c55e",
  "#f97316",
  "#ef4444",
  "#3b82f6",
  "#14b8a6",
  "#eab308",
  "#ec4899",
] as const;

export const FOCUS_COLOR = "#22d3ee";
export const ACTIVITY_COLOR = "#7c5cfa";
export const BREAK_COLOR = "#6366f1";

export function parseLocalDateTime(iso: string): Date {
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  return new Date(normalized);
}

export function minutesSinceMidnight(iso: string): number {
  const d = parseLocalDateTime(iso);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function blockGeometry(
  startedAt: string,
  endedAt: string | null,
  now = new Date(),
): { top: number; height: number } {
  const startMin = minutesSinceMidnight(startedAt);
  const endMin = endedAt
    ? minutesSinceMidnight(endedAt)
    : now.getHours() * 60 + now.getMinutes();
  const dayStart = DAY_START_HOUR * 60;
  const top = ((startMin - dayStart) / 60) * HOUR_HEIGHT;
  const rawHeight =
    ((Math.max(endMin, startMin + 1) - startMin) / 60) * HOUR_HEIGHT;
  return {
    top: Math.max(0, top),
    height: Math.max(22, rawHeight),
  };
}

export function colorForKey(key: string | number | null | undefined): string {
  const s = String(key ?? "default");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return BLOCK_COLORS[Math.abs(hash) % BLOCK_COLORS.length];
}

export function formatDayHeading(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function weekDays(day: string): string[] {
  const start = mondayOf(day);
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}

export function weekNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const oneJan = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - oneJan.getTime()) / 86400000);
  return Math.ceil((days + oneJan.getDay() + 1) / 7);
}

export function monthLabel(day: string): string {
  const [y, m] = day.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function shiftMonth(day: string, delta: number): string {
  const [y, m] = day.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

export function monthGrid(day: string): string[] {
  const [y, m] = day.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => shiftDay(start, i));
}

export function totalMinutes(
  sessions: { started_at: string; ended_at: string | null; idle: boolean }[],
): number {
  let total = 0;
  const now = Date.now();
  for (const s of sessions) {
    if (s.idle) continue;
    const a = parseLocalDateTime(s.started_at).getTime();
    const b = s.ended_at ? parseLocalDateTime(s.ended_at).getTime() : now;
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      total += Math.max(0, b - a);
    }
  }
  return Math.round(total / 60000);
}

export function elapsedMinutes(
  sessions: { started_at: string; ended_at: string | null }[],
): number {
  let total = 0;
  const now = Date.now();
  for (const s of sessions) {
    const a = parseLocalDateTime(s.started_at).getTime();
    const b = s.ended_at ? parseLocalDateTime(s.ended_at).getTime() : now;
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      total += Math.max(0, b - a);
    }
  }
  return Math.round(total / 60000);
}

export function formatHoursMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return `${h} hr ${String(m).padStart(2, "0")} min`;
}

export function formatHourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}
