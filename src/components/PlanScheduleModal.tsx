import { FormEvent, useState } from "react";
import { api } from "../lib/api";

type Props = {
  day: string;
  onClose: () => void;
  onPlanned: () => void;
  onError: (msg: string | null) => void;
};

export function PlanScheduleModal({ day, onClose, onPlanned, onError }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const instructions = text.trim();
    if (!instructions) return;
    setBusy(true);
    try {
      await api.planSchedule(instructions, day);
      onError(null);
      onPlanned();
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="session-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="session-modal"
        role="dialog"
        aria-label="Plan Schedule"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="session-modal-head">
          <h2>Plan Schedule</h2>
          <button type="button" className="icon-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Create a series of planned sessions. Try: “Classic Pomodoro until 2pm” or “25 min focus
          with 5 min breaks, 4 rounds”.
        </p>
        <form onSubmit={(e) => void submit(e)}>
          <label className="muted session-field">
            Instructions
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add custom instructions on how you want to plan your schedule."
            />
          </label>
          <div className="session-modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary-pill"
              disabled={busy || !text.trim()}
            >
              Plan Schedule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
