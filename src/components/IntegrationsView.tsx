import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  ExportEntry,
  IntegrationRow,
  SyncLogRow,
} from "../lib/api";

type Props = {
  onError: (msg: string | null) => void;
};

const KIND_META: Record<
  string,
  { title: string; blurb: string; fields: { key: string; label: string; secret?: boolean }[] }
> = {
  clickup: {
    title: "ClickUp",
    blurb:
      "Push approved, tagged time entries as ClickUp time tracking. Never sends raw window titles or URLs.",
    fields: [
      { key: "api_token", label: "Personal API token", secret: true },
      { key: "team_id", label: "Team ID" },
    ],
  },
  webhook: {
    title: "Webhook",
    blurb:
      "POST approved entry summaries to your HTTPS endpoint. Optional shared secret signs X-AutoTrace-Signature.",
    fields: [
      { key: "url", label: "HTTPS URL" },
      { key: "secret", label: "Shared secret (optional)", secret: true },
    ],
  },
  local_api: {
    title: "Local export API",
    blurb:
      "Token-gated HTTP API on 127.0.0.1 only. Clients pull approved summaries — nothing leaves unless you call it.",
    fields: [
      { key: "port", label: "Port" },
      { key: "token", label: "Bearer token", secret: true },
    ],
  },
};

function parseConfig(json: string): Record<string, string> {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = val == null ? "" : String(val);
    }
    return out;
  } catch {
    return {};
  }
}

