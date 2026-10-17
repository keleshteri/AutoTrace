import { useEffect, useState } from "react";
import type { NavId } from "./Sidebar";

const SEEN_KEY = "autotrace.whatsNew.seen";

const SLIDES: { title: string; body: string; nav?: NavId; cta?: string }[] = [
  {
    title: "Simpler, grouped navigation",
    body: "The sidebar is now organised as Agent, Track and Analyze, and your pinned dashboards live right under Analyze.",
  },
  {
    title: "See where time goes in seconds",
    body: "Tracked Time works like a spreadsheet you don't have to build: pick rows, pick columns, add a filter. Busy cells are shaded, and every cell drills down to the exact entries behind it.",
    nav: "tracked",
    cta: "Open Tracked Time",
  },
  {
    title: "Save the views you check every week",
    body: "Save any view as a dashboard, or start from a template like Weekly timesheet. Dashboards are available to Reports, chat @mentions and MCP.",
    nav: "dashboards",
    cta: "Browse templates",
  },
  {
    title: "Reports with highlights and anomalies",
    body: "Run a report on a dashboard on demand or on a schedule. Highlights and anomalies are computed on this device; an AI summary is optional and never sees titles.",
    nav: "reports",
    cta: "Create a report",
  },
  {
    title: "Automate with Routines",
    body: "Start-of-day and end-of-day digests, weekly CSV timesheets, AI prompts and integration pushes — scheduled, with full run history.",
    nav: "routines",
    cta: "See routines",
  },
  {
    title: "Capacity at a glance",
    body: "Resourcing shows planned vs tracked against your weekly capacity, so overbooked weeks stand out before they start.",
    nav: "resourcing",
    cta: "Open Resourcing",
  },
  {
    title: "Meetings, tagged from transcripts",
    body: "Meetings come from your calendar. Attach a transcript export and AutoTrace matches the client and project locally — no bot joins your call.",
    nav: "meetings",
    cta: "Open Meetings",
  },
  {
    title: "Silent mode and a simpler Focus",
    body: "Silent mode hides reminders while you work and turns on automatically during focus. Your block list and top distractions sit next to the timer.",
    nav: "timer",
    cta: "Open Focus",
  },
  {
    title: "Mention anything in chat",
    body: "Type @ in the Agent chat to pick a client, project, task, app or dashboard. You see exactly what data the AI will get before you send.",
    nav: "ai",
    cta: "Try it",
  },
  {
    title: "Tell us what you think",
    body: "Help & feedback at the bottom of the sidebar opens a prefilled bug report or feature request. Nothing is sent until you submit it.",
  },
];

export function useWhatsNew(version: string | undefined) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!version) return;
    try {
      if (localStorage.getItem(SEEN_KEY) !== version) setVisible(true);
    } catch {
      /* storage unavailable: don't nag */
    }
  }, [version]);
  return {
    visible,
    open: () => setVisible(true),
    close: () => {
      setVisible(false);
      try {
        if (version) localStorage.setItem(SEEN_KEY, version);
      } catch {
        /* ignore */
      }
    },
  };
}

export function WhatsNew({ onClose, onNavigate }: { onClose: () => void; onNavigate: (id: NavId) => void }) {
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(SLIDES.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-label="What's new in AutoTrace" onClick={onClose}>
      <div className="modal-card whats-new" onClick={(e) => e.stopPropagation()}>
        <div className="whats-new-head">
          <span className="muted">What's new in AutoTrace</span>
          <span className="muted">
            {i + 1} of {SLIDES.length}
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <h3>{s.title}</h3>
        <p className="muted">{s.body}</p>
        {s.nav && s.cta && (
          <button type="button" className="btn ghost" onClick={() => onNavigate(s.nav!)}>
            {s.cta} →
          </button>
        )}
        <div className="whats-new-foot">
          <div className="dots" aria-hidden="true">
            {SLIDES.map((_, k) => (
              <span key={k} className={k === i ? "on" : undefined} />
            ))}
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Skip
          </button>
          <button type="button" className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
            ← Back
          </button>
          <button type="button" className="btn" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? "Done" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
