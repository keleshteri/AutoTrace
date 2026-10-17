import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { AutoTraceLogo } from "./AutoTraceLogo";
import type { Workspace, WorkspaceFeatures } from "../lib/api";
import { parseWorkspaceSettings } from "../lib/api";

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
  | "profit"
  | "teams"
  | "integrations"
  | "ai"
  | "settings"
  | "workspace"
  | "ws_overview"
  | "ws_dashboards"
  | "routines"
  | "meetings"
  | "tracked"
  | "resourcing"
  | "dashboards"
  | "dashboard";

type Props = {
  active: NavId;
  onNavigate: (id: NavId) => void;
  trackerStatus: string;
  currentApp: string | null;
  workspaces?: Workspace[];
  onSwitchWorkspace?: (id: number) => void;
  pinnedDashboards?: { id: number; name: string }[];
  activeDashboardId?: number | null;
  onOpenDashboard?: (id: number) => void;
  onHelp?: (action: "docs" | "bug" | "feature" | "changelog") => void;
  onCreateWorkspace?: (name: string) => void;
};

const NAV: {
  id: NavId;
  label: string;
  section?: string;
  feature?: keyof WorkspaceFeatures;
  icon: ReactNode;
}[] = [
  {
    id: "ai",
    section: "Agent",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
      </svg>
    ),
  },
  {
    id: "routines",
    label: "Routines",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
        <path d="M18 3v4h-4M6 21v-4h4" />
      </svg>
    ),
  },
  {
    id: "timer",
    label: "Focus",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 1.5M9 3h6" />
      </svg>
    ),
  },
  {
    id: "calendar",
    section: "Track",
    label: "Calendar",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
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
    id: "meetings",
    label: "Meetings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3" />
      </svg>
    ),
  },
  {
    id: "tracked",
    section: "Analyze",
    label: "Tracked Time",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 19V5M4 19h16" />
        <rect x="7" y="11" width="3" height="5" rx="1" />
        <rect x="12" y="7" width="3" height="9" rx="1" />
        <rect x="17" y="13" width="3" height="3" rx="1" />
      </svg>
    ),
  },
  {
    id: "resourcing",
    label: "Resourcing",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 14h3M8 17h6" />
      </svg>
    ),
  },
  {
    id: "profit",
    label: "Profitability",
    feature: "profitability",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 19h16M6 16l4-6 3 3 5-8" />
      </svg>
    ),
  },
  {
    id: "reports",
    label: "Reports",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 19V5M4 19h16M8 15v4M12 10v9M16 7v12" />
      </svg>
    ),
  },
  {
    id: "dashboards",
    label: "Dashboards",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 19h16M6 15l4-4 3 3 5-6" />
      </svg>
    ),
  },
  {
    id: "focus",
    label: "Focus insights",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: "teams",
    label: "Teams",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="9" cy="8" r="3" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3 19c0-3 3-5 6-5s6 2 6 5M13 19c.5-2 2.5-3.5 5-3.5 1.2 0 2.3.4 3 1" />
      </svg>
    ),
  },
  {
    id: "projects",
    section: "Work",
    label: "Projects",
    feature: "projects",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 7h16v12H4zM8 7V5h8v2" />
      </svg>
    ),
  },
  {
    id: "clients",
    label: "Clients",
    feature: "clients",
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
    feature: "tasks",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    ),
  },
  {
    id: "rules",
    section: "Automate",
    label: "Rules",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 7h16M4 12h10M4 17h7" />
        <circle cx="18" cy="12" r="2" />
        <circle cx="15" cy="17" r="2" />
      </svg>
    ),
  },
  {
    id: "integrations",
    section: "Admin",
    label: "Integrations",
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
  workspaces = [],
  onSwitchWorkspace,
  onCreateWorkspace,
  pinnedDashboards = [],
  activeDashboardId = null,
  onOpenDashboard,
  onHelp,
}: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [teamsOpen, setTeamsOpen] = useState(true);

  const activeWs = workspaces.find((w) => w.is_active) ?? workspaces[0];
  const features = useMemo(
    () => parseWorkspaceSettings(activeWs?.settings_json).features,
    [activeWs?.settings_json],
  );
  const logo = parseWorkspaceSettings(activeWs?.settings_json).logo_data_url;

  let lastSection = "";
  const visibleNav = NAV.filter((item) => {
    if (!item.feature) return true;
    return features[item.feature];
  });

  function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !onCreateWorkspace) return;
    onCreateWorkspace(newName.trim());
    setNewName("");
    setSwitchOpen(false);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">
          <AutoTraceLogo size={26} />
          <span>AutoTrace</span>
        </div>
      </div>

      <div className="workspace-switcher">
        <button
          type="button"
          className="workspace-pill"
          onClick={() => setSwitchOpen((v) => !v)}
        >
          {logo ? (
            <img src={logo} alt="" className="avatar-img" />
          ) : (
            <span className="avatar">{(activeWs?.name ?? "AT").slice(0, 2).toUpperCase()}</span>
          )}
          <span className="workspace-pill-name">{activeWs?.name ?? "Workspace"}</span>
        </button>
        {switchOpen && (
          <div className="workspace-menu">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                className={w.is_active ? "active" : undefined}
                onClick={() => {
                  onSwitchWorkspace?.(w.id);
                  setSwitchOpen(false);
                }}
              >
                {w.name}
                {w.is_active ? " · active" : ""}
              </button>
            ))}
            <form onSubmit={submitCreate} className="workspace-create">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New workspace name"
              />
              <button type="submit" className="btn">
                Add
              </button>
            </form>
          </div>
        )}
      </div>

      {visibleNav.map((item) => {
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
            {item.id === "dashboards" &&
              pinnedDashboards.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`nav-item nested${active === "dashboard" && activeDashboardId === d.id ? " active" : ""}`}
                  onClick={() => onOpenDashboard?.(d.id)}
                  title={d.name}
                >
                  <span className="nav-nested-label">{d.name}</span>
                </button>
              ))}
          </div>
        );
      })}

      <div className="nav-section" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="teams-toggle"
          onClick={() => setTeamsOpen((v) => !v)}
        >
          Your Teams {teamsOpen ? "▾" : "▸"}
        </button>
      </div>
      {teamsOpen && activeWs && (
        <div className="your-teams">
          <div className="your-teams-name">{activeWs.name}</div>
          <button
            type="button"
            className={`nav-item nested${active === "ws_overview" ? " active" : ""}`}
            onClick={() => onNavigate("ws_overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={`nav-item nested${active === "dashboards" ? " active" : ""}`}
            onClick={() => onNavigate("dashboards")}
          >
            Dashboards
          </button>
          <button
            type="button"
            className={`nav-item nested${active === "workspace" ? " active" : ""}`}
            onClick={() => onNavigate("workspace")}
          >
            Settings
          </button>
        </div>
      )}
      <button
        type="button"
        className="nav-item"
        onClick={() => {
          setSwitchOpen(true);
          setNewName("");
        }}
      >
        + Add Workspace
      </button>

      <div className="sidebar-help">
        <button
          type="button"
          className="nav-item"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" />
          </svg>
          <span>Help & feedback</span>
        </button>
        {helpOpen && (
          <div className="help-menu" role="menu">
            {(
              [
                ["docs", "Docs"],
                ["bug", "Report a bug"],
                ["feature", "Request a feature"],
                ["changelog", "What's new"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setHelpOpen(false);
                  onHelp?.(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        <div className="tracker-chip">
          <div className="label">Live capture</div>
          <div className="value">{currentApp ?? "Waiting for activity"}</div>
          <div className={`status${trackerStatus === "running" ? "" : " paused"}`}>
            {trackerStatus}
          </div>
        </div>
      </div>
    </aside>
  );
}
