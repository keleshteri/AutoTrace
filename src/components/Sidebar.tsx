import type { ReactNode } from "react";
import { AutoTraceLogo } from "./AutoTraceLogo";

type NavId =
  | "calendar"
  | "timer"
  | "activity"
  | "focus"
  | "projects"
  | "clients"
  | "tasks"
  | "rules"
  | "reports"
  | "integrations"
  | "settings";

type Props = {
  active: NavId;
  onNavigate: (id: NavId) => void;
  trackerStatus: string;
  currentApp: string | null;
};

const NAV: {
  id: NavId;
  label: string;
  section?: string;
  icon: ReactNode;
}[] = [
  {
    id: "calendar",
    label: "Calendar",
    section: "Track",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: "timer",
    label: "Timer",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 1.5M9 3h6" />
      </svg>
    ),
  },
  {
    id: "activity",
    label: "Activity",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 14h3l2-5 3 10 2-5h6" />
      </svg>
    ),
  },
  {
    id: "focus",
    label: "Focus digest",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: "projects",
    label: "Projects",
    section: "Work",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 7h16v12H4zM8 7V5h8v2" />
      </svg>
    ),
  },
  {
    id: "clients",
    label: "Clients",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="9" cy="8" r="3" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3 19c0-3 3-5 6-5s6 2 6 5M14 19c.3-1.8 1.8-3 3.5-3 1.4 0 2.7.8 3.2 2" />
      </svg>
    ),
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    ),
  },
  {
    id: "rules",
    label: "Rules",
    section: "Automate",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 7h16M4 12h10M4 17h7" />
        <circle cx="18" cy="12" r="2" />
        <circle cx="15" cy="17" r="2" />
      </svg>
    ),
  },
  {
    id: "reports",
    label: "Reports",
    section: "Analyze",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 19V5M4 19h16M8 15v4M12 10v9M16 7v12" />
      </svg>
    ),
  },
  {
    id: "integrations",
    label: "Integrations",
    section: "Admin",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M8 12h8M12 8v8" />
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
      </svg>
    ),
  },
];

export type { NavId };

export function Sidebar({
  active,
  onNavigate,
  trackerStatus,
  currentApp,
}: Props) {
  let lastSection = "";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">
          <AutoTraceLogo size={26} />
          <span>AutoTrace</span>
        </div>
      </div>

      <button type="button" className="workspace-pill">
        <span className="avatar">AT</span>
        <span>Personal</span>
      </button>

      {NAV.map((item) => {
        const showSection = item.section && item.section !== lastSection;
        if (item.section) lastSection = item.section;
        return (
          <div key={item.id}>
            {showSection && <div className="nav-section">{item.section}</div>}
            <button
              type="button"
              className={`nav-item${active === item.id ? " active" : ""}`}
              onClick={() => onNavigate(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}

      <div className="sidebar-foot">
        <div className="tracker-chip">
          <div className="label">Live capture</div>
          <div className="value">{currentApp ?? "Waiting for activity"}</div>
          <div
            className={`status${trackerStatus === "running" ? "" : " paused"}`}
          >
            {trackerStatus}
          </div>
        </div>
      </div>
    </aside>
  );
}
