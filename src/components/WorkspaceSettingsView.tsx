import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  Workspace,
  WorkspaceSettings,
  defaultWorkspaceSettings,
  parseWorkspaceSettings,
} from "../lib/api";

type Props = {
  workspaceId?: number | null;
  onError: (msg: string | null) => void;
  onWorkspacesChanged?: () => void;
};

type Tab = "settings" | "features";

const FEATURE_ROWS: {
  key: keyof WorkspaceSettings["features"];
  title: string;
  blurb: string;
}[] = [
  {
    key: "profitability",
    title: "Profitability",
    blurb: "When enabled, the profitability dashboard will be available in the sidebar.",
  },
  {
    key: "invoicing",
    title: "Invoicing",
    blurb: "When enabled, invoicing fields are available in workspace settings.",
  },
  {
    key: "billable_hours",
    title: "Billable Hours",
    blurb: "When enabled, members can mark time entries as billable.",
  },
  {
    key: "tasks",
    title: "Tasks",
    blurb: "When enabled, members can tag time entries with a task.",
  },
  {
    key: "projects",
    title: "Projects",
    blurb: "When enabled, members can tag time entries with a project.",
  },
  {
    key: "clients",
    title: "Clients",
    blurb: "When enabled, the workspace can use clients for reports and grouping.",
  },
  {
    key: "client_tagging",
    title: "Client tagging",
    blurb: "Allows members and AI suggestions to tag time entries directly with clients.",
  },
  {
    key: "labels",
    title: "Labels",
    blurb: "When enabled, members can tag time entries with a label (shared categories).",
  },
  {
    key: "team_creation_admin_only",
    title: "Team creation",
    blurb: "When enabled, only workspace admins can create teams. Members can still be added to existing teams.",
  },
];

const ICONS = ["briefcase", "building", "users", "spark", "globe", "folder"] as const;

