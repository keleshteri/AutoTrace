import { useEffect, useRef, useState } from "react";
import { FocusSession, formatElapsed, api } from "../lib/api";

type Props = {
  trackerStatus: string;
  currentApp: string | null;
  distractionBlocked?: string | null;
  focus: FocusSession | null;
  breakReminder?: string | null;
  onBreak?: boolean;
  breakRemainingSecs?: number;
  onEndBreak?: () => void;
  onToggleTracking: () => void;
  onStartFocus: () => void;
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

export function StatusBar({
  trackerStatus,
  currentApp,
  distractionBlocked,
  focus,
  breakReminder,
  onBreak,
  breakRemainingSecs = 0,
  onEndBreak,
  onToggleTracking,
  onStartFocus,
  onEndFocus,
  onPauseFocus,
  onResumeFocus,
  onOpenTimer,
}: Props) {
  const trackingOn = trackerStatus === "running";
  const focusing = focus?.status === "active";
  const pausedFocus = focus?.status === "paused";
  const [musicOn, setMusicOn] = useState(false);
  const [track, setTrack] = useState<TrackId>("space");
  useAmbientPad(musicOn, track);

  useEffect(() => {
    void api.getFeatureFlag("ambient_track").then((v) => {
      if (v === "rain" || v === "focus" || v === "space") setTrack(v);
    });
  }, []);

  function cycleTrack() {
    const order: TrackId[] = ["space", "rain", "focus"];
    const next = order[(order.indexOf(track) + 1) % order.length];
    setTrack(next);
    void api.setFeatureFlag("ambient_track", next);
  }

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
        <div className="status-meta" onClick={onOpenTimer} role="presentation">
          {onBreak ? (
            <>
              <span className="focus-ring-mini break" />
              <div>
                <div className="status-time">{formatElapsed(breakRemainingSecs)}</div>
                <div className="status-label">On break</div>
              </div>
            </>
          ) : focusing || pausedFocus ? (
            <>
              <span className="focus-ring-mini" />
              <div>
                <div className="status-time">
                  {formatElapsed(focus?.elapsed_secs ?? 0)}
                  {pausedFocus ? " (paused)" : ""}
                </div>
                <div className="status-label">
                  {breakReminder ?? "Focus time elapsed"}
                </div>
              </div>
            </>
          ) : (
            <div>
              <div className="status-time">
                {trackingOn ? "Tracking" : "Paused"}
              </div>
              <div className="status-label">
                {distractionBlocked
                  ? `Blocked: ${distractionBlocked}`
                  : (currentApp ?? "Tracking status")}
              </div>
            </div>
          )}
        </div>
        {onBreak ? (
          <button type="button" className="end-focus-btn" onClick={onEndBreak}>
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
              End Focus
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
              End Focus
            </button>
          </>
        ) : (
          <button type="button" className="end-focus-btn" onClick={onStartFocus}>
            Start Focus
          </button>
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
          <button
            type="button"
            className="ambient-btn"
            aria-label="Next track"
            title="Cycle ambient track"
            onClick={cycleTrack}
          >
            ♪
          </button>
        </div>
      </div>
    </footer>
  );
}
