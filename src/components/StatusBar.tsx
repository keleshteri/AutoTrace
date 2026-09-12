import { useEffect, useRef, useState } from "react";
import { FocusSession, SessionKind, formatElapsed, api } from "../lib/api";

type Props = {
  trackerStatus: string;
  currentApp: string | null;
  distractionBlocked?: string | null;
  focus: FocusSession | null;
  sinceBreakSecs?: number;
  breakReminder?: string | null;
  onBreak?: boolean;
  breakRemainingSecs?: number;
  onEndBreak?: () => void;
  startMenuOpen?: boolean;
  onToggleStartMenu?: () => void;
  onPickStartKind?: (kind: SessionKind) => void;
  onToggleTracking: () => void;
  onEndFocus: () => void;
  onPauseFocus?: () => void;
  onResumeFocus?: () => void;
  onOpenTimer: () => void;
};

type TrackId = "space" | "rain" | "focus";

const TRACKS: Record<TrackId, { title: string; freqs: number[]; types: OscillatorType[] }> = {
  space: { title: "Space Ambience", freqs: [110, 164.81, 220], types: ["sine", "triangle", "sine"] },
  rain: { title: "Soft Rain", freqs: [80, 120, 180, 240], types: ["sine", "sine", "triangle", "sine"] },
  focus: { title: "Focus Drone", freqs: [65.41, 98, 130.81], types: ["triangle", "sine", "sine"] },
};

function useAmbientPad(playing: boolean, track: TrackId) {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);

  useEffect(() => {
    for (const n of nodesRef.current) {
      try {
        n.osc.stop();
      } catch {
        /* */
      }
    }
    nodesRef.current = [];
    void ctxRef.current?.close();
    ctxRef.current = null;
    if (!playing) return;

    const spec = TRACKS[track];
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = track === "rain" ? 0.03 : 0.04;
    master.connect(ctx.destination);
    nodesRef.current = spec.freqs.map((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = spec.types[i] ?? "sine";
      osc.frequency.value = f;
      gain.gain.value = 0.28 / spec.freqs.length;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      return { osc, gain };
    });
    return () => {
      for (const n of nodesRef.current) {
        try {
          n.osc.stop();
        } catch {
          /* */
        }
      }
      nodesRef.current = [];
      void ctx.close();
    };
  }, [playing, track]);
}

function endLabel(focus: FocusSession | null): string {
  const kind = (focus?.kind || "focus").toLowerCase();
  if (kind === "meeting") return "End Meeting";
  if (kind === "break") return "End Break";
  return "End Focus";
}

function activeLabel(focus: FocusSession | null): string {
  const kind = (focus?.kind || "focus").toLowerCase();
  if (kind === "meeting") return "Meeting time elapsed";
  if (kind === "break") return "On break";
  return "Focus time elapsed";
}

export function StatusBar({
  trackerStatus,
  currentApp,
  distractionBlocked,
  focus,
  sinceBreakSecs = 0,
  breakReminder,
  onBreak,
  breakRemainingSecs = 0,
  onEndBreak,
  startMenuOpen,
  onToggleStartMenu,
  onPickStartKind,
  onToggleTracking,
  onEndFocus,
  onPauseFocus,
  onResumeFocus,
  onOpenTimer,
}: Props) {
  const trackingOn = trackerStatus === "running";
  const focusing = focus?.status === "active";
  const pausedFocus = focus?.status === "paused";
  const kind = (focus?.kind || "focus").toLowerCase();
  const [musicOn, setMusicOn] = useState(false);
  const [track, setTrack] = useState<TrackId>("space");
  const menuRef = useRef<HTMLDivElement>(null);
  useAmbientPad(musicOn, track);

  useEffect(() => {
    void api.getFeatureFlag("ambient_track").then((v) => {
      if (v === "rain" || v === "focus" || v === "space") setTrack(v);
    });
  }, []);

  useEffect(() => {
    if (!startMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        onToggleStartMenu?.();
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [startMenuOpen, onToggleStartMenu]);

  function cycleTrack() {
    const order: TrackId[] = ["space", "rain", "focus"];
    const next = order[(order.indexOf(track) + 1) % order.length];
    setTrack(next);
    void api.setFeatureFlag("ambient_track", next);
  }

  const displaySecs =
    onBreak || kind === "break"
      ? breakRemainingSecs
      : focusing || pausedFocus
        ? (focus?.elapsed_secs ?? 0)
        : sinceBreakSecs;

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <button
          type="button"
          className={`power-btn${trackingOn ? " on" : ""}`}
          title={trackingOn ? "Pause auto-tracking" : "Resume auto-tracking"}
          onClick={onToggleTracking}
          aria-label="Toggle tracking"
        >
          ⏻
        </button>
        <div
          className="status-meta"
          onClick={onOpenTimer}
          role="presentation"
          title={currentApp ?? undefined}
        >
          <span className={`focus-ring-mini${onBreak || kind === "break" ? " break" : ""}`} />
          <div>
            <div className="status-time">
              {formatElapsed(displaySecs)}
              {pausedFocus ? " (paused)" : ""}
            </div>
            <div className="status-label">
              {onBreak || kind === "break"
                ? "On break"
                : focusing || pausedFocus
                  ? (breakReminder ?? activeLabel(focus))
                  : (breakReminder ??
                    (distractionBlocked
                      ? `Blocked: ${distractionBlocked}`
                      : "Time since last break"))}
            </div>
          </div>
        </div>
        {onBreak || kind === "break" ? (
          <button type="button" className="end-focus-btn" onClick={onEndBreak ?? onEndFocus}>
            End Break
          </button>
        ) : focusing ? (
          <>
            {onPauseFocus && (
              <button type="button" className="end-focus-btn" onClick={onPauseFocus}>
                Pause
              </button>
            )}
            <button type="button" className="end-focus-btn" onClick={onEndFocus}>
              {endLabel(focus)}
            </button>
          </>
        ) : pausedFocus ? (
          <>
            {onResumeFocus && (
              <button type="button" className="end-focus-btn" onClick={onResumeFocus}>
                Resume
              </button>
            )}
            <button type="button" className="end-focus-btn" onClick={onEndFocus}>
              {endLabel(focus)}
            </button>
          </>
        ) : (
          <div className="status-start-wrap" ref={menuRef}>
            <button
              type="button"
              className="end-focus-btn"
              onClick={onToggleStartMenu}
            >
              Start ▾
            </button>
            {startMenuOpen && (
              <div className="timer-start-menu status-start-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => onPickStartKind?.("focus")}>
                  Start Focus
                </button>
                <button type="button" role="menuitem" onClick={() => onPickStartKind?.("meeting")}>
                  Start Meeting
                </button>
                <button type="button" role="menuitem" onClick={() => onPickStartKind?.("break")}>
                  Start Break
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="status-bar-right">
        <div className="ambient-player">
          <div className="ambient-art" aria-hidden>
            <span />
          </div>
          <div className="ambient-meta">
            <div className="ambient-title">{TRACKS[track].title}</div>
            <div className="ambient-sub">
              {musicOn ? "Playing (local synth)" : "Focus soundscape"}
            </div>
          </div>
          <button
            type="button"
            className="ambient-btn"
            aria-label={musicOn ? "Pause" : "Play"}
            onClick={() => setMusicOn((v) => !v)}
          >
            {musicOn ? "❚❚" : "▶"}
          </button>
          <button type="button" className="ambient-btn" aria-label="Next track" onClick={cycleTrack}>
            ⏭
          </button>
        </div>
      </div>
    </footer>
  );
}