export function WorkspaceSettingsView({
  workspaceId,
  onError,
  onWorkspacesChanged,
}: Props) {
  const [tab, setTab] = useState<Tab>("settings");
  const [list, setList] = useState<Workspace[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("briefcase");
  const [settings, setSettings] = useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    try {
      const ws = await api.listWorkspaces();
      setList(ws);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = useMemo(() => {
    if (workspaceId != null) {
      return list.find((w) => w.id === workspaceId) ?? list.find((w) => w.is_active) ?? list[0];
    }
    return list.find((w) => w.is_active) ?? list[0];
  }, [list, workspaceId]);

  useEffect(() => {
    if (!active) return;
    setName(active.name);
    setIcon(active.icon || "briefcase");
    setSettings(parseWorkspaceSettings(active.settings_json));
  }, [active?.id, active?.name, active?.icon, active?.settings_json]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!active) return;
    try {
      await api.updateWorkspace(active.id, name.trim() || active.name, icon, JSON.stringify(settings));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      await refresh();
      onWorkspacesChanged?.();
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleFeature(key: keyof WorkspaceSettings["features"]) {
    const next = {
      ...settings,
      features: {
        ...settings.features,
        [key]: !settings.features[key],
      },
    };
    setSettings(next);
    if (!active) return;
    try {
      await api.updateWorkspace(active.id, name.trim() || active.name, icon, JSON.stringify(next));
      await refresh();
      onWorkspacesChanged?.();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const q = search.trim().toLowerCase();
  const featureRows = FEATURE_ROWS.filter(
    (r) => !q || r.title.toLowerCase().includes(q) || r.blurb.toLowerCase().includes(q),
  );

  if (!active) {
    return (
      <div className="page">
        <p className="muted">No workspace yet. Create one from the sidebar.</p>
      </div>
    );
  }

  return (
    <div className="page ws-settings">
      <div className="page-head">
        <div>
          <p className="kicker">Teams / {active.name}</p>
          <h2>Workspace Settings</h2>
        </div>
        <input
          className="search-input"
          style={{ maxWidth: 220, marginBottom: 0 }}
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="ws-tabs">
        <button
          type="button"
          className={tab === "settings" ? "active" : undefined}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
        <button
          type="button"
          className={tab === "features" ? "active" : undefined}
          onClick={() => setTab("features")}
        >
          Features
        </button>
      </div>

      {tab === "features" && (
        <div className="ws-card">
          <h3>Features</h3>
          <p className="muted">
            Enable or disable features for this workspace. App-wide privacy and tracking stay under
            Settings.
          </p>
          <div style={{ marginTop: 12 }}>
            {featureRows.map((row) => {
              const on = settings.features[row.key];
              return (
                <div key={row.key} className="ws-feature-row">
                  <div>
                    <div className="ws-feature-title">{row.title}</div>
                    <div className="muted">{row.blurb}</div>
                  </div>
                  <button
                    type="button"
                    className={`ws-toggle${on ? " on" : ""}`}
                    onClick={() => void toggleFeature(row.key)}
                    aria-pressed={on}
                  >
                    {on ? "On" : "Off"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "settings" && (
        <form onSubmit={(e) => void save(e)}>
          <div className="ws-card">
            <h3>Workspace Name</h3>
            <p className="muted">Change how your workspace name is displayed in the application.</p>
            <label className="muted" style={{ display: "block", marginTop: 12 }}>
              Name
              <input
                style={{ width: "100%", marginTop: 6 }}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="detail-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setName(active.name)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                {saved ? "Saved" : "Save"}
              </button>
            </div>
          </div>

          <div className="ws-card">
            <h3>Workspace Logo</h3>
            <p className="muted">
              Upload a logo for your workspace. When set, the logo replaces the icon in the sidebar.
            </p>
            <div className="detail-actions" style={{ marginTop: 12 }}>
              <label className="btn" style={{ cursor: "pointer" }}>
                Upload logo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const data = typeof reader.result === "string" ? reader.result : null;
                      setSettings((s) => ({ ...s, logo_data_url: data }));
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {settings.logo_data_url && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSettings((s) => ({ ...s, logo_data_url: null }))}
                >
                  Remove
                </button>
              )}
            </div>
            {settings.logo_data_url && (
              <img
                src={settings.logo_data_url}
                alt="Workspace logo"
                style={{ marginTop: 12, height: 48, borderRadius: 8 }}
              />
            )}
          </div>

          <div className="ws-card">
            <h3>Workspace Icon</h3>
            <p className="muted">
              Change the icon displayed for your workspace in the sidebar. Used when no logo is set.
            </p>
            <div className="ws-icon-grid">
              {ICONS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={icon === id ? "active" : undefined}
                  onClick={() => setIcon(id)}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>

          {settings.features.invoicing && (
            <div className="ws-card">
              <h3>Invoicing</h3>
              <p className="muted">Configure company details that appear on your invoices.</p>
              <label className="muted" style={{ display: "block", marginTop: 10 }}>
                Company Name
                <input
                  style={{ width: "100%", marginTop: 6 }}
                  value={settings.invoicing.company_name}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      invoicing: { ...settings.invoicing, company_name: e.target.value },
                    })
                  }
                />
              </label>
              <label className="muted" style={{ display: "block", marginTop: 10 }}>
                Company Address
                <input
                  style={{ width: "100%", marginTop: 6 }}
                  value={settings.invoicing.company_address}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      invoicing: { ...settings.invoicing, company_address: e.target.value },
                    })
                  }
                />
              </label>
              <label className="muted" style={{ display: "block", marginTop: 10 }}>
                Payment Instructions
                <textarea
                  style={{ width: "100%", marginTop: 6, minHeight: 72 }}
                  value={settings.invoicing.payment_instructions}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      invoicing: {
                        ...settings.invoicing,
                        payment_instructions: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <label className="muted" style={{ display: "block", marginTop: 10 }}>
                Default Payment Terms
                <select
                  style={{ width: "100%", marginTop: 6 }}
                  value={settings.invoicing.default_payment_terms}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      invoicing: {
                        ...settings.invoicing,
                        default_payment_terms: e.target.value,
                      },
                    })
                  }
                >
                  <option>Net 15</option>
                  <option>Net 30</option>
                  <option>Net 45</option>
                  <option>Due on receipt</option>
                </select>
              </label>
            </div>
          )}

          <div className="ws-card">
            <h3>Features</h3>
            <p className="muted">Enable or disable features for your workspace.</p>
            <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setTab("features")}>
              Manage Features
            </button>
          </div>

          <div className="detail-actions" style={{ marginTop: 8 }}>
            <button type="submit" className="primary">
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