export function IntegrationsView({ onError }: Props) {
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [eligible, setEligible] = useState<ExportEntry[]>([]);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  const [apiStatus, setApiStatus] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, elig, sync, status] = await Promise.all([
        api.listIntegrations(),
        api.listEligibleExports(),
        api.listSyncLog(),
        api.localApiStatus(),
      ]);
      setRows(list);
      setEligible(elig);
      setLogs(sync);
      setApiStatus(status);
      const nextDrafts: Record<string, Record<string, string>> = {};
      const nextEnabled: Record<string, boolean> = {};
      for (const r of list) {
        nextDrafts[r.kind] = parseConfig(r.config_json);
        nextEnabled[r.kind] = r.enabled;
      }
      setDrafts(nextDrafts);
      setEnabled(nextEnabled);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(kind: string, e: FormEvent) {
    e.preventDefault();
    if (enabled[kind] && !consent[kind]) {
      onError("Confirm the consent checkbox before enabling an integration.");
      return;
    }
    try {
      const raw = { ...(drafts[kind] ?? {}) };
      const config: Record<string, unknown> = { ...raw };
      if (kind === "local_api") {
        config.port = Number(raw.port) || 17890;
      }
      if (kind === "clickup") {
        config.include_notes = raw.include_notes === "true";
      }
      await api.updateIntegration(kind, !!enabled[kind], JSON.stringify(config));
      setMsg(`Saved ${kind}.`);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnect(kind: string) {
    if (
      !window.confirm(
        `Disconnect ${kind}? This clears tokens, mappings, and sync history for it.`,
      )
    ) {
      return;
    }
    await api.disconnectIntegration(kind);
    setConsent((c) => ({ ...c, [kind]: false }));
    setMsg(`Disconnected ${kind}.`);
    await refresh();
  }

  async function push(kind: string) {
    try {
      const result = await api.pushIntegration(kind);
      const ok = result.results.filter((r) => r.ok).length;
      const bad = result.results.length - ok;
      setMsg(`Pushed to ${kind}: ${ok} ok, ${bad} failed.`);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Integrations</h2>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="kicker">Privacy rules</p>
        <ul className="muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          <li>Every connector is off until you enable it</li>
          <li>Only approved entries tagged to a client/project can sync</li>
          <li>Raw window titles and URLs are never sent</li>
          <li>Disconnect clears secrets and remote IDs for that connector</li>
        </ul>
        <p className="muted" style={{ marginTop: 10 }}>
          Local API: {apiStatus || "—"}
        </p>
        {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
      </div>

      {rows.map((row) => {
        const meta = KIND_META[row.kind] ?? {
          title: row.kind,
          blurb: "",
          fields: [],
        };
        const draft = drafts[row.kind] ?? {};
        return (
          <form
            key={row.kind}
            className="card"
            style={{ marginBottom: 12 }}
            onSubmit={(e) => void save(row.kind, e)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p className="kicker">{meta.title}</p>
                <p className="muted">{meta.blurb}</p>
              </div>
              <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!!enabled[row.kind]}
                  onChange={(e) =>
                    setEnabled((s) => ({ ...s, [row.kind]: e.target.checked }))
                  }
                />
                Enabled
              </label>
            </div>

            <div className="forms" style={{ marginTop: 10 }}>
              {meta.fields.map((f) => (
                <label key={f.key} className="muted">
                  {f.label}
                  <input
                    type={f.secret ? "password" : "text"}
                    value={draft[f.key] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        [row.kind]: { ...draft, [f.key]: e.target.value },
                      }))
                    }
                    placeholder={f.secret ? "••••••••" : undefined}
                    autoComplete="off"
                  />
                </label>
              ))}
              {row.kind === "clickup" && (
                <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={draft.include_notes === "true"}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        [row.kind]: {
                          ...draft,
                          include_notes: e.target.checked ? "true" : "false",
                        },
                      }))
                    }
                  />
                  Include notes in ClickUp description
                </label>
              )}
              <label className="muted" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={!!consent[row.kind]}
                  onChange={(e) =>
                    setConsent((c) => ({ ...c, [row.kind]: e.target.checked }))
                  }
                />
                <span>
                  I understand this may send approved project time summaries off this device
                  for {meta.title}.
                </span>
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="submit" className="btn">
                Save
              </button>
              {row.kind !== "local_api" && (
                <button
                  type="button"
                  className="btn"
                  disabled={!row.enabled}
                  onClick={() => void push(row.kind)}
                >
                  Push pending
                </button>
              )}
              <button
                type="button"
                className="btn"
                style={{ background: "#7f1d1d" }}
                onClick={() => void disconnect(row.kind)}
              >
                Disconnect
              </button>
            </div>
          </form>
        );
      })}

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="kicker">OAuth &amp; live calendars</p>
        <p className="muted">
          Paste your OAuth client ID/secret from the provider console. Redirect URI example:{" "}
          <code>http://127.0.0.1:17891/callback</code>
        </p>
        <OauthPanel onError={onError} setMsg={setMsg} />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="kicker">MCP (via local API)</p>
        <p className="muted">
          Enable Local export API, then <code>GET /v1/mcp/tools</code> and{" "}
          <code>POST /v1/mcp</code> with JSON {"{"}&quot;tool&quot;:&quot;day_report&quot;,&quot;arguments&quot;:{"{"}&quot;day&quot;:&quot;YYYY-MM-DD&quot;{"}"}{"}"}.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="kicker">Eligible to sync ({eligible.length})</p>
        <p className="muted">Approved + tagged + ended sessions.</p>
        <ul className="tree" style={{ marginTop: 8 }}>
          {eligible.slice(0, 20).map((e) => (
            <li key={e.session_id}>
              #{e.session_id} · {e.description} · {e.duration_mins}m
            </li>
          ))}
          {eligible.length === 0 && (
            <li className="muted">None yet — approve tagged sessions first.</li>
          )}
        </ul>
      </div>

      <div className="card">
        <p className="kicker">Recent sync log</p>
        <ul className="tree" style={{ marginTop: 8 }}>
          {logs.slice(0, 30).map((l) => (
            <li key={l.id}>
              session {l.session_id} · {l.status}
              {l.detail ? ` · ${l.detail}` : ""} · {l.synced_at}
            </li>
          ))}
          {logs.length === 0 && <li className="muted">No sync attempts yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function OauthPanel({
  onError,
  setMsg,
}: {
  onError: (m: string | null) => void;
  setMsg: (m: string | null) => void;
}) {
  const [provider, setProvider] = useState("google");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirect, setRedirect] = useState("http://127.0.0.1:17891/callback");
  const [code, setCode] = useState("");
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="mini-form" style={{ marginTop: 10, display: "grid", gap: 8 }}>
      <select value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="google">Google Calendar</option>
        <option value="outlook">Outlook Calendar</option>
        <option value="clickup">ClickUp OAuth</option>
      </select>
      <input
        placeholder="Client ID"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      />
      <input
        placeholder="Client secret"
        type="password"
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
      />
      <input
        placeholder="Redirect URI"
        value={redirect}
        onChange={(e) => setRedirect(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        onClick={() =>
          void api
            .oauthAuthorizeUrl(provider, clientId, redirect)
            .then((url) => {
              window.open(url, "_blank");
              setMsg("Browser opened — paste the auth code below");
            })
            .catch((e) => onError(String(e)))
        }
      >
        Open authorize URL
      </button>
      <input
        placeholder="Authorization code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button
        type="button"
        className="primary"
        onClick={() =>
          void api
            .oauthExchangeCode({
              provider,
              clientId,
              clientSecret,
              redirectUri: redirect,
              code,
            })
            .then((r) => setMsg(r))
            .catch((e) => onError(String(e)))
        }
      >
        Exchange code
      </button>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button
          type="button"
          className="btn"
          onClick={() =>
            void api
              .syncGoogleCalendar(day)
              .then((n) => setMsg(`Imported ${n} Google events`))
              .catch((e) => onError(String(e)))
          }
        >
          Sync Google day
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            void api
              .syncOutlookCalendar(day)
              .then((n) => setMsg(`Imported ${n} Outlook events`))
              .catch((e) => onError(String(e)))
          }
        >
          Sync Outlook day
        </button>
      </div>
    </div>
  );
}
