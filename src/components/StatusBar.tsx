import { useEffect, useRef, useState } from "react";
import { FocusSession, formatElapsed } from "../lib/api";

type Props = {
  trackerStatus: string;
  currentApp: string | null;
  focus: FocusSession | null;
  onToggleTracking: () => void;
  onStartFocus: () => void;
  onEndFocus: () => void;
  onOpenTimer: () => void;
};

/** Soft ambient pad via Web Audio (no external files). */
function useAmbientPad(playing: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);

  useEffect(() => {
    if (!playing) {
      for (const n of nodesRef.current) {
        try {
          n.osc.stop();
        } catch {
          /* already stopped */
        }
      }
      nodesRef.current = [];
      void ctxRef.current?.close();
      ctxRef.current = null;
      return;
    }
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.04;
    master.connect(ctx.destination);
    const freqs = [110, 164.81, 220];
    nodesRef.current = freqs.map((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      gain.gain.value = 0.3 / freqs.length;
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
  }, [playing]);
}

export function StatusBar({
  trackerStatus,
  currentApp,
  focus,
  onToggleTracking,
  onStartFocus,
  onEndFocus,
  onOpenTimer,
}: Props) {
  const trackingOn = trackerStatus === "running";
  const focusing = focus?.status === "active";
  const [musicOn, setMusicOn] = useState(false);
  useAmbientPad(musicOn);

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
          {focusing ? (
            <>
              <span className="focus-ring-mini" />
              <div>
                <div className="status-time">
                  {formatElapsed(focus.elapsed_secs)}
                </div>
                <div className="status-label">Focus time elapsed</div>
              </div>
            </>
          ) : (
            <div>
              <div className="status-time">
                {trackingOn ? "Tracking" : "Paused"}
              </div>
              <div className="status-label">
                {currentApp ?? "Tracking status"}
              </div>
            </div>
          )}
        </div>
        {focusing ? (
          <button type="button" className="end-focus-btn" onClick={onEndFocus}>
            End Focus
          </button>
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
            <div className="ambient-title">Space Ambience</div>
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
            aria-label="Volume"
            title="Volume fixed soft"
            disabled
          >
            ♪
          </button>
        </div>
      </div>
    </footer>
  );
}
