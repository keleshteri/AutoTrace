/** Pure timer ring / caption helpers (unit-tested). */

export type SessionKindLike = string | null | undefined;

export type FocusLike = {
  status: string;
  kind?: SessionKindLike;
  planned_secs?: number | null;
  elapsed_secs?: number | null;
} | null;

export function sessionCaption(focus: FocusLike, sinceBreak: boolean): string {
  if (!focus) return sinceBreak ? "Time since last break" : "Ready";
  const kind = (focus.kind || "focus").toLowerCase();
  if (focus.status === "paused") {
    if (kind === "meeting") return "Meeting paused";
    if (kind === "break") return "Break paused";
    return "Focus paused";
  }
  if (kind === "meeting") return "Meeting time elapsed";
  if (kind === "break") return "Break remaining";
  return "Focus time elapsed";
}

export function displaySecs(focus: FocusLike, sinceBreakSecs: number): number {
  if (!focus) return sinceBreakSecs;
  const planned = focus.planned_secs;
  const elapsed = focus.elapsed_secs ?? 0;
  if ((focus.kind || "").toLowerCase() === "break" && planned != null && planned > 0) {
    return Math.max(0, planned - elapsed);
  }
  return elapsed;
}

export function ringProgressPct(
  focus: FocusLike,
  shownSecs: number,
  focusDefaultMins: number,
): number {
  const kind = (focus?.kind || "focus").toLowerCase();
  const isBreak = kind === "break";
  const targetSecs =
    focus?.planned_secs && focus.planned_secs > 0
      ? focus.planned_secs
      : Math.max(1, focusDefaultMins) * 60;
  const progressBase =
    isBreak && focus?.planned_secs ? focus.planned_secs - shownSecs : shownSecs;
  return Math.min(100, (progressBase / targetSecs) * 100);
}
