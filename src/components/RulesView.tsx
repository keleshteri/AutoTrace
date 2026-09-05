import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, Hierarchy, Rule } from "../lib/api";

type Props = { onError: (msg: string | null) => void };

export function RulesView({ onError }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [matchField, setMatchField] = useState("title");
  const [projectId, setProjectId] = useState<number | "">("");
  const [action, setAction] = useState("tag");
  const [priority, setPriority] = useState(10);

  const refresh = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([api.listRules(), api.getHierarchy()]);
      setRules(r);
      setHierarchy(h);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !pattern.trim()) return;
    let clientId: number | null = null;
    let pid: number | null = projectId === "" ? null : projectId;
    if (pid != null) {
      for (const c of hierarchy?.clients ?? []) {
        if (c.projects.some((p) => p.id === pid)) clientId = c.id;
      }
    }
    await api.createRule({
      name: name.trim(),
      pattern: pattern.trim(),
      matchField,
      clientId: action === "exclude" ? null : clientId,
      projectId: action === "exclude" ? null : pid,
      taskId: null,
      priority,
      action,
    });
    setName("");
    setPattern("");
    await refresh();
  }

  const projects =
    hierarchy?.clients.flatMap((c) =>
      c.projects.map((p) => ({ id: p.id, label: `${c.name} / ${p.name}` })),
    ) ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h2>Auto-tag rules</h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        When a new session starts, the highest-priority matching rule tags it
        offline (case-insensitive substring on title, app, or URL).
      </p>

      <form className="mini-form" onSubmit={(e) => void onCreate(e)}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Figma → Design" />
        </label>
        <label>
          Pattern
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="figma" />
        </label>
        <button type="submit">Add rule</button>
        <label>
          Match
          <select value={matchField} onChange={(e) => setMatchField(e.target.value)}>
            <option value="title">Window title</option>
            <option value="app">App name</option>
            <option value="url">URL</option>
          </select>
        </label>
        <label>
          Action
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="tag">Tag to project</option>
            <option value="exclude">Exclude from tracking</option>
          </select>
        </label>
        <label>
          Project
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
            disabled={action === "exclude"}
          >
            <option value="">Untagged / none</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 0)}
          />
        </label>
      </form>

      <ul className="tree">
        {rules.map((r) => (
          <li key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="tree-client">
                {r.name}{" "}
                <span className="muted">
                  ({r.action === "exclude" ? "exclude · " : ""}
                  {r.match_field}: “{r.pattern}”, p{r.priority})
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                style={{ background: r.enabled ? "var(--accent)" : "var(--bg-hover)" }}
                onClick={() => void api.setRuleEnabled(r.id, !r.enabled).then(refresh)}
              >
                {r.enabled ? "On" : "Off"}
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: "var(--bg-hover)" }}
                onClick={() => void api.deleteRule(r.id).then(refresh)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {rules.length === 0 && <li className="muted">No rules yet.</li>}
      </ul>
    </div>
  );
}
